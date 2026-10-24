const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync('src/interception.js', 'utf8');

// x.com's logged-in page as far as the registry reads it: the main.js script tag, the webpack chunk
// name / hash maps and the user's feature switch values in __INITIAL_STATE__ (shapes from the
// 2026-10-23 HAR). Chunk 45 is in the maps but not served.
const CDN = 'https://abs.twimg.com/responsive-web/client-web/';
const HOME_CHUNK = 'shared~bundle.Compose~bundle.HomeTimeline~bundle.LoggedInMain';
const CHUNKS = {
    44: ['bundle.HomeTimeline', '0000000000000044'],
    45: ['loader.HomeTimelineAdblockNotice', '0000000000000045'],
    53852: [HOME_CHUNK, 'd25cb356ba28eeb6'],
    99969: ['bundle.Notifications', '436071e07774e741'],
    77: ['bundle.Bookmarks', '0000000000000077'],
};
const MAIN = 'main.02f55579051b838ba.js';
const CONFIG = { rweb_video_screen_enabled: true, articles_preview_enabled: false, payments_enabled: true };
function pageHtml({ main = MAIN, config = CONFIG } = {}) {
    const names = Object.entries(CHUNKS).map(([n, [name]]) => `${n}:"${name}"`).join(',');
    const hashes = Object.entries(CHUNKS).map(([n, [, hash]]) => `${n}:"${hash}"`).join(',');
    const state = {
        entities: { users: { entities: { 1: { id_str: '1', screen_name: 'me' } } } },
        featureSwitch: { user: { config: Object.fromEntries(Object.entries(config).map(([k, v]) => [k, { value: v }])) } },
    };
    return `<!DOCTYPE html><html><head><script>window.__INITIAL_STATE__=${JSON.stringify(state)};window.__META_DATA__={"env":"prod"};</script>`
        + `<script>!function(){var e={};e.u=t=>({${names}})[t]+"."+({${hashes}})[t]+"a.js"}();</script>`
        + `<script src="${CDN}vendor.35f35d8c35ac2afda.js"></script><script src="${CDN}${main}"></script></head><body></body></html>`;
}
const declare = (id, name, type, features) =>
    `{queryId:"${id}",operationName:"${name}",operationType:"${type}",metadata:{featureSwitches:${JSON.stringify(features)},fieldToggles:["withPayments","withDmBlocks"]}}`;
const HOME_FEATURES = ['rweb_video_screen_enabled', 'articles_preview_enabled', 'brand_new_feature_enabled'];
const bundles = (main = MAIN) => ({
    [main]: `var a=${declare('oTolA2WNu-LVMjbarDB2KA', 'CreateTweet', 'mutation', ['payments_enabled'])},b=${declare('mxaYWwt52eAb6OAzYHMVzg', 'UserByRestId', 'query', ['payments_enabled', 'articles_preview_enabled'])};`,
    'bundle.HomeTimeline.0000000000000044a.js': 'var nothing=1;',
    [`${HOME_CHUNK}.d25cb356ba28eeb6a.js`]: `x=${declare('AbCdEfGhIjKlMnOpQrStUv', 'HomeLatestTimeline', 'query', HOME_FEATURES)};`,
    'bundle.Notifications.436071e07774e741a.js': `x=${declare('PV7uQNNsuQhCB2vjo4WJGA', 'NotificationsTimeline', 'query', HOME_FEATURES)};`,
    'bundle.Bookmarks.0000000000000077a.js': 'var nothing=2;',
});
function fakeFetch(html, files) {
    const fetch = async (url) => {
        fetch.log.push(url.startsWith(CDN) ? url.slice(CDN.length) : url);
        if (url === 'https://x.com/') return { ok: true, status: 200, text: async () => html };
        const file = url.startsWith(CDN) ? files[url.slice(CDN.length)] : undefined;
        if (file !== undefined) return { ok: true, status: 200, text: async () => file };
        return { ok: false, status: 404, text: async () => 'not found' };
    };
    fetch.log = [];
    return fetch;
}

// The raw XHR under the Proxy: records every open() and what was sent.
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

function load({ localStorage = {}, fetch, solved = [] } = {}) {
    const context = vm.createContext({
        localStorage, location: { hostname: 'x.com' }, navigator: { language: 'en-US' },
        XMLHttpRequest: FakeXHR, console: { ...console, log() {}, warn() {}, error() {} },
        URL, URLSearchParams, Date, setTimeout, clearTimeout, Event: class {}, ProgressEvent: class {},
        solveChallenge: async (path) => { solved.push(path); return 'transaction-id'; },
        ...(fetch ? { fetch } : {}),
    });
    context.window = context;
    vm.runInContext(source, context);
    return context;
}
const registry = (context) => vm.runInContext('graphqlRegistry', context);
const settled = (context) => registry(context).pending || Promise.resolve(registry(context).table);
const plain = (value) => JSON.parse(JSON.stringify(value));
async function firstRun() {
    const localStorage = {};
    await settled(load({ localStorage, fetch: fakeFetch(pageHtml(), bundles()) }));
    return localStorage;
}
async function send(context, method, url, body = null, headers = { 'x-act-as-user-id': '42' }) {
    const XHR = vm.runInContext('XMLHttpRequest', context);
    const xhr = new XHR();
    xhr.open(method, url, true);
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
    await xhr.send(body);
    return xhr;
}
const HOME = 'https://api.x.com/1.1/statuses/home_timeline.json?count=40';
// the route's own id (2026-10-24); the fixtures declare a made-up newer one
const HOME_FALLBACK = '/graphql/KQPfcqQJJqF6M0D77p3JKw/HomeLatestTimeline?';

test("reads the operations x.com's bundles declare, trying the chunks a hint names until one has them", async () => {
    const localStorage = {};
    const fetch = fakeFetch(pageHtml(), bundles());
    const table = plain(await settled(load({ localStorage, fetch })));
    assert.equal(table.main, CDN + MAIN);
    assert.deepEqual(table.ops.HomeLatestTimeline, { id: 'AbCdEfGhIjKlMnOpQrStUv', features: HOME_FEATURES, chunk: HOME_CHUNK });
    assert.deepEqual(table.ops.NotificationsTimeline, { id: 'PV7uQNNsuQhCB2vjo4WJGA', features: HOME_FEATURES, chunk: 'bundle.Notifications' });
    assert.deepEqual(table.ops.CreateTweet, { id: 'oTolA2WNu-LVMjbarDB2KA', features: ['payments_enabled'], chunk: 'main' });
    assert.equal(table.ops.Bookmarks, undefined);
    // only the switch values the operations use are kept
    assert.deepEqual(table.values, CONFIG);
    // the page, main.js, then for Home the chunks named HomeTimeline shortest first (one cannot be
    // fetched), Notifications by its exact name, the guess for Bookmarks; nothing twice
    assert.deepEqual(fetch.log, [
        'https://x.com/', MAIN, 'bundle.HomeTimeline.0000000000000044a.js', 'loader.HomeTimelineAdblockNotice.0000000000000045a.js',
        `${HOME_CHUNK}.d25cb356ba28eeb6a.js`, 'bundle.Notifications.436071e07774e741a.js', 'bundle.Bookmarks.0000000000000077a.js',
    ]);
    assert.equal(JSON.parse(localStorage.OTDgraphqlOperations).ops.HomeLatestTimeline.id, 'AbCdEfGhIjKlMnOpQrStUv');
});

test('the next start with the same main.js reads only the page, and refreshes the switch values', async () => {
    const localStorage = await firstRun();
    const fetch = fakeFetch(pageHtml({ config: { ...CONFIG, rweb_video_screen_enabled: false, articles_preview_enabled: true } }), bundles());
    const table = plain(await settled(load({ localStorage, fetch })));
    assert.deepEqual(fetch.log, ['https://x.com/']);
    assert.equal(table.ops.HomeLatestTimeline.id, 'AbCdEfGhIjKlMnOpQrStUv');
    assert.deepEqual(table.values, { rweb_video_screen_enabled: false, articles_preview_enabled: true, payments_enabled: true });
});

test('a new main.js is read again, starting with the chunk each operation was last found in', async () => {
    const localStorage = await firstRun();
    const main = 'main.ffffffffffffffffa.js';
    const fetch = fakeFetch(pageHtml({ main }), bundles(main));
    const table = plain(await settled(load({ localStorage, fetch })));
    assert.equal(table.main, CDN + main);
    assert.deepEqual(fetch.log, [
        'https://x.com/', main, `${HOME_CHUNK}.d25cb356ba28eeb6a.js`, 'bundle.Notifications.436071e07774e741a.js', 'bundle.Bookmarks.0000000000000077a.js',
    ]);
});

test("a Home request goes out with x.com's query id and features, signed for the new path", async () => {
    const solved = [];
    // no fetch here: the saved table is used as it is
    const xhr = await send(load({ localStorage: await firstRun(), solved }), 'GET', HOME);
    assert.equal(xhr.opens.length, 2, 'opened by the route, then again with the rewritten URL');
    assert.ok(xhr.opens[0].includes(HOME_FALLBACK), xhr.opens[0]);
    const url = new URL(xhr.opens[1]);
    assert.equal(url.pathname, '/i/api/graphql/AbCdEfGhIjKlMnOpQrStUv/HomeLatestTimeline');
    // the declared keys with the user's values; a key the page does not list is false
    assert.deepEqual(JSON.parse(url.searchParams.get('features')), { rweb_video_screen_enabled: true, articles_preview_enabled: false, brand_new_feature_enabled: false });
    // the route's variables and fieldToggles are kept
    assert.equal(JSON.parse(url.searchParams.get('variables')).count, 40);
    assert.deepEqual(JSON.parse(url.searchParams.get('fieldToggles')), { withPayments: false });
    assert.deepEqual(solved, ['/i/api/graphql/AbCdEfGhIjKlMnOpQrStUv/HomeLatestTimeline']);
    assert.equal(xhr.headers['x-client-transaction-id'], 'transaction-id');
});

test("a mutation's body carries x.com's queryId and features too", async () => {
    const context = load({ localStorage: await firstRun() });
    const headers = { 'x-act-as-user-id': '42', 'Content-Type': 'application/x-www-form-urlencoded' };
    const xhr = await send(context, 'POST', 'https://api.x.com/1.1/statuses/update.json', 'status=hello', headers);
    assert.equal(new URL(xhr.opens.at(-1)).pathname, '/i/api/graphql/oTolA2WNu-LVMjbarDB2KA/CreateTweet');
    const body = JSON.parse(xhr.sentBody);
    assert.equal(body.queryId, 'oTolA2WNu-LVMjbarDB2KA');
    assert.deepEqual(body.features, { payments_enabled: true });
    assert.equal(body.variables.tweet_text, 'hello');
});

test('"ids" swaps only the query id; "off" leaves the request as the route built it', async () => {
    const saved = await firstRun();
    const ids = await send(load({ localStorage: { ...saved, OTDgraphqlRegistry: 'ids' } }), 'GET', HOME);
    const [built, sent] = ids.opens.map((u) => new URL(u));
    assert.equal(sent.pathname, '/i/api/graphql/AbCdEfGhIjKlMnOpQrStUv/HomeLatestTimeline');
    assert.equal(sent.searchParams.get('features'), built.searchParams.get('features'));
    const off = await send(load({ localStorage: { ...saved, OTDgraphqlRegistry: 'off' } }), 'GET', HOME);
    assert.equal(off.opens.length, 1);
    assert.ok(off.opens[0].includes(HOME_FALLBACK));
});

test('an operation the bundles did not declare goes out as the route built it', async () => {
    const table = JSON.parse((await firstRun()).OTDgraphqlOperations);
    delete table.ops.HomeLatestTimeline;
    const xhr = await send(load({ localStorage: { OTDgraphqlOperations: JSON.stringify(table) } }), 'GET', HOME);
    assert.equal(xhr.opens.length, 1);
    assert.ok(xhr.opens[0].includes(HOME_FALLBACK));
});

test('a 404 on a known operation forces one re-read of the bundles, not one per failure', async () => {
    const fetch = fakeFetch(pageHtml(), bundles());
    const context = load({ localStorage: await firstRun(), fetch });
    await settled(context);
    assert.deepEqual(fetch.log, ['https://x.com/']);
    for (let i = 0; i < 2; i++) {
        const xhr = await send(context, 'GET', HOME);
        xhr.readyState = 4;
        xhr.status = 404;
        xhr.responseText = '{"errors":[{"message":"operation not found"}]}';
        void xhr.status; // legacy reads the status; the Proxy looks at the failure once
        await settled(context);
    }
    assert.deepEqual(fetch.log.slice(1), [
        'https://x.com/', MAIN, `${HOME_CHUNK}.d25cb356ba28eeb6a.js`, 'bundle.Notifications.436071e07774e741a.js', 'bundle.Bookmarks.0000000000000077a.js',
    ]);
});

test('when the page cannot be read the saved table still applies, and without one nothing changes', async () => {
    const failing = async () => { throw new TypeError('Failed to fetch'); };
    const context = load({ localStorage: await firstRun(), fetch: failing });
    assert.equal(plain(await settled(context)).ops.HomeLatestTimeline.id, 'AbCdEfGhIjKlMnOpQrStUv');
    assert.equal(new URL((await send(context, 'GET', HOME)).opens.at(-1)).pathname, '/i/api/graphql/AbCdEfGhIjKlMnOpQrStUv/HomeLatestTimeline');
    const bare = load({ fetch: failing });
    assert.equal(await settled(bare), null);
    assert.equal((await send(bare, 'GET', HOME)).opens.length, 1);
});
