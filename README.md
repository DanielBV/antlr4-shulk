

# Antlr4-shulk

## How to use
For the basic use, you can do:
```javascript 
const ac = new Autocompleter(MyLexer, MyParser);
const result = ac.autocomplete(input);
```
Here `MyLexer` and `MyParser` are classes, not objects. The autocompleter will instanciate them.

To change the starting rule, you can use the second argument of `autocomplete`:
```javascript
const options = {initialRule: MyParser.RULE_myRule};
const ac = new Autocompleter(MyLexer, MyParser, options);
const result = ac.autocomplete(input);
```
