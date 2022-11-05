
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


    it('Follows subrules', async () => {
       await givenGrammar(`first: A second; 
       second: B; 
       A: 'A'; 
       B: 'B';
       `).whenInput("A").thenExpect("B");


       await givenGrammar(`first: A second C; 
       second: B; 
       A: 'A'; 
       B: 'B';
       C: 'C';
       `).whenInput("AB").thenExpect("C");

       await givenGrammar(`
       first: A second D; 
       second: B; 
       third: C second B;
       
       A: 'A'; 
       B: 'B'; 
       C: 'C';
       D: 'D';`).whenInput("AB").thenExpect("D");
    });

    it('Test left-recursion', async() => {
      const grammar =  givenGrammar(`
      expr: expr (MULT|DIV) expr
        | expr (PLUS|MINUS) expr
        | literal;

      literal: ID;

      WS: [\\p{White_Space}] -> skip;
      ID: [a-zA-Z0-9]+;
      MULT: '*'; 
      DIV: '/';
      PLUS: '+';
      MINUS: '-';
      `);
      
      await grammar.whenInput("a + b").thenExpect(["MULT", "DIV", "PLUS", "MINUS"]);
      await grammar.whenInput("a +").thenExpect("ID");
      await grammar.whenInput("a + b * c / d - e").thenExpect(["MULT", "DIV", "PLUS", "MINUS"]);
    });

    //TODO test negated sets and negated optional sets
    it('Inline tokens return their value', async () => {
      await givenGrammar("r: 'A';").whenInput("A").thenExpect([]);
    });
    //TODO test tokens in other channels
    it('Test dots', async () => {
      await givenGrammar("r: .; A:'a'; B: 'b';").whenInput("").thenExpect(["A", "B"]);
    });
    //TODO test skip
    //TODO test tokens that combine multiple intervals [a-zA-Z0-9]. It shouldn't really matter but it doesnt matter
    it('Ignores tokens in other channels', async () => {
      await givenLexer("channels {POTATO}\n A:'a' -> channel(HIDDEN); B: 'b' -> channel(POTATO); C:'c';").andParser("r: .;").whenInput("").thenExpect(["C"])
    });

});