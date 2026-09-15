const { test } = require('node:test');
const assert = require('node:assert/strict');
const { detectLanguageFromContent } = require('../language');
test('specific language syntax takes precedence over broad patterns', () => {
    for (const [source, expected] of [
        ['#include <iostream>\nint main() { std::cout << "Hi"; }', 'cpp'],
        ['#include <stdio.h>\nint main() {}', 'c'],
        ['package main\nfunc main() {}', 'go'],
        ['import x from "x";\nconst y = 1;', 'javascript'],
        ['interface User { name: string }', 'typescript'],
        ['# Heading', 'markdown'],
        ['Just a sentence.', 'plaintext'],
    ]) assert.equal(detectLanguageFromContent(source), expected);
});
