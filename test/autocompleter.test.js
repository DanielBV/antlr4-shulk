
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
    //TODO test tokens that combine multiple intervals [a-zA-Z0-9]. It shouldn't really matter but it doesnt matter
    it('Ignores tokens in other channels', async () => {
      //TODO test that it doesn't confuse the channel action with other actions (push, pop, etc)
      const parser = givenLexer("channels {POTATO}\n A:'a' -> channel(HIDDEN); B: 'b' -> channel(POTATO); C:'c';")
        .andParser("r: .;");
      //TODO test if it has channel(DEFAULT_TOKEN_CHANNEL)
      await parser.whileIgnoringOtherChannels().whenInput("").thenExpect(["C"]);
      await parser.withDefaultConfig().whenInput("").thenExpect(["A", "B", "C"]);
    });

    it("ignoreSuggestionsInNonDefaultChannels doesn't get confused with other types of lexer actions", async () => {
      const grammar = givenLexer(` 
      A: 'A' -> mode(OTHER_MODE);
      mode OTHER_MODE;
      A2: 'B' -> mode(DEFAULT_MODE);`)
      .andParser("r: .+;");


      await grammar.whileIgnoringOtherChannels()
      .whenInput("")
      .thenExpect(["A", "A2"]);

      //Technically here "A2" is the only valid suggestion. I'm not sure it's worth to try to fix it
      // After all, "." is probably not used
      await grammar.withDefaultConfig()
      .whenInput("ABABABA").thenExpect(["A", "A2"])
    
    });

    //TODO Test if I can get duplicated tokens

    it("considers the types of the tokens (spoiler: it actually doesn't)", async () => {
      await givenLexer(`
      tokens { FOO }
      A: 'A' -> type(FOO);
      B: 'B' -> type(FOO);
    `).andParser("r: FOO;")
    .whenInput("").thenExpect(["FOO"]);

      // I don't think it's worth the effort to try to remove the "A" and "B" from here. Most grammars probably 
      // don't use the dot to match anything
      await givenLexer(`
        tokens { FOO }
        A: 'A' -> type(FOO);
        B: 'B' -> type(FOO);
      `).andParser("r: .+;")
      .whenInput("").thenExpect(["FOO", "A", "B"]);
    });

});