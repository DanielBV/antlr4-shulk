
import {givenGrammar, givenLexer} from './utils/GrammarTest';

describe('Test Autocompletition', () => {
    const LETTER_LEXER = "A: 'A'; B: 'B'; C: 'C'";

    it('General', async () => {
      await givenGrammar("r: A A 'B'; A: 'A';").whenInput("AA").thenExpect("B");
      await givenGrammar("r: 'A' ('B'|'C'|'D') EOF;").whenInput("A").thenExpect(["B","C","D"]); //TODO test also with optionals, and optional rules
      await givenGrammar("r: 'A' EOF;").whenInput("A").thenExpect("EOF");
      await givenGrammar("r: 'A' 'B'? 'C' EOF;").whenInput("A").thenExpect(["B","C"]);
      await givenGrammar("r: A+ B; A: 'A'; B:'B';").whenInput("A").thenExpect(["A", "B"]);
    });

    //TODO test negated sets and negated optional sets
    it('Inline tokens return their value', async () => {
      await givenGrammar("r: 'A';").whenInput("A").thenExpect([]);
    });
    //TODO test tokens in other channels
    it('Test dots', async () => {
      await givenGrammar("r: .; A:'a'; B: 'b';").whenInput("").thenExpect(["A", "B"]);
    });

    it('Ignores tokens in other channels', async () => {
      await givenLexer("channels {POTATO}\n A:'a' -> channel(HIDDEN); B: 'b' -> channel(POTATO); C:'c';").andParser("r: .;").whenInput("").thenExpect(["C"])
    });

});