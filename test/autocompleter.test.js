
import {givenGrammar} from './utils/GrammarTest';

test('Test Grammar', async () => {
    await givenGrammar("r: A A 'B'; A: 'A';").whenInput("AA").thenExpect("B");
    await givenGrammar("r: 'A' ('B'|'C'|'D') EOF;").whenInput("A").thenExpect(["B","C","D"]);
    await givenGrammar("r: 'A' EOF;").whenInput("A").thenExpect("EOF");
    await givenGrammar("r: 'A';").whenInput("A").thenExpect([]);
    await givenGrammar("r: 'A' 'B'? 'C' EOF;").whenInput("A").thenExpect(["B","C"]);
});