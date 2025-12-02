"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const parser_1 = require("./src/parser");
const markdown = `
- [ ] Task 1
## Archive
- [x] Archived Parent
\t- [x] Archived Child
`;
console.log('--- Testing Parse ---');
const { items, archivedItems } = (0, parser_1.parseMarkdown)(markdown);
console.log('Items:', items.length);
console.log('Archived Items:', archivedItems.length);
if (archivedItems.length > 0) {
    console.log('Archived Item 0 Indent:', archivedItems[0].indent);
    console.log('Archived Item 1 Indent:', archivedItems[1].indent);
}
console.log('\n--- Testing Stringify ---');
const output = (0, parser_1.stringifyItems)(items, archivedItems);
console.log(output);
if (output.includes('\t- [x] Archived Child')) {
    console.log('SUCCESS: Indentation preserved in output');
}
else {
    console.log('FAILURE: Indentation lost in output');
}
//# sourceMappingURL=test_parser.js.map