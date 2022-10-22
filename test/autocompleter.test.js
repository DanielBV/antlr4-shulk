

import child from 'child_process';
import fs from 'fs';
import Autocompleter from '../lib/autocompleter';
const result =  child.execSync(`echo aaaaaaa`)
console.log(result);
let counter = 0;
if (!fs.existsSync(`./test/tmp/`)) {
  fs.mkdirSync(`./test/tmp/`);
}
class GrammarTest {
  constructor(grammar) {
    this.grammar = grammar;
    this.counter = counter++;
  }
  
  get fullGrammar() {
    return  `grammar file${this.counter};\n` + this.grammar;
  }

  whenInput(input) {
    this.input = input;
    return this;
  }

  async thenExpect(expected) {
    if (!Array.isArray(expected)) expected = [expected];
    const file = `file${this.counter}`
    fs.writeFileSync(`./test/tmp/${file}.g4`, this.fullGrammar);
    child.execSync(`java -jar ./test/utils/antlr-4.11.1-complete.jar -Dlanguage=JavaScript ./test/tmp/${file}.g4  -no-visitor -no-listener -o ./test/tmp/`)
    const Lexer = await import(`./tmp/${file}Lexer`)
    const Parser = await import(`./tmp/${file}Parser`)
    const ac = new Autocompleter(Lexer.default, Parser.default);
    const result = ac.autocomplete(this.input);
    expect(result).toEqual(expected);
  }
}
function givenGrammar(grammar) {
  return new GrammarTest(grammar);
}

test('Test Grammar', async () => {
    await givenGrammar("r: A A 'B'; A: 'A';").whenInput("AA").thenExpect("B");
    await givenGrammar("r: 'A' ('B'|'C'|'D') EOF;").whenInput("A").thenExpect(["B","C","D"]);
    await givenGrammar("r: 'A' EOF;").whenInput("A").thenExpect("EOF");
    await givenGrammar("r: 'A';").whenInput("A").thenExpect([]);
    await givenGrammar("r: 'A' 'B'? 'C' EOF;").whenInput("A").thenExpect(["B","C"]);


});