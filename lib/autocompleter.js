import antlr4 from 'antlr4';
import RuleStartState from 'antlr4/src/antlr4/state/RuleStartState.js';
import RuleStopState  from 'antlr4/src/antlr4/state/RuleStopState.js';
import AtomTransition from 'antlr4/src/antlr4/transition/AtomTransition.js';
import SetTransition from 'antlr4/src/antlr4/transition/SetTransition.js';
import BasicState from 'antlr4/src/antlr4/state/BasicState.js';
import WildcardTransition from 'antlr4/src/antlr4/transition/WildcardTransition.js';
import RuleTransition from 'antlr4/src/antlr4/transition/RuleTransition.js';


const caret = new antlr4.CommonToken();

class ThrowErrorListener extends antlr4.error.ErrorListener {
  constructor() {
      super();
  }

  syntaxError(recognizer, offendingSymbol, line, column, msg, e) {
      throw new Error("line " + line + ":" + column + " " + msg);
  }
}

export default class Autocompleter {
    constructor(Lexer, Parser) {
        this._lexer = Lexer;
        this._parser = Parser;
    }

    autocomplete(input) {
        const chars = new antlr4.CharStreams.fromString(input);
        const lexer = new this._lexer(chars);
        lexer.removeErrorListeners();
        lexer.addErrorListener(new ThrowErrorListener())
        const all = lexer.getAllTokens();
        const tokenList = all.filter(x => x.channel === 0);
        tokenList.push(caret);
        const parser = new this._parser(lexer);
        const collector = [];
        process(parser.ruleNames, 
          this._lexer.symbolicNames, 
          parser.atn.states[0], 
          tokenList, 
          collector, 
          [],
          //new ParserStack([], parser.ruleNames), 
          [], 0, parser.atn); // No hay un parser.atn.INITIAL o algo así?
        const tokenCollector = collector.map(x => x === -1 
          ? "EOF" : this._lexer.symbolicNames[x] || this._lexer.literalNames[x].slice(1, -1));
        const filtered = tokenCollector.filter(x => {
          // Crap, here the x is already the x and not the token type
          if (lexer.atn.lexerActions[x]?.channel !== undefined)
            return lexer.atn.lexerActions[x].channel !== antlr4.Token.DEFAULT_CHANNEL
          return true;
        })
        return filtered;
    }
}


function intervalToArray(interval) {
  let values= [];
  let n = interval.intervals.length;
  for (let i = 0; i < n; i++) {
    let I = interval.intervals[i];
    let a = I.start;
    let b = I.stop;
    // Careful. Intervals are open in the right, thats why < and not <=
    for (let v = a; v < b; v++) {
      values.push(v);
    }
  }

  return values;
}

function process(ruleNames, vocabulary, state, tokens, collector, parserStack, alreadyPassed, tokenStreamIndex, atn) {
  //const stackRes = parserStack.process(state);
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
  state.transitions.forEach(it => {
    if (it.isEpsilon) {
      if (!alreadyPassed.includes(it.target.stateNumber)) {
        //TODO Review precedence
        const newParserStack = it instanceof RuleTransition ? [...parserStack, [it.ruleIndex, it.followState]] : parserStack;
        //console.log("Pasamos por un epsilon " + state.stateNumber + " -> "+ it.target.stateNumber );
        // Doesn't increase 'tokenStreamIndex' because it doesn't consume tokens
        if (limitNextState && it.target !== limitNextState) return;
        process(ruleNames, vocabulary, it.target, tokens,  collector,
          newParserStack, [...alreadyPassed, it.target.stateNumber],
          tokenStreamIndex, atn)
      }
    } else if (it instanceof AtomTransition) {
      //console.log(it);
      const nextToken = tokens[tokenStreamIndex];
      if (nextToken === caret) {
          collector.push(...intervalToArray(it.label));
      } else {
        // I find it interesting that here it's not necessary to check if the stack is compatible, which means it should always
        // be compatible.
        console.log(`${tokenStreamIndex} - Atom transition: Expected ${vocabulary[it.label]} - Found ${vocabulary[nextToken.type]}`);
        // I'm not sure why each label can have multiple intervals
        if (it.label.intervals.some(x => x.contains(nextToken.type))) {
          // I'm not sure about the tokens. He does tokens.move() because he uses a custom stream type that who knows where he implemented it
          // Note that you don't pass the 'alreadyPassAttribute' because otherwise it would stop recursion. 
          //  this attribute is to avoid loops in the same rule
          process(ruleNames, vocabulary, it.target, tokens,  collector, parserStack, [], tokenStreamIndex + 1, atn);
        }
      }
    } else if (it instanceof SetTransition) {
      const nextToken = tokens[tokenStreamIndex];
      if (nextToken === caret) {
          collector.push(...intervalToArray(it.label));
      } else {
        console.log(`${tokenStreamIndex} Set transition: Expected ${intervalToArray(it.label).map(x => vocabulary[x])} - Found ${vocabulary[nextToken.type]}`);
        if (it.label.contains(nextToken.type)) {
          process(ruleNames, vocabulary, it.target, tokens,  collector, parserStack, [], tokenStreamIndex + 1, atn);
        }
      }
     
      // TODO could the label have several intervals?
      // This is on antlr4-c3 and it confuses me A LOT
      //if (label && label.size > 0) {
      //  if (transition.serializationType === TransitionType.NOT_SET) {
    } else if (it instanceof  WildcardTransition) {
      const nextToken = tokens[tokenStreamIndex];
      if (nextToken === caret) {
        collector.push(...intervalToArray({intervals: [{start: antlr4.Token.MIN_USER_TOKEN_TYPE, stop: atn.maxTokenType+1}]}));
      } else {
        process(ruleNames, vocabulary, it.target, tokens,  collector, parserStack, [], tokenStreamIndex + 1, atn);
      }    
   } else {
      console.log("EY " + it.constructor.name);
    }
  });
}