const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync('src/interception.js', 'utf8');

// The write routes as x.com's own requests (main.js, bundle.LoggedInApiFilters and the request
// headers of the 2026-11-11 HAR): the client headers, the variables of each mutation and the
// features CreateTweet falls back to when the registry is off.
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

function load({ language = 'ja-JP', withNavigator = true, localStorage = { OTDgraphqlRegistry: 'off' }, fetch, warnings = [] } = {}) {
    const context = vm.createContext({
        localStorage, location: { hostname: 'x.com' },
        ...(withNavigator ? { navigator: { language } } : {}),
        ...(fetch ? { fetch } : {}),
        XMLHttpRequest: FakeXHR, console: { ...console, log() {}, warn: (...args) => warnings.push(args.join(' ')), error() {} },
        URL, URLSearchParams, Date, setTimeout, clearTimeout, Event: class {}, ProgressEvent: class {},
        solveChallenge: async () => 'transaction-id',
        // the retweet route asks legacy which account acts
        TD: { storage: { accountController: { getAll: () => [{ state: { username: 'me', userId: '42' } }], getUserIdentifier: () => 'me' } } },
    });
    context.window = context;
    vm.runInContext(source, context);
    return context;
}
// what legacy's TD.net.ajax puts on a request before the Proxy sees it
const LEGACY = {
    'x-act-as-user-id': '42', 'Content-Type': 'application/x-www-form-urlencoded',
    'X-Twitter-Client-Version': 'Twitter-TweetDeck-blackbird-chrome/4.0.220811153004 web/',
};
async function send(context, method, url, body = null, headers = LEGACY) {
    const XHR = vm.runInContext('XMLHttpRequest', context);
    const xhr = new XHR();
    xhr.open(method, url, true);
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
    await xhr.send(body);
    return xhr;
}
const API = 'https://api.x.com/1.1/';
const POST = API + 'statuses/update.json';
const sent = (xhr) => JSON.parse(xhr.sentBody);
const variablesOf = (xhr) => sent(xhr).variables;
const operation = (xhr) => new URL(xhr.opens.at(-1)).pathname.split('/').pop();
const headerNames = (xhr) => Object.keys(xhr.headers).map((name) => name.toLowerCase());
// x.com's logged-in page as far as readPageLoginUser reads it
const page = (session, config = {}) => `<html><script>window.__INITIAL_STATE__=${JSON.stringify({
    entities: { users: { entities: { 1: { id_str: '1', screen_name: 'me' } } } },
    featureSwitch: { user: { config } }, session: { user_id: '1', ...session },
})};window.__META_DATA__={"env":"prod"};</script></html>`;
const serving = (html) => async () => ({ ok: true, status: 200, text: async () => html });

test("every API request carries x.com's client headers, and never legacy's TweetDeck client version", async () => {
    const ctx = load({ language: 'ja-JP' });
    const tweet = await send(ctx, 'POST', POST, 'status=hello');
    assert.equal(operation(tweet), 'CreateTweet');
    assert.equal(tweet.headers['X-Twitter-Client-Language'], 'ja');
    assert.equal(tweet.headers['X-Twitter-Active-User'], 'yes');
    assert.ok(!headerNames(tweet).includes('x-twitter-client-version'));
    // requests without a route of their own went out as legacy built them: a follow (the bundle's
    // helper sets "en" itself) and a mute
    for (const path of ['friendships/create.json', 'mutes/users/create.json']) {
        const xhr = await send(ctx, 'POST', API + path, 'screen_name=x', { ...LEGACY, 'X-Twitter-Client-Language': 'en', 'x-twitter-client-version': 'again' });
        assert.deepEqual(xhr.opens, [API + path], 'the request itself is left alone');
        assert.equal(xhr.sentBody, 'screen_name=x');
        assert.equal(xhr.headers['X-Twitter-Client-Language'], 'ja', path);
        assert.equal(xhr.headers['X-Twitter-Active-User'], 'yes', path);
        assert.deepEqual(headerNames(xhr).filter((name) => /client-version|client-language/.test(name)), ['x-twitter-client-language'], path);
        assert.equal(xhr.headers['x-act-as-user-id'], '42');
    }
    // a caller's own x-twitter-active-user stays
    const background = await send(ctx, 'POST', API + 'mutes/users/create.json', '', { ...LEGACY, 'x-twitter-active-user': 'no' });
    assert.equal(background.headers['x-twitter-active-user'], 'no');
    assert.ok(!('X-Twitter-Active-User' in background.headers));
    // the upload host only loses the client version; another site is not touched
    const upload = await send(ctx, 'POST', 'https://upload.x.com/1.1/media/upload.json?command=INIT', '');
    assert.deepEqual(headerNames(upload).sort(), ['content-type', 'x-act-as-user-id']);
    const elsewhere = await send(ctx, 'GET', 'https://example.com/x.com/i/api/1.1/a.json');
    assert.ok(headerNames(elsewhere).includes('x-twitter-client-version'));
    assert.ok(!headerNames(elsewhere).includes('x-twitter-client-language'));
});

test("the language is the account's on x.com's page, through x.com's map; the browser's until that is known", async () => {
    assert.equal(vm.runInContext('clientLanguage()', load({ language: 'pt-BR' })), 'pt');
    assert.equal(vm.runInContext('clientLanguage()', load({ withNavigator: false })), 'en');
    const localStorage = { OTDgraphqlRegistry: 'off' };
    const ctx = load({ language: 'en-US', localStorage, fetch: serving(page({ language: 'zh-Hant' })) });
    await vm.runInContext('readPageLoginUser()', ctx);
    assert.equal(vm.runInContext('clientLanguage()', ctx), 'zh-tw');
    assert.equal(localStorage.OTDaccountLanguage, 'zh-Hant');
    assert.equal((await send(ctx, 'POST', POST, 'status=hello')).headers['X-Twitter-Client-Language'], 'zh-tw');
    // the next start has it before the page is read; a language the map does not list goes as it is
    assert.equal(vm.runInContext('clientLanguage()', load({ language: 'en-US', localStorage: { ...localStorage } })), 'zh-tw');
    assert.equal(vm.runInContext('clientLanguage()', load({ language: 'en-US', localStorage: { OTDaccountLanguage: 'ja' } })), 'ja');
    assert.equal(vm.runInContext('clientLanguage()', load({ language: 'en-US', localStorage: { OTDaccountLanguage: 'constructor' } })), 'constructor');
});

test("a tweet's variables are x.com's, in its order: no dark_request, batch_compose on a thread", async () => {
    const ctx = load();
    const plain = variablesOf(await send(ctx, 'POST', POST, 'status=hello'));
    assert.deepEqual(plain, {
        tweet_text: 'hello',
        media: { media_entities: [], possibly_sensitive: false },
        semantic_annotation_ids: [],
        disallowed_reply_options: null,
    });
    assert.deepEqual(Object.keys(plain), ['tweet_text', 'media', 'semantic_annotation_ids', 'disallowed_reply_options']);
    // legacy's tweetstorm: the follow-ups are replies to the tweet just sent, batch_mode=subsequent
    const followUp = variablesOf(await send(ctx, 'POST', POST, 'status=two&in_reply_to_status_id=5&auto_populate_reply_metadata=true&batch_mode=subsequent&media_ids=8%2C9'));
    assert.deepEqual(followUp, {
        tweet_text: 'two',
        reply: { in_reply_to_tweet_id: '5', exclude_reply_user_ids: [] },
        batch_compose: 'BatchSubsequent',
        media: { media_entities: [{ media_id: '8', tagged_users: [] }, { media_id: '9', tagged_users: [] }], possibly_sensitive: false },
        semantic_annotation_ids: [],
        disallowed_reply_options: null,
    });
    assert.deepEqual(Object.keys(followUp), ['tweet_text', 'reply', 'batch_compose', 'media', 'semantic_annotation_ids', 'disallowed_reply_options']);
    assert.equal(variablesOf(await send(ctx, 'POST', POST, 'status=one&batch_mode=first')).batch_compose, 'BatchFirst');
    // an ordinary reply and a quote carry none; x.com drops a reply id that is not a tweet id
    const reply = variablesOf(await send(ctx, 'POST', POST, 'status=two&in_reply_to_status_id=5&batch_mode=off&exclude_reply_user_ids=7%2C8&attachment_url=https%3A%2F%2Fx.com%2Fa%2Fstatus%2F3'));
    assert.deepEqual(Object.keys(reply), ['tweet_text', 'attachment_url', 'reply', 'media', 'semantic_annotation_ids', 'disallowed_reply_options']);
    assert.deepEqual(reply.reply, { in_reply_to_tweet_id: '5', exclude_reply_user_ids: ['7', '8'] });
    assert.equal(reply.attachment_url, 'https://x.com/a/status/3');
    assert.ok(!('reply' in variablesOf(await send(ctx, 'POST', POST, 'status=two&in_reply_to_status_id=abc'))));
    // the body is variables, features, queryId: x.com sends CreateTweet no fieldToggles
    assert.deepEqual(Object.keys(sent(await send(ctx, 'POST', POST, 'status=hello'))), ['variables', 'features', 'queryId']);
});

test("a retweet, its undo and a delete send x.com's variables and nothing else", async () => {
    const ctx = load();
    const cases = [
        ['statuses/retweet/123.json', 'CreateRetweet', { tweet_id: '123' }],
        ['statuses/unretweet/123.json', 'DeleteRetweet', { source_tweet_id: '123' }],
        ['statuses/destroy/123.json', 'DeleteTweet', { tweet_id: '123' }],
    ];
    for (const [path, name, variables] of cases) {
        const xhr = await send(ctx, 'POST', API + path, '');
        assert.equal(operation(xhr), name);
        const body = sent(xhr);
        assert.deepEqual(body.variables, variables, name);
        assert.deepEqual(Object.keys(body), ['variables', 'queryId'], name);
        assert.ok(new URL(xhr.opens.at(-1)).pathname.includes(`/${body.queryId}/`), name);
    }
    const like = await send(ctx, 'POST', API + 'favorites/create.json', 'id=123');
    assert.equal(operation(like), 'FavoriteTweet');
    assert.deepEqual(sent(like).variables, { tweet_id: '123' });
});

test("with the registry off, CreateTweet goes out with the built-in table's id and features", async () => {
    const ctx = load();
    const xhr = await send(ctx, 'POST', POST, 'status=hello');
    const body = sent(xhr);
    const table = vm.runInContext('builtinGraphqlTable()', ctx);
    // a plain copy: the vm realm has its own Object prototype
    const expected = JSON.parse(JSON.stringify(vm.runInContext('graphqlFeaturesFor', ctx)(table.ops.CreateTweet, table)));
    assert.deepEqual(body.features, expected);
    assert.equal(body.queryId, table.ops.CreateTweet.id);
    assert.equal(new URL(xhr.opens.at(-1)).pathname, `/i/api/graphql/${table.ops.CreateTweet.id}/CreateTweet`);
    assert.ok(Object.keys(expected).length > 30, 'a current list, not the 2024 one');
});

test('says so, once a day, when x.com starts signing its own writes for the account', async () => {
    const quiet = [];
    const off = load({ warnings: quiet, fetch: serving(page({ language: 'ja' }, { rweb_session_binding_enabled: { value: false } })) });
    await vm.runInContext('readPageLoginUser()', off);
    assert.deepEqual(quiet.filter((w) => w.includes('session_binding')), []);
    const warnings = [];
    const localStorage = { OTDgraphqlRegistry: 'off' };
    const on = load({ warnings, localStorage, fetch: serving(page({ language: 'ja' }, { rweb_session_binding_enabled: { value: true } })) });
    await vm.runInContext('readPageLoginUser()', on);
    assert.ok(warnings.some((w) => w.includes('rweb_session_binding_enabled')), warnings.join('\n'));
    assert.ok(Number(localStorage.OTDsessionBindingNoticedAt) > 0);
    assert.equal(vm.runInContext('pendingToasts.length', on), 1, 'one toast, however often the page is read');
});
