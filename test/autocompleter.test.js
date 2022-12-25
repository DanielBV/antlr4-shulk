
import {givenGrammar, givenLexer, saveCache, loadCache, givenFiles} from './utils/GrammarTest';

const jestConsole = console;
describe('Test Autocompletition', () => {

      
    beforeEach(() => {
      global.console = require('console');
    });

    afterEach(() => {
      global.console = jestConsole;
    });
    beforeAll(() => {
      return loadCache();
    })
    afterAll(() => {
      return saveCache();
    });

    /*const LETTER_LEXER = "A: 'A'; B: 'B'; C: 'C';";
    it('General', async () => {
      // For every case I should test both what happens if the caret is there + that it transverses it if it's not a caret
      await givenGrammar("r: A A 'B'; A: 'A';").whenInput("AA").thenExpect("B");
      await givenGrammar("r: 'A' ('B'|'C'|'D') EOF;").whenInput("A").thenExpect(["B","C","D"]); //TODO test also with optionals, and optional rules
      await givenGrammar("r: A (A|C) EOF;" + LETTER_LEXER).whenInput("A").thenExpect(["A", "C"]); // This tests split interval sets
      await givenGrammar("r: 'A' EOF;").whenInput("A").thenExpect("EOF");

      //Optionals
      await givenGrammar("r: 'A' 'B'? 'C' EOF;").whenInput("A").thenExpect(["B","C"]); 
      await givenGrammar("r: 'A' w? 'C'; w: 'B' 'W'; ").whenInput("A").thenExpect(["B","C"]);
      await givenGrammar("r: 'A' ('B'|) 'C' EOF;").whenInput("A").thenExpect(["B","C"]); //Implicit optional
      await givenGrammar("r: A+ B; A: 'A'; B:'B';").whenInput("A").thenExpect(["A", "B"]);
      await givenGrammar("r: w+ B; w: A 'C'?;  A: 'A'; B:'B';").whenInput("A").thenExpect(["C", "A", "B"]);
      await givenGrammar("r: A* B; A: 'A'; B:'B';").whenInput("A").thenExpect(["A", "B"]);
      // Fun fact: When it's greedy the transitions are ordered different (probably because of the priority change and antlr4 might prioritize
      // transitions by their order) 
      await givenGrammar("r: A+? B; A: 'A'; B:'B';").whenInput("A").thenExpect(["B", "A"]);
      await givenGrammar("r: A*? B; A: 'A'; B:'B';").whenInput("A").thenExpect(["B", "A"]);
      await givenGrammar("r: 'A' 'B'?? 'C' EOF;").whenInput("A").thenExpect(["C", "B"]);
    });


    it("removes duplicated tokens", async () => {
      await givenGrammar("r: A | . | A; A: 'A';").whenInput("").thenExpect("A");
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

    it('Inline tokens return their value', async () => {
      await givenGrammar("r: 'A';").whenInput("A").thenExpect([]);
    });

    it('Test dots', async () => {
      await givenGrammar("r: .; A: [a-zA-Z0-9]; B: 'b';").whenInput("").thenExpect(["A", "B"]);
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

    it("test with other starting rule", async () => {
      const base = givenGrammar(`
        first2: 'A';
        second2: B first2; 
        B: 'B';
      `);

      await base.whenInput("").thenExpect(['A']);
      await base.whenInput("").startingAtRule((parser) => parser.RULE_second2).thenExpect(['B']);
    });

    it("test with a starting rule that doesn't exist", async () => {
      const base = givenGrammar(`
        first2: 'A';
        second2: B first2; 
        B: 'B';
      `).whenInput("").startingAtRule(() => 3);
      await expect(() => base.thenExpect(['B'])).rejects.toThrow("Unexpected starting rule: 3");
     
    }); 

    it("executes with context", async () => {
      const base = givenGrammar(`
        first: 'A' second fourth;
        second: 'A' third; 
        third: A;
        fourth: 'A';
        A: 'A';
      `);
      await base.whenInput("").thenExpectWithContext([{s: "A", ctx: [["first"]]}]);
      await base.whenInput("A").thenExpectWithContext([{s: "A", ctx: [["first", "second"]]}]);
      await base.whenInput("AA").thenExpectWithContext([{s: "A", ctx: [["first", "second", "third"]]}]);
      await base.whenInput("AAA").thenExpectWithContext([{s: "A", ctx: [["first", "fourth"]]}]);
    });

    it("fuses context in duplicated suggestions", async () => {
      const base = givenGrammar(`
        first: second | third;
        second: A; 
        third: A? fourth;
        fourth: A;
        A: 'A';
      `);
      await base.whenInput("").thenExpectWithContext([
        {s: "A", ctx: [["first", "second"], ["first", "third"], ["first", "third", "fourth"]]}
      ]);
    });

    it("finds rules", async () => {
      const base = givenGrammar(`
      first: expr PLUS expr;
      expr: 'A' another? notThisOne?;
      another: 'B';
      notThisOne: 'C';
      PLUS: '+';
      A: 'A';
    `);

    await base.whenInput("").withFindableRules((parser) => new Set([parser.RULE_expr, parser.RULE_another])).thenExpectComplete([{s: "expr", rule: true}]);
    await base.whenInput("").withFindableRules((parser) => new Set([parser.RULE_another])).thenExpectComplete([{s: "A", rule: false}]);
    await base.whenInput("A").withFindableRules((parser) => new Set([parser.RULE_expr, parser.RULE_another]))
      .thenExpectComplete([{s: "another", rule: true}, {s: "C", rule: false}, {s: "PLUS", rule: false}]);
    });


    const recoveryBase = givenGrammar(`
    expression: assignment | simpleExpression;

    assignment: (VAR | LET) ID EQUAL simpleExpression;
    
    simpleExpression
        : simpleExpression (PLUS | MINUS) simpleExpression
        | simpleExpression (MULTIPLY | DIVIDE) simpleExpression
        | variableRef
        | functionRef
    ;
    
    variableRef: ID;
    functionRef: ID OPEN_PAR CLOSE_PAR;
    
    VAR: [vV] [aA] [rR];
    LET: [lL] [eE] [tT];
    
    PLUS: '+';
    MINUS: '-';
    MULTIPLY: '*';
    DIVIDE: '/';
    EQUAL: '=';
    OPEN_PAR: '(';
    CLOSE_PAR: ')';
    ID: [a-zA-Z] [a-zA-Z0-9_]*;
    WS: [ \\n\\r\\t] -> channel(HIDDEN);
    `);
    /*it("test basic recovery", async () => {
      recoveryBase.withRecovery((parser) => {
        const a = {};
        a[parser.RULE_assignment] = {};
        a[parser.RULE_assignment][parser.VAR] =  parser.RULE_assignment;
        return a;
      });
      await recoveryBase.whenInput("let = = var a =").thenExpect("ID");
      await recoveryBase.whenInput("let a = b").thenExpect(["PLUS", "MINUS", "MULTIPLY", "DIVIDE", "OPEN_PAR"]);
      await recoveryBase.whenInput("let = = var a = b").thenExpect(["PLUS", "MINUS", "MULTIPLY", "DIVIDE", "OPEN_PAR"]);
    });

    it("test recovery inside nested rules", async () => {
      recoveryBase.withRecovery((parser) => {
        const a = {};
        a[parser.RULE_assignment] = {};
        const foo = {ifInRule: parser.RULE_assignment, nested: true, andFindToken: parser.VAR, thenGoToRule: parser.RULE_assignment};  
        return [foo];
      });

      //TODO test stack when recovery
      await recoveryBase.whenInput("var a = b()").thenExpect(["PLUS", "MINUS", "MULTIPLY", "DIVIDE"]);
      // The idea here is that the error isn't inside 'assignment', but inside 'simpleExpression'
      await recoveryBase.whenInput("let a = foo( var a = b()").thenExpect(["PLUS", "MINUS", "MULTIPLY", "DIVIDE"]);
      const baseCtx =  ["expression", "assignment", "simpleExpression"];
      await recoveryBase.whenInput("var a = b()").thenExpectWithContext(["PLUS", "MINUS", "MULTIPLY", "DIVIDE"].map(x => ({s: x, ctx: [baseCtx]})));
      //It's difficult to know when an error should be recovered and when it shouldn't be because another branch of the execution will keep on parsing it correctly.
      //that's why there are several contexts, since the autocompleter arrived at the same suggestion throw several token recoveries
      // Maybe I could try making the autocompletion do a breadth first search in a way that, it'll only try to recover if all branches fail. But that scares 
      // me a little since there could be times when a branch succeeds but it's not the actually intended one.
      await recoveryBase.whenInput("let a = foo( var a = b()").thenExpectWithContext(["PLUS", "MINUS", "MULTIPLY", "DIVIDE"]
        .map(x => ({s: x, ctx: [baseCtx, baseCtx, baseCtx]})));

    });

    it("test more efficient recovery", async () => {
      const grammar = givenGrammar(`
      expression: block+;      
      block
          : a SEMI
          | b SEMI
          | c SEMI
          | d SEMI
          ;

      a: 'A';
      b: 'B'; 
      c: 'C';
      d: 'D';
      SEMI: ';';
      WS: [ \\n\\r\\t] -> channel(HIDDEN);

      `).withRecovery((parser) => {
        const a = {};
        a[parser.RULE_assignment] = {};
        const foo = {ifInRule: parser.RULE_block, nested: true, andFindToken: parser.SEMI, thenGoToRule: parser.RULE_block, skipOne: true};  
        return [foo];
      });

      //TODO test stack when recovery
      await grammar.whenInput("A; B B; A;").thenExpect(["A", "B", "C", "D"]);
      // The idea here is that the error isn't inside 'assignment', but inside 'simpleExpression'
    });*/
    
    it("test java grammar", async () => {
      const grammar = givenFiles("JavaLexer.g4", "JavaParser.g4").withRecovery((parser) => {
        const foo = {ifInRule: parser.RULE_blockStatement, nested: true, andFindToken: parser.SEMI, thenGoToRule: parser.RULE_blockStatement, skipOne: true};  
        return [foo];
      });

      const expected = ["MUL", "DIV", "MOD", "ADD", "SUB", "LT", "GT", "LE", "GE", "EQUAL", "NOTEQUAL", 
      "BITAND", "CARET", "BITOR", "AND", "OR", "QUESTION", "ASSIGN", "ADD_ASSIGN", "SUB_ASSIGN", 
      "MUL_ASSIGN", "DIV_ASSIGN", "AND_ASSIGN", "OR_ASSIGN", "XOR_ASSIGN", "MOD_ASSIGN", "LSHIFT_ASSIGN", 
      "RSHIFT_ASSIGN", "URSHIFT_ASSIGN", "DOT", "LBRACK", "INC", "DEC", "INSTANCEOF", "COLONCOLON", "COMMA", 
      "RPAREN"];
      /*await grammar.whenInput(`class HelloWorld {
        public static void main(String[] args) {
            System.out.println("foo"
      `).thenExpect(expected);*/

      // Brainstorming: Ahora está ejecutando 21 por el 
        // block: '{' blockStatement* '}'
      // 1. Poner tokens de parada: '}', \n
      await grammar.whenInput(`class HelloWorld {
        ${`public static void main(String[] args) {
          System.out.println("foo");
        }\n`.repeat(15)}
        public static void main(String[] args) {
            System.out.println("foo";  // It's missing a ) and yet it advances to the next statement and autocompletes it correctly.
            System.out.println("foo"
      `).thenExpect(expected);
    });
});