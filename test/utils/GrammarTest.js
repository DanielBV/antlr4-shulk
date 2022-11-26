import Autocompleter from '../../lib/autocompleter';
import child from 'child_process';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

if (!fs.existsSync(`./test/tmp/`)) {
    fs.mkdirSync(`./test/tmp/`);
}

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
        this.counter = crypto.randomUUID().replace(/-/g,"");
        this._cachedParser = null;
        this._startingRuleFactory = null;
        this._rulesFactory = null;
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

    withRecovery(recovery) {
        this._recovery = recovery;
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

    /**
     * @param {*} rulesFactory A function that takes a parser and returns a set of findable rules
     */
    withFindableRules(rulesFactory) {
        this._rulesFactory = rulesFactory;
        return this;
    }

    async getParser() {
        if (!this._cachedParser) {
            this._cachedParser = await this.buildParser();
            this.saveInGlobalCache();
        }
        return this._cachedParser;
    }

    /**
     * 
     * @param {*} factory A function that takes a parser and returns a integer representing the rule in that parser
     */
    startingAtRule(factory) {
        this._startingRuleFactory = factory;
        return this;
    }

    async thenExpect(expected) {
        if (!Array.isArray(expected)) expected = [expected];
        const [result, _] = await this.execute();
        expect(result.map(x => x.suggestion)).toEqual(expected);
    }

    async thenExpectWithContext(expected) {
        const [result, Parser] = await this.execute();
        if (result.length !== expected.length)
            //This is to make the message a bit more clear
            expect(result.map(x => x.suggestion)).toEqual(expected.map(x => x.s));

        for (let i = 0; i < result.length; i++) {
            expect(result[i].suggestion).toEqual(expected[i].s);
            const numberedResultContexts = result[i].ctxs.map(x => x.map(y => Parser.ruleNames[y]))
            expect(numberedResultContexts).toEqual(expected[i].ctx);
        }
    }

    async thenExpectComplete(expected) {
        const [result, Parser] = await this.execute();
        if (result.length !== expected.length)
        //This is to make the message a bit more clear
        expect(result.map(x => x.suggestion)).toEqual(expected.map(x => x.s));

    for (let i = 0; i < result.length; i++) {
        expect(result[i].suggestion).toEqual(expected[i].s);
        expect(result[i].isRule).toEqual(expected[i].rule);
    }
    }

    async execute() {
        const [Lexer, Parser] = await this.getParser();
        if (this._startingRuleFactory)
            this.options.initialRule = this._startingRuleFactory(Parser);
        if (this._rulesFactory)
            this.options.suggestRules = this._rulesFactory(Parser);
        if (this._recovery) 
            this.options.recovery = this._recovery(Parser);
        const ac = new Autocompleter(Lexer, Parser, this.options);
        return [ac.autocomplete(this.input), Parser];
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
        globalCache[this.grammar] = this.counter;
    }

    async buildParser() {
        // This is used because for some reason the relative path of the output folder of the execSync worked differently 
        // when run in Github actions 
        const fullPath = path.resolve(".");
        // The globalCache overrides the this.counter to use the file that already exists
        if(globalCache[this.grammar]) {
            console.log("Is in cache: "+ this.grammar);
            console.log(globalCache[this.grammar]);
            this.counter = globalCache[this.grammar];
        } else {
            fs.writeFileSync(`./test/tmp/${this.file}.g4`, this.fullGrammar);
            child.execSync(`java -jar ./test/bin/antlr-4.11.1-complete.jar -Dlanguage=JavaScript ${fullPath}/test/tmp/${this.file}.g4  -no-visitor -no-listener -o  ${fullPath}/test/tmp/`)
        }   
        const Lexer = await import(`../tmp/${this.file}Lexer.js`)
        const Parser = await import(`../tmp/${this.file}Parser.js`)
        return [Lexer.default, Parser.default];
    }
}

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
        globalCache[this._lexer][this._parser] = this.counter; 
    }

    andParser(parser) {
        this._parser = parser;
        return this;
    }

    async buildParser() {
        // The globalCache overrides the this.file
        if(globalCache[this._lexer] &&  globalCache[this._lexer][this._parser]) {
            this.counter = globalCache[this._lexer][this._parser];
        } else {
            fs.writeFileSync(`./test/tmp/${this.file}Lexer.g4`, this.fullLexer);
            fs.writeFileSync(`./test/tmp/${this.file}Parser.g4`, this.fullParser);
            const fullPath = path.resolve(".");
            child.execSync(`java -jar ./test/bin/antlr-4.11.1-complete.jar -Dlanguage=JavaScript ${fullPath}/test/tmp/${this.file}Lexer.g4  -no-visitor -no-listener -o ${fullPath}/test/tmp/`)
            child.execSync(`java -jar ./test/bin/antlr-4.11.1-complete.jar -Dlanguage=JavaScript ${fullPath}/test/tmp/${this.file}Parser.g4  -no-visitor -no-listener -o ${fullPath}/test/tmp/`)
        }
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