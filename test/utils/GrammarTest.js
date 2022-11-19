import Autocompleter from '../../lib/autocompleter';
import child from 'child_process';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

if (!fs.existsSync(`./test/tmp/`)) {
    fs.mkdirSync(`./test/tmp/`);
}

let counter = 0;
// There are two caches:
// - The _cachedParser in GrammarTestBase is used to avoid regenerating the same parser 
// if a GrammarTestBase calls multiple times to "thenExpect"
// - The globalCache is used to avoid regenerating the same parser across multiple executions. 
//      It's persisted to a json file.
let globalCache = {};


class GrammarTestBase {
    constructor() {
        this._input = null;
        this.options = {};
        // Maybe I could use something else rather than uuids?
        // The whole point of this rather than a counter (by the variable name you can guess it used to be an autoincreasing counter)
        // is that since there is a global cache persisted across multiple executions, and since you can define new tests, that 
        // could mess up the INCREASING counter (unless you always add tests at the end)
        this.counter = crypto.randomUUID().replaceAll("-","");
        this._cachedParser = null;
    }

    get file() {
        return `file${this.counter}`;
    }

    saveInGlobalCache() {
        throw new Error("Abstract method");
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
            this.saveInGlobalCache();
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

    saveInGlobalCache() {
        globalCache[this.grammar] = this.file;
    }

    async buildParser() {
        // This is used because for some reason the relative path of the output folder of the execSync worked differently 
        // when run in Github actions 
        const fullPath = path.resolve(".");
        let file;
        // The globalCache overrides the this.file
        if(globalCache[this.grammar]) {
            file = globalCache[this.grammar];
        } else {
            fs.writeFileSync(`./test/tmp/${this.file}.g4`, this.fullGrammar);
            child.execSync(`java -jar ./test/bin/antlr-4.11.1-complete.jar -Dlanguage=JavaScript ${fullPath}/test/tmp/${this.file}.g4  -no-visitor -no-listener -o  ${fullPath}/test/tmp/`)
            file = this.file;
        }   
        const Lexer = await import(`../tmp/${file}Lexer.js`)
        const Parser = await import(`../tmp/${file}Parser.js`)
        return [Lexer.default, Parser.default];
    }
}

//TODO would be nice to combine it with GrammarTest 
class SplitGrammar extends GrammarTestBase {
    constructor(lexer) {
        super();
        this._lexer = lexer;
    }

    get fullLexer() {
        return  `lexer grammar file${this.counter}Lexer;\n` + this._lexer;
    }

    get fullParser() {
        return  `parser grammar file${this.counter}Parser;\n options { tokenVocab=file${this.counter}Lexer;}` + this._parser;
    }

    saveInGlobalCache() {
        globalCache[this._lexer] = {};
        globalCache[this._lexer][this._parser] = this.file; 
    }

    andParser(parser) {
        this._parser = parser;
        return this;
    }

    async buildParser() {
        let file;
        // The globalCache overrides the this.file
        if(globalCache[this._lexer] &&  globalCache[this._lexer][this._parser]) {
            file = globalCache[this._lexer][this._parser];
        } else {
            fs.writeFileSync(`./test/tmp/${this.file}Lexer.g4`, this.fullLexer);
            fs.writeFileSync(`./test/tmp/${this.file}Parser.g4`, this.fullParser);
            const fullPath = path.resolve(".");
            child.execSync(`java -jar ./test/bin/antlr-4.11.1-complete.jar -Dlanguage=JavaScript ${fullPath}/test/tmp/${this.file}Lexer.g4  -no-visitor -no-listener -o ${fullPath}/test/tmp/`)
            child.execSync(`java -jar ./test/bin/antlr-4.11.1-complete.jar -Dlanguage=JavaScript ${fullPath}/test/tmp/${this.file}Parser.g4  -no-visitor -no-listener -o ${fullPath}/test/tmp/`)
            file = this.file;
        }
         const Lexer = await import(`../tmp/${file}Lexer.js`)
        const Parser = await import(`../tmp/${file}Parser.js`)
        return [Lexer.default, Parser.default];
    }
}

export function givenGrammar(grammar) {
    return new SingleGrammarFile(grammar);
}

export function givenLexer(lexer) {
    return new SplitGrammar(lexer);
}

const CACHE_PATH = './test/tmp/cache.json';
export function loadCache() {
    if (fs.existsSync(CACHE_PATH)) {
        const data = fs.readFileSync(CACHE_PATH, {encoding:'utf8'});
        globalCache = JSON.parse(data);
        console.log(globalCache);
    }
}

export function saveCache() {
    fs.writeFileSync(CACHE_PATH, JSON.stringify(globalCache));
    console.log('Cached cases');
}