import Autocompleter from '../../lib/autocompleter';
import child from 'child_process';
import fs from 'fs';
import path from 'path';

console.log(path.resolve("./"))


if (!fs.existsSync(`./test/tmp/`)) {
    fs.mkdirSync(`./test/tmp/`);
}

let counter = 0;

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
        child.execSync(`java -jar ./test/bin/antlr-4.11.1-complete.jar -Dlanguage=JavaScript ./test/tmp/${file}.g4  -no-visitor -no-listener -o ./test/tmp/`)
        const Lexer = await import(`../tmp/${file}Lexer.js`)
        const Parser = await import(`../tmp/${file}Parser.js`)
        const ac = new Autocompleter(Lexer.default, Parser.default);
        const result = ac.autocomplete(this.input);
        expect(result).toEqual(expected);
    }
}

export function givenGrammar(grammar) {
    return new GrammarTest(grammar);
}

