const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync('src/interception.js', 'utf8');

// The part of legacy's docked composer template around its DM recipients (compose/docked_compose.mustache).
const TEMPLATE = '<div class="js-docked-compose"> <div class="js-compose-message-recipient-container compose-message-recipient-container is-hidden"> <p class="compose-text-title">To</p> '
    + '<div class="js-compose-message-recipient-input-container"> <ul class="js-typeahead-user-list is-hidden"></ul> </div> </div> <!-- end Direct Message --> <div class="js-compose-message-header"></div> </div>';
const MARKER = '<!-- end Direct Message -->';

function load(TD, document) {
    const context = vm.createContext({
        localStorage: {}, location: { hostname: 'x.com' }, navigator: { language: 'en-US' },
        XMLHttpRequest: function () {}, console: { ...console, log() {}, warn() {}, error() {} }, URL, URLSearchParams,
        Date, setTimeout, Event: class {}, ProgressEvent: class {}, TD, ...(document ? { document } : {}),
    });
    vm.runInContext(source, context);
    return vm.runInContext('noteUnencryptedDm', context);
}

test('the composer template gets the notice inside the DM recipient container, once', () => {
    const TD = { mustaches: { 'compose/docked_compose.mustache': TEMPLATE } };
    const note = load(TD);
    note();
    note();
    const after = TD.mustaches['compose/docked_compose.mustache'];
    assert.equal(after.split('otd-dm-notice').length - 1, 1);
    // inside the container: after the recipient input, before the container's closing tag and the marker
    const container = after.slice(after.indexOf('js-compose-message-recipient-container'), after.indexOf(MARKER));
    assert.match(container, /js-typeahead-user-list.*otd-dm-notice.*without end-to-end encryption/);
    assert.ok(container.trimEnd().endsWith('</div>'));
    assert.ok(after.endsWith(MARKER + ' <div class="js-compose-message-header"></div> </div>'));
    assert.equal(after.slice(0, after.indexOf('<p class="otd-dm-notice')), TEMPLATE.slice(0, TEMPLATE.lastIndexOf('</div>', TEMPLATE.indexOf(MARKER))));
});

test('a composer already on the page gets the line once; without legacy or its template nothing happens', () => {
    const inserted = [];
    const container = { querySelector: () => (inserted.length ? {} : null), insertAdjacentHTML: (where, html) => inserted.push([where, html]) };
    const document = { body: { getAttribute: () => null }, cookie: '', querySelector: (s) => (s === '.js-compose-message-recipient-container' ? container : null) };
    const note = load({ mustaches: {} }, document);
    note();
    note();
    assert.equal(inserted.length, 1);
    assert.equal(inserted[0][0], 'beforeend');
    assert.match(inserted[0][1], /^<p class="otd-dm-notice .*Encrypted X Chat conversations are not available in TweetDeck\.<\/p>$/);
    assert.doesNotThrow(() => load({})());
    assert.doesNotThrow(() => load(undefined)());
});
