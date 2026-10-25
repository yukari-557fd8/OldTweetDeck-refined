const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync('src/interception.js', 'utf8');

// The raw XHR under the Proxy: records what was sent.
class FakeXHR {
    constructor() { this.readyState = 0; this.status = 0; this.statusText = ''; this.responseText = ''; this.headers = {}; this.sentBody = undefined; }
    open() { this.readyState = 1; }
    setRequestHeader(name, value) { this.headers[name] = value; }
    send(body) { this.sentBody = body; }
    addEventListener() {}
    getResponseHeader() { return null; }
    getAllResponseHeaders() { return ''; }
    abort() {}
}

function load() {
    const context = vm.createContext({
        localStorage: {}, location: { hostname: 'x.com' }, navigator: { language: 'en-US' },
        XMLHttpRequest: FakeXHR, console: { ...console, log() {}, warn() {}, error() {} },
        URL, URLSearchParams, Date, setTimeout, clearTimeout, Event: class {}, ProgressEvent: class {},
        solveChallenge: async () => 'transaction-id',
    });
    context.window = context;
    vm.runInContext(source, context);
    return context;
}

async function post(context, url, body, contentType = 'application/x-www-form-urlencoded; charset=UTF-8') {
    const XHR = vm.runInContext('XMLHttpRequest', context);
    const xhr = new XHR();
    xhr.open('POST', url, true);
    xhr.setRequestHeader('Content-Type', contentType);
    await xhr.send(body);
    return xhr;
}

// What legacy's handleSendDm hands jQuery for one recipient (ids as an array), after $.param.
const DM = 'https://api.x.com/1.1/dm/new.json';
const legacyBody = 'text=hello+there&ext=altText&recipient_ids%5B%5D=1297&cards_platform=Web-13&include_entities=1';

test('a direct message goes out with recipient_ids as the comma-joined list X accepts, not as jQuery\'s array', async () => {
    const xhr = await post(load(), DM, legacyBody);
    const sent = new URLSearchParams(xhr.sentBody);
    assert.equal(sent.get('recipient_ids'), '1297');
    assert.equal(sent.has('recipient_ids[]'), false);
    assert.equal(sent.get('text'), 'hello there');
    assert.equal(sent.get('ext'), 'altText');
    assert.equal(sent.get('include_entities'), '1');
    assert.equal(xhr.headers['Content-Type'], 'application/x-www-form-urlencoded; charset=UTF-8');
});

test('several values of one array key join with commas, in order', async () => {
    const xhr = await post(load(), 'https://api.x.com/1.1/dm/conversation/1-2/add_participants.json', 'participant_ids%5B%5D=1&participant_ids%5B%5D=2&participant_ids%5B%5D=3');
    assert.equal(new URLSearchParams(xhr.sentBody).get('participant_ids'), '1,2,3');
});

test('bodies without an array key, JSON bodies and GraphQL requests are not touched', async () => {
    const plain = 'status=hello&in_reply_to_status_id=5';
    const context = load();
    const flatten = vm.runInContext('flattenArrayParams', context);
    assert.equal(flatten({ modUrl: DM }, plain), plain);
    assert.equal(flatten({ modUrl: DM }, '{"recipient_ids":["1"],"text":"[]="}'), '{"recipient_ids":["1"],"text":"[]="}');
    assert.equal(flatten({ modUrl: 'https://x.com/i/api/graphql/abc/CreateTweet' }, 'a%5B%5D=1'), 'a%5B%5D=1');
    assert.equal(flatten({ modUrl: DM }, null), null);
});
