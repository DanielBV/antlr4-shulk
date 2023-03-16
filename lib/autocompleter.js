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
import PrecedencePredicateTransition from 'antlr4/src/antlr4/transition/PrecedencePredicateTransition';


const caret = new antlr4.CommonToken();
const STOP = Symbol("Stop");

class ThrowErrorListener extends antlr4.error.ErrorListener {
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
    //TODO esto no me acaba de convencer
    this.suggestion = null;
    this.isRule = isRule;
  }

  polish(lexer, parser) {
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
      recovery: []
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
        const startingRule = this.options?.initialRule ?? DEFAULT_INITIAL_RULE;
        const initialState = parser.atn.ruleToStartState[startingRule];
        if (initialState === undefined) throw new Error("Unexpected starting rule: " + startingRule);
        if (!this.options) this.options = {};
        if (!this.options.suggestRules) this.options.suggestRules = new Set();
        if (!this.options.recovery) this.options.recovery = [];
        this.options.__cache = {};
        for (const rule of parser.atn.ruleToStartState) {
          //TODO simplify the ruleNames, symbolicNames, which are not necessary here
          this.options.__cache[rule.ruleIndex] = process(parser.ruleNames, this._lexer.symbolicNames, rule, [caret], [[rule.ruleIndex, STOP, 0]], 
            // To keep the parserStack of the suggestions consistent, the cache stores Suggestions, not just the token
            [], 0, parser.atn, {recovery: [], suggestRules: new Set()});
        }
        //TODO test to see what happens if I remove the cache. WTF el ultimo contador pasa de 1 a 201
        //this.options.__cache = null;

        const suggestions = process(parser.ruleNames, 
          this._lexer.symbolicNames, 
          initialState, 
          tokenList, 
          // Technically it's not necessary to add the startingRule to the stack but that results in more intuitive token contexts
          [[startingRule, STOP, 0]],
          //TODO allow setting the initial rule to autocomplete
          [], 0, parser.atn, this.options); // No hay un parser.atn.INITIAL o algo así?
        const filtered = this.options?.ignoreSuggestionsInNonDefaultChannels 
          ? suggestions
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
        : suggestions;
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

function onFail(stack, ruleNames, vocabulary, state, tokens, parserStack, alreadyPassed, 
  tokenStreamIndex, atn, options, rule) {
    const {andFindToken, thenGoToRule, skipOne} = rule;
    for (let i = tokenStreamIndex; i < tokens.length; i++) {
      if (tokens[i].type === andFindToken) {
        recoverCounter += 1;
        stack.push([atn.ruleToStartState[thenGoToRule],ruleNames, vocabulary, 
          // We add the current rule to the parser stack as if it had been entered through a RuleStartTransition
          tokens, parserStack/*TODO Pending a.remainingStack*/, [] /* Rset the alreadyPassed*/, skipOne ? i + 1 : i , atn, options]);
        return;
        }
      }   
}

function process(ruleNames, vocabulary, state, tokens, parserStack, alreadyPassed, 
  tokenStreamIndex, atn, options) {
    //TODO quitar la duplicidad de nombres
  //console.log("-".repeat(tokenStreamIndex) + "> " + ruleNames[state.ruleIndex] + "  " + collector.length)
  let limitNextState = null;

  const suggestions = [];
  const stack = [[state, ruleNames, vocabulary, tokens, parserStack, alreadyPassed, tokenStreamIndex, atn, options]];
  while (stack.length !== 0) {
    let [state, ruleNames, vocabulary, tokens, parserStack, alreadyPassed, tokenStreamIndex, atn, options, lastNumber, passed, recoveryRule] = 
      stack[stack.length - 1].length === 9 ? stack.pop() : stack[stack.length - 1];
      //console.log(state.stateNumber);

      const tryToRecover = (rule) => onFail(stack, ruleNames, vocabulary, state, tokens, parserStack, alreadyPassed, 
        tokenStreamIndex, atn, options, rule);
      if (lastNumber !== undefined && passed !== undefined) {
        if (passed) {
          stack.pop();
          if (suggestions.length === lastNumber) tryToRecover(recoveryRule);
          continue;
        }
        stack[stack.length - 1][10] = true;
      }
      
 
      // The main rule isn't included in the stack, but still has a StopState.
      if (state instanceof RuleStopState && parserStack.length !== 0) {
        const [lastRule, nextState] = parserStack[parserStack.length-1];
        //console.log(`Exiting rule ${ruleNames[state.ruleIndex]} -> ${nextState.toString()}`);
        if (!state.ruleIndex === lastRule)
          throw new Error("Unexpected situation. Exited a rule that isn't the last one that was entered");
          limitNextState = nextState;
          // It's important to make a shallow copy to avoid affecting the other alternatives.
          parserStack = parserStack.slice(0,-1);
      } else {
        limitNextState = null;
      }

    
      //Reverses the order so that the first transition is at the top of the stack
      for (let i = state.transitions.length - 1; i >= 0; i--) {
        const it = state.transitions[i];
        //if (!it.isEpsilon) {console.log("QUÉ NO ES EPSILON" + it.label)};
        if (it.isEpsilon) {
          if (!alreadyPassed.includes(it.target.stateNumber)) {
            const newParserStack = it instanceof RuleTransition ? [...parserStack, [it.ruleIndex, it.followState, it.precedence]] : parserStack;
            //if (it instanceof RuleTransition) console.log(`Entering rule ${ruleNames[it.ruleIndex]}`);
            if (it instanceof PrecedencePredicateTransition && it.precedence < parserStack[parserStack.length - 1][2]) 
              continue;
            
            const nextToken = tokens[tokenStreamIndex];
            if (it instanceof RuleTransition) {
              if (nextToken === caret) {
                if (options.suggestRules.has(it.ruleIndex)) {
                  suggestions.push(new Suggestion(prettifyContextStack(parserStack), it.ruleIndex, true));
                  continue; 
                } else if (options.__cache) {
                  const prettifyStack = prettifyContextStack(parserStack);
                  // In theory the cached suggestion could have several contexes, and therefore to get the final context we add the current to each of them
                  suggestions.push(...options.__cache[it.target.ruleIndex].map(s => {
                    const newSuggestion = new Suggestion(
                    s.ctxs.map(c => [...prettifyStack, ...c]),
                    s._raw, false);
                    // TODO currently you can't set the ctxts directly from the constructor, since it grabs the ctx and it wraps it in a list.
                    newSuggestion.ctxs =  s.ctxs.map(c => [...prettifyStack, ...c]);
                    return newSuggestion;
                  }));
                  continue;
                }
                // The next token isn't in the first set of the rule, so there is no point in entering there.
                // This is useful to avoid useless recoveries
                //TODO do somethign with that map()
              } else if (options.__cache && !options.__cache[it.target.ruleIndex].map(s => s._raw).includes(nextToken.type))
                continue;
            }

            // Doesn't increase 'tokenStreamIndex' because it doesn't consume tokens
            if (limitNextState && it.target !== limitNextState) continue;
            let index = options.recovery.map(x => x.ifInRule).indexOf(it.ruleIndex);
            if (it instanceof RuleTransition && index != -1) {
              stack.push([it.target, ruleNames, vocabulary, tokens,
                newParserStack, state instanceof RuleStopState  ? [] : [...alreadyPassed, it.target.stateNumber],
                tokenStreamIndex, atn, options, suggestions.length, false, options.recovery[index]]);
            } else {
              stack.push([it.target, ruleNames, vocabulary, tokens,
                newParserStack, state instanceof RuleStopState ? [] : [...alreadyPassed, it.target.stateNumber],
                tokenStreamIndex, atn, options]);
            }
          }
          } else if (it instanceof NotSetTransition) { 
            const nextToken = tokens[tokenStreamIndex];
            if (nextToken === caret) {
                suggestions.push(...intervalToSuggestionArray(complement.bind(it.label)(antlr4.Token.MIN_USER_TOKEN_TYPE, atn.maxTokenType), parserStack));
            } else {
              if (!it.label.contains(nextToken.type)) {
                stack.push([it.target, ruleNames, vocabulary, tokens, parserStack, [], tokenStreamIndex + 1, atn, options]);
              }
              //TODO aquí faltaría un recovering?
            }
          
        } else if (it instanceof AtomTransition || it instanceof SetTransition) {
          const nextToken = tokens[tokenStreamIndex];
          if (nextToken === caret) {
              suggestions.push(...intervalToSuggestionArray(it.label, parserStack));
          } else {
            // I'm not sure why each label can have multiple intervals
            if (it.label.contains(nextToken.type)) {
              // I'm not sure about the tokens. He does tokens.move() because he uses a custom stream type that who knows where he implemented it
              // Note that you don't pass the 'alreadyPassAttribute' because otherwise it would stop recursion. 
              //  this attribute is to avoid loops in the same rule
              stack.push([it.target, ruleNames, vocabulary, tokens, parserStack, [], tokenStreamIndex + 1, atn, options]);
            } else {
              //console.log("Fallo: " + vocabulary[it.label.intervals[0]] + "  found: " + nextToken.text)
            }
          }
    
        // The instanceof of NotSetTransition must be before the SetTransition because NoSet inherits from Set
        } else if (it instanceof  WildcardTransition) {
          const nextToken = tokens[tokenStreamIndex];
          if (nextToken === caret) {
            suggestions.push(...intervalToSuggestionArray({intervals: [{start: antlr4.Token.MIN_USER_TOKEN_TYPE, stop: atn.maxTokenType+1}]}, parserStack));
          } else {
            stack.push([it.target, ruleNames, vocabulary, tokens, parserStack, [], tokenStreamIndex + 1, atn, options]);
          }    
       } else {
          console.log("EY " + it.constructor.name);
        }
      };
  }
  return suggestions;
}