import ActionTransition from 'antlr4/src/antlr4/transition/ActionTransition.js';

function findLexerActions(state) {
    const collector = [];
    findLexerActionsRecursive(state, [], collector);
    return collector;
}

function findLexerActionsRecursive(state, alreadyPassed, collector) {
    state.transitions.forEach(it => {
        // This must go before it.isEpsilon because ActionTransitions are epsilon
        if (it instanceof ActionTransition) {
            collector.push(it.actionIndex);
            findLexerActionsRecursive(it.target, [it.target.stateNumber], collector);
            
        } else if (it.isEpsilon) {
            if (!alreadyPassed.includes(it.target.stateNumber)) 
                findLexerActionsRecursive(it.target, [...alreadyPassed, it.target.stateNumber], collector);
        } else {
            findLexerActionsRecursive(it.target, alreadyPassed, collector);
        }
    }); 
}

export default findLexerActions;