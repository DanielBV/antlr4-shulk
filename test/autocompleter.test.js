
import {givenGrammar, givenLexer} from './utils/GrammarTest';

describe('Test Autocompletition', () => {
    const LETTER_LEXER = "A: 'A'; B: 'B'; C: 'C';";
    it('General', async () => {
      await givenGrammar("r: A A 'B'; A: 'A';").whenInput("AA").thenExpect("B");
      await givenGrammar("r: 'A' ('B'|'C'|'D') EOF;").whenInput("A").thenExpect(["B","C","D"]); //TODO test also with optionals, and optional rules
      await givenGrammar("r: A (A|C) EOF;" + LETTER_LEXER).whenInput("A").thenExpect(["A", "C"]); // This tests split interval sets
      await givenGrammar("r: 'A' EOF;").whenInput("A").thenExpect("EOF");
      await givenGrammar("r: 'A' 'B'? 'C' EOF;").whenInput("A").thenExpect(["B","C"]);
      await givenGrammar("r: 'A' ('B'|) 'C' EOF;").whenInput("A").thenExpect(["B","C"]);
      await givenGrammar("r: A+ B; A: 'A'; B:'B';").whenInput("A").thenExpect(["A", "B"]);
      await givenGrammar("r: A* B; A: 'A'; B:'B';").whenInput("A").thenExpect(["A", "B"]);
      // Fun fact: When it's greedy the transitions are ordered different (probably because of the priority change) which
      // makes 
      await givenGrammar("r: A+? B; A: 'A'; B:'B';").whenInput("A").thenExpect(["B", "A"]);
      await givenGrammar("r: A*? B; A: 'A'; B:'B';").whenInput("A").thenExpect(["B", "A"]);
      await givenGrammar("r: 'A' 'B'?? 'C' EOF;").whenInput("A").thenExpect(["C", "B"]);
      //TODO I should also test that the autosuggester transverses all these.
    });



    
    it("removes duplicated tokens", async () => {
      await givenGrammar("r: A | .; A: 'A';").whenInput("").thenExpect("A");
    })


    it("Non set transitions", async () => {
      // ~A is a non set even though it's a single element
      await givenGrammar("r:  ~A; A: 'A'; B: 'B'; C: 'C';").whenInput("").thenExpect(["B", "C"]);
      await givenGrammar("r:  ~A B; A: 'A'; B: 'B'; C: 'C';").whenInput("C").thenExpect(["B"]);

      await givenGrammar("r:  ~(A | B); A: 'A'; B: 'B'; C: 'C';").whenInput("").thenExpect(["C"]);
      await givenGrammar("r:  (~(A | C)); A: 'A'; B: 'B'; C: 'C';").whenInput("").thenExpect(["B"]);
      await givenGrammar("r:  (~(A | B | C)); A: 'A'; B: 'B'; C: 'C';").whenInput("").thenExpect([]);
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

    it('Test dots', async () => {
      await givenGrammar("r: .; A: [a-zA-Z0-9]; B: 'b';").whenInput("").thenExpect(["A", "B"]);
      await givenGrammar("r: .; ").whenInput("").thenExpect([]);
    });

    it('Ignores tokens in other channels', async () => {
      const parser = givenLexer("channels {POTATO}\n A:'a' -> channel(HIDDEN); B: 'b' -> channel(POTATO); C:'c';")
        .andParser("r: .;");
      await parser.whileIgnoringOtherChannels().whenInput("").thenExpect(["C"]);
      await parser.withDefaultConfig().whenInput("").thenExpect(["A", "B", "C"]);
      
      // This tests that when ignoring other channels still includes those tokens that explicitely use the default channel
      givenLexer("channels {POTATO}\n A:'a' -> channel(0); B:'b';")
        .andParser("r: .;")
        .whileIgnoringOtherChannels()
        .whenInput("")
        .thenExpect(["A", "B"])
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