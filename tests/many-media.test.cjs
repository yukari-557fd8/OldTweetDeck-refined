const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

// X allows twenty photos and videos in a post since 2026-11-12 (four before), and its GraphQL no
// longer says which client wrote a tweet. What legacy's templates and composer in files/bundle.js
// do about both, rendered with the Hogan that ships in files/vendor.js.
const source = fs.readFileSync('files/bundle.js', 'utf8');
const css = fs.readFileSync('files/bundle.css', 'utf8');

// Hogan is two webpack modules of vendor.js, the compiler and the template runtime, each
// `function(t, e, n) { !function(t) { ... }(e) }` filling its exports.
function loadHogan() {
    const lines = fs.readFileSync('files/vendor.js', 'utf8').split('\n');
    const opens = (line) => /^\t\}, (?:, )*function\(/.test(line); // `}, , function` where the module array has holes
    const moduleWith = (marker) => {
        const at = lines.findIndex((l) => l.includes(marker));
        assert.notEqual(at, -1, marker);
        let start = at;
        while (!opens(lines[start])) start--;
        let end = at;
        while (!opens(lines[end])) end++;
        const body = lines.slice(start, end).join('\n').replace(/^\t\}, (?:, )*/, '');
        const exports = {};
        new Function(`return (${body}\n})`)()(null, exports, null);
        return exports;
    };
    const hogan = moduleWith('t.compile = function(e, n) {');
    hogan.Template = moduleWith('t.Template = function(t, e, n, r) {').Template;
    hogan.template = hogan.Template;
    return hogan;
}
const Hogan = loadHogan();

// A template of the bundle: the one-line string literal that holds `marker`.
function template(marker) {
    const line = source.split('\n').find((l) => l.includes(marker) && l.trim().startsWith("'"));
    assert.ok(line, marker);
    return new Function(`return ${line.trim().replace(/\)?[;,]\s*$/, '')}`)();
}
const render = (text, context, partials = {}) => Hogan.compile(text).render(context, partials);

// Source of the function assigned right after `marker`.
function method(marker, scope = {}) {
    const at = source.indexOf(marker);
    assert.notEqual(at, -1, marker);
    const start = source.indexOf('function', at);
    let depth = 0;
    for (let i = source.indexOf('{', start); i < source.length; i++) {
        if (source[i] === '{') depth++;
        else if (source[i] === '}' && --depth === 0) return new Function(...Object.keys(scope), `return (${source.slice(start, i + 1)});`)(...Object.values(scope));
    }
    throw new Error('unterminated ' + marker);
}

const chirp = (count) => ({
    media: Array.from({ length: count }, (_, i) => ({ mediaId: String(i + 1) })),
    getMedia() { return this.media; },
    isMediaGridContent() { return this.media.length > 1; },
    mediaLength: method('TD.services.ChirpBase.prototype.mediaLength = '),
    moreMediaCount: method('TD.services.ChirpBase.prototype.moreMediaCount = '),
});
const CELL = { 'status/media_image_container': '<i data-id="{{mediaId}}"></i>', 'status/media_thumb': '<b></b>', 'status/media_sensitive': '' };
const GRID = '{{#isMediaGridContent}} <div class="media-grid-{{mediaLength}}"> {{#getMedia}} {{> status/media_image_container}} {{/getMedia}}';

test('the template engine of vendor.js runs here', () => {
    assert.equal(render('{{#list}}<{{.}}>{{/list}}{{^none}}!{{/none}}', { list: [1, 2] }), '<1><2>!');
});

test('a grid of two to four media is drawn as before, without a count', () => {
    for (const count of [2, 3, 4]) {
        const html = render(template(GRID), chirp(count), CELL);
        assert.match(html, new RegExp(`<div class="media-grid-${count}">`));
        assert.equal(html.match(/<i data-id/g).length, count);
        assert.doesNotMatch(html, /media-grid-more/);
    }
});

test('a post with more than four media keeps the grid of four and says how many more there are', () => {
    for (const count of [5, 17, 20]) {
        const html = render(template(GRID), chirp(count), CELL);
        assert.match(html, /<div class="media-grid-4">/);
        // every cell is still in the page (the stylesheet hides the fifth onwards), so a click on
        // the grid opens the gallery over all of them
        assert.equal(html.match(/<i data-id/g).length, count);
        assert.match(html, new RegExp(`<span class="media-grid-more">\\+${count - 4}</span> </div>`));
    }
});

test('every template that draws a grid carries the count: columns (two), the scheduled Tweet and the detail view', () => {
    const more = '{{#moreMediaCount}}<span class="media-grid-more">+{{moreMediaCount}}</span>{{/moreMediaCount}}';
    assert.equal(source.split(`{{/getMedia}} ${more} </div>`).length - 1, 3);
    assert.equal(source.split(`{{/getUniqueMedia}} ${more} {{> status/media_sensitive}} </div>`).length - 1, 1);
    assert.equal(source.split('<div class="media-grid-{{mediaLength}}">').length - 1, 5, 'four chirp grids and the composer');
});

test('the stylesheet hides the fifth cell onwards and lays the composer out for many files', () => {
    assert.match(css, /\.media-grid-4 > \.media-image-container:nth-child\(n \+ 5\) \{\s*display: none !important;/);
    assert.match(css, /\.media-grid-more \{[^}]*pointer-events: none;/);
    assert.match(css, /\.media-grid-many \{[^}]*grid-template-columns: repeat\(4, 1fr\);/);
    assert.match(css, /html\.dark \.compose-media-grid-holder \.media-grid-container\.media-grid-container-many \{\s*height: auto;/);
});

test('the composer takes twenty attachments for a Tweet, four for a scheduled one and one for a message', () => {
    const getMaxAllowedImages = method('getMaxAllowedImages: ');
    assert.equal(getMaxAllowedImages({ tweetType: 'tweet' }), 20);
    assert.equal(getMaxAllowedImages({ tweetType: 'reply' }), 20);
    assert.equal(getMaxAllowedImages({ tweetType: 'tweet', scheduledDate: new Date() }), 4);
    assert.equal(getMaxAllowedImages({ tweetType: 'message' }), 1);
    assert.equal(method('(t.getMaxAllowedFiles = ')(), 20);
    // "a GIF or a video stays alone" used to be asked only when the limit was exactly four
    assert.ok(source.includes('if (1 < s.default.getMaxAllowedImages(e)) {'));
    assert.ok(!source.includes('4 === s.default.getMaxAllowedImages(e)'));
});

test("the composer's preview names its grid by the count up to four, and \"many\" beyond", () => {
    assert.ok(source.includes('mediaLength: t > 4 ? "many" : t,'));
    const bar = template('compose-media-grid-holder');
    const files = (count) => ({ isMediaGridContent: true, mediaLength: count > 4 ? 'many' : count, mediaInfo: Array.from({ length: count }, (_, i) => ({ src: 'blob:' + i, fileIndex: i })) });
    const partials = { 'compose/close_button': 'x', 'compose/image_description_field': '' };
    assert.match(render(bar, files(4), partials), /<div class="media-grid-container media-grid-container-4"> <div class="media-grid-4">/);
    const many = render(bar, files(9), partials);
    assert.match(many, /<div class="media-grid-container media-grid-container-many"> <div class="media-grid-many">/);
    assert.equal(many.match(/data-file-index=/g).length, 9, 'each file can be removed');
});

test('the detail view names the client only when X sent one', () => {
    const whole = template('{{sourceNoHTML}}');
    const line = whole.slice(whole.indexOf('<a href="{{getChirpURL}}"'), whole.indexOf('{{#hasLocationData}}'));
    assert.match(line, /^<a href="\{\{getChirpURL\}\}"/);
    const tweet = { getChirpURL: 'https://x.com/a/status/1', createdPrettyFull: '10:00 AM · Nov 13, 2026' };
    const withSource = render(line, { ...tweet, sourceNoHTML: 'Twitter Web App', sourceUrl: 'https://help.twitter.com/en/using-twitter/how-to-tweet#source-labels' });
    assert.match(withSource, /Nov 13, 2026<\/a> &middot; <a href="https:\/\/help\.twitter\.com\/en\/using-twitter\/how-to-tweet#source-labels" rel="url" target="_blank">Twitter Web App<\/a>/);
    // TwitterStatus.prototype.sourceNoHTML is "" for a tweet without `source`, which is every
    // tweet of x.com's GraphQL but a retweet's wrapper (HARs of 2026-10-16 to 11-13)
    const without = render(line, { ...tweet, sourceNoHTML: '', sourceUrl: '' });
    assert.match(without, /Nov 13, 2026<\/a>\s+<\/div>/);
    assert.doesNotMatch(without, /&middot;|href=""/);
});
