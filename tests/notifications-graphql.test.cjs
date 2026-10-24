const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync('src/interception.js', 'utf8');

// One OTD instance per call. The Notifications and Mentions routes read the same GraphQL page.
function load(localStorage = {}) {
    const context = vm.createContext({
        localStorage, location: { hostname: 'x.com' }, navigator: { language: 'en-US' },
        document: { body: { getAttribute: () => null } },
        XMLHttpRequest: function () {}, console: { ...console, log() {}, warn() {}, error() {} }, URL, URLSearchParams,
        Date, setTimeout, Event: class {}, ProgressEvent: class {},
    });
    vm.runInContext(source, context);
    const routes = vm.runInContext('proxyRoutes', context);
    return {
        notifications: routes.find(r => r.path === '/1.1/activity/about_me.json'),
        mentions: routes.find(r => r.path === '/1.1/statuses/mentions_timeline.json'),
    };
}
const legacyRequest = (path, query, actAs = '42') => ({
    modUrl: `https://api.x.com${path}?${query}`, modReqHeaders: { 'x-act-as-user-id': actAs }, storage: {},
    open(method, url) { this.opened = url; },
});
const prepare = (route, query, actAs) => { const xhr = legacyRequest(route.path, query, actAs); route.beforeRequest(xhr); route.beforeSend(xhr); return xhr; };
const params = (xhr) => Object.fromEntries([...new URL(xhr.modUrl).searchParams].map(([k, v]) => [k, JSON.parse(v)]));
const deliver = (route, text) => Array.from(route.afterRequest({ storage: { user_id: '42' }, responseText: text }));

// GraphQL shapes as NotificationsTimeline sent them on 2026-10-23: users without `legacy`, aggregates
// under itemContent.template, mentions / replies / quotes as TimelineTweet items.
const gUser = (id, perspectives = {}) => ({
    __typename: 'User', rest_id: id, is_blue_verified: false, verification: { verified: false },
    core: { screen_name: 'user' + id, name: 'User ' + id, created_at: 'Wed Oct 14 10:00:00 +0000 2026' },
    avatar: { image_url: 'https://pbs.twimg.com/' + id + '.jpg' },
    relationship_perspectives: { following: false, followed_by: false, blocking: false, muting: false, ...perspectives },
});
const gTweet = (id, author, extra = {}) => ({
    __typename: 'Tweet', rest_id: id, core: { user_results: { result: author } },
    legacy: { id_str: id, conversation_id_str: id, full_text: 'tweet ' + id, user_id_str: author.rest_id, created_at: 'Wed Oct 14 10:00:00 +0000 2026', entities: {}, ...extra },
});
const aggregate = (element, id, sortIndex, users, tweets) => ({
    entryId: 'notification-' + id, sortIndex: String(sortIndex),
    content: { __typename: 'TimelineTimelineItem', entryType: 'TimelineTimelineItem', clientEventInfo: { component: 'urt', element },
        itemContent: { __typename: 'TimelineNotification', itemType: 'TimelineNotification', id, timestamp_ms: new Date(sortIndex).toISOString(),
            notification_icon: 'heart_icon', rich_message: { text: 'someone did something', entities: [] },
            template: { __typename: 'TimelineNotificationAggregateUserActions',
                from_users: users.map(u => ({ __typename: 'TimelineNotificationUserRef', user_results: { result: u } })),
                target_objects: tweets.map(t => ({ __typename: 'TimelineNotificationTweetRef', tweet_results: { result: t } })) } } },
});
const single = (element, id, sortIndex, tweet) => ({
    entryId: 'notification-' + id, sortIndex: String(sortIndex),
    content: { __typename: 'TimelineTimelineItem', entryType: 'TimelineTimelineItem', clientEventInfo: { component: 'urt', element },
        itemContent: { __typename: 'TimelineTweet', itemType: 'TimelineTweet', tweetDisplayType: 'Tweet', tweet_results: { result: tweet } } },
});
const cursor = (type, value, sortIndex) => ({
    entryId: `cursor-${type.toLowerCase()}-${sortIndex}`, sortIndex: String(sortIndex),
    content: { __typename: 'TimelineTimelineCursor', entryType: 'TimelineTimelineCursor', cursorType: type, value },
});
const page = (entries, { top = 'TOP', bottom = 'BOTTOM' } = {}) => JSON.stringify({ data: { viewer_v2: { user_results: { result: { notification_timeline: { timeline: {
    instructions: [{ type: 'TimelineClearCache' }, { type: 'TimelineAddEntries', entries: [cursor('Top', top, 2000), ...entries, cursor('Bottom', bottom, 1)] },
        { type: 'TimelineClearEntriesUnreadState' }],
} } } } } } });

const me = gUser('42');
const fixture = () => page([
    aggregate('users_liked_your_tweet', 'n1', 1000, [gUser('7', { following: true, followed_by: true }), gUser('8')], [gTweet('100', me)]),
    single('user_replied_to_your_tweet', 'n2', 900, gTweet('101', gUser('7', { following: true, followed_by: true }), { in_reply_to_status_id_str: '100' })),
    single('user_mentioned_you', 'n3', 800, gTweet('102', gUser('8'))),
    single('user_quoted_your_tweet', 'n4', 700, { ...gTweet('103', gUser('9'), { quoted_status_id_str: '100', is_quote_status: true }), quoted_status_result: { result: gTweet('100', me) } }),
    aggregate('users_followed_you', 'n5', 600, [gUser('9')], []),
    aggregate('users_retweeted_your_tweet', 'n6', 500, [gUser('10')], [gTweet('100', me)]),
]);
const summary = (n) => `${n.action}:${n.sources[0].id_str}:${n.targets[0].id_str}@${n.max_position}`;

test('both columns ask the GraphQL notifications timeline, with cursors inside variables', () => {
    const { notifications, mentions } = load();
    for (const route of [notifications, mentions]) {
        const first = prepare(route, 'count=20');
        assert.ok(first.modUrl.startsWith('https://x.com/i/api/graphql/MSIb-PAcnu9OBUe56f_DHQ/NotificationsTimeline?'), first.modUrl);
        assert.deepEqual(params(first).variables, { timeline_type: 'All', count: 20 });
        assert.equal(params(first).features.responsive_web_graphql_timeline_navigation_enabled, true);
        assert.equal(first.opened, first.modUrl);
    }
    deliver(notifications, fixture());
    deliver(mentions, fixture());
    // since polls re-read the top page; scrolling down takes the bottom cursor of the first page
    assert.equal(params(prepare(notifications, 'count=20&since_id=5')).variables.cursor, undefined);
    assert.equal(params(prepare(notifications, 'count=20&max_id=5')).variables.cursor, 'BOTTOM');
    assert.equal(params(prepare(mentions, 'count=20&max_id=5')).variables.cursor, 'BOTTOM');
    assert.equal(params(prepare(mentions, 'count=20&max_id=5', '43')).variables.cursor, undefined);
});

test('a GraphQL page becomes the same legacy actions an all.json page did', () => {
    const { notifications } = load();
    const actions = deliver(notifications, fixture());
    assert.deepEqual(actions.map(summary), [
        'favorite:7:100@1000', 'favorite:8:100@999', 'reply:7:101@900', 'mention:8:102@800', 'quote:9:103@700', 'follow:9:9@600', 'retweet:10:100@500',
    ]);
    const like = actions[0];
    // the liker is a v1.1 user built from core / avatar / relationship_perspectives
    assert.equal(like.sources[0].screen_name, 'user7');
    assert.equal(like.sources[0].name, 'User 7');
    assert.equal(like.sources[0].profile_image_url_https, 'https://pbs.twimg.com/7.jpg');
    assert.equal(like.sources[0].following, true);
    assert.equal(like.sources[0].followed_by, true);
    assert.equal(like.created_at, 'Thu Jan 01 00:00:01 +0000 1970');
    // the liked tweet is a v1.1 tweet with its author attached
    assert.equal(like.targets[0].text, 'tweet 100');
    assert.equal(like.targets[0].user.screen_name, 'user42');
    // a quote keeps the quoted tweet
    const quote = actions[4];
    assert.equal(quote.targets[0].quoted_status.id_str, '100');
    assert.equal(quote.targets[0].user.screen_name, 'user9');
});

test('Mentions keeps the replies, mentions and quotes of the GraphQL page with their authors', () => {
    const { mentions } = load();
    const tweets = deliver(mentions, fixture());
    assert.deepEqual(tweets.map(t => t.id_str), ['101', '102', '103']);
    assert.deepEqual(tweets.map(t => t.user.screen_name), ['user7', 'user8', 'user9']);
    assert.equal(tweets[0].in_reply_to_status_id_str, '100');
});

test('muted and blocked accounts are dropped as before, and an author X withholds drops only its entry', () => {
    const { notifications, mentions } = load();
    const text = page([
        aggregate('users_liked_your_tweet', 'n1', 1000, [gUser('7', { muting: true }), gUser('8')], [gTweet('100', me)]),
        single('user_replied_to_your_tweet', 'n2', 900, gTweet('101', gUser('7', { blocking: true }))),
        single('user_mentioned_you', 'n3', 800, { __typename: 'Tweet', rest_id: '102', core: { user_results: {} }, legacy: { id_str: '102', full_text: 'orphan', user_id_str: '0', entities: {} } }),
        single('user_mentioned_you', 'n4', 700, gTweet('103', gUser('8'))),
    ]);
    assert.deepEqual(deliver(notifications, text).map(summary), ['favorite:8:100@1000', 'mention:8:103@700']);
    assert.deepEqual(deliver(mentions, text).map(t => t.id_str), ['103']);
});

test('a 200 whose body is only a GraphQL error fails the page instead of emptying the column', () => {
    const { notifications } = load();
    const xhr = { status: 200, storage: {}, responseText: JSON.stringify({ errors: [{ message: 'Timeout' }] }) };
    notifications.inspectResponse(xhr);
    assert.equal(xhr._status, 503);
    assert.equal(xhr.storage.failure.kind, 'x-error');
    const fine = { status: 200, storage: {}, responseText: fixture() };
    notifications.inspectResponse(fine);
    assert.equal(fine._status, undefined);
});

test('OTDnotificationsSource = all.json goes back to the old endpoint, whose pages still parse', () => {
    const { notifications, mentions } = load({ OTDnotificationsSource: 'all.json' });
    const first = prepare(notifications, 'count=20');
    assert.ok(first.modUrl.startsWith('https://x.com/i/api/2/notifications/all.json?'), first.modUrl);
    const allJson = JSON.stringify({
        globalObjects: {
            tweets: { 101: { id_str: '101', user_id_str: '7', full_text: 'tweet 101', entities: {} } },
            users: { 7: { id_str: '7', screen_name: 'user7', name: 'User 7' } }, notifications: {},
        },
        timeline: { instructions: [{ addEntries: { entries: [
            { entryId: 'notification-n1', sortIndex: '900', content: { item: { clientEventInfo: { element: 'user_mentioned_you' }, content: { tweet: { id: '101' } } } } },
            { entryId: 'cursor-bottom-1', content: { operation: { cursor: { value: 'OLD' } } } },
        ] } }] },
    });
    assert.deepEqual(deliver(mentions, allJson).map(t => t.id_str), ['101']);
    assert.ok(prepare(mentions, 'count=20&max_id=5').modUrl.endsWith('&cursor=OLD'));
    notifications.inspectResponse({ status: 200, storage: {}, responseText: allJson });
});
