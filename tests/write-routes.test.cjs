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
        this.opens = []; this.headers = {}; this.listeners = []; this.sentBody = undefined; this.onload = null; this.onerror = null;
        FakeXHR.all.push(this);
    }
    static all = []; // the raw requests, newest last
    answer(status, text) { this.readyState = 4; this.status = status; this.responseText = text; }
    open(method, url) { this.readyState = 1; this.opens.push(url); }
    setRequestHeader(name, value) { this.headers[name] = value; }
    send(body) { this.sentBody = body; }
    addEventListener(type, fn) { this.listeners.push([type, fn]); }
    getResponseHeader() { return null; }
    getAllResponseHeaders() { return ''; }
    abort() {}
}

function load({ language = 'ja-JP', withNavigator = true, localStorage = { OTDgraphqlRegistry: 'off' }, fetch, warnings = [], document } = {}) {
    const context = vm.createContext({
        localStorage, location: { hostname: 'x.com' },
        ...(withNavigator ? { navigator: { language } } : {}),
        ...(fetch ? { fetch } : {}),
        ...(document ? { document } : {}),
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
    // requests without a route of their own went out as legacy built them: a mute and a block
    // (a caller may set "en" itself, as the bundle's follow helper does)
    for (const path of ['mutes/users/create.json', 'blocks/create.json']) {
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
    // nothing made up goes along: x.com's page sends no X-Client-UUID
    assert.deepEqual(headerNames(tweet).sort(), ['authorization', 'content-type', 'x-act-as-user-id', 'x-client-transaction-id', 'x-twitter-active-user', 'x-twitter-client-language']);
    assert.ok(!headerNames(await send(load({ localStorage: { OTDgraphqlRegistry: 'off', device_id: 'old' } }), 'POST', POST, 'status=hello')).includes('x-client-uuid'));
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

// ---- x.com's own follow, upload and composer signals (the second HAR of 2026-11-11) -------------

const FOLLOW_SWITCHES = 'include_profile_interstitial_type=1&include_blocking=1&include_blocked_by=1&include_followed_by=1'
    + '&include_want_retweets=1&include_mute_edge=1&include_can_dm=1&include_can_media_tag=1'
    + '&include_ext_is_blue_verified=1&include_ext_verified_type=1&include_ext_profile_image_shape=1&skip_status=1';
const JQUERY = { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Twitter-Client-Version': 'Twitter-TweetDeck-blackbird-chrome/4.0 web/' };
const settle = () => new Promise((resolve) => setImmediate(resolve));

test("a follow and an unfollow go to x.com's own origin with its body: the switches, then user_id", async () => {
    const ctx = load();
    vm.runInContext('screenNameIds', ctx).someone = '7';
    for (const action of ['create', 'destroy']) {
        const xhr = await send(ctx, 'POST', `${API}friendships/${action}.json`, 'screen_name=Someone', JQUERY);
        await settle();
        assert.deepEqual(xhr.opens, [`https://x.com/i/api/1.1/friendships/${action}.json`], action);
        assert.equal(xhr.sentBody, `${FOLLOW_SWITCHES}&user_id=7`, action);
        assert.deepEqual(Object.entries(xhr.headers).filter(([name]) => name.toLowerCase() === 'content-type'), [['Content-Type', 'application/x-www-form-urlencoded']]);
        assert.deepEqual(headerNames(xhr).sort(), ['content-type', 'x-client-transaction-id', 'x-twitter-active-user', 'x-twitter-client-language']);
    }
    // a caller that already has the id
    assert.equal((await send(ctx, 'POST', API + 'friendships/create.json', 'user_id=9', JQUERY)).sentBody, `${FOLLOW_SWITCHES}&user_id=9`);
    // an account x.com acts for keeps api.x.com, as on x.com
    const acting = await send(ctx, 'POST', API + 'friendships/create.json', 'user_id=9', { ...JQUERY, 'x-act-as-user-id': '42' });
    assert.deepEqual(acting.opens, [API + 'friendships/create.json']);
    assert.equal(acting.sentBody, `${FOLLOW_SWITCHES}&user_id=9`);
    // a name nothing is known about is looked up; if that fails the name goes along instead
    const before = FakeXHR.all.length;
    const unknown = await send(ctx, 'POST', API + 'friendships/create.json', 'screen_name=nobody', JQUERY);
    assert.equal(unknown.sentBody, undefined, 'waits for the lookup');
    const lookup = FakeXHR.all.at(-1);
    assert.ok(FakeXHR.all.length > before && lookup.opens[0].includes('/UserByScreenName?'), lookup.opens[0]);
    lookup.onerror();
    await settle();
    assert.equal(unknown.sentBody, `${FOLLOW_SWITCHES}&screen_name=nobody`);
});

test("the digest of an upload's pieces is MD5, however they are cut", () => {
    const md5Stream = vm.runInContext('md5Stream', load());
    const crypto = require('node:crypto');
    for (const size of [0, 1, 55, 56, 57, 63, 64, 65, 119, 120, 128, 1000, 70001]) {
        const data = crypto.randomBytes(size);
        const expected = crypto.createHash('md5').update(data).digest('hex');
        for (const piece of [size || 1, 1, 7, 64, 100, 4096]) {
            if (piece === 1 && size > 2000) continue;
            const md5 = md5Stream();
            for (let at = 0; at < size; at += piece) {
                const part = data.subarray(at, at + piece);
                md5.update(part.buffer.slice(part.byteOffset, part.byteOffset + part.length));
            }
            assert.equal(md5.hex(), expected, `${size} bytes in pieces of ${piece}`);
        }
    }
    assert.equal(md5Stream().hex(), 'd41d8cd98f00b204e9800998ecf8427e');
});

const UPLOAD = 'https://upload.x.com/1.1/media/upload.json';
const UPLOADED = 'https://upload.x.com/i/media/upload.json';
const SRU = { Authorization: 'Bearer x', 'X-Twitter-Auth-Type': 'OAuth2Session', 'X-Csrf-Token': 'c' };
const piece = (bytes) => ({ get: (name) => (name === 'media' ? { arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) } : null) });
// INIT through the Proxy, answered by X with this media id
async function initUpload(ctx, type, id, extra = '') {
    const init = await send(ctx, 'POST', `${UPLOAD}?command=INIT&total_bytes=10&media_type=${encodeURIComponent(type)}${extra}`, null, SRU);
    FakeXHR.all.at(-1).answer(202, JSON.stringify({ media_id: Number(id), media_id_string: id, expires_after_secs: 86400 }));
    assert.equal(JSON.parse(init.responseText).media_id_string, id, 'legacy reads the answer as it is');
    return init;
}

test("an image goes up as on x.com: its path, media_category=tweet_image and the file's MD5 on FINALIZE", async () => {
    const ctx = load();
    const crypto = require('node:crypto');
    const init = await initUpload(ctx, 'image/png', '55');
    assert.deepEqual(init.opens, [`${UPLOADED}?command=INIT&total_bytes=10&media_type=image%2Fpng&media_category=tweet_image`]);
    assert.deepEqual(headerNames(init).sort(), ['authorization', 'x-csrf-token', 'x-twitter-auth-type']);
    const parts = [crypto.randomBytes(70), crypto.randomBytes(33)];
    const first = await send(ctx, 'POST', `${UPLOAD}?command=APPEND&media_id=55&segment_index=0`, piece(parts[0]), SRU);
    assert.deepEqual(first.opens, [`${UPLOADED}?command=APPEND&media_id=55&segment_index=0`]);
    assert.equal(typeof first.sentBody.get, 'function', 'the piece itself goes up untouched');
    // legacy repeats a piece that failed: it is read once
    await send(ctx, 'POST', `${UPLOAD}?command=APPEND&media_id=55&segment_index=0`, piece(parts[0]), SRU);
    await send(ctx, 'POST', `${UPLOAD}?command=APPEND&media_id=55&segment_index=1`, piece(parts[1]), SRU);
    const finalize = await send(ctx, 'POST', `${UPLOAD}?command=FINALIZE&media_id=55`, null, SRU);
    await settle();
    const md5 = crypto.createHash('md5').update(Buffer.concat(parts)).digest('hex');
    assert.deepEqual(finalize.opens, [`${UPLOADED}?command=FINALIZE&media_id=55&original_md5=${md5}`]);
    assert.deepEqual(headerNames(finalize).sort(), ['authorization', 'x-csrf-token', 'x-twitter-auth-type']);
    assert.equal(finalize.sentBody, null);
    // a FINALIZE that legacy repeats carries the same digest
    const again = await send(ctx, 'POST', `${UPLOAD}?command=FINALIZE&media_id=55`, null, SRU);
    await settle();
    assert.deepEqual(again.opens, finalize.opens);
});

test('an upload whose pieces were not all read in order, and anything that is not an image, is finalized as before', async () => {
    const ctx = load();
    await initUpload(ctx, 'image/jpeg', '60');
    await send(ctx, 'POST', `${UPLOAD}?command=APPEND&media_id=60&segment_index=1`, piece(Buffer.from('late')), SRU);
    const skipped = await send(ctx, 'POST', `${UPLOAD}?command=FINALIZE&media_id=60`, null, SRU);
    await settle();
    assert.deepEqual(skipped.opens, [`${UPLOADED}?command=FINALIZE&media_id=60`]);
    await initUpload(ctx, 'image/jpeg', '61');
    await send(ctx, 'POST', `${UPLOAD}?command=APPEND&media_id=61&segment_index=0`, { get: () => ({ arrayBuffer: async () => { throw new Error('unreadable'); } }) }, SRU);
    const unread = await send(ctx, 'POST', `${UPLOAD}?command=FINALIZE&media_id=61`, null, SRU);
    await settle();
    assert.deepEqual(unread.opens, [`${UPLOADED}?command=FINALIZE&media_id=61`]);
    // a GIF keeps legacy's category, a video gets none; neither is hashed
    const gif = await initUpload(ctx, 'image/gif', '62', '&media_category=tweet_gif');
    assert.deepEqual(gif.opens, [`${UPLOADED}?command=INIT&total_bytes=10&media_type=image%2Fgif&media_category=tweet_gif`]);
    const video = await initUpload(ctx, 'video/mp4', '63');
    assert.deepEqual(video.opens, [`${UPLOADED}?command=INIT&total_bytes=10&media_type=video%2Fmp4`]);
    await send(ctx, 'POST', `${UPLOAD}?command=APPEND&media_id=63&segment_index=0`, piece(Buffer.from('v')), SRU);
    const done = await send(ctx, 'POST', `${UPLOAD}?command=FINALIZE&media_id=63&allow_async=true`, null, SRU);
    assert.deepEqual(done.opens, [`${UPLOADED}?command=FINALIZE&media_id=63&allow_async=true`], 'opened at once');
    const status = await send(ctx, 'GET', `${UPLOAD}?command=STATUS&media_id=63`, null, SRU);
    assert.deepEqual(status.opens, [`${UPLOADED}?command=STATUS&media_id=63`]);
});

test("a post says how it was written, as x.com's composer does: pasted and never typed, or nothing", async () => {
    const switchOn = { composer_composition_signals_enabled: { value: true } };
    const listeners = {};
    const ctx = load({ fetch: serving(page({ language: 'ja' }, switchOn)) });
    assert.ok(!('semantic_annotation_options' in variablesOf(await send(load(), 'POST', POST, 'status=early'))), 'nothing until the page says x.com sends it');
    await vm.runInContext('readPageLoginUser()', ctx);
    const key = vm.runInContext('noteComposeKey', ctx), paste = vm.runInContext('noteComposePaste', ctx), posted = vm.runInContext('compositionSent', ctx);
    // a compose field of TweetDeck's, holding this text
    const field = (value) => ({ value, isConnected: true, matches: (selector) => selector.includes('textarea.js-compose-text') && selector.includes('textarea.js-reply-tweetbox') });
    const options = async (text) => { const xhr = await send(ctx, 'POST', POST, 'status=' + encodeURIComponent(text)); return [variablesOf(xhr), FakeXHR.all.at(-1)]; };
    // nothing typed or pasted (a re-draft): just where it was written
    let [variables, raw] = await options('hello');
    assert.deepEqual(variables.semantic_annotation_options, { source: 'Unknown' });
    assert.equal(Object.keys(variables).at(-1), 'semantic_annotation_options');
    // typed, with a paste in between
    const drawer = field(' typed\nand pasted ');
    for (const k of ['Shift', 'A', 'Process', 'Enter']) key({ key: k, target: drawer });
    paste({ target: drawer });
    assert.deepEqual((await options('typed\nand pasted'))[0].semantic_annotation_options, { source: 'Unknown' });
    // pasted into another field and never typed: modifiers and shortcuts are not typing
    const reply = field('pasted');
    for (const event of [{ key: 'Control' }, { key: 'v', ctrlKey: true }, { key: 'v', metaKey: true }, { key: 'Shift' }]) key({ ...event, target: reply });
    paste({ target: reply });
    [variables, raw] = await options('pasted');
    assert.deepEqual(variables.semantic_annotation_options, { composition_signal_1: true, source: 'Unknown' });
    assert.deepEqual(Object.keys(variables.semantic_annotation_options), ['composition_signal_1', 'source']);
    // each post is judged by the field that holds its text, not by the field touched last
    assert.deepEqual((await options('typed\nand pasted'))[0].semantic_annotation_options, { source: 'Unknown' });
    assert.deepEqual((await options('written elsewhere'))[0].semantic_annotation_options, { source: 'Unknown' });
    // a post that failed is still what it was; once it is out the count starts again
    assert.equal((await options('pasted'))[0].semantic_annotation_options.composition_signal_1, true);
    posted(raw);
    assert.deepEqual((await options('pasted'))[0].semantic_annotation_options, { source: 'Unknown' });
    // an image pasted into an empty field is a paste too, as on x.com; a field that left the page is not looked at
    const empty = field('');
    paste({ target: empty });
    assert.equal((await options(''))[0].semantic_annotation_options.composition_signal_1, true);
    empty.isConnected = false;
    assert.deepEqual((await options(''))[0].semantic_annotation_options, { source: 'Unknown' });
    // other elements do not count, and only the few fields used last are kept
    key({ key: 'a', target: { matches: () => false } });
    paste({ target: {} });
    paste({});
    for (let i = 0; i < 20; i++) key({ key: 'a', target: field('x' + i) });
    assert.equal(vm.runInContext('composeInput.fields.length', ctx), 8);
    // the listeners are x.com's: keydown and paste, capturing
    load({ document: { addEventListener: (type, fn, opts) => { listeners[type] = { ...opts }; } } });
    assert.deepEqual(listeners, { keydown: { passive: true, capture: true }, paste: { passive: true, capture: true } });
    // an account x.com sends nothing for
    const off = load({ fetch: serving(page({ language: 'ja' }, { composer_composition_signals_enabled: { value: false } })) });
    await vm.runInContext('readPageLoginUser()', off);
    assert.ok(!('semantic_annotation_options' in variablesOf(await send(off, 'POST', POST, 'status=hello'))));
});
