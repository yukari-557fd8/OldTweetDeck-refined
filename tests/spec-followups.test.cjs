const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync('src/interception.js', 'utf8');

class FakeXHR {
    constructor() {
        this.readyState = 0; this.status = 0; this.statusText = ''; this.responseText = ''; this.headers = {}; this.sentBody = undefined;
        this.onload = null; this.onloadend = null; this.onerror = null; this.onreadystatechange = null;
        FakeXHR.instances.push(this);
    }
    static instances = [];
    open(method, url) { this.method = method; this.url = url; this.readyState = 1; }
    setRequestHeader(name, value) { this.headers[name] = value; }
    send(body) { this.sentBody = body; }
    respond(status, text) { this.readyState = 4; this.status = status; this.responseText = text; if (this.onload) this.onload(); }
    addEventListener() {}
    getResponseHeader() { return null; }
    getAllResponseHeaders() { return ''; }
    abort() {}
}

function load(localStorage = {}) {
    const context = vm.createContext({
        localStorage, location: { hostname: 'x.com' }, navigator: { language: 'en-US' },
        XMLHttpRequest: FakeXHR, console: { ...console, log() {}, warn() {}, error() {} },
        URL, URLSearchParams, Date, setTimeout, clearTimeout, Event: class {}, ProgressEvent: class {},
        solveChallenge: async (path) => 'signed:' + path,
    });
    context.window = context;
    vm.runInContext(source, context);
    return context;
}

async function send(context, method, url, body = null, headers = {}) {
    const xhr = new (vm.runInContext('XMLHttpRequest', context))();
    xhr.open(method, url, true);
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
    const done = new Promise((resolve) => { xhr.onload = () => resolve({ status: xhr.status, text: xhr.responseText }); });
    await xhr.send(body);
    return { xhr, done };
}

test('help/configuration.json is answered here with current values, without asking X', async () => {
    const { xhr, done } = await send(load(), 'GET', 'https://api.x.com/1.1/help/configuration.json?cards_platform=Web-13');
    const answer = await done;
    assert.equal(xhr.url, undefined, 'never opened against X');
    assert.equal(answer.status, 200);
    const config = JSON.parse(answer.text);
    assert.equal(config.dm_text_character_limit, 10000);
    assert.equal(config.photo_size_limit, 5242880);
    assert.equal(config.short_url_length, 23);
    assert.equal(config.characters_reserved_per_media, 24);
    assert.equal(config.transformedURLLength, 23);
});

// Better TweetDeck's request as seen on 2026-10-25: the old GraphQL form, variables as JSON text.
const BTD_URL = 'https://api.x.com/graphql/';
const BTD_BODY = JSON.stringify({ variables: JSON.stringify({ tweet_id: '1', mode: 'ByInvitation' }), queryId: 'hb1elGcj6769uT8qVYqtjw' });
const BTD_HEADERS = { authorization: 'Bearer from-btd', 'x-csrf-token': 'csrf-from-btd', 'content-type': 'application/json' };

test("Better TweetDeck's reply restriction goes to x.com's GraphQL path with the current query id, and legacy sees X's answer", async () => {
    const context = load();
    FakeXHR.instances.length = 0;
    const current = vm.runInContext('builtinGraphqlTable()', context).ops.ConversationControlChange.id;
    assert.match(current, /^[\w-]{22}$/);
    const { xhr, done } = await send(context, 'POST', BTD_URL, BTD_BODY, BTD_HEADERS);
    await new Promise((r) => setTimeout(r, 10)); // the rerouted request goes through the Proxy's async send
    const inner = FakeXHR.instances.find((x) => /\/i\/api\/graphql\/[\w-]+\/ConversationControlChange$/.test(x.url || ''));
    assert.equal(inner.url, `https://x.com/i/api/graphql/${current}/ConversationControlChange`);
    assert.deepEqual(JSON.parse(inner.sentBody), { variables: { tweet_id: '1', mode: 'ByInvitation' }, queryId: current });
    assert.equal(inner.headers['x-client-transaction-id'], `signed:/i/api/graphql/${current}/ConversationControlChange`);
    assert.equal(inner.headers['Content-Type'], 'application/json');
    assert.equal(inner.headers.Authorization, 'Bearer from-btd', "the caller's own headers travel with it");
    assert.equal(inner.headers['X-Csrf-Token'], 'csrf-from-btd');
    assert.equal(xhr.sentBody, undefined, "Better TweetDeck's own request was not sent");
    inner.respond(200, '{"data":{"tweet_conversation_control_put":"Done"}}');
    assert.deepEqual(await done, { status: 200, text: '{"data":{"tweet_conversation_control_put":"Done"}}' });
});

test("when x.com's path does not answer Done, Better TweetDeck's own request goes out as it was", async () => {
    const context = load();
    FakeXHR.instances.length = 0;
    const { xhr } = await send(context, 'POST', BTD_URL, BTD_BODY, BTD_HEADERS);
    await new Promise((r) => setTimeout(r, 10));
    const inner = FakeXHR.instances.find((x) => /\/i\/api\/graphql\/[\w-]+\/ConversationControlChange$/.test(x.url || ''));
    inner.respond(404, '{"errors":[{"message":"not found"}]}');
    assert.equal(xhr.url, BTD_URL);
    assert.equal(xhr.sentBody, BTD_BODY);
    // the same with the id-in-path form some versions use, and nothing for another body
    FakeXHR.instances.length = 0;
    const other = await send(context, 'POST', 'https://api.x.com/graphql/hb1elGcj6769uT8qVYqtjw/ConversationControlChange', BTD_BODY, BTD_HEADERS);
    assert.ok(FakeXHR.instances.find((x) => /\/i\/api\/graphql\/[\w-]+\/ConversationControlChange$/.test(x.url || '')));
    const plain = await send(context, 'POST', BTD_URL, '{"queryId":"abc","variables":"{}"}', BTD_HEADERS);
    assert.equal(plain.xhr.sentBody, '{"queryId":"abc","variables":"{}"}');
});

const gUser = { __typename: 'User', rest_id: '7', core: { screen_name: 'user7', name: 'User 7', created_at: 'Wed Oct 14 10:00:00 +0000 2026' }, avatar: { image_url: 'https://pbs.twimg.com/7.jpg' } };
const gTweet = (id, extra = {}) => ({
    __typename: 'Tweet', rest_id: id, core: { user_results: { result: gUser } },
    legacy: { id_str: id, conversation_id_str: id, full_text: 'tweet ' + id, user_id_str: '7', created_at: 'Wed Oct 14 10:00:00 +0000 2026', entities: {} },
    ...extra,
});
const article = (extra = {}) => ({ article_results: { result: {
    rest_id: '900', title: 'A long read', preview_text: 'The first lines of it',
    cover_media: { media_info: { original_img_url: 'https://pbs.twimg.com/cover.jpg', original_img_width: 1200, original_img_height: 600 } }, ...extra,
} } });

test('an X Article becomes a summary card with its title, preview and cover, linking to the article', () => {
    const parseTweet = vm.runInContext('parseTweet', load());
    const tweet = parseTweet(gTweet('1', { article: article() }));
    assert.equal(tweet.card.name, 'summary_large_image');
    assert.equal(tweet.card.url, 'https://x.com/i/article/900');
    assert.equal(tweet.card.binding_values.title.string_value, 'A long read');
    assert.equal(tweet.card.binding_values.description.string_value, 'The first lines of it');
    assert.equal(tweet.card.binding_values.vanity_url.string_value, 'x.com');
    assert.deepEqual(JSON.parse(JSON.stringify(tweet.card.binding_values.summary_photo_image.image_value)), { url: 'https://pbs.twimg.com/cover.jpg', width: 1200, height: 600 });
    // without a cover: a plain summary; without a title or id: no card; a retweet of an article too
    assert.equal(parseTweet(gTweet('2', { article: article({ cover_media: null }) })).card.name, 'summary');
    assert.equal(parseTweet(gTweet('3', { article: article({ title: '' }) })).card, undefined);
    const retweet = parseTweet(gTweet('4', { legacy: { ...gTweet('4').legacy, full_text: 'RT @user7: tweet 1', retweeted_status_result: { result: gTweet('1', { article: article() }) } } }));
    assert.equal(retweet.retweeted_status.card.url, 'https://x.com/i/article/900');
});

test("a Space's card becomes a link card to the Space", () => {
    const parseTweetCard = vm.runInContext('parseTweetCard', load());
    const card = parseTweetCard({ rest_id: 'https://t.co/abc', legacy: { name: '3691233323:audiospace', url: 'https://t.co/abc', binding_values: [
        { key: 'id', value: { type: 'STRING', string_value: '1ABCDE' } }, { key: 'card_url', value: { type: 'STRING', string_value: 'https://x.com/i/spaces/1ABCDE' } },
        { key: 'narrow_cast_space_type', value: { type: 'STRING', string_value: '0' } }, { key: 'tweet_id', value: { type: 'STRING', string_value: '5' } },
    ] } });
    assert.equal(card.name, 'summary');
    assert.equal(card.url, 'https://x.com/i/spaces/1ABCDE');
    assert.equal(card.binding_values.title.string_value, 'X Space');
    assert.equal(card.binding_values.card_url.string_value, 'https://x.com/i/spaces/1ABCDE');
    // other cards are untouched
    const other = parseTweetCard({ legacy: { name: 'summary', binding_values: [{ key: 'title', value: { type: 'STRING', string_value: 'T' } }] } });
    assert.equal(other.name, 'summary');
    assert.equal(other.binding_values.title.string_value, 'T');
});

test('notification polls carry the top cursor, read the whole page every ten minutes, and can be turned back', () => {
    const localStorage = {};
    const context = load(localStorage);
    const route = vm.runInContext('proxyRoutes', context).find((r) => r.path === '/1.1/activity/about_me.json');
    const prepare = (query) => {
        const xhr = { modUrl: 'https://api.x.com/1.1/activity/about_me.json?' + query, modReqHeaders: { 'x-act-as-user-id': '42' }, storage: {}, open(method, url) { this.opened = url; } };
        route.beforeRequest(xhr);
        route.beforeSend(xhr);
        return xhr;
    };
    const cursorOf = (xhr) => JSON.parse(new URL(xhr.modUrl).searchParams.get('variables')).cursor;
    const page = (top) => JSON.stringify({ data: { viewer_v2: { user_results: { result: { notification_timeline: { timeline: { instructions: [{ type: 'TimelineAddEntries', entries: [
        { entryId: 'cursor-top-1', sortIndex: '2000', content: { entryType: 'TimelineTimelineCursor', cursorType: 'Top', value: top } },
        { entryId: 'cursor-bottom-1', sortIndex: '1', content: { entryType: 'TimelineTimelineCursor', cursorType: 'Bottom', value: 'BOTTOM' } },
    ] }] } } } } } } });
    // the first page: whole; it is the resync
    const first = prepare('count=20');
    assert.equal(cursorOf(first), undefined);
    assert.equal(first.storage.topPage, true);
    route.afterRequest({ storage: { user_id: '42' }, responseText: page('TOP-1') });
    // polls: the top cursor, and still a shareable top-page request
    const poll = prepare('count=20&since_id=5');
    assert.equal(cursorOf(poll), 'TOP-1');
    assert.equal(poll.storage.topPage, true);
    route.afterRequest({ storage: { user_id: '42', since_id: '5' }, responseText: page('TOP-2') });
    assert.equal(cursorOf(prepare('count=20&since_id=5')), 'TOP-2');
    // ten minutes later the whole page again, then the cursor again
    vm.runInContext('topFetches["notifications-top-42"] = Date.now() - 11 * 60 * 1000', context);
    assert.equal(cursorOf(prepare('count=20&since_id=5')), undefined);
    assert.equal(cursorOf(prepare('count=20&since_id=5')), 'TOP-2');
    // another account has no cursor yet
    const other = { modUrl: 'https://api.x.com/1.1/activity/about_me.json?count=20&since_id=5', modReqHeaders: { 'x-act-as-user-id': '43' }, storage: {}, open() {} };
    route.beforeRequest(other); route.beforeSend(other);
    assert.equal(cursorOf(other), undefined);
    // the switch back
    localStorage.OTDnotificationsTopCursor = '0';
    assert.equal(cursorOf(prepare('count=20&since_id=5')), undefined);
});
