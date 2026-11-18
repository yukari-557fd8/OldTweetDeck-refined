const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync('src/interception.js', 'utf8');

// One OTD instance per call. The Notifications and Mentions routes read the same GraphQL page.
function load(localStorage = {}, globals = {}) {
    const context = vm.createContext({
        localStorage, location: { hostname: 'x.com' }, navigator: { language: 'en-US' },
        document: { body: { getAttribute: () => null } },
        XMLHttpRequest: function () {}, console: { ...console, log() {}, warn() {}, error() {} }, URL, URLSearchParams,
        Date, setTimeout, Event: class {}, ProgressEvent: class {}, ...globals,
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
        assert.ok(first.modUrl.startsWith('https://x.com/i/api/graphql/XANkUc-HLIcCl8q85rGC2A/NotificationsTimeline?'), first.modUrl);
        assert.deepEqual(params(first).variables, { timeline_type: 'All', count: 20 });
        assert.equal(params(first).features.responsive_web_graphql_timeline_navigation_enabled, true);
        assert.equal(first.opened, first.modUrl);
    }
    deliver(notifications, fixture());
    deliver(mentions, fixture());
    // a poll takes the top cursor of the page just read; scrolling down the bottom cursor of the first page
    assert.equal(params(prepare(notifications, 'count=20&since_id=5')).variables.cursor, 'TOP');
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

// Legacy's follow action, as far as the action derived from it for an accepted follow request needs.
function legacyActions() {
    const TwitterActionFollow = function (account) { this.account = account; };
    TwitterActionFollow.prototype = { action: 'follow', isAboutYou() { return false; }, isOwnChirp() { return false; }, generateText() { this.text = 'followed'; } };
    const TwitterAction = function () {};
    TwitterAction._getActionConstructor = (name) => (name === 'follow' ? TwitterActionFollow : null);
    return {
        services: { TwitterAction, TwitterActionFollow },
        ui: { template: { toHtml: (t, d) => t.replace('{{{user}}}', d.user), render: (name, d) => `<a href="${d.profileUrl}">${d.name}</a>` } },
    };
}

test('an accepted follow request becomes an action legacy learns to render like a follow', () => {
    const TD = legacyActions();
    const { notifications } = load({}, { TD });
    const accepted = (id, sortIndex, users) => aggregate('users_accepted_your_follow_request', id, sortIndex, users, []);
    const actions = deliver(notifications, page([accepted('n7', 650, [gUser('11'), gUser('12')]), aggregate('users_followed_you', 'n8', 640, [gUser('13')], [])]));
    assert.deepEqual(actions.map(summary), ['follow_request_accepted:11:11@650', 'follow_request_accepted:12:12@649', 'follow:13:13@640']);
    assert.equal(actions[0].sources[0].screen_name, 'user11');
    // legacy now answers the new name with the derived constructor, and the old ones as before
    const Accepted = TD.services.TwitterAction._getActionConstructor('follow_request_accepted');
    assert.equal(typeof Accepted, 'function');
    assert.equal(TD.services.TwitterAction._getActionConstructor('follow'), TD.services.TwitterActionFollow);
    assert.equal(TD.services.TwitterAction._getActionConstructor('favorite'), null);
    const action = new Accepted({ getUserID: () => '42' });
    action.following = { name: 'User 11', screen_name: 'user11', emojifiedName: 'User 11' };
    action.generateText();
    assert.equal(action.action, 'follow_request_accepted');
    assert.equal(action.text, 'User 11 accepted your follow request');
    assert.equal(action.htmlText, '<a href="https://x.com/user11">User 11</a> accepted your follow request');
    assert.equal(action.isAboutYou(), true);
    assert.equal(action.isOwnChirp(), false);
    // delivered once, like any other notification
    assert.deepEqual(deliver(notifications, page([accepted('n7', 650, [gUser('11'), gUser('12')])])), []);
});

test('without legacy\'s follow action the accepted request is left out, and the rest of the page is kept', () => {
    const { notifications } = load();
    const actions = deliver(notifications, page([
        aggregate('users_accepted_your_follow_request', 'n7', 650, [gUser('11')], []),
        aggregate('users_followed_you', 'n8', 640, [gUser('13')], []),
        aggregate('some_future_type', 'n9', 630, [gUser('14')], []),
    ]));
    assert.deepEqual(actions.map(summary), ['follow:13:13@640']);
});

// A like and a retweet of one's retweet (NotificationsTimeline, 2026-11-18): the target is the
// account's retweet, whose own favorite_count is 0. Its first photo has someone tagged here.
const tagged = { media: [{ id_str: '9', type: 'photo', media_url_https: 'https://pbs.twimg.com/media/a.jpg', url: 'https://t.co/aaaaaaaaaa', indices: [0, 23],
    features: { all: { tags: [{ user_id: '77', name: 'User 77', screen_name: 'user77', type: 'user' }] } } }] };
const myRetweet = (retweeted = gTweet('100', gUser('5'), { favorite_count: 113, retweet_count: 7, favorited: true, retweeted: true, extended_entities: tagged })) =>
    gTweet('900', me, { full_text: 'RT @user5: tweet 100', favorite_count: 0, retweet_count: 7, favorited: true, retweeted: true, extended_entities: tagged, retweeted_status_result: { result: retweeted } });
const onMyRetweet = (retweeted) => page([
    aggregate('users_liked_your_retweet', 'n1', 1000, [gUser('7'), gUser('8')], [myRetweet(retweeted)]),
    aggregate('users_retweeted_your_retweet', 'n2', 900, [gUser('7')], [myRetweet(retweeted)]),
]);

// What legacy makes of an action (files/bundle.js), with its user and status classes cut down to
// the fields read here.
const bundle = fs.readFileSync('files/bundle.js', 'utf8');
function legacyMethod(marker, scope) {
    const at = bundle.indexOf(marker);
    assert.notEqual(at, -1, marker);
    const start = bundle.indexOf('function', at);
    let depth = 0;
    for (let i = bundle.indexOf('{', start); i < bundle.length; i++) {
        if (bundle[i] === '{') depth++;
        else if (bundle[i] === '}' && --depth === 0) return new Function(...Object.keys(scope), `return (${bundle.slice(start, i + 1)});`)(...Object.values(scope));
    }
    throw new Error('unterminated ' + marker);
}
function legacyChirp(action) {
    const account = { getUserID: () => '42' };
    class TwitterUser { constructor(a) { this.account = a; } fromJSONObject(e) { this.id = e.id_str; this.name = e.name; return this; } isMe() { return this.account.getUserID() == this.id; } getProfileURL() { return ''; } }
    class TwitterStatus { fromJSONObject(e) { this.id = e.id_str; this.likeCount = e.favorite_count; this.user = e.user; return this; } }
    const TD = {
        services: { TwitterUser, TwitterStatus, TwitterAction: {
            FAVORITED_RETWEET: 'favorited_retweet', FAVORITED_MENTION: 'favorited_mention', FAVORITED_MEDIA: 'favorited_media_tagged',
            RETWEETED_RETWEET: 'retweeted_retweet', RETWEETED_MENTION: 'retweeted_mention', RETWEETED_MEDIA: 'retweeted_media_tagged',
        } },
        ui: { template: { toHtml: (text, values) => text.replace('{{{user}}}', values.user), render: (name, values) => `<b>${values.name}</b>` } },
    };
    const get = (object, path, fallback) => path.replace(/\[(\d+)\]/g, '.$1').split('.').reduce((o, key) => o?.[key], object) ?? fallback;
    const translate = { default: (text) => text };
    const kind = { favorited_retweet: 'TwitterActionFavoritedInteraction', retweeted_retweet: 'TwitterActionRetweetedInteraction' }[action.action];
    // the names these two modules bind lodash's get, the translation and linkifyUser to
    const scope = kind === 'TwitterActionFavoritedInteraction'
        ? { TD, n: { default: get }, s: translate, r: { linkifyUser: (user) => `<b>${user.name}</b>` } }
        : { TD, n: { default: get }, s: translate };
    const chirp = { account, action: action.action };
    legacyMethod(`TD.services.${kind}.prototype.fromRESTData = `, scope).call(chirp, action, action.sources[0], action.targets[0], action.target_objects[0]);
    chirp.isAboutYou = legacyMethod(`TD.services.${kind}.prototype.isAboutYou = `, scope);
    legacyMethod('TD.services.TwitterActionOnTweet.prototype.generateInternalID = ', { TD }).call(chirp);
    legacyMethod(`TD.services.${kind}.prototype.generateText = `, scope).call(chirp);
    return chirp;
}

test('a like or a retweet of a retweet of the account is the action legacy words as "your Retweet"', () => {
    const actions = deliver(load().notifications, onMyRetweet());
    assert.deepEqual(actions.map(summary), ['favorited_retweet:7:900@1000', 'favorited_retweet:8:900@999', 'retweeted_retweet:7:900@900']);
    for (const action of actions) {
        // the target is the retweet, the object the account it is about
        assert.equal(action.targets[0].retweeted_status.id_str, '100');
        assert.equal(action.target_objects[0].id_str, '42');
        assert.equal(action.target_objects[0].screen_name, 'user42');
        assert.equal(action.target_objects_size, 1);
    }
    const chirps = actions.map(legacyChirp);
    // `text` is the title of the desktop notification, `htmlText` the line above the tweet
    assert.deepEqual(chirps.map(c => c.text), ['User 7 liked your Retweet', 'User 8 liked your Retweet', 'User 7 Retweeted your Retweet']);
    assert.deepEqual(chirps.map(c => c.htmlText), ['<b>User 7</b> liked your Retweet', '<b>User 8</b> liked your Retweet', '<b>User 7</b> Retweeted your Retweet']);
    // the tagged photo does not move them under the column's "Tweets tagging me"
    assert.deepEqual(chirps.map(c => c.action), ['favorited_retweet', 'favorited_retweet', 'retweeted_retweet']);
    for (const chirp of chirps) {
        assert.equal(chirp.isAboutYou(), true);
        // the tweet shown is the retweeted one, with its own likes
        assert.equal(chirp.targetTweet.id, '100');
        assert.equal(chirp.targetTweet.likeCount, 113);
        assert.equal(chirp.targetTweet.user.screen_name, 'user5');
    }
});

test('the ids of actions on a retweet are the ones legacy builds, so a poller that holds them is not sent them again', () => {
    const ids = deliver(load().notifications, onMyRetweet()).map(legacyChirp).map(c => c.id);
    assert.deepEqual(ids, ['favorited_retweet_7_100', 'favorited_retweet_8_100', 'retweeted_retweet_7_100']);
    const holds = (...held) => {
        const TD = { controller: {
            columnManager: { getAll: () => ({ col: { getFeeds: () => [{ getType: () => 'interactions', getAccountKey: () => 'twitter:42', getKey: () => 'feed' }] } }) },
            feedManager: { getPoller: () => ({ chirpIndex: Object.fromEntries(held.map(id => [id, {}])) }) },
        } };
        return deliver(load({}, { TD }).notifications, onMyRetweet()).map(summary);
    };
    assert.deepEqual(holds(...ids), []);
    assert.deepEqual(holds(ids[0], ids[2]), ['favorited_retweet:8:900@1000']);
    // ids spelled the way a plain like or retweet is would let everything through again
    assert.equal(holds('favorite_7_900', 'favorite_8_900', 'retweet_7_900').length, 3);
});

test('a retweet whose retweeted tweet did not come stays a plain like or retweet', () => {
    // legacy would word it "liked a Tweet you were mentioned in"
    const actions = deliver(load().notifications, onMyRetweet({ __typename: 'TweetUnavailable', reason: 'Protected' }));
    assert.deepEqual(actions.map(summary), ['favorite:7:900@1000', 'favorite:8:900@999', 'retweet:7:900@900']);
    assert.equal(actions[0].target_objects[0].id_str, '900');
});

test('a like of a tweet of the account stays a plain like, tagged photo or not', () => {
    const actions = deliver(load().notifications, page([
        aggregate('users_liked_your_tweet', 'n1', 1000, [gUser('7')], [gTweet('100', me, { extended_entities: tagged })]),
    ]));
    assert.deepEqual(actions.map(summary), ['favorite:7:100@1000']);
    assert.equal(actions[0].targets[0].extended_entities.media[0].features.all.tags.length, 1);
    assert.equal(actions[0].target_objects[0].id_str, '100');
});
