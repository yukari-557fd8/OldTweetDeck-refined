const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync('src/interception.js', 'utf8');

// The write routes as x.com's own requests: the language header, CreateTweet's variables and the
// features the route falls back to when the registry is off.
class FakeXHR {
    constructor() {
        this.readyState = 0; this.status = 0; this.statusText = ''; this.responseText = '';
        this.opens = []; this.headers = {}; this.listeners = []; this.sentBody = undefined;
    }
    open(method, url) { this.readyState = 1; this.opens.push(url); }
    setRequestHeader(name, value) { this.headers[name] = value; }
    send(body) { this.sentBody = body; }
    addEventListener(type, fn) { this.listeners.push([type, fn]); }
    getResponseHeader() { return null; }
    getAllResponseHeaders() { return ''; }
    abort() {}
}

function load({ language = 'ja-JP', withNavigator = true, localStorage = { OTDgraphqlRegistry: 'off' } } = {}) {
    const context = vm.createContext({
        localStorage, location: { hostname: 'x.com' },
        ...(withNavigator ? { navigator: { language } } : {}),
        XMLHttpRequest: FakeXHR, console: { ...console, log() {}, warn() {}, error() {} },
        URL, URLSearchParams, Date, setTimeout, clearTimeout, Event: class {}, ProgressEvent: class {},
        solveChallenge: async () => 'transaction-id',
        // the retweet route asks legacy which account acts
        TD: { storage: { accountController: { getAll: () => [{ state: { username: 'me', userId: '42' } }], getUserIdentifier: () => 'me' } } },
    });
    context.window = context;
    vm.runInContext(source, context);
    return context;
}
const FORM = { 'x-act-as-user-id': '42', 'Content-Type': 'application/x-www-form-urlencoded' };
async function send(context, method, url, body = null, headers = FORM) {
    const XHR = vm.runInContext('XMLHttpRequest', context);
    const xhr = new XHR();
    xhr.open(method, url, true);
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
    await xhr.send(body);
    return xhr;
}
const POST = 'https://api.x.com/1.1/statuses/update.json';
const RETWEET = 'https://api.x.com/1.1/statuses/retweet/123.json';
const variablesOf = (xhr) => JSON.parse(xhr.sentBody).variables;

test("write requests carry the browser's language, as x.com sends the account's; en without a navigator", async () => {
    const ctx = load({ language: 'ja-JP' });
    const tweet = await send(ctx, 'POST', POST, 'status=hello');
    assert.equal(new URL(tweet.opens.at(-1)).pathname.split('/').pop(), 'CreateTweet');
    assert.equal(tweet.headers['X-Twitter-Client-Language'], 'ja');
    const retweet = await send(ctx, 'POST', RETWEET, '');
    assert.equal(new URL(retweet.opens.at(-1)).pathname.split('/').pop(), 'CreateRetweet');
    assert.equal(retweet.headers['X-Twitter-Client-Language'], 'ja');
    assert.equal(vm.runInContext('clientLanguage()', load({ language: 'pt-BR' })), 'pt');
    assert.equal(vm.runInContext('clientLanguage()', load({ withNavigator: false })), 'en');
});

test("a tweet's variables are x.com's: disallowed_reply_options travels, batch_compose only on a thread's follow-ups", async () => {
    const ctx = load();
    const plain = variablesOf(await send(ctx, 'POST', POST, 'status=hello'));
    assert.deepEqual(plain, {
        tweet_text: 'hello',
        media: { media_entities: [], possibly_sensitive: false },
        semantic_annotation_ids: [],
        disallowed_reply_options: null,
        dark_request: false,
    });
    // legacy's tweetstorm: the follow-ups are replies to the tweet just sent, batch_mode=subsequent
    const followUp = variablesOf(await send(ctx, 'POST', POST, 'status=two&in_reply_to_status_id=5&auto_populate_reply_metadata=true&batch_mode=subsequent'));
    assert.deepEqual(followUp.reply, { in_reply_to_tweet_id: '5', exclude_reply_user_ids: [] });
    assert.equal(followUp.batch_compose, 'BatchSubsequent');
    assert.equal(followUp.disallowed_reply_options, null);
    // an ordinary reply, and the first tweet of a thread (sent before the thread exists), carry none
    const reply = variablesOf(await send(ctx, 'POST', POST, 'status=two&in_reply_to_status_id=5&auto_populate_reply_metadata=true&batch_mode=off&exclude_reply_user_ids=7%2C8'));
    assert.deepEqual(reply.reply, { in_reply_to_tweet_id: '5', exclude_reply_user_ids: ['7', '8'] });
    assert.ok(!('batch_compose' in reply));
    assert.ok(!('batch_compose' in plain));
});

test("with the registry off, CreateTweet falls back to the built-in table's features", async () => {
    const ctx = load();
    const body = JSON.parse((await send(ctx, 'POST', POST, 'status=hello')).sentBody);
    const table = vm.runInContext('builtinGraphqlTable()', ctx);
    // a plain copy: the vm realm has its own Object prototype
    const expected = JSON.parse(JSON.stringify(vm.runInContext('graphqlFeaturesFor', ctx)(table.ops.CreateTweet, table)));
    assert.deepEqual(body.features, expected);
    assert.equal(body.queryId, table.ops.CreateTweet.id);
    assert.ok(Object.keys(expected).length > 30, 'the 2026-10 list, not the 2024 one');
});
