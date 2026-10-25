const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync('src/injection.js', 'utf8');

// injection.js runs in the page before anything else; its top level only registers listeners and
// posts messages, so it can be evaluated with stubs for those.
function load() {
    const context = vm.createContext({
        navigator: { userAgent: 'test' }, chrome: {}, console: { ...console, log() {} },
        addEventListener() {}, postMessage() {}, setTimeout() {}, setInterval() {}, clearInterval() {},
        localStorage: {}, document: { querySelectorAll: () => [] },
    });
    context.window = context;
    vm.runInContext(source, context);
    return context;
}

test("Better TweetDeck's settings script is what is kept across the document swap, nothing else", () => {
    const keep = vm.runInContext('keepOtherExtensions', load());
    const btd = { tag: 'script', dataset: { btdSettings: '{}' } };
    const doc = { querySelectorAll: (selector) => (selector.includes('data-btd-settings') ? [btd] : []) };
    const kept = keep(doc);
    assert.equal(kept.length, 1);
    assert.equal(kept[0], btd);
    assert.equal(keep({ querySelectorAll: () => [] }).length, 0);
});
