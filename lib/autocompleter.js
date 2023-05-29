
import antlr4 from 'antlr4';
import AtomTransition from 'antlr4/src/antlr4/transition/AtomTransition.js';
import RuleTransition from 'antlr4/src/antlr4/transition/RuleTransition';
import SetTransition from 'antlr4/src/antlr4/transition/SetTransition.js';
import RuleStopState  from 'antlr4/src/antlr4/state/RuleStopState.js';
import NotSetTransition from 'antlr4/src/antlr4/transition/NotSetTransition.js';
import PrecedencePredicateTransition from 'antlr4/src/antlr4/transition/PrecedencePredicateTransition';
import { complement, intervalToArray } from './utils/intervalSet';
import WildcardTransition from 'antlr4/src/antlr4/transition/WildcardTransition.js';
import findLexerActions from './utils/LexerActionFinder';

const DEBUG = 0;
const caret = new antlr4.CommonToken();
const STOP = Symbol("Stop");
const DEFAULT_INITIAL_RULE = 0;
const DEFAULT_OPTS = {
    // This won't be a problem for 99.9999% of grammars and it adds a slight impact in performance
    ignoreSuggestionsInNonDefaultChannels: false,
    initialRule: DEFAULT_INITIAL_RULE,
    suggestRules: new Set(),
    recovery: []
};


class DebugStats {
    constructor() {
        this._recoveries = {};
    }

    recovery(rule) {
        const id = `${rule.ifInRule}-${rule.andFindToken}-${rule.thenGoToRule}`;
        let val = this._recoveries[id];
        if (!val) {
            val = {rule, attempts: 0};
            this._recoveries[id] = val;
        }
        val.attempts +=1;
    }

    toString() {
        return JSON.stringify(this._recoveries);
    }
}

class Suggestion {
    constructor(id, ctxt, isRule=false) {
        this.id = id; //Id of the token or rule 
        this.ctxt = [ctxt];
        this.isRule= isRule;
    }

    // Slightly weird methods for more friendly access names. Maybe I should have done inheritance
    get token() {return this.isRule ? null : this.id;}
    get rule() {return this.isRule ? this.id : null;}
}

function groupSuggestions(suggestions) {
    const tSuggestionByName = {};
    const rSuggestionByName = {};
    const grouped = [];
    for (const s of suggestions) {
        let register = false ? rSuggestionByName : tSuggestionByName;
        if (register[s.token]) register[s.token].ctxt = register[s.token].ctxt.concat(s.ctxt);
        else {
            grouped.push(s);
            register[s.token] = s;
        }
    }
    return grouped;
}


class ThrowErrorListener extends antlr4.error.ErrorListener {
    syntaxError(recognizer, offendingSymbol, line, column, msg, e) {
        throw new Error("line " + line + ":" + column + " " + msg);
    }
}

class Autocompleter {
    constructor(Lexer, Parser, options=DEFAULT_OPTS) {
        this._lexer = Lexer;
        this._parser = Parser;
        this._atn = null;
        this.options = options ? options : DEFAULT_OPTS;
    }

    get atn() {return this._atn;}
    get parserRuleNames() {return this._parser.ruleNames;}

    autocomplete(input) {
        const chars = new antlr4.CharStreams.fromString(input);
        const lexer = new this._lexer(chars);
        lexer.removeErrorListeners();
        lexer.addErrorListener(new ThrowErrorListener())
        const all = lexer.getAllTokens();
        const tokenList = all.filter(x => x.channel === 0);
        tokenList.push(caret);

        const parser = new this._parser(lexer);
        this._atn = parser.atn;
        const startingRule = this.options?.initialRule ?? DEFAULT_INITIAL_RULE;
        const initialState = parser.atn.ruleToStartState[startingRule];
        if (initialState === undefined) throw new Error("Unexpected starting rule: " + startingRule);

        const stack = [[0, initialState, [], [[startingRule, STOP, 0]]]];
        this._debugStats = new DebugStats();
        this.options.debugStats = this._debugStats;
        if (!this.options.suggestRules) this.options.suggestRules = new Set();
        this.options.__cache = {};
        for (const rule of parser.atn.ruleToStartState) {
            this.options.__cache[rule.ruleIndex] = this._executeATN(
                [caret],
                [[0, parser.atn.ruleToStartState[rule.ruleIndex], [], [[rule.ruleIndex, STOP, 0]]]],
                // To keep the parserStack of the suggestions consistent, the cache stores Suggestions, not just the token
                {...this.options, recovery: [], __cache: null, suggestRules: new Set()}, parser.atn);
        }
        const suggestions = this._executeATN(tokenList, stack, this.options);
        const grouped = groupSuggestions(suggestions);
        return this.options?.ignoreSuggestionsInNonDefaultChannels ? this._filterNonDefaultChannels(grouped, lexer): grouped;
    }

    log(msg, stack) {
        if (DEBUG) console.log(`${" ".repeat(stack.length*2)} - ${msg}`) 
    }

    _executeATN(tokens, stack, options) {
        const suggestions = [];

        while(stack.length !== 0) {
            let [tokenStreamIndex, state, alreadyPassed, parserStack, recoveryData] = stack.pop();
            this.log(`[${state.stateNumber}] Next token: ${tokens[tokenStreamIndex]}. Already passed: ${alreadyPassed}`, stack)
            let limitNextState = null;


            if (recoveryData !== undefined) {
                // If the number doesn't match, it means the rule hasn't failed
                if (suggestions.length !== recoveryData.suggestions) continue;
                let rule = recoveryData.recoveryRules[0];
                this._onFail(stack, tokens, parserStack, tokenStreamIndex, rule, options, state);
                // If it has nSuggestions it means it's a rule that has already been traversed and therefore
                // we shouldn't traverse it again
                continue;
            }

            // In theory it should never be 0
            if (state instanceof RuleStopState && parserStack.length !== 0) {
                const [lastRule, nextState] = parserStack[parserStack.length-1];
                this.log(`[${state.stateNumber}] - Finished rule ${this.parserRuleNames[state.ruleIndex]} going to state ${nextState.toString()}`, stack)
                if (!state.ruleIndex === lastRule)
                    throw new Error("Unexpected situation. Exited a rule that isn't the last one that was entered");
                limitNextState = nextState;
                // It's important to make a shallow copy to avoid affecting the other alternatives.
                parserStack = parserStack.slice(0,-1);
            }
    
            // Iterates through the transitions in reverse order so that the first transition is processed first (therefore it's pushed the last)
            // This way if the grammar says '(A|B|C)', the autocompleter will suggest them in that same order
            for (let i = state.transitions.length - 1; i >= 0; i--) {
                const it = state.transitions[i];
                if (it.isEpsilon && !alreadyPassed.includes(it.target.stateNumber)) {
                    if (it instanceof PrecedencePredicateTransition && it.precedence < parserStack[parserStack.length - 1][2]) 
                        continue;

                    const nextToken = tokens[tokenStreamIndex];
                    if (it instanceof RuleTransition) {
                        if (nextToken === caret) {
                            if (options.suggestRules.has(it.ruleIndex)) {
                                suggestions.push(new Suggestion(it.ruleIndex, parserStack.map(y => y[0]),true));
                                continue;
                            } else if(options.__cache) { 
                                options.__cache[it.target.ruleIndex]?.forEach(s => suggestions.push(new Suggestion(s.token, [...(parserStack.map(x => x[0])), ...(s.ctxt[0])])));
                                continue;
                            } 
                            // If there is no cache then it must keep going and enter the rule to find the suggestions
                        } else if (options.__cache && !options.__cache[it.target.ruleIndex].map(s => s.token).includes(nextToken.type))
                        // This means that the next token doesn't match any of the first possible tokens of the rule. So we ignore this 
                        // transition since it's going to fail either way. Plus entering the rule could end up triggering an unnecessary
                        // recovery (since the failure is guaranteed)
                            continue;
                    }
          
                    const newParserStack = it instanceof RuleTransition ? [...parserStack, [it.ruleIndex, it.followState, it.precedence]] : parserStack;
                    this.log(`[${state.stateNumber}] ${it instanceof RuleTransition ? `Entering rule ${it.ruleIndex}` : `Epsilon transition to ${it.target}`}`, stack);
                    // Doesn't increase 'tokenStreamIndex' because it doesn't consume tokens
                    if (limitNextState && it.target !== limitNextState) continue;
                    let recoveryRules = options?.recovery ? options.recovery.filter(x => x.ifInRule === it.ruleIndex) : [];
                    if (it instanceof RuleTransition && recoveryRules.length > 0) {
                        // We are going to enter a rule that has a recovery rule.
                        // Repush the current state but adding the number of suggestions and then add 
                        // the next state
                        stack.push([tokenStreamIndex, state, alreadyPassed, parserStack, {suggestions: suggestions.length, recoveryRules}]);
                    } 
                    stack.push([tokenStreamIndex, it.target, 
                        it instanceof RuleTransition || state instanceof RuleStopState ? 
                            []:[it.target.stateNumber, ...alreadyPassed], newParserStack]);
                    // This has to go before SetTransition because NoSetTransition is a subclass of SetTransition
                } else if (it instanceof NotSetTransition) { 
                    const nextToken = tokens[tokenStreamIndex];
                    if (nextToken === caret) {
                        suggestions.push(...intervalToArray(
                            complement.bind(it.label)(antlr4.Token.MIN_USER_TOKEN_TYPE, this.atn.maxTokenType))
                            .map(x => new Suggestion(x, parserStack.map(y => y[0])), parserStack));
                    } else if (!it.label.contains(nextToken.type)) {
                        stack.push([tokenStreamIndex + 1, // Increase the index because it has consumed a token
                            it.target, 
                            [], // It resets 'alreadyPassed' because it just consumed a token, so it's not longer at risk of getting stuck in an infinite loop. 
                            parserStack
                        ]);
                    }
                } else if (it instanceof AtomTransition || it instanceof SetTransition) {
                    const nextToken = tokens[tokenStreamIndex];
                    if (nextToken === caret) {
                        this.log(`[${state.stateNumber}] In caret. Added suggestions: ${intervalToArray(it.label, parserStack.map(x => x[0])).map(x => x.token)}`, stack)
                        suggestions.push(...intervalToArray(it.label).map(x => new Suggestion(x, parserStack.map(y => y[0])), parserStack));
                    } else if (it.label.contains(nextToken.type)) {
                        stack.push([tokenStreamIndex + 1, // Increase the index because it has consumed a token
                            it.target, 
                            [], // It resets 'alreadyPassed' because it just consumed a token, so it's not longer at risk of getting stuck in an infinite loop. 
                            parserStack
                        ]);
                    } else 
                        this.log(`[${state.stateNumber}]Dead end. Expecting ${it.label} but found ${nextToken.type}`, stack);
                } else if (it instanceof  WildcardTransition) {
                    const nextToken = tokens[tokenStreamIndex];
                    if (nextToken === caret) {
                        suggestions.push(...intervalToArray({intervals: [{start: antlr4.Token.MIN_USER_TOKEN_TYPE, stop: this.atn.maxTokenType+1}]}).map(x => new Suggestion(x, parserStack.map(y => y[0])), parserStack));
                    } else {
                        stack.push([tokenStreamIndex + 1, // Increase the index because it has consumed a token
                            it.target, 
                            [], // It resets 'alreadyPassed' because it just consumed a token, so it's not longer at risk of getting stuck in an infinite loop. 
                            parserStack
                        ]);
                    }    
    
                } else if (alreadyPassed.includes(it.target.stateNumber)) this.log("Dead end. Epsilon transition already passed")
                else this.log("Dead end - Unknown transition", stack)
            }
        }
        return suggestions;
    }

    /*
  * The problem with filtering non default channels is that neither the lexer nor the ATN leave an easy record of what is the
  * channel of a token. To access it this ends up searching for the lexe rule for that token in the lexer ATN and then looks 
  * for an action state
  */
    _filterNonDefaultChannels(suggestions, lexer) {
        return suggestions
            .filter(x => {
                let rule;
                for (const [i, tokenType] of lexer.atn.ruleToTokenType.entries()) {
                    if (x.token === tokenType) {
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
    }

    // CurrentState should always be a state with a transition that is a RuleTransition. Since this is called
    // from the state before actually entering the rule?
    _onFail(stack, tokens, parserStack, tokenStreamIndex, rule, options, currentState) {
    //TODO Pensar en reescribir la configuración de la recuperación de forma más semántica en base
    // a los casos
    // - ";" -> FinishRule
    // - TODO Avoid double recovering? If you have let foo = ; let var = 3; Some paths might 
    // try to go to the second ";". On the other hand, this could kill recoveries like 
    // let foo = ; let var =; let xz = 3;
        const {andFindToken, thenGoToRule, skipOne, thenFinishRule} = rule;
        // tokenStreamIndex + 1 to avoid it from recovering in the same token, which
        // would be confusing . If you have let = = let a = b the rule starts in the 
        // first 'let' so it wouldn't make any sense to try to recover by entering the 
        // same rule again
        for (let i = tokenStreamIndex + 1; i < tokens.length; i++) {
            if (tokens[i].type === andFindToken) {
                options.debugStats.recovery(rule);
                //recoverCounter += 1;
                if (thenGoToRule) {
                    stack.push([skipOne ? i + 1 : i, this.atn.ruleToStartState[thenGoToRule], [],
                        // We add the current rule to the parser stack as if it had been entered through a RuleStartTransition //TODO wait we are not doing this here wtf
                        parserStack]);
                } else if (thenFinishRule) {
                    stack.push([skipOne ? i + 1 : i, currentState.transitions[0].followState, [],
                        parserStack/*.slice(0,-1)*/]);
                }
                return;
            }
        }   
    }
}


export default Autocompleter;