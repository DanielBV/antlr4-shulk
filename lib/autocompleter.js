import antlr4 from 'antlr4';
import RuleStartState from 'antlr4/src/antlr4/state/RuleStartState.js';
import RuleStopState  from 'antlr4/src/antlr4/state/RuleStopState.js';
import AtomTransition from 'antlr4/src/antlr4/transition/AtomTransition.js';
import SetTransition from 'antlr4/src/antlr4/transition/SetTransition.js';
import BasicState from 'antlr4/src/antlr4/state/BasicState.js';

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
        process(parser.ruleNames, this._lexer.symbolicNames, parser.atn.states[0], tokenList, collector, new ParserStack([], parser.ruleNames), [], 0); // No hay un parser.atn.INITIAL o algo así?
        console.log(collector);
        const tokenCollector = collector.map(x => x === -1 ? "EOF" : this._lexer.symbolicNames[x] || this._lexer.literalNames[x].slice(1, -1));
        return tokenCollector;
    }
}

class ParserStack {

  constructor(stateList, ruleNames) {
    this.stateList = stateList;
    this.ruleNames = ruleNames;
  }

  process(state) {
    if (state instanceof RuleStartState) {
      console.log("Stack says Rule start --> " + this.ruleNames[state.ruleIndex] );
      // The  boolean is if it's compatible currently with the stack
      return [true, new ParserStack([...this.stateList, state], this.ruleNames)]
    } else if (state instanceof RuleStopState) {
      // How can the machine go to an invalid state? Is it even possible?
      const last = this.stateList[this.stateList.length-1];
      if (last instanceof RuleStartState && last.stopState === state) {
        console.log("Successfully ended rule " + this.ruleNames[state.ruleIndex])
      }
    } else if (state instanceof BasicState) {
      //TODO note that, unlike RuleStartState, here you don't add the BasicState to the stack 
      return [true, this];
    }
    return [true, this];
  }
}

//TODO is there really a situation when it's not compatible?
// Check antlr4-autosuggest isParseableWithAddedToken
function isCompatibleWithStack(state, parserStack) {
  return true;
  const resStack = parserStack.process(state);
  if (resStack[0]) {
    // Shouldn't it walk any epsilon transition? Not just if all are epsilon transitions
    if (state.epsilonOnlyTransitions) {
      state.transitions.some(x => isCompatibleWithStack(x.target, resStack[1]));
    } else return true;
  } else {
    //TODO I'm not really sure when this can happen
    return false;
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

function process(ruleNames, vocabulary, state, tokens, collector, parserStack, alreadyPassed, tokenStreamIndex) {
  const stackRes = parserStack.process(state);
  state.transitions.forEach(it => {
    const desc = "mistery";

    if (it.isEpsilon) {
      if (!alreadyPassed.includes(it.target.stateNumber)) {
        //console.log("Pasamos por un epsilon " + state.stateNumber + " -> "+ it.target.stateNumber );
        // Doesn't increase 'tokenStreamIndex' because it doesn't consume tokens
        process(ruleNames, vocabulary, it.target, tokens,  collector,
          stackRes[1], [...alreadyPassed, it.target.stateNumber],
          tokenStreamIndex)
      }
    } else if (it instanceof AtomTransition) {
      //console.log(it);
      const nextToken = tokens[tokenStreamIndex];
      if (nextToken === caret) {
        if (isCompatibleWithStack(it.target, parserStack)) {
          collector.push(...intervalToArray(it.label));
        }
      } else {
        // I find it interesting that here it's not necessary to check if the stack is compatible, which means it should always
        // be compatible.
        console.log(`${tokenStreamIndex} - Atom transition: Expected ${vocabulary[it.label]} - Found ${vocabulary[nextToken.type]}`);
        // I'm not sure why each label can have multiple intervals
        if (it.label.intervals.some(x => x.contains(nextToken.type))) {
          console.log("HEY LISTEN")
          // I'm not sure about the tokens. He does tokens.move() because he uses a custom stream type that who knows where he implemented it
          // Note that you don't pass the 'alreadyPassAttribute' because otherwise it would stop recursion. 
          //  this attribute is to avoid loops in the same rule
          process(ruleNames, vocabulary, it.target, tokens,  collector, stackRes[1], [], tokenStreamIndex + 1)
        }
      }
    } else if (it instanceof SetTransition) {
      const nextToken = tokens[tokenStreamIndex];
      if (nextToken === caret) {
        if (isCompatibleWithStack(it.target, parserStack)) {
          collector.push(...intervalToArray(it.label));
        }
      } else {
        console.log(`${tokenStreamIndex} Set transition: Expected ${intervalToArray(it.label).map(x => vocabulary[x])} - Found ${vocabulary[nextToken.type]}`);
        if (it.label.contains(nextToken.type)) {
          process(ruleNames, vocabulary, it.target, tokens,  collector, stackRes[1], [], tokenStreamIndex + 1);
        }
      }
     
      // TODO could the label have several intervals?
      // This is on antlr4-c3 and it confuses me A LOT
      //if (label && label.size > 0) {
      //  if (transition.serializationType === TransitionType.NOT_SET) {
    
    } else {
      console.log("EY " + it.constructor.name);
    }
  });
}