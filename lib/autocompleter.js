import antlr4 from 'antlr4';
import RuleStartState from 'antlr4/src/antlr4/state/RuleStartState.js';
import RuleStopState  from 'antlr4/src/antlr4/state/RuleStopState.js';
import AtomTransition from 'antlr4/src/antlr4/transition/AtomTransition.js';
import SetTransition from 'antlr4/src/antlr4/transition/SetTransition.js';
import NotSetTransition from 'antlr4/src/antlr4/transition/NotSetTransition.js';
import BasicState from 'antlr4/src/antlr4/state/BasicState.js';
import WildcardTransition from 'antlr4/src/antlr4/transition/WildcardTransition.js';
import RuleTransition from 'antlr4/src/antlr4/transition/RuleTransition.js';
import findLexerActions from './LexerActionFinder';
import { complement, intervalToArray } from './utils/intervalSet';


const caret = new antlr4.CommonToken();

class ThrowErrorListener extends antlr4.error.ErrorListener {
  constructor() {
      super();
  }

  syntaxError(recognizer, offendingSymbol, line, column, msg, e) {
      throw new Error("line " + line + ":" + column + " " + msg);
  }
}
const DEFAULT_INITIAL_RULE = 0;
let recoverCounter = 0;

class Suggestion {
  constructor(ctx, rawSuggestion, isRule) {
    this.ctxs = [ctx];
    this._raw = rawSuggestion;
    this.suggestion = null;
    this.isRule = isRule;
  }

  polish(lexer, parser) {
    console.log(this.suggestion);
    const x = this._raw;
    if (this.isRule) this.suggestion = parser.ruleNames[x];
    else this.suggestion = x === -1 ? "EOF" : lexer.symbolicNames[x] || lexer.literalNames[x].slice(1, -1);
  }
}

// If two suggestions are duplicated, they are fused by keeping one and fusing the contextes
function groupSuggestions(suggestions) {
  const tSuggestionByName = {};
  const rSuggestionByName = {};
  // They are kept in another array in order to keep the order
  const grouped = [];
  for (const s of suggestions) {
    let register = s.isRule ? rSuggestionByName : tSuggestionByName;
    if (register[s._raw]) register[s._raw].ctxs = register[s._raw].ctxs.concat(s.ctxs);
    else {
      grouped.push(s);
      register[s._raw] = s;
    }
  }
  return grouped;
}

function prettifyContextStack(stack) {
  return stack.map(([ruleIndex, nextState]) => ruleIndex);
}

export default class Autocompleter {
    constructor(Lexer, Parser, options = {
      // This won't be a problem for 99.9999% of grammars and it adds a slight impact in performance
      ignoreSuggestionsInNonDefaultChannels: false,
      initialRule: DEFAULT_INITIAL_RULE,
      suggestRules: new Set(),
      recovery: {}
    }) {
        this._lexer = Lexer;
        this._parser = Parser;
        this.options = options;
    }

    autocomplete(input) {
        const chars = new antlr4.CharStreams.fromString(input);
        recoverCounter = 0;
        const lexer = new this._lexer(chars);
        lexer.removeErrorListeners();
        lexer.addErrorListener(new ThrowErrorListener())
        const all = lexer.getAllTokens();
        const tokenList = all.filter(x => x.channel === 0);
        tokenList.push(caret);
        const parser = new this._parser(lexer);
        const collector = [];
        const startingRule = this.options?.initialRule ?? DEFAULT_INITIAL_RULE;
        const initialState = parser.atn.ruleToStartState[startingRule];
        if (initialState === undefined) throw new Error("Unexpected starting rule: " + startingRule);
        if (!this.options) this.options = {};
        if (!this.options.suggestRules) this.options.suggestRules = new Set();
        if (!this.options.recovery) this.options.recovery = {};
        process(parser.ruleNames, 
          this._lexer.symbolicNames, 
          initialState, 
          tokenList, 
          collector, 
          // Technically it's not necessary to add the startingRule to the stack but that results in more intuitive token contexts
          [[startingRule, null]],
          //TODO allow setting the initial rule to autocomplete
          [], 0, parser.atn, this.options); // No hay un parser.atn.INITIAL o algo así?
        const filtered = this.options?.ignoreSuggestionsInNonDefaultChannels 
          ? collector
          .filter(x => {
            let rule;
            for (const [i, tokenType] of lexer.atn.ruleToTokenType.entries()) {
              if (x._raw === tokenType) {
                rule = i;
                break;
              }
            } 
            // This shouldn't happen but just in case return true
            if (rule === undefined) return true;
            const actions = findLexerActions(lexer.atn.ruleToStartState[rule]);
            return !actions.some(x => {
              const channel = lexer.atn.lexerActions[x].channel;
              return channel !== undefined && channel !==  antlr4.Token.DEFAULT_CHANNEL
            });
          })
        : collector;
        const grouped = groupSuggestions(filtered);
        grouped.forEach(x => x.polish(this._lexer, this._parser));
        console.log("Contador" + recoverCounter);
        return [...new Set(grouped)];
    }
}


function intervalToSuggestionArray(interval, parserStack) {
  return intervalToArray(interval).map(x => new Suggestion(prettifyContextStack(parserStack), x, false));
}

//let x = foo; 
// The ; or another let allows you to end. But the ; exits the current rule while the let starts a new one.
// But remember that the focus is to get to the caret
function isInside(value, stack) {
  for (let i = stack.length - 1; i >= 0; i--) {
    const test = stack[i][0];
    if (test === value) {
      return {result: true, remainingStack: stack.slice(0, i+1)}
    }
  }
  return {result: false};
}

function onFail(ruleNames, vocabulary, state, tokens, collector, parserStack, alreadyPassed, 
  tokenStreamIndex, atn, options, rule) {
    const {andFindToken, thenGoToRule, skipOne} = rule;
    for (let i = tokenStreamIndex; i < tokens.length; i++) {
      if (tokens[i].type === andFindToken) {
        recoverCounter += 1;
        process(ruleNames, vocabulary, 
          atn.ruleToStartState[thenGoToRule], 
          tokens, collector, parserStack/*TODO Pending a.remainingStack*/, [] /* Rset the alreadyPassed*/, skipOne ? i + 1 : i , atn, options);
        return;
        }
      }   
}

function process(ruleNames, vocabulary, state, tokens, collector, parserStack, alreadyPassed, 
  tokenStreamIndex, atn, options) {
  //console.log("-".repeat(tokenStreamIndex) + "> " + ruleNames[state.ruleIndex] + "  " + collector.length)
  let limitNextState = null;
  // The main rule isn't included in the stack, but still has a StopState.
  if (state instanceof RuleStopState && parserStack.length !== 0) {
    const [lastRule, nextState] = parserStack[parserStack.length-1];
    if (!state.ruleIndex === lastRule)
      throw new Error("Unexpected situation. Exited a rule that isn't the last one that was entered");
      limitNextState = nextState;
      // It's important to make a shallow copy to avoid affecting the other alternatives.
      parserStack = parserStack.slice(0,-1);
  }
  let needsRecovering = false;
  const nextStack = [];
  let process2 = function() {nextStack.push(arguments)};
  const tryToRecover = (rule) => onFail(ruleNames, vocabulary, state, tokens, collector, parserStack, alreadyPassed, 
    tokenStreamIndex, atn, options, rule);
  state.transitions.forEach(it => {
    if (it.isEpsilon) {
      if (!alreadyPassed.includes(it.target.stateNumber)) {
        //TODO Review precedence
        const newParserStack = it instanceof RuleTransition ? [...parserStack, [it.ruleIndex, it.followState]] : parserStack;
        const nextToken = tokens[tokenStreamIndex];
        if (it instanceof RuleTransition && nextToken === caret && options.suggestRules.has(it.ruleIndex)) {
          collector.push(new Suggestion(parserStack, it.ruleIndex, true));
          return; 
        }
        // Doesn't increase 'tokenStreamIndex' because it doesn't consume tokens
        if (limitNextState && it.target !== limitNextState) return;
        let index = options.recovery.map(x => x.ifInRule).indexOf(it.ruleIndex);
        if (it instanceof RuleTransition && index != -1) {
          let before = collector.length;
          process(ruleNames, vocabulary, it.target, tokens,  collector,
            newParserStack, [...alreadyPassed, it.target.stateNumber],
            tokenStreamIndex, atn, options)
          let after = collector.length;
          //console.log("Rule" + ruleNames[it.ruleIndex]);
          if (before === after) {
            //console.log("UPSIE");
            tryToRecover(options.recovery[index]);
          }
        } else {
          process2(ruleNames, vocabulary, it.target, tokens,  collector,
            newParserStack, [...alreadyPassed, it.target.stateNumber],
            tokenStreamIndex, atn, options);
        }
      }
    } else if (it instanceof AtomTransition) {
      const nextToken = tokens[tokenStreamIndex];
      if (nextToken === caret) {
          collector.push(...intervalToSuggestionArray(it.label, parserStack));
      } else {
        // I'm not sure why each label can have multiple intervals
        if (it.label.intervals.some(x => x.contains(nextToken.type))) {
          // I'm not sure about the tokens. He does tokens.move() because he uses a custom stream type that who knows where he implemented it
          // Note that you don't pass the 'alreadyPassAttribute' because otherwise it would stop recursion. 
          //  this attribute is to avoid loops in the same rule
          process2(ruleNames, vocabulary, it.target, tokens,  collector, parserStack, [], tokenStreamIndex + 1, atn, options);
        } else {
          needsRecovering = true;
        }
      }

    // The instanceof of NotSetTransition must be before the SetTransition because NoSet inherits from Set
    } else if (it instanceof NotSetTransition) { 
      const nextToken = tokens[tokenStreamIndex];
      if (nextToken === caret) {
          collector.push(...intervalToSuggestionArray(complement.bind(it.label)(antlr4.Token.MIN_USER_TOKEN_TYPE, atn.maxTokenType), parserStack));
      } else {
        if (!it.label.contains(nextToken.type)) {
          process2(ruleNames, vocabulary, it.target, tokens,  collector, parserStack, [], tokenStreamIndex + 1, atn, options);
        }
        //TODO aquí faltaría un recovering?
      }
    } else if (it instanceof SetTransition) {
      const nextToken = tokens[tokenStreamIndex];
      if (nextToken === caret) {
          collector.push(...intervalToSuggestionArray(it.label, parserStack));
      } else {
        //console.log(`${tokenStreamIndex} Set transition: Expected ${intervalToArray(it.label).map(x => vocabulary[x])} - Found ${vocabulary[nextToken.type]}`);
        if (it.label.contains(nextToken.type)) {
          process2(ruleNames, vocabulary, it.target, tokens,  collector, parserStack, [], tokenStreamIndex + 1, atn, options);
        } else {
          needsRecovering = true;
        }
      }
    } else if (it instanceof  WildcardTransition) {
      const nextToken = tokens[tokenStreamIndex];
      if (nextToken === caret) {
        collector.push(...intervalToSuggestionArray({intervals: [{start: antlr4.Token.MIN_USER_TOKEN_TYPE, stop: atn.maxTokenType+1}]}, parserStack));
      } else {
        process2(ruleNames, vocabulary, it.target, tokens,  collector, parserStack, [], tokenStreamIndex + 1, atn, options);
      }    
   } else {
      console.log("EY " + it.constructor.name);
    }
  });
  // TODO VER Podría detectar que si al iniciar una regla todos devuelven [], entrar una vez en recovery. O igual controlar de mejor forma qué pasa 
  // cuando entro en una regla. Quizá marcarlo de alguna forma. Devolver si ha funcionado alguna rama o no con el return.
  // En algún momento se saldrá de la regla pero se seguirá mediante recursión, no?
  nextStack.forEach(args => process(...args));
  if (nextStack.length === 0 && needsRecovering) {
    //tryToRecover();
  }

}