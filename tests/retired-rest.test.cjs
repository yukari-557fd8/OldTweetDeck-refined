const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync('src/interception.js', 'utf8');

// The raw XHR under the Proxy. Requests to x.com's GraphQL are answered from `responders`
// (url pattern -> body builder) on the next tick, the way X would; a legacy REST request is left
// for the test to answer with respond().
function fakeXhrClass(responders = []) {
    return class FakeXHR {
        constructor() {
            this.readyState = 0; this.status = 0; this.statusText = ''; this.responseText = ''; this.headers = {}; this.sentBody = undefined;
            this.onload = null; this.onloadend = null; this.onerror = null; this.onreadystatechange = null;
            FakeXHR.instances.push(this);
        }
        open(method, url) { this.url = url; this.readyState = 1; }
        setRequestHeader(name, value) { this.headers[name] = value; }
        send(body) {
            this.sentBody = body;
            const match = responders.find(([pattern]) => pattern.test(this.url));
            if (match) setTimeout(() => this.respond(match[1].status ?? 200, JSON.stringify(match[1].body(new URL(this.url)))), 0);
        }
        respond(status, text) { this.readyState = 4; this.status = status; this.responseText = text; if (this.onload) this.onload(); }
        addEventListener() {}
        getResponseHeader() { return null; }
        getAllResponseHeaders() { return ''; }
        abort() {}
        static instances = [];
    };
}

function load({ localStorage = {}, responders = [] } = {}) {
    const XHR = fakeXhrClass(responders);
    const context = vm.createContext({
        localStorage, location: { hostname: 'x.com' }, navigator: { language: 'en-US' },
        XMLHttpRequest: XHR, console: { ...console, log() {}, warn() {}, error() {} },
        URL, URLSearchParams, Date, setTimeout, clearTimeout, Event: class {}, ProgressEvent: class {},
        solveChallenge: async () => 'transaction-id',
    });
    context.window = context;
    vm.runInContext(source, context);
    return { context, XHR };
}

// What jQuery reads once legacy's request is done.
async function legacyGet(context, url) {
    const xhr = new (vm.runInContext('XMLHttpRequest', context))();
    xhr.open('GET', url, true);
    xhr.setRequestHeader('x-act-as-user-id', '42');
    const done = new Promise((resolve) => { xhr.onload = () => resolve({ status: xhr.status, text: xhr.responseText }); });
    await xhr.send(null);
    return { xhr, done };
}
const graphqlRequests = (XHR) => XHR.instances.filter((x) => x.url && x.url.includes('/i/api/graphql/')).map((x) => new URL(x.url));
const variablesOf = (url) => JSON.parse(url.searchParams.get('variables'));

// GraphQL shapes: a TimelineTwitterList item of CombinedLists, a TimelineUser item of the blocked / muted pages.
const gUser = (id) => ({ __typename: 'User', rest_id: id, core: { screen_name: 'user' + id, name: 'User ' + id, created_at: 'Wed Oct 14 10:00:00 +0000 2026' }, avatar: { image_url: 'https://pbs.twimg.com/' + id + '.jpg' } });
const listItem = (id, ownerId, extra = {}) => ({ entryId: 'list-' + id, content: { entryType: 'TimelineTimelineItem', itemContent: { itemType: 'TimelineTwitterList', list: {
    id_str: id, name: 'List ' + id, description: 'about ' + id, mode: ownerId === '42' ? 'Private' : 'Public', member_count: 3, subscriber_count: 1, user_results: { result: gUser(ownerId) }, ...extra } } } });
const userItem = (id) => ({ entryId: 'user-' + id, content: { entryType: 'TimelineTimelineItem', itemContent: { itemType: 'TimelineUser', user_results: { result: gUser(id) } } } });
const bottom = (value) => ({ entryId: 'cursor-bottom-1', content: { entryType: 'TimelineTimelineCursor', cursorType: 'Bottom', value } });
const timeline = (entries) => ({ instructions: [{ type: 'TimelineClearCache' }, { type: 'TimelineAddEntries', entries }] });

const combinedLists = [/CombinedLists/, { body: (url) => {
    const v = variablesOf(url);
    assert.equal(v.userId, '42');
    assert.equal(v.count, 100);
    // page one: a list of the user's and one they follow, inside a module; page two: one more of theirs
    const entries = v.cursor === 'LISTS-2'
        ? [listItem('300', '42')]
        : [{ entryId: 'module-1', content: { entryType: 'TimelineTimelineModule', items: [{ item: listItem('100', '42').content }, { item: listItem('200', '7').content }] } }, bottom('LISTS-2')];
    return { data: { user: { result: { __typename: 'User', timeline: { timeline: timeline(entries) } } } } };
} }];
const blocked = [/BlockedAccountsAll/, { body: (url) => {
    const v = variablesOf(url);
    assert.equal(v.includePromotedContent, false);
    const entries = v.cursor === 'BLOCKS-2' ? [bottom('BLOCKS-3')] : [userItem('1'), userItem('2'), bottom('BLOCKS-2')];
    return { data: { viewer: { timeline: { timeline: timeline(entries) } } } };
} }];
const muted = [/MutedAccounts/, { body: () => ({ data: { viewer: { muting_timeline: { timeline: timeline([userItem('9')]) } } } }) }];

const OWNERSHIPS = 'https://api.x.com/1.1/lists/ownerships.json?count=1000';
const SUBSCRIPTIONS = 'https://api.x.com/1.1/lists/subscriptions.json?count=1000';
const BLOCKS = 'https://api.x.com/1.1/blocks/ids.json?stringify_ids=true&cursor=-1';
const CONTRIBUTEES = 'https://api.x.com/1.1/users/contributees.json';

test('while REST answers, the lists, blocks and contributees requests go out to it untouched', async () => {
    const { context, XHR } = load();
    for (const url of [OWNERSHIPS, BLOCKS, CONTRIBUTEES]) {
        const { xhr } = await legacyGet(context, url);
        assert.equal(xhr.url, url);
        assert.equal(xhr.sentBody, null);
    }
    assert.deepEqual(graphqlRequests(XHR), []);
});

test('with OTDpreferGraphql the lists come from CombinedLists, owned and followed apart, in legacy\'s shape', async () => {
    const { context, XHR } = load({ localStorage: { OTDpreferGraphql: '1' }, responders: [combinedLists] });
    const owned = await legacyGet(context, OWNERSHIPS);
    const first = await owned.done;
    assert.equal(first.status, 200);
    const body = JSON.parse(first.text);
    assert.deepEqual(body.lists.map((l) => l.id_str), ['100', '300']);
    assert.equal(body.next_cursor_str, '0');
    const list = body.lists[0];
    assert.equal(list.name, 'List 100');
    assert.equal(list.mode, 'private');
    assert.equal(list.member_count, 3);
    assert.equal(list.user.screen_name, 'user42');
    assert.equal(list.user.id_str, '42');
    // two pages were read, the second with the first page's bottom cursor
    assert.deepEqual(graphqlRequests(XHR).map((u) => variablesOf(u).cursor), [undefined, 'LISTS-2']);
    assert.ok(graphqlRequests(XHR)[0].searchParams.get('features').includes('responsive_web_graphql_timeline_navigation_enabled'));
    assert.equal(XHR.instances.find((x) => x.url && x.url.includes('CombinedLists')).headers['x-client-transaction-id'], 'transaction-id');
    const followed = await legacyGet(context, SUBSCRIPTIONS);
    assert.deepEqual(JSON.parse((await followed.done).text).lists.map((l) => l.id_str), ['200']);
    // the legacy request itself never went to X
    assert.equal(owned.xhr.url, undefined);
});

test('the blocked and muted ids come one GraphQL page per call, and a page without users ends the walk', async () => {
    const { context } = load({ localStorage: { OTDpreferGraphql: '1' }, responders: [blocked, muted] });
    const first = JSON.parse((await (await legacyGet(context, BLOCKS)).done).text);
    assert.deepEqual(first.ids, ['1', '2']);
    assert.equal(first.next_cursor_str, 'BLOCKS-2');
    const second = JSON.parse((await (await legacyGet(context, 'https://api.x.com/1.1/blocks/ids.json?stringify_ids=true&cursor=BLOCKS-2')).done).text);
    assert.deepEqual(second.ids, []);
    assert.equal(second.next_cursor_str, '0');
    const mutes = JSON.parse((await (await legacyGet(context, 'https://api.x.com/1.1/mutes/users/ids.json?stringify_ids=true&cursor=-1')).done).text);
    assert.deepEqual(mutes.ids, ['9']);
    assert.equal(mutes.next_cursor_str, '0');
});

test('a 410 from REST is remembered for a day, and the next request takes the GraphQL source', async () => {
    const localStorage = {};
    const { context, XHR } = load({ localStorage, responders: [combinedLists] });
    const { xhr, done } = await legacyGet(context, OWNERSHIPS);
    xhr.respond(410, '{"errors":[{"message":"Gone","code":34}]}');
    assert.equal((await done).status, 410);
    const remembered = JSON.parse(localStorage.OTDretiredRest)['/1.1/lists/ownerships.json'];
    assert.equal(remembered.status, 410);
    assert.ok(Date.now() - remembered.at < 5000);
    const next = await legacyGet(context, OWNERSHIPS);
    assert.deepEqual(JSON.parse((await next.done).text).lists.map((l) => l.id_str), ['100', '300']);
    assert.equal(graphqlRequests(XHR).length, 2);
    // a day later REST is tried again
    remembered.at = Date.now() - 25 * 60 * 60 * 1000;
    localStorage.OTDretiredRest = JSON.stringify({ '/1.1/lists/ownerships.json': remembered });
    const later = await legacyGet(context, OWNERSHIPS);
    assert.equal(later.xhr.url, OWNERSHIPS);
});

test('users/contributees and saved_searches/list answer an empty list once X refuses them, and stay empty while that is remembered', async () => {
    const localStorage = {};
    const { context } = load({ localStorage });
    const first = await legacyGet(context, CONTRIBUTEES);
    first.xhr.respond(410, '{"errors":[{"message":"Gone"}]}');
    assert.deepEqual(await first.done, { status: 200, text: '[]' });
    assert.equal(JSON.parse(localStorage.OTDretiredRest)['/1.1/users/contributees.json'].status, 410);
    const again = await legacyGet(context, CONTRIBUTEES);
    assert.equal(again.xhr.url, undefined, 'answered without asking X');
    assert.deepEqual(await again.done, { status: 200, text: '[]' });
    // a 5xx is answered the same way, but not remembered
    const searches = await legacyGet(context, 'https://api.x.com/1.1/saved_searches/list.json');
    searches.xhr.respond(503, '');
    assert.deepEqual(await searches.done, { status: 200, text: '[]' });
    assert.equal(JSON.parse(localStorage.OTDretiredRest)['/1.1/saved_searches/list.json'], undefined);
    // a good answer passes through
    const pending = await legacyGet(context, 'https://api.x.com/1.1/users/contributees/pending.json');
    pending.xhr.respond(200, '[{"user":{"id_str":"7"}}]');
    assert.deepEqual(await pending.done, { status: 200, text: '[{"user":{"id_str":"7"}}]' });
});

test('a GraphQL source that fails answers legacy with 503 instead of an empty success', async () => {
    const failing = [/CombinedLists/, { status: 404, body: () => ({ errors: [{ message: 'operation not found' }] }) }];
    const { context } = load({ localStorage: { OTDpreferGraphql: '1' }, responders: [failing] });
    const { done } = await legacyGet(context, OWNERSHIPS);
    const answer = await done;
    assert.equal(answer.status, 503);
    assert.match(answer.text, /Could not|could not/);
});
