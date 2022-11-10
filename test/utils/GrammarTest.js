import Autocompleter from '../../lib/autocompleter';
import child from 'child_process';
import path from 'path';
import fs from 'fs';

if (!fs.existsSync(`./test/tmp/`)) {
    fs.mkdirSync(`./test/tmp/`);
}

let counter = 0;

class GrammarTestBase {
    constructor() {
        this._input = null;
        this.options = {};
        this.counter = counter++;
        this._cachedParser = null;
    }

    get file() {
        return `file${this.counter}`;
    }

    whenInput(input) {
        this.input = input;
        return this;
    }

    whileIgnoringOtherChannels() {
        this.options.ignoreSuggestionsInNonDefaultChannels = true;
        return this;
    }

    withOptions(opts) {
        this.options = opts;
        return this;
    }

    withDefaultConfig() {
        this.options = null;
        return this;
    }

    async getParser() {
        if (!this._cachedParser) {
            this._cachedParser = await this.buildParser();
        }
        return this._cachedParser;
    }

    async thenExpect(expected) {
        if (!Array.isArray(expected)) expected = [expected];
        const [Lexer, Parser] = await this.getParser();
        const ac = new Autocompleter(Lexer, Parser, this.options);
        const result = ac.autocomplete(this.input);
        expect(result).toEqual(expected);
    }
}

class SingleGrammarFile extends GrammarTestBase {
    constructor(grammar) {
        super();
        this._cachedParser = null;
        this.grammar = grammar;
    }

    get fullGrammar() {
        return  `grammar file${this.counter};\n` + this.grammar;
    }

    async buildParser() {
        // This is used because for some reason the relative path of the output folder of the execSync worked differently 
        // when run in Github actions 
        const fullPath = path.resolve(".");
        fs.writeFileSync(`./test/tmp/${this.file}.g4`, this.fullGrammar);
        child.execSync(`java -jar ./test/bin/antlr-4.11.1-complete.jar -Dlanguage=JavaScript ${fullPath}/test/tmp/${this.file}.g4  -no-visitor -no-listener -o  ${fullPath}/test/tmp/`)
        const Lexer = await import(`../tmp/${this.file}Lexer.js`)
        const Parser = await import(`../tmp/${this.file}Parser.js`)
        return [Lexer.default, Parser.default];
    }
}

//TODO would be nice to combine it with GrammarTest 
class SplitGrammar extends GrammarTestBase {
    constructor(lexer) {
        super();
        this._lexer = lexer;
        this.counter = counter++;
    }

    get fullLexer() {
        return  `lexer grammar file${this.counter}Lexer;\n` + this._lexer;
    }

    get fullParser() {
        return  `parser grammar file${this.counter}Parser;\n options { tokenVocab=file${this.counter}Lexer;}` + this._parser;
    }

    andParser(parser) {
        this._parser = parser;
        return this;
    }


    async buildParser() {
        fs.writeFileSync(`./test/tmp/${this.file}Lexer.g4`, this.fullLexer);
        fs.writeFileSync(`./test/tmp/${this.file}Parser.g4`, this.fullParser);
        const fullPath = path.resolve(".");
        child.execSync(`java -jar ./test/bin/antlr-4.11.1-complete.jar -Dlanguage=JavaScript ${fullPath}/test/tmp/${this.file}Lexer.g4  -no-visitor -no-listener -o ${fullPath}/test/tmp/`)
        child.execSync(`java -jar ./test/bin/antlr-4.11.1-complete.jar -Dlanguage=JavaScript ${fullPath}/test/tmp/${this.file}Parser.g4  -no-visitor -no-listener -o ${fullPath}/test/tmp/`)
        const Lexer = await import(`../tmp/${this.file}Lexer.js`)
        const Parser = await import(`../tmp/${this.file}Parser.js`)
        return [Lexer.default, Parser.default];
    }
}

export function givenGrammar(grammar) {
    return new SingleGrammarFile(grammar);
}

export function givenLexer(lexer) {
    return new SplitGrammar(lexer);
}
