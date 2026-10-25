const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync('src/interception.js', 'utf8');

class FakeXHR {
    constructor() {
        this.readyState = 0; this.status = 0; this.statusText = ''; this.responseText = '';
        this.responseHeaders = {}; this.sent = false;
        this.onload = null; this.onloadend = null; this.onerror = null; this.onreadystatechange = null;
    }
    open() { this.readyState = 1; }
    setRequestHeader() { if (this.readyState !== 1) throw new Error('state must be OPENED'); }
    send() { this.sent = true; }
    addEventListener() {}
    getResponseHeader(name) { return this.responseHeaders[name.toLowerCase()] ?? null; }
    getAllResponseHeaders() { return ''; }
    abort() {}
    respond(status, text, headers = {}) {
        this.readyState = 4; this.status = status; this.responseText = text; this.responseHeaders = headers;
        if (this.onload) this.onload();
    }
}

// What jQuery 2.1.4's xhr transport reads once a request is done, in this order.
function jqueryRead(xhr) {
    const status = xhr.status;
    const statusText = xhr.statusText;
    const text = typeof xhr.responseText === 'string' ? xhr.responseText : undefined;
    let parsed = true;
    try { JSON.parse(text); } catch (e) { parsed = false; }
    return { status, statusText, text, ok: status >= 200 && status < 300 && parsed };
}

function load({ TD, toasts, solveChallenge = async () => 'transaction-id', ...globals } = {}) {
    const context = vm.createContext({
        localStorage: { twitterAccountID: '42' }, location: { hostname: 'x.com' },
        navigator: { language: 'en-US' }, XMLHttpRequest: FakeXHR,
        console: { ...console, log() {}, warn() {}, error() {} }, URL, URLSearchParams,
        Date, setTimeout, Event: class {}, ProgressEvent: class {}, solveChallenge,
        ...(TD ? { TD } : {}), ...(toasts ? { toasts } : {}), ...globals,
    });
    context.window = context;
    vm.runInContext(source, context);
    return context;
}

async function request(context, url) {
    const XHR = vm.runInContext('XMLHttpRequest', context);
    const xhr = new XHR();
    xhr.open('GET', url, true);
    const seen = {};
    xhr.onload = () => Object.assign(seen, jqueryRead(xhr));
    await xhr.send(null);
    return { xhr, seen };
}

const VERIFY = 'https://api.x.com/1.1/account/verify_credentials.json';
const SEARCH = 'https://api.x.com/1.1/search/universal.json?q=otd';

test('a 429 the route cannot parse still finishes, and the login form says why', async () => {
    const shown = [];
    const TD = { ready: false, controller: { init: { showLogin(message) { shown.push(message); } } } };
    const context = load({ TD });
    const { xhr, seen } = await request(context, VERIFY);
    const reset = new Date(2026, 9, 17, 12, 34);
    xhr.respond(429, 'Rate limit exceeded', { 'x-rate-limit-reset': String(reset.getTime() / 1000) });
    assert.equal(seen.status, 429);
    assert.equal(seen.ok, false);
    TD.controller.init.showLogin('Error initializing TweetDeck: TD.core.defer.XMLHttpRequestError()');
    const clock = reset.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    assert.equal(shown[0], `TweetDeck could not start. X is rate limiting account verification (429). It should work again after ${clock}.`);
});

test('a 200 the route cannot parse fails as a parse error instead of throwing', async () => {
    const context = load();
    const { xhr, seen } = await request(context, VERIFY);
    xhr.respond(200, '<html>Something went wrong</html>');
    assert.equal(seen.status, 200);
    assert.equal(seen.ok, false);
    assert.match(vm.runInContext('startupStatusText()', context), /X sent a response for account verification that OldTweetDeck could not read/);
});

test('after startup, a failing column raises one toast per reason and column type', async () => {
    const toasts = [];
    const context = load({ TD: { ready: true }, toasts: { showErrorNotification: (n) => toasts.push(n.message) } });
    for (const [status, text] of [[503, ''], [503, ''], [429, '{"errors":[{"code":88}]}']]) {
        const { xhr, seen } = await request(context, SEARCH);
        xhr.respond(status, text);
        assert.equal(seen.ok, false);
    }
    assert.deepEqual(toasts, [
        'X returned an error for Search (503).',
        'X is rate limiting Search (429). Wait a few minutes before reloading.',
    ]);
});

test('a challenge solver failure is named in the toast', async () => {
    const toasts = [];
    const context = load({
        TD: { ready: true }, toasts: { showErrorNotification: (n) => toasts.push(n.message) },
        solveChallenge: async () => { throw new Error('header not found'); },
    });
    const { xhr, seen } = await request(context, SEARCH);
    assert.equal(xhr.sent, false);
    assert.equal(seen.status, 503);
    assert.deepEqual(toasts, [
        'Could not sign the request for Search (Error: header not found). Reload TweetDeck. If this keeps happening, the challenge solver may need an update.',
    ]);
});

test('requests this file answers itself are not failures, GraphQL error pages carry X\'s message', () => {
    const context = load();
    const failureFromStatus = vm.runInContext('failureFromStatus', context);
    assert.equal(failureFromStatus({ _status: 503, storage: { cancelled: true } }), null);
    assert.equal(failureFromStatus({ status: 304, storage: {} }), null);
    assert.equal(failureFromStatus({ status: 404, storage: {} }).kind, 'x-error');
    const page = { status: 200, responseText: JSON.stringify({ errors: [{ message: 'Over capacity' }] }), storage: {} };
    vm.runInContext('graphqlPageInspector', context)((data) => data?.data?.home)(page);
    const failure = failureFromStatus(page);
    assert.equal(failure.kind, 'x-error');
    assert.equal(vm.runInContext('describeFailure', context)({ ...failure, label: 'Home' }), 'X returned an error for Home (Over capacity).');
});

test('the loading screen names the request X has not answered yet', async () => {
    const context = load();
    const { xhr } = await request(context, VERIFY);
    const since = vm.runInContext('startupRequests[0].since', context);
    const status = vm.runInContext('startupStatusText', context);
    assert.equal(status(since + 35000), 'TweetDeck is still waiting for X to answer account verification (35 s).');
    xhr.respond(200, JSON.stringify({ id_str: '42', screen_name: 'otd' }));
    assert.equal(status(since + 40000), 'TweetDeck is taking longer than usual to load.');
});

// Just enough of the startup markup in files/index.html: .js-app-loading .js-signin-ui > img.spinner-centered
function loadingScreen() {
    const element = (className = '') => ({
        className, children: [], style: {}, textContent: '',
        appendChild(child) { this.children.push(child); },
        addEventListener() {},
        querySelector(selector) { return this.children.find((c) => `.${c.className}` === selector) || null; },
    });
    const container = element();
    container.children.push(element('spinner-centered'));
    const document = {
        createElement: () => element(),
        querySelector: (selector) => (selector === '.js-app-loading .js-signin-ui' ? container : null),
    };
    return { container, document };
}

test('a spinner still up after 30 s gets the reason under it, until the login form replaces it', async () => {
    const timers = [];
    const { container, document } = loadingScreen();
    const context = load({ document, setTimeout: (fn, ms) => timers.push({ fn, ms }) });
    await request(context, VERIFY);
    assert.deepEqual(timers.map((t) => t.ms), [30000]);
    timers.shift().fn();
    const line = container.querySelector('.otd-startup-status');
    assert.match(line.textContent, /^TweetDeck is still waiting for X to answer account verification \(\d+ s\)\. $/);
    assert.equal(line.children[0].textContent, 'Reload');
    container.children = [];
    timers.shift().fn();
    assert.equal(timers.length, 0);
});

const HOME = 'https://api.x.com/1.1/statuses/home_timeline.json?count=40';

test('a 404 on a GraphQL operation is explained as a query id problem', async () => {
    const toasts = [];
    const context = load({ TD: { ready: true }, toasts: { showErrorNotification: (n) => toasts.push(n.message) } });
    const { xhr, seen } = await request(context, HOME);
    xhr.respond(404, '{"errors":[{"message":"operation not found"}]}');
    assert.equal(seen.ok, false);
    assert.deepEqual(toasts.map((t) => t.replace(/\d{4}-\d{2}-\d{2}/, 'DATE')), [
        "X rejected the query for Home (404; the id came from OldTweetDeck's built-in copy of DATE). Reload TweetDeck; if this keeps happening, OldTweetDeck needs an update.",
    ]);
    assert.equal(vm.runInContext('failureFromStatus', context)({ status: 410, storage: {} }).kind, 'x-error');
});

const PAGE_USER = { id_str: '42', screen_name: 'me', name: 'Me', profile_image_url_https: 'https://pbs.twimg.com/me.jpg', protected: false, verified: false };

test("when X refuses account verification, the login account from x.com's page stands in", async () => {
    const toasts = [];
    const context = load({
        TD: { ready: true }, toasts: { showErrorNotification: (n) => toasts.push(n.message) },
        document: { cookie: 'night_mode=2; twid=u%3D42; lang=en' },
    });
    vm.runInContext(`pageLoginUser = ${JSON.stringify(PAGE_USER)}`, context);
    const { xhr, seen } = await request(context, VERIFY);
    xhr.respond(410, '{"errors":[{"message":"Gone","code":34}]}');
    assert.equal(seen.status, 200);
    assert.equal(seen.ok, true);
    assert.equal(JSON.parse(seen.text).screen_name, 'me');
    assert.equal(JSON.parse(context.localStorage.OTDverifiedUser).id_str, '42');
    assert.equal(vm.runInContext('verifiedUser.id_str', context), '42');
    assert.deepEqual(toasts, [
        "X no longer confirms your account to TweetDeck (410); OldTweetDeck used the profile on x.com's page instead. "
        + 'If the profile shown is wrong, open x.com in another tab, then reload TweetDeck.',
    ]);
    // within a day the stand-in is silent; the profile X confirmed last time serves when the page's is missing
    const later = load({
        localStorage: context.localStorage, TD: { ready: true }, toasts: { showErrorNotification: (n) => toasts.push(n.message) },
        document: { cookie: 'twid=u%3D42' },
    });
    const second = await request(later, VERIFY);
    second.xhr.respond(410, '');
    assert.equal(second.seen.status, 200);
    assert.equal(JSON.parse(second.seen.text).screen_name, 'me');
    assert.equal(toasts.length, 1);
});

test('the stand-in serves only the account the session cookie names, and never an acting account', async () => {
    const shown = [];
    const TD = { ready: false, controller: { init: { showLogin(message) { shown.push(message); } } } };
    const context = load({ TD, document: { cookie: 'twid=u%3D42' } });
    vm.runInContext(`pageLoginUser = ${JSON.stringify({ ...PAGE_USER, id_str: '7', screen_name: 'other' })}`, context);
    vm.runInContext('verifiedUser = { id_str: "8", screen_name: "stale" }', context);
    const { xhr, seen } = await request(context, VERIFY);
    xhr.respond(410, '{"errors":[{"message":"Gone"}]}');
    assert.equal(seen.status, 410);
    TD.controller.init.showLogin('Error initializing TweetDeck');
    assert.equal(shown[0], 'TweetDeck could not start. X returned an error for account verification (410).');
    // an acting (Teams) account: only X can confirm it
    const acting = load({ document: { cookie: 'twid=u%3D42' } });
    vm.runInContext(`pageLoginUser = ${JSON.stringify(PAGE_USER)}`, acting);
    const XHR = vm.runInContext('XMLHttpRequest', acting);
    const req = new XHR();
    req.open('GET', VERIFY, true);
    req.setRequestHeader('x-act-as-user-id', '99');
    const read = {};
    req.onload = () => Object.assign(read, jqueryRead(req));
    await req.send(null);
    req.respond(410, '{}');
    assert.equal(read.status, 410);
});
