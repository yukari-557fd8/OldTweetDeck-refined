const PUBLIC_TOKENS = [
    "Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA",
];
const NEW_API = `https://${location.hostname}/i/api/graphql`;
const cursors = {};
const OTD_INIT_TIME = Date.now();

const generateID = () => {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

let verifiedUser;
if(localStorage.OTDverifiedUser) {
    try {
        verifiedUser = JSON.parse(localStorage.OTDverifiedUser);
    } catch(e) {
        console.warn(`Error parsing OTDverifiedUser.`, e);
        verifiedUser = null;
    }
}
// Deck state is per login account. Teams columns stay in that one deck: the key is the
// verified login, not the x-act-as-user-id of a column. Older builds stored one global deck.
let feeds = {};
let columns = {};
let settings;
let activeAccountId = null;
let pendingLegacyOwner = false;

function hasStored(key) {
    const value = localStorage[key];
    // Browsers return null for a missing localStorage key. The test double returns undefined.
    return value !== undefined && value !== null && value !== "";
}

function readStoredJSON(key) {
    if (!hasStored(key)) return undefined;
    try {
        return JSON.parse(localStorage[key]);
    } catch (e) {
        console.warn(`Error parsing ${key}.`, e);
        return undefined;
    }
}

function stateKey(name, userId) {
    return `OTD${name}:${userId}`;
}

function accountHasStoredState(userId) {
    return ["feeds", "columns", "settings", "columnIds"].some((name) => hasStored(stateKey(name, userId)));
}

function hasLegacyBundle() {
    return ["OTDfeeds", "OTDcolumns", "OTDsettings", "OTDcolumnIds"].some((key) => hasStored(key));
}

function columnIdsOfActive() {
    const key = activeAccountId ? stateKey("columnIds", activeAccountId) : "OTDcolumnIds";
    return readStoredJSON(key) || [];
}

function writeColumnIds(ids) {
    const key = activeAccountId ? stateKey("columnIds", activeAccountId) : "OTDcolumnIds";
    localStorage[key] = JSON.stringify(ids);
}

function persistAccountState() {
    const suffix = activeAccountId ? `:${activeAccountId}` : "";
    localStorage["OTDfeeds" + suffix] = JSON.stringify(feeds);
    localStorage["OTDcolumns" + suffix] = JSON.stringify(columns);
    if (settings) localStorage["OTDsettings" + suffix] = JSON.stringify(settings);
}

function loadStoredAccount(userId) {
    feeds = readStoredJSON(stateKey("feeds", userId)) || {};
    columns = readStoredJSON(stateKey("columns", userId)) || {};
    const stored = readStoredJSON(stateKey("settings", userId));
    settings = stored === undefined ? null : stored;
    activeAccountId = String(userId);
    pendingLegacyOwner = false;
}

// The global keys belong to whichever login opens TweetDeck first after this change.
function migrateLegacyTo(userId) {
    feeds = readStoredJSON("OTDfeeds") || {};
    columns = readStoredJSON("OTDcolumns") || {};
    const stored = readStoredJSON("OTDsettings");
    settings = stored === undefined ? null : stored;
    activeAccountId = String(userId);
    pendingLegacyOwner = false;
    const columnIds = readStoredJSON("OTDcolumnIds") || [];
    persistAccountState();
    writeColumnIds(columnIds);
    localStorage.OTDstateMigrated = String(userId);
    delete localStorage.OTDfeeds;
    delete localStorage.OTDcolumns;
    delete localStorage.OTDsettings;
    delete localStorage.OTDcolumnIds;
}

function ensureAccount(userId) {
    if (!userId) return;
    userId = String(userId);
    if (activeAccountId === userId) return;
    if (pendingLegacyOwner && !localStorage.OTDstateMigrated) {
        migrateLegacyTo(userId);
        return;
    }
    if (activeAccountId) persistAccountState();
    if (accountHasStoredState(userId)) {
        loadStoredAccount(userId);
        return;
    }
    if (!localStorage.OTDstateMigrated && hasLegacyBundle()) {
        migrateLegacyTo(userId);
        return;
    }
    feeds = {};
    columns = {};
    settings = null;
    activeAccountId = userId;
    pendingLegacyOwner = false;
}

if (verifiedUser?.id_str) {
    ensureAccount(verifiedUser.id_str);
} else if (!localStorage.OTDstateMigrated && localStorage.OTDsettings) {
    feeds = readStoredJSON("OTDfeeds") || {};
    columns = readStoredJSON("OTDcolumns") || {};
    settings = readStoredJSON("OTDsettings");
    pendingLegacyOwner = true;
}
let seenNotifications = new Set();
// Legacy chirp id -> the position we first handed out for it, so a notification that has to be
// re-sent (another column's poller didn't have it yet) doesn't jump when its aggregate moves.
let notificationPositions = new Map();
let seenHomeTweets = {};
let timings = {
    list: {},
    user: {},
    search: {},
}
let refreshInterval = localStorage.OTDrefreshInterval ? parseInt(localStorage.OTDrefreshInterval) : 35000;

function exportState() {
	const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify({
        feeds, 
        columns,
        settings,
        columnIds: columnIdsOfActive()
    })], {type: 'application/json'}));
    a.download = 'OTDState.json';
    a.click();
}

function importState() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async () => {
        const file = input.files[0];
        if(!file) return;
        const reader = new FileReader();
        reader.onload = async (e) => {
            const text = e.target.result;
            try {
                const data = JSON.parse(text);
                if(!data.feeds || !data.columns || !data.settings || !data.columnIds) {
                    throw new Error("Invalid file");
                }
                feeds = data.feeds;
                columns = data.columns;
                settings = data.settings;
                persistAccountState();
                writeColumnIds(data.columnIds);
                location.reload();
            } catch(e) {
                alert("Error parsing file");
            }
        };
        reader.readAsText(file);
    };
    input.click();
}

function cleanUp() {
    let ids = columnIdsOfActive();
    for(let columnId in columns) {
        if(!ids.includes(columnId)) {
            delete columns[columnId];
        }
    }
    const columnsJson = JSON.stringify(columns);
    const columnsKey = activeAccountId ? stateKey("columns", activeAccountId) : "OTDcolumns";
    localStorage[columnsKey] = columnsJson;
    for(let id in feeds) {
        if(!columnsJson.includes(id)) {
            delete feeds[id];
        }
    }
    const feedsKey = activeAccountId ? stateKey("feeds", activeAccountId) : "OTDfeeds";
    localStorage[feedsKey] = JSON.stringify(feeds);
}

function getFollows(id = getCurrentUserId(), cursor = -1, count = 5000) {
	return new Promise(function (resolve, reject) {
		var xhr = new XMLHttpRequest();
		xhr.open("GET", `https://api.${location.hostname}/1.1/friends/ids.json?user_id=${id}&cursor=${cursor}&stringify_ids=true&count=${count}`, true);
		xhr.setRequestHeader("X-Twitter-Active-User", "yes");
		xhr.setRequestHeader("X-Twitter-Auth-Type", "OAuth2Session");
		xhr.setRequestHeader("X-Twitter-Client-Language", "en");
		xhr.setRequestHeader("Authorization", "Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA");
		xhr.setRequestHeader("X-Csrf-Token", (function () {
			var csrf = document.cookie.match(/(?:^|;\s*)ct0=([0-9a-f]+)\s*(?:;|$)/);
			return csrf ? csrf[1] : "";
		})());
		xhr.withCredentials = true;

		xhr.onreadystatechange = function () {
			if (xhr.readyState === 4 && xhr.status === 200) {
				resolve(JSON.parse(xhr.responseText));
			} else if (xhr.readyState === 4 && xhr.status !== 200) {
                reject(xhr);
            }
		};
		
		xhr.send();
	});
}

let followsData = JSON.parse(localStorage.OTDfollowsData || "{}");

let updatingFollows = false;
function updateFollows(id = getCurrentUserId()) {
    if(followsData[id] && followsData[id].lastUpdate && Date.now() - +followsData[id].lastUpdate < 1000 * 60 * 60 * 6) return;
    if(updatingFollows) return;
    updatingFollows = true;

    if(!followsData[id]) followsData[id] = {};
    let newfollows = [];
    let cursor = -1;
    let count = 5000;
    let i = 0;
    let get = async () => {
        let res = await getFollows(id, cursor, count);
        newfollows = newfollows.concat(res.ids);
        if(res.next_cursor_str === "0" || i++ > 10) {
            followsData[id].lastUpdate = Date.now();
            followsData[id].data = newfollows;
            localStorage.OTDfollowsData = JSON.stringify(followsData);
            updatingFollows = false;
            return;
        }
        cursor = res.next_cursor_str;
        get();
    };

    get();
}

// setTimeout(updateFollows, 1000);
// setInterval(updateFollows, 1000 * 60);

function parseNoteTweet(result) {
    let text, entities;
    if (result.note_tweet.note_tweet_results.result) {
        text = result.note_tweet.note_tweet_results.result.text;
        entities = result.note_tweet.note_tweet_results.result.entity_set;
        if (result.note_tweet.note_tweet_results.result.richtext?.richtext_tags.length) {
            entities.richtext = result.note_tweet.note_tweet_results.result.richtext.richtext_tags; // logically, richtext is an entity, right?
        }
    } else {
        text = result.note_tweet.note_tweet_results.text;
        entities = result.note_tweet.note_tweet_results.entity_set;
    }
    return { text, entities };
}

// A legacy summary card from a link, a title, a text and an image (summary_large_image with the
// image, summary without): what TweetDeck's card renderer reads for a link preview.
function summaryCard({ url, title, description, vanity, image }) {
    const stringValue = (value) => ({ type: "STRING", string_value: value });
    const binding_values = {
        card_url: stringValue(url),
        title: stringValue(title),
        description: stringValue(description || ""),
        domain: stringValue(vanity),
        vanity_url: stringValue(vanity),
    };
    if (image?.url) {
        for (const prefix of ["photo_image_full_size", "summary_photo_image", "thumbnail_image"]) {
            for (const suffix of ["", "_small", "_large", "_x_large", "_original"]) {
                binding_values[prefix + suffix] = { type: "IMAGE", image_value: { url: image.url, width: image.width || 0, height: image.height || 0 } };
            }
        }
    }
    return { name: image?.url ? "summary_large_image" : "summary", url, binding_values };
}

// An X Article comes as `article` on the tweet, not as a card, so TweetDeck showed the text alone.
// Shape (HomeLatestTimeline, 2026-10-23): article.article_results.result { rest_id, title,
// preview_text, cover_media.media_info { original_img_url, original_img_width, original_img_height } }.
function presentArticle(tweet, article) {
    if (!tweet || tweet.card) return;
    const result = article?.article_results?.result;
    const id = result?.rest_id || result?.id;
    if (!id || !result.title) return;
    const media = result.cover_media?.media_info;
    const image = media?.original_img_url
        ? { url: media.original_img_url, width: media.original_img_width, height: media.original_img_height }
        : null;
    tweet.card = summaryCard({ url: `https://x.com/i/article/${id}`, title: result.title, description: result.preview_text, vanity: "x.com", image });
}

function parseTweetCard(card) {
    const legacy = card?.legacy;
    if (!legacy) return;
    const bindings = Array.isArray(legacy.binding_values)
        ? Object.fromEntries(legacy.binding_values.filter(entry => entry?.key && entry.value).map(entry => [entry.key, entry.value]))
        : legacy.binding_values || {};
    const normalized = { ...legacy, binding_values: bindings };
    // A Space's card (binding values: id, card_url, narrow_cast_space_type, tweet_id) has nothing
    // TweetDeck can render; a link card to the Space says what the tweet carries.
    if (legacy.name === "3691233323:audiospace") {
        const spaceId = bindings.id?.string_value;
        const url = bindings.card_url?.string_value || (spaceId ? `https://x.com/i/spaces/${spaceId}` : null);
        return url ? summaryCard({ url, title: "X Space", description: "Listen on X", vanity: "x.com", image: null }) : normalized;
    }
    if (legacy.name !== "unified_card") return normalized;
    try {
        const payload = JSON.parse(bindings.unified_card?.string_value);
        if (!["image_website", "image_carousel_website", "image_multi_dest_carousel_website", "image_collection_website"].includes(payload?.type)) return normalized;
        const objects = payload.component_objects || {};
        const slides = payload.layout?.data?.slides;
        const order = Array.isArray(slides) && slides.length
            ? slides.flat()
            : payload.components;
        if (!Array.isArray(order)) return normalized;
        const mediaKey = order.find(key => ["media", "swipeable_media"].includes(objects[key]?.type));
        const component = objects[mediaKey];
        const slot = component?.type === "swipeable_media" ? component.data?.media_list?.[0] : component?.data;
        const media = payload.media_entities?.[slot?.id];
        if (media?.type !== "photo") return normalized;
        const imageUrl = media.media_url_https || media.media_url;
        const image = new URL(imageUrl);
        if (!["https:", "http:"].includes(image.protocol)) return normalized;
        const slide = Array.isArray(slides) ? slides.find(keys => Array.isArray(keys) && keys.includes(mediaKey)) : null;
        const details = (slide || order).map(key => objects[key]).find(value => value?.type === "details")?.data;
        const destinationKey = slot?.destination || component?.data?.destination || details?.destination;
        const destination = payload.destination_objects?.[destinationKey];
        if (!["browser", "browser_with_docked_media"].includes(destination?.type)) return normalized;
        const urlData = destination.data?.url_data;
        const url = new URL(urlData?.url);
        if (!["https:", "http:"].includes(url.protocol)) return normalized;
        const vanity = typeof urlData.vanity === "string" && urlData.vanity ? urlData.vanity : url.hostname;
        const stringValue = value => ({ type: "STRING", string_value: value });
        const converted = {
            card_url: stringValue(urlData.url),
            title: stringValue(typeof details?.title?.content === "string" && details.title.content ? details.title.content : vanity),
            description: stringValue(typeof details?.subtitle?.content === "string" ? details.subtitle.content : ""),
            domain: stringValue(vanity),
            vanity_url: stringValue(vanity),
        };
        for (const prefix of ["photo_image_full_size", "summary_photo_image", "thumbnail_image"]) {
            for (const [suffix, bucket] of [["", "medium"], ["_small", "small"], ["_large", "large"], ["_x_large", "large"], ["_original", "original"]]) {
                const sizes = media.sizes || {};
                const size = sizes[bucket] || sizes.medium || sizes.large || {};
                const width = bucket === "original" ? media.original_info?.width || sizes.large?.w || 0 : size.w || 0;
                const height = bucket === "original" ? media.original_info?.height || sizes.large?.h || 0 : size.h || 0;
                converted[prefix + suffix] = { type: "IMAGE", image_value: { url: imageUrl, width, height } };
            }
        }
        return { ...legacy, name: "summary_large_image", url: urlData.url, binding_values: converted };
    } catch {
        return normalized;
    }
}

// parseTweet throws on shapes it can't handle. Timelines must drop that one tweet rather
// than fail the whole response, which TweetDeck shows as an empty "No recent Tweets" column.
function safeParseTweet(res, options) {
    try {
        return parseTweet(res, options);
    } catch (e) {
        return undefined;
    }
}

function userHidden(user) {
    return !!(user && (user.muting || user.blocking));
}

// Drop a tweet whose author, or the author of a retweet, is muted or blocked.
// A quote of such a user loses the quoted tweet and keeps the outer one.
function tweetHidden(tweet) {
    if (!tweet) return false;
    if (userHidden(tweet.user) || userHidden(tweet.retweeted_status?.user)) return true;
    if (userHidden(tweet.quoted_status?.user)) {
        delete tweet.quoted_status;
        tweet.is_quote_status = false;
    }
    if (userHidden(tweet.retweeted_status?.quoted_status?.user)) {
        delete tweet.retweeted_status.quoted_status;
    }
    return false;
}

// Better TweetDeck marks <body> data-btd-ready once it runs. It draws its own Blue, Business and
// Government badges from the v1.1 ext_is_blue_verified / ext_verified_type fields.
function betterTweetDeckRunning() {
    try {
        return document.body.getAttribute("data-btd-ready") === "true";
    } catch (e) {
        return false;
    }
}

// X no longer sets `verified`: a checkmark is is_blue_verified or a verified_type (Business,
// Government). Legacy only draws `verified`, so a checkmark becomes `verified` for it to draw.
// Better TweetDeck draws the checkmark itself from the ext_ fields, so with it running `verified`
// stays what X says: otherwise both draw one, and when BTD puts badges on avatars it hides legacy's
// in columns, which left these accounts with no badge at all there.
function markVerified(user) {
    if (!user || user.verified) return;
    if ((user.ext_is_blue_verified || user.ext_verified_type) && !betterTweetDeckRunning()) user.verified = true;
}

// A GraphQL user's checkmark and follow state, in the v1.1 fields legacy and Better TweetDeck read.
// X moved following / followed_by out of `legacy` into relationship_perspectives. Without them
// legacy offers "Follow" for accounts already followed, and BTD never looks for mutuals.
function applyGraphUserState(user, result) {
    const relationship = result?.relationship_perspectives;
    if (relationship) {
        if (!("following" in user)) user.following = !!relationship.following;
        if (!("followed_by" in user)) user.followed_by = !!relationship.followed_by;
        rememberRelationship(user, relationship);
    }
    user.ext_is_blue_verified = !!result?.is_blue_verified;
    if (result?.verification?.verified_type) user.ext_verified_type = result.verification.verified_type;
    if (result?.is_blue_verified) user.verified_type = "Blue";
    if (result?.verification?.verified) user.verified = true;
    markVerified(user);
}

// The v1.1 user fields legacy reads (TwitterUser.fromJSONObject in bundle.js: the profile popup's
// bio, counts, banner, website, join date), from where X keeps them now that users come without
// `legacy`: core, avatar, banner, profile_bio, website, relationship_counts, tweet_counts,
// action_counts, privacy, location. A field the user already has is kept. X gives no listed_count,
// so it is 0 (legacy's prettyNumber would show undefined as an empty Listed cell).
function fillUserFromGraph(user, result) {
    if (!user || !result) return user;
    const set = (key, value) => {
        if (user[key] !== undefined && user[key] !== null && user[key] !== "") return;
        if (value === undefined || value === null || value === "") return;
        user[key] = value;
    };
    set("name", result.core?.name);
    set("screen_name", result.core?.screen_name);
    set("created_at", result.core?.created_at);
    if (!user.profile_image_url_https && result.avatar?.image_url) {
        user.profile_image_url_https = String(result.avatar.image_url).replace("http://", "https://");
    }
    if (!user.profile_image_url && user.profile_image_url_https) {
        user.profile_image_url = user.profile_image_url_https.replace("https://", "http://");
    }
    set("profile_banner_url", result.banner?.image_url);
    set("description", result.profile_bio?.description);
    set("location", result.location?.location);
    const website = result.website?.url;
    set("url", website);
    if (!user.entities) {
        const description = Object.assign({ urls: [] }, result.profile_bio?.entities?.description);
        user.entities = { description };
        const urls = result.profile_bio?.entities?.url?.urls;
        if (Array.isArray(urls) && urls.length) {
            user.entities.url = { urls };
        } else if (website) {
            const display = String(website).replace(/^https?:\/\//, "").replace(/\/$/, "");
            user.entities.url = { urls: [{ url: website, expanded_url: website, display_url: display, indices: [0, String(website).length] }] };
        }
    }
    set("followers_count", result.relationship_counts?.followers);
    set("friends_count", result.relationship_counts?.following);
    set("statuses_count", result.tweet_counts?.tweets);
    set("media_count", result.tweet_counts?.media_tweets);
    set("favourites_count", result.action_counts?.favorites_count);
    set("listed_count", 0);
    if (result.privacy?.protected) user.protected = true;
    if (result.relationship_perspectives?.muting) user.muting = true;
    if (result.relationship_perspectives?.blocking) user.blocking = true;
    applyGraphUserState(user, result);
    return user;
}

function isPromoted(entry) {
    const id = entry?.entryId || "";
    if (id.includes("promoted")) return true;
    const itemContent = entry?.content?.itemContent || entry?.item?.itemContent;
    return !!itemContent?.promotedMetadata;
}

// A video unified card has no legacy card TweetDeck can play. Hand it the same
// media object a native video tweet carries, and the column player uses it.
function mediaFromUnifiedCard(card) {
    const legacy = card?.legacy;
    if (!legacy || legacy.name !== "unified_card") return null;
    const bindings = Array.isArray(legacy.binding_values)
        ? Object.fromEntries(legacy.binding_values.filter(entry => entry?.key && entry.value).map(entry => [entry.key, entry.value]))
        : legacy.binding_values || {};
    let payload;
    try {
        payload = JSON.parse(bindings.unified_card?.string_value);
    } catch (e) {
        return null;
    }
    const objects = payload?.component_objects || {};
    const slides = payload?.layout?.data?.slides;
    const order = Array.isArray(slides) && slides.length ? slides.flat() : payload?.components;
    if (!Array.isArray(order)) return null;
    const mediaKey = order.find(key => ["media", "swipeable_media"].includes(objects[key]?.type));
    const component = objects[mediaKey];
    const slot = component?.type === "swipeable_media" ? component.data?.media_list?.[0] : component?.data;
    const media = payload.media_entities?.[slot?.id];
    if (!media || (media.type !== "video" && media.type !== "animated_gif")) return null;
    const variants = media.video_info?.variants;
    if (!Array.isArray(variants) || !variants.some(variant => variant?.content_type === "video/mp4" && variant.url)) return null;
    return {
        id_str: String(media.id_str || media.id || slot.id),
        media_url_https: media.media_url_https || media.media_url,
        type: media.type,
        sizes: media.sizes || {},
        video_info: media.video_info,
        original_info: media.original_info,
    };
}

function presentCard(tweet, card) {
    if (!tweet || !card) return;
    const media = mediaFromUnifiedCard(card);
    if (media) {
        if (!tweet.extended_entities?.media?.length) tweet.extended_entities = { media: [media] };
        return;
    }
    const parsed = parseTweetCard(card);
    if (parsed) tweet.card = parsed;
}

function parseTweet(res, options) {
    const expandNotes = options?.expandNotes ?? localStorage.OTDenableAutoExpand === "1";
    try {

        if (typeof res !== "object") return;
        if (res.limitedActionResults) {
            let limitation = res.limitedActionResults.limited_actions.find((l) => l.action === "Reply");
            if (limitation) {
                res.tweet.legacy.limited_actions_text = limitation.prompt
                    ? limitation.prompt.subtext.text
                    : "This tweet has limitations to who can reply.";
            }
            res = res.tweet;
        }
        if (!res.legacy && res.tweet) res = res.tweet;
        let tweet = res.legacy;
        if (!res.core || !tweet) return;
        if(!tweet.id) {
            tweet.id = +tweet.id_str;
        }
        // Suspended or deleted authors come back as `user_results: {}`. Without an author the
        // tweet can't be rendered, so skip it instead of throwing and failing the whole feed.
        let result = res.core.user_results?.result;
        if (!result) return;
        tweet.conversation_id = +tweet.conversation_id_str;
        tweet.text = tweet.full_text;
        // X no longer sends `legacy` for users: name, avatar, bio, counts and the rest are filled
        // from the new shape (fillUserFromGraph), so the profile popup has them too.
        tweet.user = result.legacy || {};
        tweet.user.id = +tweet.user_id_str;
        tweet.user.id_str = tweet.user_id_str;
        fillUserFromGraph(tweet.user, result);

        if (tweet.retweeted_status_result?.result) {
            let result = tweet.retweeted_status_result.result;
            if (result.limitedActionResults) {
                let limitation = result.limitedActionResults.limited_actions.find(
                    (l) => l.action === "Reply"
                );
                if (limitation && result.tweet?.legacy) {
                    result.tweet.legacy.limited_actions_text = limitation.prompt
                        ? limitation.prompt.subtext.text
                        : "This tweet has limitations to who can reply.";
                }
            }
            // TweetWithVisibilityResults (mediaVisibilityResults, tweetInterstitial, ...) wraps the
            // real tweet in `tweet`, with or without limitedActionResults. Without unwrapping it,
            // retweeted_status stays undefined and TweetDeck falls back to the raw "RT @user:" text.
            if (!result.legacy && result.tweet) result = result.tweet;
            if (
                result.quoted_status_result &&
                result.quoted_status_result.result &&
                result.quoted_status_result.result.legacy &&
                result.quoted_status_result.result.core?.user_results?.result
            ) {
                result.legacy.quoted_status = result.quoted_status_result.result.legacy;
                presentCard(result.legacy.quoted_status, result.quoted_status_result.result.card);
                result.legacy.quoted_status.id = +result.legacy.quoted_status.id_str;
                result.legacy.quoted_status.text = result.legacy.quoted_status.full_text;
                result.legacy.quoted_status.conversation_id = +result.legacy.quoted_status.conversation_id_str;
                if (result.legacy.quoted_status) {
                    result.legacy.quoted_status.user =
                        result.quoted_status_result.result.core.user_results.result.legacy || {};
                    result.legacy.quoted_status.user.id_str = result.legacy.quoted_status.user_id_str;
                    result.legacy.quoted_status.user.id = +result.legacy.quoted_status.user_id_str;
                    let user_result = result?.quoted_status_result?.result?.core?.user_results?.result;
                    fillUserFromGraph(result.legacy.quoted_status.user, user_result);
                } else {
                    console.warn("No retweeted quoted status", result);
                }
            }
            tweet.retweeted_status = result.legacy;
            if (tweet.retweeted_status && result.core?.user_results?.result) {
                let user_result = result.core.user_results.result;
                tweet.retweeted_status.text = tweet.retweeted_status.full_text;
                tweet.retweeted_status.id = +tweet.retweeted_status.id_str;
                tweet.retweeted_status.conversation_id = +tweet.retweeted_status.conversation_id_str;
                // Same as the top-level tweet: the author's fields live outside `legacy` now.
                tweet.retweeted_status.user = user_result.legacy || {};
                tweet.retweeted_status.user.id_str = tweet.retweeted_status.user_id_str;
                tweet.retweeted_status.user.id = +tweet.retweeted_status.user_id_str;
                fillUserFromGraph(tweet.retweeted_status.user, user_result);
                tweet.retweeted_status.ext = {};
                if (result.views) {
                    tweet.retweeted_status.ext.views = { r: { ok: { count: +result.views.count } } };
                }
                presentCard(tweet.retweeted_status, result.card);
                presentArticle(tweet.retweeted_status, result.article);
            } else {
                console.warn("No retweeted status", result);
            }
            // With autoexpand off, leave the truncated text. It ends in "…" and
            // TweetDeck adds an Expand tweet link. statuses/show passes expandNotes.
            if (expandNotes && result.note_tweet && result.note_tweet.note_tweet_results) {
                let note = parseNoteTweet(result);
                tweet.retweeted_status.full_text = note.text;
                tweet.retweeted_status.text = note.text;
                tweet.retweeted_status.entities = note.entities;
                tweet.retweeted_status.display_text_range = undefined; // no text range for long tweets
            }
        }
    
        if (res.quoted_status_result) {
            tweet.quoted_status_result = res.quoted_status_result;
        }
        if (expandNotes && res.note_tweet && res.note_tweet.note_tweet_results) {
            let note = parseNoteTweet(res);
            tweet.full_text = note.text;
            tweet.text = note.text;
            tweet.entities = note.entities;
            tweet.display_text_range = undefined; // no text range for long tweets
        }
        if (tweet.quoted_status_result && tweet.quoted_status_result.result) {
            let result = tweet.quoted_status_result.result;
            if (!result.core && result.tweet) result = result.tweet;
            if (result.limitedActionResults) {
                let limitation = result.limitedActionResults.limited_actions.find(
                    (l) => l.action === "Reply"
                );
                if (limitation) {
                    result.tweet.legacy.limited_actions_text = limitation.prompt
                        ? limitation.prompt.subtext.text
                        : "This tweet has limitations to who can reply.";
                }
                result = result.tweet;
            }
            if(result && result.legacy) {
                tweet.quoted_status = result.legacy;
                presentCard(tweet.quoted_status, result.card);
                tweet.quoted_status.id = +tweet.quoted_status.id_str;
                tweet.quoted_status.conversation_id = +tweet.quoted_status.conversation_id_str;
                tweet.quoted_status.text = tweet.quoted_status.full_text;
                if (tweet.quoted_status) {
                    let user_result = result.core?.user_results?.result;
                    // Same as above: the author's fields live outside `legacy` now.
                    tweet.quoted_status.user = user_result ? (user_result.legacy || {}) : undefined;
                    if (!tweet.quoted_status.user) {
                        delete tweet.quoted_status;
                    } else {
                        tweet.quoted_status.user.id_str = tweet.quoted_status.user_id_str;
                        tweet.quoted_status.user.id = +tweet.quoted_status.user_id_str;
                        fillUserFromGraph(tweet.quoted_status.user, user_result);
                        tweet.quoted_status.ext = {};
                        if (result.views) {
                            tweet.quoted_status.ext.views = { r: { ok: { count: +result.views.count } } };
                        }
                    }
                } else {
                    console.warn("No quoted status", result);
                }
            }
        }
        presentCard(tweet, res.card);
        presentArticle(tweet, res.article);
        if (res.views) {
            if (!tweet.ext) tweet.ext = {};
            tweet.ext.views = { r: { ok: { count: +res.views.count } } };
        }
        if (res.source) {
            tweet.source = res.source;
        }
        if (res.birdwatch_pivot) {
            // community notes
            tweet.birdwatch = res.birdwatch_pivot;
        }
    
        if (tweet.favorited && tweet.favorite_count === 0) {
            tweet.favorite_count = 1;
        }
        if (tweet.retweeted && tweet.retweet_count === 0) {
            tweet.retweet_count = 1;
        }
    
        return tweet;
    } catch (e) {
        console.error('error parsing tweet', e, res);
        throw new Error('error parsing tweet');
    }
}

// Legacy TweetDeck polled REST with `since_id` set to its second-newest tweet, so every page
// overlapped the newest cached tweet and FeedPoller could tell a real gap from "nothing new".
// Our cursor-based polls only return entries above the previous page, so every non-empty poll
// looked like a gap: FeedPoller.forgetAll() wiped its cache, and anything that refills columns
// from that cache (theme, font size, column width and sensitive-media toggles) came back with
// only the last poll's tweets. Treat a page as covering everything above the lower bound it was
// asked for, which is what REST guaranteed.
let legacyPollerPatched = false;
function keepLegacyPollerCache() {
    if (legacyPollerPatched) return;
    try {
        const poller = TD.util.poller;
        const original = poller.makeRequestResultInterval;
        poller.makeRequestResultInterval = function (chirps, requested) {
            const covered = original.call(this, chirps, requested);
            if (covered.empty || !requested.from.finite) return covered;
            return covered.hull(new requested.constructor(requested.from, requested.to));
        };
        legacyPollerPatched = true;
    } catch (e) {
        // TD isn't loaded yet; the next state load tries again.
    }
}

// ---- direct messages are the old, unencrypted kind -------------------------------------------

// X moved direct messages to X Chat (x.com/i/chat), whose conversations can be end-to-end
// encrypted. Legacy sends through the old dm/new.json, which still works (flattenArrayParams) but
// is not encrypted: the other side's X Chat shows the message as unencrypted, and an encrypted
// conversation can neither be read nor answered from here. Said where the message is written:
// under the recipients of the composer's DM mode, in the template legacy renders it from, and in
// a composer already on the page. Called whenever legacy loads its state, like the other patches.
const DM_NOTICE_CLASS = "otd-dm-notice";
const DM_NOTICE_TEXT = "Sent as a classic direct message without end-to-end encryption. Encrypted X Chat conversations are not available in TweetDeck.";
const DM_NOTICE_HTML = `<p class="${DM_NOTICE_CLASS} compose-text-title padding-t--9" style="font-size: 12px; opacity: 0.8;">${DM_NOTICE_TEXT}</p>`;
let dmNoticeInTemplate = false;
function noteUnencryptedDm() {
    try {
        const key = "compose/docked_compose.mustache";
        const template = TD.mustaches?.[key];
        if (!dmNoticeInTemplate && typeof template === "string") {
            if (template.includes(DM_NOTICE_CLASS)) {
                dmNoticeInTemplate = true;
            } else {
                // the marker follows the recipient container's closing tag; the line goes inside
                const marker = template.indexOf("<!-- end Direct Message -->");
                const close = marker === -1 ? -1 : template.lastIndexOf("</div>", marker);
                if (close !== -1) {
                    TD.mustaches[key] = template.slice(0, close) + DM_NOTICE_HTML + " " + template.slice(close);
                    dmNoticeInTemplate = true;
                }
            }
        }
        if (typeof document !== "undefined") {
            const container = document.querySelector(".js-compose-message-recipient-container");
            if (container && !container.querySelector(`.${DM_NOTICE_CLASS}`)) container.insertAdjacentHTML("beforeend", DM_NOTICE_HTML);
        }
    } catch (e) {
        // legacy is not loaded yet; the next state load tries again
    }
}

// ---- v1.1 endpoints x.com itself no longer calls -----------------------------------------------

// X retires these one at a time (help/configuration.json: 410 since 2026-10). The ones legacy
// still needs have another source, or a harmless empty answer: lists/ownerships and
// lists/subscriptions from CombinedLists, blocks/ids and mutes/users/ids from BlockedAccountsAll
// and MutedAccounts (the operations behind x.com's own lists, blocked and muted pages),
// users/contributees and saved_searches/list as an empty list. REST stays the first choice while
// it answers: one call brings a thousand lists or five thousand ids, where a GraphQL page holds a
// hundred users with their profiles. A 404 or 410 is remembered for a day and the other source
// serves meanwhile; the next day REST is tried once more. localStorage.OTDpreferGraphql = "1"
// takes the other source first, which is how it is tested while REST still works.
const RETIRED_REST_KEY = "OTDretiredRest";
const RETIRED_REST_RETRY = 24 * 60 * 60 * 1000;
const RETIRED_REST_ANSWERS = {
    "/1.1/lists/ownerships.json": "CombinedLists",
    "/1.1/lists/subscriptions.json": "CombinedLists",
    "/1.1/blocks/ids.json": "BlockedAccountsAll",
    "/1.1/mutes/users/ids.json": "MutedAccounts",
    "/1.1/users/contributees.json": "an empty list",
    "/1.1/users/contributees/pending.json": "an empty list",
    "/1.1/saved_searches/list.json": "an empty list",
    "/2/timeline/conversation/{id}.json": "TweetDetail",
    "/1.1/friendships/show.json": "the relationship the timelines carry, or UserByScreenName",
};

// The key a path is remembered under: the one entry for every conversation.
function retirementKey(path) {
    return String(path || "").replace(/^\/2\/timeline\/conversation\/\d+\.json$/, "/2/timeline/conversation/{id}.json");
}

function retiredRestEntry(path) {
    const entry = (readStoredJSON(RETIRED_REST_KEY) || {})[retirementKey(path)];
    return entry && Date.now() - (entry.at || 0) < RETIRED_REST_RETRY ? entry : null;
}

function rememberRetiredRest(path, status) {
    path = retirementKey(path);
    const all = readStoredJSON(RETIRED_REST_KEY) || {};
    all[path] = { status, at: Date.now() };
    try {
        localStorage[RETIRED_REST_KEY] = JSON.stringify(all);
    } catch (e) {
        // nothing to do: the next start asks REST again
    }
    noteGraphqlDifference(`retired:${path}`, `${path} answered ${status}; ${RETIRED_REST_ANSWERS[path]} stands in for a day`);
}

function useGraphqlFor(path) {
    return localStorage.OTDpreferGraphql === "1" || !!retiredRestEntry(path);
}

// From the Proxy's status getter: a REST answer of 404 or 410 on one of the paths above.
function noteRestRetirement(xhr) {
    const status = xhr._status || xhr.status;
    if (status !== 404 && status !== 410) return;
    if (xhr.storage?.graphql || xhr.storage?.emptyAnswer) return;
    const path = retirementKey(requestPath(xhr));
    if (!(path in RETIRED_REST_ANSWERS)) return;
    rememberRetiredRest(path, status);
}

function csrfToken() {
    try {
        return /(?:^|;\s*)ct0=([^;]+)/.exec(document.cookie)?.[1] || "";
    } catch (e) {
        return "";
    }
}

// A GET of one of the registry's operations, through the Proxy (which signs it and rewrites the
// query id and features to x.com's current ones), as x.com's own page would send it.
function graphqlGet(operation, variables, fieldToggles) {
    return new Promise((resolve, reject) => {
        const builtin = builtinGraphqlTable();
        const table = graphqlRegistry.table || builtin;
        const known = table.ops[operation] || builtin.ops[operation];
        if (!known) {
            reject(new Error(`unknown GraphQL operation ${operation}`));
            return;
        }
        let req;
        try {
            req = new XMLHttpRequest();
            req.open("GET", `${NEW_API}/${known.id}/${operation}?${generateParams(graphqlFeaturesFor(known, table), variables, fieldToggles)}`, true);
        } catch (e) {
            reject(e);
            return;
        }
        req.setRequestHeader("Authorization", PUBLIC_TOKENS[0]);
        req.setRequestHeader("X-Csrf-Token", csrfToken());
        req.setRequestHeader("X-Twitter-Auth-Type", "OAuth2Session");
        req.setRequestHeader("X-Twitter-Active-User", "yes");
        req.setRequestHeader("Content-Type", "application/json");
        req.onload = () => {
            let data = null;
            try {
                data = JSON.parse(req.responseText);
            } catch (e) {
                // not JSON: the status says enough
            }
            resolve({ status: req.status, data });
        };
        req.onerror = () => reject(new Error(`${operation} failed`));
        req.send();
    });
}

// The instructions of whichever timeline a GraphQL answer carries (CombinedLists has it under
// user.result.timeline.timeline, MutedAccounts under viewer.muting_timeline.timeline, and so on).
function graphqlInstructions(data) {
    const seen = new Set();
    const walk = (node, depth) => {
        if (!node || typeof node !== "object" || depth > 8 || seen.has(node)) return null;
        seen.add(node);
        if (Array.isArray(node.instructions)) return node.instructions;
        for (const value of Object.values(node)) {
            const found = walk(value, depth + 1);
            if (found) return found;
        }
        return null;
    };
    return walk(data?.data, 0) || [];
}

function graphqlEntries(data) {
    return graphqlInstructions(data).find((i) => i?.type === "TimelineAddEntries")?.entries || [];
}

// The item contents of the entries, modules' items included.
function graphqlItemContents(entries) {
    const out = [];
    for (const entry of entries) {
        const content = entry?.content;
        if (!content) continue;
        if (content.itemContent) out.push(content.itemContent);
        for (const item of content.items || []) if (item?.item?.itemContent) out.push(item.item.itemContent);
    }
    return out;
}

function graphqlBottomCursor(entries) {
    for (const entry of entries) {
        const content = entry?.content;
        if (content?.cursorType === "Bottom" && content.value) return content.value;
        if (String(entry?.entryId || "").startsWith("cursor-bottom") && (content?.value || content?.itemContent?.value)) return content.value || content.itemContent.value;
    }
    return null;
}

function graphqlPageFailure(status, data) {
    if (status >= 200 && status < 300 && (!data?.errors || graphqlInstructions(data).length)) return null;
    return new Error(data?.errors?.[0]?.message || `HTTP ${status}`);
}

function answerWithError(xhr, message, e) {
    console.warn(`OldTweetDeck: ${message}`, e);
    xhr._status = 503;
    xhr.storage.failure = { kind: "x-error", status: null, detail: String(e?.message || e) };
    xhr._responseText = JSON.stringify({ errors: [{ message }] });
    emulateResponse(xhr);
}

// lists/ownerships.json and lists/subscriptions.json: legacy asks each once, for a thousand lists,
// and reads `lists`. CombinedLists pages through the lists a user owns or follows together, a
// hundred at a time; the owner tells them apart.
const LIST_PAGE = 100;
const LIST_PAGES = 10;
async function answerListsFromGraph(xhr, kind) {
    const userId = String(requestUserId(xhr) || "");
    const lists = [];
    let cursor = null;
    try {
        for (let page = 0; page < LIST_PAGES; page++) {
            const variables = { userId, count: LIST_PAGE };
            if (cursor) variables.cursor = cursor;
            const { status, data } = await graphqlGet("CombinedLists", variables);
            const failure = graphqlPageFailure(status, data);
            if (failure) throw failure;
            const entries = graphqlEntries(data);
            let found = 0;
            for (const item of graphqlItemContents(entries)) {
                if (!item?.list || typeof item.list !== "object") continue;
                found++;
                const list = legacyListFromNode(item.list);
                const own = String(list.user?.id_str) === userId;
                if (kind === "owned" ? own : !own) lists.push(list);
            }
            cursor = graphqlBottomCursor(entries);
            if (!found || !cursor) break;
        }
    } catch (e) {
        answerWithError(xhr, `could not read ${kind} lists from CombinedLists`, e);
        return;
    }
    xhr._responseText = JSON.stringify({ lists, next_cursor: 0, next_cursor_str: "0", previous_cursor: 0, previous_cursor_str: "0" });
    emulateResponse(xhr);
}

// blocks/ids.json and mutes/users/ids.json: legacy reads `ids` and follows next_cursor_str until
// it is "0". One GraphQL page per call; a page without users ends the walk.
const IDS_PAGE = 100;
async function answerIdsFromGraph(xhr, operation) {
    let cursor = null;
    try {
        cursor = new URL(xhr.originalUrl || xhr.modUrl).searchParams.get("cursor");
    } catch (e) {
        // no cursor: the first page
    }
    const variables = { count: IDS_PAGE, includePromotedContent: false };
    if (cursor && cursor !== "-1" && cursor !== "0") variables.cursor = cursor;
    try {
        const { status, data } = await graphqlGet(operation, variables);
        const failure = graphqlPageFailure(status, data);
        if (failure) throw failure;
        const entries = graphqlEntries(data);
        const ids = [];
        for (const item of graphqlItemContents(entries)) {
            const result = item?.user_results?.result || item?.userResults?.result;
            const id = result?.rest_id || result?.legacy?.id_str;
            if (id) ids.push(String(id));
        }
        const bottom = ids.length ? graphqlBottomCursor(entries) : null;
        xhr._responseText = JSON.stringify({ ids, next_cursor: 0, next_cursor_str: bottom || "0", previous_cursor: 0, previous_cursor_str: "0" });
    } catch (e) {
        answerWithError(xhr, `could not read ${operation}`, e);
        return;
    }
    emulateResponse(xhr);
}

// help/configuration.json went 410 in 2026-10. Legacy falls back to its 2016 defaults when the
// request fails, so nothing broke, but startup logged an error and the composer counted a DM at
// the default limit. These are X's last published values (the photo limit is not enforced by
// legacy; the composer reads characters_reserved_per_media, transformedURLLength and
// dm_text_character_limit).
const HELP_CONFIGURATION = {
    characters_reserved_per_media: 24,
    dm_text_character_limit: 10000,
    max_media_per_upload: 4,
    non_username_paths: [],
    photo_size_limit: 5242880,
    photo_sizes: {
        thumb: { h: 150, resize: "crop", w: 150 },
        small: { h: 680, resize: "fit", w: 680 },
        medium: { h: 1200, resize: "fit", w: 1200 },
        large: { h: 2048, resize: "fit", w: 2048 },
    },
    short_url_length: 23,
    short_url_length_https: 23,
    transformedURLLength: 23,
};

// /2/timeline/conversation/<id>.json is the detail view: legacy's TwitterClient.getConversation
// reads globalObjects.tweets / users and the entries of the first instruction, which are tweet-<id>
// items (the ancestors and the tweet itself, displayType Tweet or SelfThread),
// conversationThread-<id> items (a reply and its thread as conversationComponents, and a
// showMoreCursor whose actionText it shows) and cursor-top-. It never follows a cursor: a reply
// opens its own conversation. x.com reads TweetDetail instead, whose page has the same things as
// tweet-<id> items, conversationthread-<id> modules of TimelineTweet items with a
// TimelineTimelineCursor item for "show more", and cursor entries. Shapes from 2026-10-25.
const TWEET_DETAIL_FIELD_TOGGLES = { withArticleRichContentState: true, withArticlePlainText: false, withGrokAnalyze: false, withDisallowedReplyControls: false };

function conversationFromTweetDetail(data, focalId) {
    const tweets = {};
    const users = {};
    const entries = [];
    const keep = (tweet) => {
        if (!tweet?.id_str || !tweet.user?.id_str) return;
        tweets[tweet.id_str] = tweet;
        users[tweet.user.id_str] = tweet.user;
    };
    // a tweet the entries can point at, or nothing for a muted or blocked author (as the REST
    // route drops them) and for what parseTweet cannot read
    const tweetOf = (itemContent) => {
        const result = itemContent?.tweet_results?.result;
        const tweet = result ? safeParseTweet(result) : null;
        if (!tweet?.id_str || !tweet.user?.id_str || userHidden(tweet.user)) return null;
        keep(tweet);
        for (const nested of [tweet.retweeted_status, tweet.quoted_status]) if (nested && !userHidden(nested.user)) keep(nested);
        return { id: tweet.id_str, displayType: itemContent.tweetDisplayType === "SelfThread" ? "SelfThread" : "Tweet" };
    };
    const isCursor = (itemContent) => itemContent?.itemType === "TimelineTimelineCursor" || (itemContent?.cursorType && !itemContent.tweet_results);
    for (const entry of graphqlEntries(data)) {
        const content = entry?.content;
        if (!content) continue;
        const sortIndex = String(entry.sortIndex || "");
        if (Array.isArray(content.items)) {
            const conversationComponents = [];
            let showMoreCursor;
            for (const item of content.items) {
                const itemContent = item?.item?.itemContent;
                if (!itemContent) continue;
                if (isCursor(itemContent)) {
                    showMoreCursor = { value: itemContent.value, cursorType: itemContent.cursorType, displayTreatment: { actionText: itemContent.displayTreatment?.actionText || "Show more replies" } };
                    continue;
                }
                const tweet = tweetOf(itemContent);
                if (tweet) conversationComponents.push({ conversationTweetComponent: { tweet } });
            }
            if (!conversationComponents.length) continue;
            const conversationThread = { conversationComponents };
            if (showMoreCursor) conversationThread.showMoreCursor = showMoreCursor;
            entries.push({ entryId: `conversationThread-${conversationComponents[0].conversationTweetComponent.tweet.id}`, sortIndex, content: { item: { content: { conversationThread } } } });
            continue;
        }
        const itemContent = content.itemContent || (content.cursorType ? content : null);
        if (!itemContent) continue;
        if (isCursor(itemContent)) {
            // legacy knows the top cursor (older ancestors exist); the bottom and "show more
            // threads" cursors have no counterpart
            if (itemContent.cursorType === "Top") entries.push({ entryId: `cursor-top-${sortIndex}`, sortIndex, content: { operation: { cursor: { value: itemContent.value, cursorType: "Top" } } } });
            continue;
        }
        const tweet = tweetOf(itemContent);
        if (tweet) entries.push({ entryId: `tweet-${tweet.id}`, sortIndex, content: { item: { content: { tweet } } } });
    }
    return {
        globalObjects: { tweets, users, moments: {}, cards: {}, places: {}, media: {}, broadcasts: {}, topics: {}, lists: {} },
        timeline: {
            id: `Conversation-${focalId}`,
            instructions: [{ addEntries: { entries } }, { terminateTimeline: { direction: "Top" } }],
            responseObjects: { feedbackActions: {}, immediateReactions: {} },
        },
    };
}

async function answerConversationFromGraph(xhr, focalId) {
    try {
        const variables = {
            focalTweetId: focalId, with_rux_injections: false, rankingMode: "Relevance", includePromotedContent: false,
            withCommunity: true, withQuickPromoteEligibilityTweetFields: true, withBirdwatchNotes: true, withVoice: true,
        };
        const { status, data } = await graphqlGet("TweetDetail", variables, TWEET_DETAIL_FIELD_TOGGLES);
        const failure = graphqlPageFailure(status, data);
        if (failure) throw failure;
        xhr._responseText = JSON.stringify(conversationFromTweetDetail(data, focalId));
    } catch (e) {
        answerWithError(xhr, "could not read the conversation from TweetDetail", e);
        return;
    }
    emulateResponse(xhr);
}

// ---- friendships/show.json from what the timelines already said -------------------------------

// Better TweetDeck asks friendships/show.json for every author it draws (about thirty requests
// at startup) to show its "follows you" and mutual badges; x.com itself no longer calls it. Every
// GraphQL user that passes through this file carries the same answer in relationship_perspectives
// (following, followed_by, blocking, muting), so it is remembered per user, and the question is
// answered from that for the login account while the answer is recent. REST answers the rest while
// it lives; once it is gone (OTDretiredRest), or with OTDpreferGraphql, a remembered answer of any
// age serves, and an unknown account is looked up with UserByScreenName / UserByRestId. A follow or
// unfollow from TweetDeck updates the memory from X's answer to it.
const RELATIONSHIP_FRESH = 10 * 60 * 1000;
const relationships = { byId: {}, byName: {} };

function rememberRelationship(user, perspectives) {
    if (!user?.id_str || !perspectives) return;
    const entry = {
        id_str: String(user.id_str),
        screen_name: String(user.screen_name || ""),
        following: !!perspectives.following,
        followed_by: !!perspectives.followed_by,
        blocking: !!perspectives.blocking,
        muting: !!perspectives.muting,
        at: Date.now(),
    };
    relationships.byId[entry.id_str] = entry;
    if (entry.screen_name) relationships.byName[entry.screen_name.toLowerCase()] = entry;
}

function knownRelationship(targetId, targetName) {
    return (targetId && relationships.byId[String(targetId)]) || (targetName && relationships.byName[String(targetName).toLowerCase()]) || null;
}

function loginUserId() {
    return String(verifiedUser?.id_str ?? localStorage.twitterAccountID ?? "");
}

// The v1.1 answer: `source` is the login account, `target` the other one; each side's `following`
// is what that side does. Fields X no longer tells (can_dm, notifications, ...) are false.
function friendshipShowBody(target) {
    const sourceId = loginUserId();
    return { relationship: {
        source: {
            id: +sourceId || 0, id_str: sourceId, screen_name: verifiedUser?.screen_name || "",
            following: target.following, followed_by: target.followed_by, live_following: false,
            following_received: false, following_requested: false, notifications_enabled: false,
            can_dm: false, can_media_tag: false, blocking: target.blocking, blocked_by: false,
            muting: target.muting, want_retweets: true, all_replies: false, marked_spam: false,
        },
        target: {
            id: +target.id_str || 0, id_str: target.id_str, screen_name: target.screen_name,
            following: target.followed_by, followed_by: target.following,
            following_received: false, following_requested: false,
        },
    } };
}

async function answerFriendshipFromGraph(xhr, targetId, targetName) {
    try {
        const { status, data } = targetId
            ? await graphqlGet("UserByRestId", { userId: String(targetId), withSafetyModeUserFields: true })
            : await graphqlGet("UserByScreenName", { screen_name: String(targetName), withGrokTranslatedBio: true }, { withPayments: false, withAuxiliaryUserLabels: true });
        if (status < 200 || status >= 300) throw new Error(`HTTP ${status}`);
        const user = legacyUserFromGraph(data?.data?.user?.result); // remembers the relationship on the way
        const known = user && knownRelationship(user.id_str, user.screen_name);
        if (!known) {
            xhr._status = 404;
            xhr._responseText = JSON.stringify({ errors: [{ code: 50, message: "User not found." }] });
            emulateResponse(xhr);
            return;
        }
        xhr._responseText = JSON.stringify(friendshipShowBody(known));
    } catch (e) {
        answerWithError(xhr, "could not look up a friendship", e);
        return;
    }
    emulateResponse(xhr);
}

const friendshipShowRoute = {
    path: "/1.1/friendships/show.json",
    method: "GET",
    openHandler: deferOpen,
    beforeRequest: (xhr) => {
        const params = new URL(xhr.modUrl).searchParams;
        xhr.storage.show = {
            sourceId: params.get("source_id"),
            sourceName: params.get("source_screen_name"),
            targetId: params.get("target_id"),
            targetName: params.get("target_screen_name"),
        };
    },
    beforeSend: (xhr) => {
        const { sourceId, sourceName, targetId, targetName } = xhr.storage.show || {};
        const forLogin = sourceId
            ? String(sourceId) === loginUserId()
            : !sourceName || String(sourceName).toLowerCase() === String(verifiedUser?.screen_name || "").toLowerCase();
        const retired = useGraphqlFor("/1.1/friendships/show.json");
        const known = forLogin && (targetId || targetName) ? knownRelationship(targetId, targetName) : null;
        if (known && (retired || Date.now() - known.at < RELATIONSHIP_FRESH)) {
            xhr.storage.graphql = true;
            xhr.storage.answer = known;
            return;
        }
        if (retired && forLogin && (targetId || targetName)) {
            xhr.storage.graphql = true;
            return;
        }
        openDeferred(xhr);
    },
    sendHandler: (xhr, body) => {
        if (xhr.storage.answer) {
            xhr._responseText = JSON.stringify(friendshipShowBody(xhr.storage.answer));
            emulateResponse(xhr);
        } else if (xhr.storage.graphql) {
            answerFriendshipFromGraph(xhr, xhr.storage.show.targetId, xhr.storage.show.targetName);
        } else {
            xhr.send(body);
        }
    },
};

// friendships/create.json and friendships/destroy.json answer with the other account as a v1.1
// user, following / followed_by included: the memory follows what TweetDeck just did.
function friendshipChangeRoute(path) {
    return {
        path,
        method: "POST",
        afterRequest: (xhr) => {
            const text = xhr.responseText;
            try {
                const user = JSON.parse(text);
                if (user?.id_str && "following" in user) {
                    rememberRelationship(user, { following: user.following, followed_by: user.followed_by, blocking: user.blocking, muting: user.muting });
                }
            } catch (e) {
                // not a user: legacy reads the answer as it is
            }
            return text;
        },
    };
}

// A route that lets REST through while it answers, and takes the GraphQL source otherwise.
function restOrGraphqlRoute(path, answer) {
    return {
        path,
        method: "GET",
        openHandler: deferOpen,
        beforeSend: (xhr) => {
            xhr.storage.graphql = useGraphqlFor(path);
            if (!xhr.storage.graphql) openDeferred(xhr);
        },
        sendHandler: (xhr, body) => {
            if (xhr.storage.graphql) answer(xhr);
            else xhr.send(body);
        },
    };
}

// A route whose endpoint has nothing to stand in: an empty list once it is gone, and the same
// answer when it fails on the spot (legacy's startup waits for users/contributees).
function emptyWhenRetiredRoute(path) {
    return {
        path,
        method: "GET",
        openHandler: deferOpen,
        beforeSend: (xhr) => {
            xhr.storage.emptyAnswer = !!retiredRestEntry(path);
            if (!xhr.storage.emptyAnswer) openDeferred(xhr);
        },
        sendHandler: (xhr, body) => {
            if (!xhr.storage.emptyAnswer) {
                xhr.send(body);
                return;
            }
            xhr._responseText = "[]";
            emulateResponse(xhr);
        },
        inspectResponse: (xhr) => {
            const status = xhr.status;
            if (status !== 404 && status !== 410 && status < 500) return;
            console.warn(`OldTweetDeck: ${path} answered ${status}; answering with an empty list instead`);
            if (status === 404 || status === 410) rememberRetiredRest(path, status);
            xhr.storage.emptyAnswer = true;
            xhr._status = 200;
            xhr._statusText = "OK";
            xhr._responseText = "[]";
        },
    };
}

// ---- request plumbing shared by the timeline routes -------------------------------------------

function getRequestHeader(xhr, name) {
    const headers = xhr.modReqHeaders || {};
    const wanted = name.toLowerCase();
    for (const key in headers) {
        if (key.toLowerCase() === wanted) return headers[key];
    }
    return undefined;
}

// Which account a legacy request acts for. Teams accounts arrive as an x-act-as-user-id header
// that legacy only adds after open() (TD.net.ajax's beforeSend in bundle.js), so this is only
// reliable from the Proxy's send() onwards; a request without the header is the login account.
function requestUserId(xhr) {
    const acting = getRequestHeader(xhr, "x-act-as-user-id");
    if (acting) return String(acting);
    if (xhr.storage && xhr.storage.user_id) return String(xhr.storage.user_id);
    try {
        const id = TD.storage.store.getTwitterLoginAccount()?.getUserID();
        if (id) return String(id);
    } catch (e) {
        // no legacy store yet
    }
    try {
        return getCurrentUserId();
    } catch (e) {
        return verifiedUser?.id_str ?? localStorage.twitterAccountID;
    }
}

// jQuery encodes an array parameter as key[]=a&key[]=b, and that is how legacy sends the
// recipients of a direct message (handleSendDm -> makeTwitterCall -> TD.net.ajax). X's v1.1
// endpoints reject that form now: dm/new.json answered 400 "Bad request" on 2026-10-25 and 200 with
// the same recipient as a plain string. The v1.1 API has always taken comma-joined lists, which
// legacy's other calls build by hand (users/lookup, statuses/lookup). Rewrite the form body on the
// way out; JSON bodies and bodies without such a key are left alone.
function flattenArrayParams(xhr, body) {
    if (typeof body !== "string" || !/(?:%5B%5D|\[\])=/.test(body)) return body;
    if (body[0] === "{" || body[0] === "[") return body; // JSON, which URLSearchParams would misread
    if (!/\/1\.1\//.test(String(xhr.modUrl || ""))) return body;
    let params;
    try {
        params = new URLSearchParams(body);
    } catch (e) {
        return body;
    }
    const out = new URLSearchParams();
    const lists = new Map();
    for (const [key, value] of params) {
        const m = /^(.+)\[\]$/.exec(key);
        if (!m) {
            out.append(key, value);
            continue;
        }
        if (!lists.has(m[1])) lists.set(m[1], []);
        lists.get(m[1]).push(value);
    }
    if (!lists.size) return body;
    for (const [key, values] of lists) out.append(key, values.join(","));
    return out.toString();
}

// Routes whose URL depends on the request headers defer the real open() to beforeSend.
function deferOpen(xhr, method, url, async, username, password) {
    xhr.storage.open = { method, async, username, password };
}

function openDeferred(xhr) {
    const open = xhr.storage.open || { method: xhr.modMethod || "GET" };
    xhr.open(open.method, xhr.modUrl, open.async ?? true, open.username ?? null, open.password ?? null);
}

// Answer legacy with a failed request without touching the network. Its error path neither
// retries nor marks the feed as exhausted, unlike an empty 200.
function failWithoutRequest(xhr, reason) {
    console.warn(`OldTweetDeck: ${reason}`);
    xhr.storage.cancelled = true;
    xhr._status = 503;
    xhr._statusText = reason;
}

// Legacy reads `status` before `responseText`, so a 200 whose body is only a GraphQL error would
// reach FeedPoller as an empty page (which can end infinite scroll). The Proxy runs this once on
// the first read of either, so the page can be failed instead; the parsed body is kept for
// afterRequest.
function graphqlPageInspector(timelineOf) {
    return (xhr) => {
        if (xhr.status < 200 || xhr.status >= 300) return;
        let data;
        try {
            data = JSON.parse(xhr.responseText);
        } catch (e) {
            return;
        }
        xhr.storage.parsed = data;
        if (!timelineOf(data)) {
            console.warn("OldTweetDeck: GraphQL error page", data?.errors ?? data);
            xhr._status = 503;
            xhr._statusText = "GraphQL error";
            xhr.storage.failure = { kind: "x-error", status: null, detail: data?.errors?.[0]?.message || "GraphQL error" };
        }
    };
}

// ---- telling the user why requests fail -------------------------------------------------------

// Legacy shows nothing when a column's request fails. At startup it shows "Error initializing
// TweetDeck" or a bare login form, and a request that never finishes leaves the spinner up for
// good. Remember why requests failed. Before TweetDeck is ready, put that on the login form or
// the loading screen. After that, raise a toast, at most once per reason and column type.
const REQUEST_LABELS = {
    "/1.1/account/verify_credentials.json": "account verification",
    "/1.1/users/contributees.json": "linked accounts",
    "/1.1/tweetdeck/clients/blackbird/all": "your saved columns",
    "/1.1/statuses/home_timeline.json": "Home",
    "/1.1/lists/statuses.json": "List columns",
    "/1.1/statuses/user_timeline.json": "User columns",
    "/1.1/statuses/bookmarks.json": "Bookmarks",
    "/1.1/activity/about_me.json": "Notifications",
    "/1.1/statuses/mentions_timeline.json": "Mentions",
    "/1.1/favorites/list.json": "Likes",
    "/1.1/search/universal.json": "Search",
};
// 401 and 403 stay off the toasts: after startup they also answer protected or missing accounts.
const TOASTED_FAILURES = new Set(["rate-limit", "x-error", "query-id", "solver", "unreadable"]);
const FAILURE_NOTICE_INTERVAL = 5 * 60 * 1000;
const STARTUP_STALL_DELAY = 30 * 1000;
const startupFailures = [];
const startupRequests = [];
const failureNoticeUntil = new Map();
let loginMessagePatched = false;
let startupWatch = null;

function legacyReady() {
    return typeof TD !== "undefined" && TD.ready === true;
}

function requestLabel(path) {
    if (REQUEST_LABELS[path]) return REQUEST_LABELS[path];
    if (/^\/2\/timeline\/conversation\//.test(path)) return "a conversation";
    return null;
}

function requestPath(xhr) {
    try {
        return new URL(xhr.originalUrl || xhr.modUrl).pathname;
    } catch (e) {
        return "";
    }
}

function formatClock(time) {
    return new Date(time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function describeFailure(f) {
    switch (f.kind) {
        case "rate-limit":
            return `X is rate limiting ${f.label} (429). ` + (f.resetAt
                ? `It should work again after ${formatClock(f.resetAt)}.`
                : "Wait a few minutes before reloading.");
        case "session":
            return `X refused ${f.label} (${f.status}). Check that you are logged in at x.com, then reload TweetDeck.`;
        case "solver":
            return `Could not sign the request for ${f.label} (${f.detail}). Reload TweetDeck. If this keeps happening, the challenge solver may need an update.`;
        case "unreadable":
            return `X sent a response for ${f.label} that OldTweetDeck could not read.`;
        case "network":
            return `Could not reach X for ${f.label}. Check your connection, then reload TweetDeck.`;
        case "verification-timeout":
            return "X did not confirm your account within 20 seconds. Reload TweetDeck.";
        case "query-id":
            return `X rejected the query for ${f.label} (${f.status}; ${f.detail}). Reload TweetDeck; if this keeps happening, OldTweetDeck needs an update.`;
        default: {
            const detail = [f.status, f.detail].filter(Boolean).join(": ");
            return `X returned an error for ${f.label}${detail ? ` (${detail})` : ""}.`;
        }
    }
}

// A finished request's status as legacy sees it, or nothing when it worked. A request this file
// answered itself (no cursor yet, and so on) is not a problem unless it says why it failed.
function failureFromStatus(xhr) {
    const status = xhr._status || xhr.status;
    if ((status >= 200 && status < 300) || status === 304) return null;
    if (xhr.storage?.failure) return Object.assign({ status }, xhr.storage.failure);
    if (xhr.storage?.cancelled) return null;
    if (status === 429) {
        const reset = Number(xhr.getResponseHeader?.("x-rate-limit-reset"));
        return { kind: "rate-limit", status, resetAt: reset > 0 ? reset * 1000 : null };
    }
    if (status === 401 || status === 403) return { kind: "session", status };
    if (status === 0) return { kind: "network", status };
    // 400 and 404 on a timeline usually mean X retired the GraphQL query id it uses; 410 that X
    // retired the endpoint itself (help/configuration.json went that way in 2026-10).
    if (status >= 400) return { kind: "x-error", status, detail: xhr.statusText || "" };
    return null;
}

// A toast for something that went wrong before legacy could show one: shown once legacy is up,
// or dropped after two minutes of waiting for it.
const pendingToasts = [];
function toastWhenReady(message) {
    pendingToasts.push(message);
    if (pendingToasts.length > 1) return;
    let tries = 0;
    const flush = () => {
        if (legacyReady() && globalThis.toasts?.showErrorNotification) {
            for (const text of pendingToasts.splice(0)) {
                try {
                    globalThis.toasts.showErrorNotification({ message: text, timeoutDelayMs: 20000 });
                } catch (e) {
                    console.warn("OldTweetDeck:", text);
                }
            }
            return;
        }
        if (++tries > 24) {
            for (const text of pendingToasts.splice(0)) console.warn("OldTweetDeck:", text);
            return;
        }
        const timer = setTimeout(flush, 5000);
        if (timer && typeof timer.unref === "function") timer.unref(); // node: a test need not wait for it
    };
    flush();
}

// Only the requests in REQUEST_LABELS are reported: startup depends on the first three, and the
// rest feed columns. Legacy reports failed actions such as a like or a reply itself.
function noteRequestFailure(xhr, failure) {
    if (!failure || xhr._failureNoted) return;
    xhr._failureNoted = true;
    const label = requestLabel(requestPath(xhr));
    if (!label) return;
    const notice = Object.assign({ label }, failure);
    if (!legacyReady()) {
        const same = startupFailures.findIndex((f) => f.kind === notice.kind && f.label === notice.label);
        if (same >= 0) startupFailures.splice(same, 1);
        startupFailures.push(notice);
        if (startupFailures.length > 3) startupFailures.shift();
        explainStartupFailures();
        return;
    }
    const method = String(xhr.modMethod || "GET").toUpperCase();
    if (method !== "GET" || !TOASTED_FAILURES.has(notice.kind)) return;
    const key = `${notice.kind}:${notice.label}`;
    const now = Date.now();
    if (now < (failureNoticeUntil.get(key) ?? 0)) return;
    failureNoticeUntil.set(key, Math.max(now + FAILURE_NOTICE_INTERVAL, notice.resetAt || 0));
    try {
        globalThis.toasts.showErrorNotification({ message: describeFailure(notice), timeoutDelayMs: 15000 });
    } catch (e) {
        console.warn("OldTweetDeck:", describeFailure(notice));
    }
}

// Legacy ends a failed startup in TD.controller.init.showLogin(message), with a message that
// does not say what failed, or none at all for 401 and 403.
function explainStartupFailures() {
    if (loginMessagePatched) return;
    try {
        const init = TD.controller.init;
        const showLogin = init.showLogin;
        if (typeof showLogin !== "function") return;
        init.showLogin = function (message) {
            const reasons = startupFailures.map(describeFailure).join(" ");
            return showLogin.call(this, reasons ? `TweetDeck could not start. ${reasons}` : message);
        };
        loginMessagePatched = true;
    } catch (e) {
        // TD isn't loaded yet; the next failure tries again.
    }
}

function rememberStartupRequest(xhr) {
    if (legacyReady()) return;
    startupRequests.push({ xhr, since: Date.now() });
    if (startupRequests.length > 50) startupRequests.shift();
}

function startupStatusText(now = Date.now()) {
    if (startupFailures.length) {
        return `TweetDeck has not loaded. ${startupFailures.map(describeFailure).join(" ")}`;
    }
    const waiting = startupRequests.find(
        (r) => !r.xhr.storage?.cancelled && r.xhr.readyState !== 4 && r.xhr._readyState !== 4
    );
    if (waiting) {
        const path = requestPath(waiting.xhr);
        const seconds = Math.round((now - waiting.since) / 1000);
        return `TweetDeck is still waiting for X to answer ${requestLabel(path) || path} (${seconds} s).`;
    }
    return "TweetDeck is taking longer than usual to load.";
}

// Under the startup spinner, once it has been up for a while. The login form replaces the
// spinner's container when startup fails, and carries its own message: then this returns false.
function renderStartupStatus() {
    const container = document.querySelector(".js-app-loading .js-signin-ui");
    if (!container || !container.querySelector(".spinner-centered")) return false;
    let line = container.querySelector(".otd-startup-status");
    if (!line) {
        line = document.createElement("p");
        line.className = "otd-startup-status";
        line.style.cssText = "margin: 16px auto 0; max-width: 420px; line-height: 1.5;";
        container.appendChild(line);
    }
    line.textContent = startupStatusText() + " ";
    const reload = document.createElement("a");
    reload.href = "#";
    reload.textContent = "Reload";
    reload.addEventListener("click", (e) => {
        e.preventDefault();
        location.reload();
    });
    line.appendChild(reload);
    return true;
}

function watchStartup() {
    if (startupWatch || typeof document === "undefined") return;
    startupWatch = setTimeout(function check() {
        if (legacyReady()) return;
        try {
            if (!renderStartupStatus()) return;
        } catch (e) {
            console.error(e);
            return;
        }
        startupWatch = setTimeout(check, 5000);
    }, STARTUP_STALL_DELAY);
}

// ---- timeline pages and cursors ---------------------------------------------------------------

// One record per page a timeline route handed to legacy: the ids it contained and the cursors X
// returned with it. Legacy derives max_id / since_id from whichever chirp sits at the edge of its
// column, so every id of a page has to resolve to that page's cursors, not just the one at the end.
const TIMELINE_PAGE_LIMIT = 300;
const timelinePages = new Map();

function rememberTimelinePage(feedKey, tweets, bottom, top) {
    if (!tweets.length || (!bottom && !top)) return;
    let pages = timelinePages.get(feedKey);
    if (!pages) timelinePages.set(feedKey, (pages = []));
    pages.push({ ids: new Set(tweets.map((t) => t.id_str)), bottom, top });
    if (pages.length > TIMELINE_PAGE_LIMIT) pages.splice(0, pages.length - TIMELINE_PAGE_LIMIT);
}

function timelinePageOf(feedKey, tweetId) {
    const pages = timelinePages.get(feedKey);
    if (!pages) return undefined;
    for (let i = pages.length - 1; i >= 0; i--) {
        if (pages[i].ids.has(tweetId)) return pages[i];
    }
    return undefined;
}

function timelineCursor(feedKey, tweetId, edge) {
    return timelinePageOf(feedKey, tweetId)?.[edge];
}

// The page below `tweetId` came back with nothing usable: point at the page after it, so the next
// request for the same bound goes deeper instead of fetching the same page again.
function advanceTimelineCursor(feedKey, tweetId, bottom) {
    const page = timelinePageOf(feedKey, tweetId);
    if (page && bottom) page.bottom = bottom;
}

function findCursor(entries, edge) {
    const entry = entries.find(
        (e) => e.entryId.startsWith(`sq-cursor-${edge}-`) || e.entryId.startsWith(`cursor-${edge}-`)
    );
    return entry?.content?.value ?? entry?.content?.operation?.cursor?.value;
}

// Legacy sorts a column by `receiveTime || id` (TwitterStatus.fromJSONObject in bundle.js). A
// conversation module carries the older tweets a reply answers. At their own ids those can sink
// below the page and become the column's bottom chirp, the one legacy turns into max_id for infinite
// scroll, after which every page below is discarded as "too new"; sorted up to the reply instead,
// they show old tweets out of order. So keep each module's newest tweet, and an older one only where
// the page itself reaches back that far and, for a poll, only past what the column already has.
function threadTweetsInRange(standalone, threads, since_id) {
    if (!threads.length) return [];
    const heads = threads.map(newestTweet);
    let floor;
    for (const tweet of [...standalone, ...heads]) {
        const id = BigInt(tweet.id_str);
        if (floor === undefined || id < floor) floor = id;
    }
    if (since_id && BigInt(since_id) >= floor) floor = BigInt(since_id) + 1n;
    const kept = [];
    threads.forEach((thread, i) => {
        for (const tweet of thread) {
            if (tweet === heads[i] || BigInt(tweet.id_str) >= floor) kept.push(tweet);
        }
    });
    return kept;
}

function newestTweet(thread) {
    return thread.reduce((a, b) => (compareIds(b.id_str, a.id_str) > 0 ? b : a));
}

function compareIds(a, b) {
    const x = BigInt(a), y = BigInt(b);
    return x < y ? -1 : x > y ? 1 : 0;
}

function sortNewestFirst(tweets) {
    return tweets.sort((a, b) => compareIds(b.id_str, a.id_str));
}

// true when `id` is new for this account's Home feed; the set stays bounded.
const SEEN_HOME_TWEET_LIMIT = 2000;
function rememberHomeTweet(user_id, id) {
    let seen = seenHomeTweets[user_id];
    if (!(seen instanceof Set)) seen = seenHomeTweets[user_id] = new Set();
    if (seen.has(id)) return false;
    seen.add(id);
    while (seen.size > SEEN_HOME_TWEET_LIMIT) {
        seen.delete(seen.values().next().value);
    }
    return true;
}

// A cursor-top poll only returns what X files above that cursor. Every so often poll the top of
// the timeline without a cursor instead, so a stale cursor (or anything X skipped) can't keep a
// column frozen; legacy drops the duplicates by id.
const TOP_RESYNC_INTERVAL = 10 * 60 * 1000;
const topFetches = {};

function topFetchDue(feedKey) {
    return Date.now() - (topFetches[feedKey] ?? 0) >= TOP_RESYNC_INTERVAL;
}

function noteTopFetch(feedKey) {
    topFetches[feedKey] = Date.now();
}

// Query id, features and variables are what x.com's Following tab sent on 2026-10-24 (HAR; the id
// had already changed once since 10-23). x.com sends them as POST; OTD keeps GET like every other
// route. The features object is the one x.com shares across its timeline queries in this deploy.
// These are the fallback: the GraphQL operations registry above replaces id and features with what
// x.com's current bundles declare.
const HOME_TIMELINE_FEATURES = {"rweb_video_screen_enabled":false,"rweb_cashtags_enabled":true,"profile_label_improvements_pcf_label_in_post_enabled":true,"responsive_web_profile_redirect_enabled":true,"rweb_tipjar_consumption_enabled":false,"verified_phone_label_enabled":false,"creator_subscriptions_tweet_preview_api_enabled":true,"responsive_web_graphql_timeline_navigation_enabled":true,"premium_content_api_read_enabled":false,"communities_web_enable_tweet_community_results_fetch":true,"c9s_tweet_anatomy_moderator_badge_enabled":true,"responsive_web_grok_analyze_button_fetch_trends_enabled":false,"responsive_web_grok_analyze_post_followups_enabled":true,"rweb_cashtags_composer_attachment_enabled":true,"responsive_web_jetfuel_frame":true,"rweb_sports_post_context_enabled":true,"responsive_web_grok_share_attachment_enabled":true,"responsive_web_grok_annotations_enabled":true,"articles_preview_enabled":true,"responsive_web_edit_tweet_api_enabled":true,"rweb_conversational_replies_downvote_enabled":false,"graphql_is_translatable_rweb_tweet_is_translatable_enabled":true,"view_counts_everywhere_api_enabled":true,"longform_notetweets_consumption_enabled":true,"responsive_web_twitter_article_tweet_consumption_enabled":true,"content_disclosure_indicator_enabled":true,"content_disclosure_ai_generated_indicator_enabled":true,"responsive_web_grok_show_grok_translated_post":true,"responsive_web_grok_analysis_button_from_backend":true,"post_ctas_fetch_enabled":false,"freedom_of_speech_not_reach_fetch_enabled":true,"standardized_nudges_misinfo":true,"tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled":true,"longform_notetweets_rich_text_read_enabled":true,"longform_notetweets_inline_media_enabled":false,"responsive_web_nested_quote_preview_enabled":true,"responsive_web_grok_image_annotation_enabled":true,"responsive_web_grok_imagine_annotation_enabled":true,"responsive_web_made_on_x_label_enabled":false,"responsive_web_grok_community_note_auto_translation_is_enabled":true,"responsive_web_enhance_cards_enabled":false};
function homeTimelineUrl(cursor) {
    const variables = { count: 40, includePromotedContent: true, enableRanking: false };
    if (cursor) variables.cursor = cursor;
    return `${NEW_API}/KQPfcqQJJqF6M0D77p3JKw/HomeLatestTimeline?${generateParams(HOME_TIMELINE_FEATURES, variables, { withPayments: false })}`;
}

const NOTIFICATIONS_ALL_URL = `https://${location.hostname}/i/api/2/notifications/all.json?include_profile_interstitial_type=1&include_blocking=1&include_blocked_by=1&include_followed_by=1&include_want_retweets=1&include_mute_edge=1&include_can_dm=1&include_can_media_tag=1&include_ext_has_nft_avatar=1&include_ext_is_blue_verified=1&include_ext_verified_type=1&include_ext_profile_image_shape=1&skip_status=1&cards_platform=Web-12&include_cards=1&include_ext_alt_text=true&include_ext_limited_action_results=true&include_quote_count=true&include_reply_count=1&tweet_mode=extended&include_ext_views=true&include_entities=true&include_user_entities=true&include_ext_media_color=true&include_ext_media_availability=true&include_ext_sensitive_media_warning=true&include_ext_trusted_friends_metadata=true&send_error_codes=true&simple_quoted_tweet=true&count=20&requestContext=launch&ext=mediaStats%2ChighlightedLabel%2ChasNftAvatar%2CvoiceInfo%2CbirdwatchPivot%2CsuperFollowMetadata%2CunmentionInfo%2CeditControl`;
// Notifications come from the GraphQL timeline x.com's own notifications page reads (query id and
// features as of 2026-10-24; the features are the set x.com shares across its timeline queries; the
// registry above keeps both current). all.json, the previous source, packs every earlier liker of a post into the newest like's
// notification (10 listed, "and 80 others"), so a poll delivered them all at once as new; the GraphQL
// page lists only the likers that arrived since. Its bucket is 1500 / 15 min, shared with x.com, where
// all.json had 180. `localStorage.OTDnotificationsSource = "all.json"` goes back to the old source.
const NOTIFICATIONS_TIMELINE_FEATURES = {"rweb_video_screen_enabled":false,"rweb_cashtags_enabled":true,"profile_label_improvements_pcf_label_in_post_enabled":true,"responsive_web_profile_redirect_enabled":true,"rweb_tipjar_consumption_enabled":false,"verified_phone_label_enabled":false,"creator_subscriptions_tweet_preview_api_enabled":true,"responsive_web_graphql_timeline_navigation_enabled":true,"premium_content_api_read_enabled":false,"communities_web_enable_tweet_community_results_fetch":true,"c9s_tweet_anatomy_moderator_badge_enabled":true,"responsive_web_grok_analyze_button_fetch_trends_enabled":false,"responsive_web_grok_analyze_post_followups_enabled":true,"rweb_cashtags_composer_attachment_enabled":true,"responsive_web_jetfuel_frame":true,"rweb_sports_post_context_enabled":true,"responsive_web_grok_share_attachment_enabled":true,"responsive_web_grok_annotations_enabled":true,"articles_preview_enabled":true,"responsive_web_edit_tweet_api_enabled":true,"rweb_conversational_replies_downvote_enabled":false,"graphql_is_translatable_rweb_tweet_is_translatable_enabled":true,"view_counts_everywhere_api_enabled":true,"longform_notetweets_consumption_enabled":true,"responsive_web_twitter_article_tweet_consumption_enabled":true,"content_disclosure_indicator_enabled":true,"content_disclosure_ai_generated_indicator_enabled":true,"responsive_web_grok_show_grok_translated_post":true,"responsive_web_grok_analysis_button_from_backend":true,"post_ctas_fetch_enabled":false,"freedom_of_speech_not_reach_fetch_enabled":true,"standardized_nudges_misinfo":true,"tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled":true,"longform_notetweets_rich_text_read_enabled":true,"longform_notetweets_inline_media_enabled":false,"responsive_web_nested_quote_preview_enabled":true,"responsive_web_grok_image_annotation_enabled":true,"responsive_web_grok_imagine_annotation_enabled":true,"responsive_web_made_on_x_label_enabled":false,"responsive_web_grok_community_note_auto_translation_is_enabled":true,"responsive_web_enhance_cards_enabled":false};
function notificationsUrl(cursor) {
    if (localStorage.OTDnotificationsSource === "all.json") {
        return `${NOTIFICATIONS_ALL_URL}${cursor ? `&cursor=${cursor}` : ""}`;
    }
    const variables = { timeline_type: "All", count: 20 };
    if (cursor) variables.cursor = cursor;
    return `${NEW_API}/MSIb-PAcnu9OBUe56f_DHQ/NotificationsTimeline?${generateParams(NOTIFICATIONS_TIMELINE_FEATURES, variables)}`;
}

// Which cursor a Notifications or Mentions request carries. Scrolling down takes the column's own
// bottom cursor. A poll for new entries takes the top cursor of the last page, as x.com's own
// polling does (a page with nothing new is a few hundred bytes, against the whole top page every
// seven seconds), and the whole top page is read again every TOP_RESYNC_INTERVAL in case an entry
// slipped past the cursor (the doubt of Phase 2-a was about all.json; GraphQL is what x.com polls
// this way). localStorage.OTDnotificationsTopCursor = "0" reads the whole page every time, as
// before; the all.json source always does.
function notificationsPollCursor(xhr, prefix) {
    const { user_id, since_id, max_id } = xhr.storage;
    if (!since_id && max_id) {
        const bottom = cursors[`${prefix}-${user_id}-bottom`];
        if (bottom) return bottom;
    }
    const feedKey = `notifications-top-${user_id}`;
    if (since_id && localStorage.OTDnotificationsTopCursor !== "0" && localStorage.OTDnotificationsSource !== "all.json" && !topFetchDue(feedKey)) {
        const top = cursors[`${prefix}-${user_id}-top`];
        if (top) {
            xhr.storage.topPoll = true;
            return top;
        }
    }
    noteTopFetch(feedKey);
    return undefined;
}

function notificationsTimeline(data) {
    return data?.data?.viewer_v2?.user_results?.result?.notification_timeline?.timeline || null;
}

// A 200 whose body is only a GraphQL error must fail the page (see graphqlPageInspector); an all.json
// body is fine as it is.
const notificationsPageInspector = graphqlPageInspector((data) => data?.globalObjects || notificationsTimeline(data));

// Both sources in the all.json shape the routes below read: `entries` whose items name a notification
// or a tweet by id, and `go` (globalObjects) holding v1.1 users, tweets and aggregate notifications.
// GraphQL users and tweets are converted on the way; a tweet that cannot be converted, or an author
// X withholds, drops its entry rather than failing the page.
function notificationsPage(text) {
    const response = JSON.parse(text);
    if (response.globalObjects) {
        return {
            entries: response.timeline.instructions.find((i) => i.addEntries).addEntries.entries,
            go: response.globalObjects,
        };
    }
    const instructions = notificationsTimeline(response)?.instructions || [];
    const go = { users: {}, tweets: {}, notifications: {} };
    const entries = [];
    const keepTweet = (result) => {
        const tweet = safeParseTweet(result);
        if (!tweet) return null;
        go.tweets[tweet.id_str] = tweet;
        if (tweet.user?.id_str && !go.users[tweet.user.id_str]) go.users[tweet.user.id_str] = tweet.user;
        return tweet;
    };
    for (const entry of instructions.find((i) => i.type === "TimelineAddEntries")?.entries || []) {
        if (!String(entry.entryId || "").startsWith("notification-")) {
            // Cursors keep their shape: findCursor reads content.value.
            entries.push(entry);
            continue;
        }
        const item = entry.content?.itemContent;
        const element = entry.content?.clientEventInfo?.element;
        const wrap = (content) => ({ entryId: entry.entryId, sortIndex: entry.sortIndex, content: { item: { clientEventInfo: { element }, content } } });
        if (item?.itemType === "TimelineTweet") {
            const tweet = keepTweet(item.tweet_results?.result);
            if (tweet) entries.push(wrap({ tweet: { id: tweet.id_str } }));
        } else if (item?.itemType === "TimelineNotification") {
            const template = item.template || {};
            const fromUsers = [];
            for (const ref of template.from_users || []) {
                const user = legacyUserFromGraph(ref?.user_results?.result);
                if (!user) continue;
                if (!go.users[user.id_str]) go.users[user.id_str] = user;
                fromUsers.push({ user: { id: user.id_str } });
            }
            const targetObjects = [];
            for (const ref of template.target_objects || []) {
                const tweet = keepTweet(ref?.tweet_results?.result);
                if (tweet) targetObjects.push({ tweet: { id: tweet.id_str } });
            }
            const time = Date.parse(item.timestamp_ms);
            go.notifications[item.id] = {
                id: item.id,
                timestampMs: String(Number.isFinite(time) ? time : +entry.sortIndex),
                message: { text: item.rich_message?.text || "" },
                template: { aggregateUserActionsV1: { fromUsers, targetObjects } },
            };
            entries.push(wrap({ notification: { id: item.id } }));
        }
    }
    return { entries, go };
}

// A since poll re-reads the top of the notifications timeline with no cursor. cursor-top is suspected of
// omitting unread notifications (#507, #487), and one page is 20 items. The bottom cursor
// on that top page is not the column's scroll position; storing it would make the next
// max_id request refetch the first page until legacy treats the feed as exhausted.
function storeNotificationCursors(entries, storage, prefix) {
    const top = findCursor(entries, "top");
    if (top) cursors[`${prefix}-${storage.user_id}-top`] = top;
    if (storage.since_id) return;
    const bottom = findCursor(entries, "bottom");
    if (bottom) cursors[`${prefix}-${storage.user_id}-bottom`] = bottom;
}

// The Notifications and Mentions columns both read the top of the same timeline, each on its own legacy
// timer. The timers neither started together nor shared a period (see POLL_FLOORS), so the same
// mention reached one column well after the other, and both fetched the same page. Now a top-page
// request that goes out also answers every top-page request of that account made while it is in
// flight or shortly after, and when it lands the other column type polls at once.
const SHARED_TOP_PAGE_TTL = 5 * 1000;
const sharedTopPages = {};

function notificationsResponseText(xhr) {
    return xhr.storage.sharedTopPage ?? xhr.responseText;
}

function answerWithTopPage(xhr, text) {
    xhr.storage.sharedTopPage = text;
    emulateResponse(xhr);
}

function sendNotificationsTopPage(xhr, data, otherFeedType) {
    const user_id = xhr.storage.user_id;
    const shared = sharedTopPages[user_id];
    if (shared && shared.waiting) {
        shared.waiting.push({ xhr, data });
        return;
    }
    if (shared && Date.now() - shared.time < SHARED_TOP_PAGE_TTL) {
        answerWithTopPage(xhr, shared.text);
        return;
    }
    const page = { waiting: [] };
    sharedTopPages[user_id] = page;
    xhr.addEventListener("loadend", () => {
        const waiting = page.waiting;
        page.waiting = null;
        // Answering a request runs legacy's handlers, and one that throws must not strand the rest.
        const settle = (answer) => {
            for (const other of waiting) {
                try {
                    answer(other);
                } catch (e) {
                    console.error(e);
                }
            }
        };
        if (xhr.status !== 200) {
            // Nothing to share. The others ask X themselves, as they would have without this.
            if (sharedTopPages[user_id] === page) delete sharedTopPages[user_id];
            settle((other) => other.xhr.send(other.data));
            return;
        }
        page.time = Date.now();
        page.text = xhr.responseText;
        settle((other) => answerWithTopPage(other.xhr, page.text));
        pollNotificationFeedsNow(user_id, otherFeedType);
    });
    xhr.send(data);
}

// Legacy's feed scheduler keeps one periodic task per account and feed type. Running it now hands
// that column the page that just arrived, and restarting its timer keeps it in step with this one
// instead of fetching again on its own a few seconds later.
function pollNotificationFeedsNow(user_id, feedType) {
    try {
        const task = TD.controller.feedScheduler._getTask(`twitter:${user_id}`, feedType);
        if (!task || !task.taskId || !task.doTask) return;
        TD.controller.scheduler.restartPeriodicTask(task.taskId);
        task.doTask({});
    } catch (e) {
        // TD not ready or its internals changed: that column keeps polling on its own timer.
    }
}

// Legacy marks a feed as exhausted below a page when a request returns fewer than ten chirps
// (FeedPoller.EXHAUSTED_API_THRESHOLD in bundle.js) and never asks for older ones again. REST
// pages were a steady 40, but ours are a GraphQL page minus promoted, muted and unparsable
// entries, so a short page is normal: only an empty one should end infinite scroll. And an empty
// first page (X over capacity) used to pin the feed as exhausted for good; lift that on refresh.
let legacyFeedPollerPatched = false;
function relaxLegacyExhaustion() {
    if (legacyFeedPollerPatched) return;
    try {
        const Original = TD.controller.FeedPoller;
        if (typeof Original !== "function") return;
        const Patched = function (feed) {
            Original.call(this, feed);
            this.EXHAUSTED_API_THRESHOLD = 1;
            const refresh = this.refresh;
            this.refresh = function () {
                const possible = this.intervalOfPossibility;
                if (possible && possible.constructor && possible.constructor.whole) {
                    this.intervalOfPossibility = possible.constructor.whole;
                }
                return refresh.apply(this, arguments);
            };
        };
        Patched.prototype = Original.prototype;
        Object.assign(Patched, Original);
        TD.controller.FeedPoller = Patched;
        legacyFeedPollerPatched = true;
    } catch (e) {
        // TD isn't loaded yet; the next state load tries again.
    }
}

// Legacy's feed scheduler polls each feed type no faster than a floor (in seconds), and stretches
// that to fit the rate limit X reports. Its scheduler ticks once a second, so a column polls every
// floor to floor + 1 seconds. Home and notifications come first and bookmarks last:
// - Home keeps legacy's own 4 s, now that its polls are no longer dropped at random.
// - Notifications polled every 15 s whatever the rate limit: legacy asks for about_me.json without
//   a feed type, so it never reads the headers, and the faster_notifications decider caps its 45 s
//   default at 15 s. Giving it its feed type lets the floor below apply. With the headers read, all
//   the cap still did was keep polling every 15 s once the rate limit ran out, so the /decider route
//   turns it off. Mentions reads the same all.json page and gets the same floor, so neither column
//   trails the other.
// - Bookmarks waits at least a minute.
// localStorage can override each floor, in seconds.
const POLL_FLOORS = {
    home: ["OTDhomeRefreshSeconds", 4],
    interactions: ["OTDnotificationsRefreshSeconds", 7],
    mentions: ["OTDnotificationsRefreshSeconds", 7],
    bookmarks: ["OTDbookmarksRefreshSeconds", 60],
};

let legacyPollingTuned = false;
function tuneLegacyPolling() {
    if (legacyPollingTuned) return;
    try {
        const floors = TD.controller.feedScheduler.FEED_TYPE_TO_MINIMUM_REFRESH_PERIOD;
        const client = TD.services.TwitterClient.prototype;
        if (!floors || typeof client.getActivityTimeline !== "function") return;
        for (const [feedType, [key, fallback]] of Object.entries(POLL_FLOORS)) {
            const stored = parseFloat(localStorage[key]);
            floors[feedType] = stored > 0 ? stored : fallback;
        }
        const getActivityTimeline = client.getActivityTimeline;
        client.getActivityTimeline = function (path, since, max, count, success, error, params, feedType) {
            if (path === "activity/about_me.json" && !feedType) feedType = "interactions";
            return getActivityTimeline.call(this, path, since, max, count, success, error, params, feedType);
        };
        legacyPollingTuned = true;
    } catch (e) {
        // TD isn't loaded yet; the next state load tries again.
    }
}

// Legacy closes every desktop notification five seconds after it shows (TD.controller.notifications
// in bundle.js). On Windows that takes it off the screen and out of the Action Center, whatever
// the system's display time is (#381, #338). Its onshow handler does nothing else, so ignore it
// and leave the notification to the OS. bundle.js reads window.Notification when it loads, after
// this file.
if (typeof Notification === "function") {
    const NativeNotification = Notification;
    Notification = class extends NativeNotification {
        static get permission() {
            return NativeNotification.permission;
        }
        static requestPermission(...args) {
            return NativeNotification.requestPermission(...args);
        }
        get onshow() {
            return null;
        }
        set onshow(handler) {}
    };
}

function getCurrentUserId() {
    let accounts = TD.storage.accountController.getAll();
    let screen_name = TD.storage.accountController.getUserIdentifier();
    let account = accounts.find((account) => account.state.username === screen_name);
    return account?.state?.userId ?? verifiedUser?.id_str ?? localStorage.twitterAccountID;
}

function generateParams(features, variables, fieldToggles) {
    let params = new URLSearchParams();
    params.append("variables", JSON.stringify(variables));
    params.append("features", JSON.stringify(features));
    if (fieldToggles) params.append("fieldToggles", JSON.stringify(fieldToggles));

    return params.toString();
}

// ---- GraphQL operations: query ids and features from x.com's own bundles ----------------------
// X retires GraphQL query ids without notice (HomeLatestTimeline changed on 2026-10-23 and again on
// 2026-10-24) and adds `features` keys that fail a request when missing. x.com's bundles declare
// every operation as
//   {queryId:"…",operationName:"…",operationType:"query",metadata:{featureSwitches:[…],fieldToggles:[…]}}
// where featureSwitches is exactly the key set x.com sends as `features` (checked on 13 operations in
// HARs), and the logged-in page HTML names the bundles (the main.<hash>.js script tag and the webpack
// chunk name / hash maps) and carries the user's switch values
// (window.__INITIAL_STATE__.featureSwitch.user.config; a key missing there is sent as false).
// At startup the page is fetched; when main.js changed since the last run, main.js and the chunks
// that hold the operations below are fetched, and { id, features, chunk } per operation plus the
// switch values are kept in localStorage. Every GraphQL request a route builds then gets x.com's
// query id, and its `features` rebuilt from the declared keys, on the way out (applyGraphqlRegistryUrl
// and applyGraphqlRegistryBody in the XHR Proxy's send). The hard-coded ids and features in the routes
// stay as the fallback: an operation nothing declared goes out unchanged. fieldToggles stay the
// route's own (x.com sends fewer than it declares). A 400 or 404 on a known operation forces a
// re-read, at most once per 10 minutes.
// localStorage.OTDgraphqlRegistry: "off" leaves every request alone, "ids" swaps only the query id.
const GRAPHQL_REGISTRY_KEY = "OTDgraphqlOperations";
// Operation -> fragments of chunk names to try, in order, when main.js does not declare it. On
// 2026-10-24 main.js held 13 of these; HomeLatestTimeline sat in
// shared~bundle.Compose~bundle.HomeTimeline~bundle.LoggedInMain (29 KB), NotificationsTimeline in
// bundle.Notifications (137 KB), the List operations in a shared~JetfuelWrapper~bundle.AudioSpaceDetail~…
// chunk (179 KB) whose name says nothing about lists, Bookmarks in a 755 KB
// shared~bundle.Birdwatch~bundle.Compose~bundle.Display~… chunk. The chunk an operation was last
// found in is tried first.
const GRAPHQL_OPERATIONS = {
    HomeLatestTimeline: ["HomeTimeline"],
    NotificationsTimeline: ["bundle.Notifications", "Notifications"],
    CreateTweet: [],
    CreateRetweet: [],
    DeleteRetweet: [],
    DeleteTweet: [],
    FavoriteTweet: [],
    UnfavoriteTweet: [],
    TweetDetail: [],
    SearchTimeline: [],
    Likes: [],
    UserTweetsAndReplies: [],
    UserByRestId: [],
    UserByScreenName: [],
    UsersByRestIds: [],
    ListLatestTweetsTimeline: ["JetfuelWrapper~bundle.AudioSpaceDetail", "JetfuelWrapper"],
    ListMembers: ["JetfuelWrapper~bundle.AudioSpaceDetail", "JetfuelWrapper"],
    ListAddMember: ["JetfuelWrapper~bundle.AudioSpaceDetail", "JetfuelWrapper"],
    ListRemoveMember: ["JetfuelWrapper~bundle.AudioSpaceDetail", "JetfuelWrapper"],
    Bookmarks: ["bundle.Birdwatch~bundle.Compose~bundle.Display", "bundle.Bookmarks"],
    // what stands in for lists/ownerships, lists/subscriptions, blocks/ids and mutes/users/ids
    CombinedLists: ["JetfuelWrapper~bundle.AudioSpaceDetail", "JetfuelWrapper"],
    BlockedAccountsAll: [],
    MutedAccounts: [],
    // Better TweetDeck's reply restriction (see the route for it)
    ConversationControlChange: [],
};
// One read fetches at most this many chunks / bytes besides main.js, and tries at most
// `perOperation` chunks for one operation. An operation still missing keeps its saved entry, if any,
// else the route's id.
const GRAPHQL_DISCOVERY_BUDGET = { chunks: 12, bytes: 4e6, perOperation: 4 };
// A saved table missing an operation is read again this often even when main.js is unchanged.
const GRAPHQL_INCOMPLETE_RETRY = 24 * 60 * 60 * 1000;
const GRAPHQL_REFRESH_INTERVAL = 10 * 60 * 1000;
// GraphQL requests in the first seconds after startup wait for the first read: briefly when a
// saved table stands in meanwhile, longer on a first run, when only the built-in copy below does.
const GRAPHQL_STARTUP_WAIT = { within: 15000, atMost: 4000, firstRun: 10000 };
const GRAPHQL_DECLARATION = /queryId:"([\w-]{22})",operationName:"(\w+)",operationType:"(?:query|mutation)",metadata:\{featureSwitches:\[([^\]]*)\]/g;
// x.com's declarations as last copied into this file: the table until the first read succeeds,
// and for good when none does (a first run that cannot reach abs.twimg.com, or a change in the
// declaration format above). Ids churn: between the 2026-10-23 and 2026-10-24 deploys 10 of the
// first 20 changed, and the routes' own ids and features below are older still. The console says when
// this copy is behind x.com; `node tools/graphql-builtin.mjs <saved table>` prints a fresh one.
const GRAPHQL_BUILTIN_KEYS = {
    homeLatestTimeline: ["rweb_video_screen_enabled","rweb_cashtags_enabled","profile_label_improvements_pcf_label_in_post_enabled","responsive_web_profile_redirect_enabled","rweb_tipjar_consumption_enabled","verified_phone_label_enabled","creator_subscriptions_tweet_preview_api_enabled","responsive_web_graphql_timeline_navigation_enabled","premium_content_api_read_enabled","communities_web_enable_tweet_community_results_fetch","c9s_tweet_anatomy_moderator_badge_enabled","responsive_web_grok_analyze_button_fetch_trends_enabled","responsive_web_grok_analyze_post_followups_enabled","rweb_cashtags_composer_attachment_enabled","responsive_web_jetfuel_frame","rweb_sports_post_context_enabled","responsive_web_grok_share_attachment_enabled","responsive_web_grok_annotations_enabled","articles_preview_enabled","responsive_web_edit_tweet_api_enabled","rweb_conversational_replies_downvote_enabled","graphql_is_translatable_rweb_tweet_is_translatable_enabled","view_counts_everywhere_api_enabled","longform_notetweets_consumption_enabled","responsive_web_twitter_article_tweet_consumption_enabled","content_disclosure_indicator_enabled","content_disclosure_ai_generated_indicator_enabled","responsive_web_grok_show_grok_translated_post","responsive_web_grok_analysis_button_from_backend","post_ctas_fetch_enabled","freedom_of_speech_not_reach_fetch_enabled","standardized_nudges_misinfo","tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled","longform_notetweets_rich_text_read_enabled","longform_notetweets_inline_media_enabled","responsive_web_nested_quote_preview_enabled","responsive_web_grok_image_annotation_enabled","responsive_web_grok_imagine_annotation_enabled","responsive_web_made_on_x_label_enabled","responsive_web_grok_community_note_auto_translation_is_enabled","responsive_web_enhance_cards_enabled"],
    createTweet: ["premium_content_api_read_enabled","communities_web_enable_tweet_community_results_fetch","c9s_tweet_anatomy_moderator_badge_enabled","responsive_web_grok_analyze_button_fetch_trends_enabled","responsive_web_grok_analyze_post_followups_enabled","rweb_cashtags_composer_attachment_enabled","responsive_web_jetfuel_frame","rweb_sports_post_context_enabled","responsive_web_grok_share_attachment_enabled","responsive_web_grok_annotations_enabled","responsive_web_edit_tweet_api_enabled","rweb_conversational_replies_downvote_enabled","graphql_is_translatable_rweb_tweet_is_translatable_enabled","view_counts_everywhere_api_enabled","longform_notetweets_consumption_enabled","responsive_web_twitter_article_tweet_consumption_enabled","content_disclosure_indicator_enabled","content_disclosure_ai_generated_indicator_enabled","responsive_web_grok_show_grok_translated_post","responsive_web_grok_analysis_button_from_backend","post_ctas_fetch_enabled","longform_notetweets_rich_text_read_enabled","longform_notetweets_inline_media_enabled","profile_label_improvements_pcf_label_in_post_enabled","responsive_web_profile_redirect_enabled","rweb_tipjar_consumption_enabled","verified_phone_label_enabled","responsive_web_nested_quote_preview_enabled","articles_preview_enabled","rweb_cashtags_enabled","responsive_web_grok_community_note_auto_translation_is_enabled","freedom_of_speech_not_reach_fetch_enabled","standardized_nudges_misinfo","tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled","responsive_web_grok_image_annotation_enabled","responsive_web_grok_imagine_annotation_enabled","responsive_web_made_on_x_label_enabled","responsive_web_graphql_timeline_navigation_enabled"],
    userByRestId: ["hidden_profile_subscriptions_enabled","profile_label_improvements_pcf_label_in_post_enabled","responsive_web_profile_redirect_enabled","rweb_tipjar_consumption_enabled","verified_phone_label_enabled","highlights_tweets_tab_ui_enabled","responsive_web_twitter_article_notes_tab_enabled","subscriptions_feature_can_gift_premium","creator_subscriptions_tweet_preview_api_enabled","responsive_web_graphql_timeline_navigation_enabled"],
    userByScreenName: ["hidden_profile_subscriptions_enabled","profile_label_improvements_pcf_label_in_post_enabled","responsive_web_profile_redirect_enabled","rweb_tipjar_consumption_enabled","verified_phone_label_enabled","subscriptions_verification_info_is_identity_verified_enabled","subscriptions_verification_info_verified_since_enabled","highlights_tweets_tab_ui_enabled","responsive_web_twitter_article_notes_tab_enabled","subscriptions_feature_can_gift_premium","creator_subscriptions_tweet_preview_api_enabled","responsive_web_graphql_timeline_navigation_enabled"],
    usersByRestIds: ["profile_label_improvements_pcf_label_in_post_enabled","responsive_web_profile_redirect_enabled","rweb_tipjar_consumption_enabled","verified_phone_label_enabled","responsive_web_graphql_timeline_navigation_enabled"],
};
const GRAPHQL_BUILTIN = {
    date: "2026-10-25",
    main: "https://abs.twimg.com/responsive-web/client-web/main.a8ff362f9b84a869a.js",
    ops: {
        HomeLatestTimeline: { id: "KQPfcqQJJqF6M0D77p3JKw", features: "homeLatestTimeline", chunk: "shared~bundle.Compose~bundle.HomeTimeline~bundle.LoggedInMain" },
        NotificationsTimeline: { id: "MSIb-PAcnu9OBUe56f_DHQ", features: "homeLatestTimeline", chunk: "bundle.Notifications" },
        CreateTweet: { id: "5CVj-J0FZWyGgJpcjeBJEA", features: "createTweet", chunk: "main" },
        CreateRetweet: { id: "mbRO74GrOvSfRcJnlMapnQ", features: [], chunk: "main" },
        DeleteRetweet: { id: "ZyZigVsNiFO6v1dEks1eWg", features: [], chunk: "main" },
        DeleteTweet: { id: "nxpZCY2K-I6QoFHAHeojFQ", features: [], chunk: "main" },
        FavoriteTweet: { id: "lI07N6Otwv1PhnEgXILM7A", features: [], chunk: "main" },
        UnfavoriteTweet: { id: "ZYKSe-w7KEslx3JhSIk5LA", features: [], chunk: "main" },
        TweetDetail: { id: "gJoREC4Bspo4kJ0ax9C3sQ", features: "homeLatestTimeline", chunk: "main" },
        SearchTimeline: { id: "f7SuGIm11eLbQs7c0K9X9w", features: "homeLatestTimeline", chunk: "main" },
        Likes: { id: "mzOgReEsktOIIXzWkqf0ig", features: "homeLatestTimeline", chunk: "main" },
        UserTweetsAndReplies: { id: "MbxTcSWPt8RWRFMwenOtyQ", features: "homeLatestTimeline", chunk: "main" },
        UserByRestId: { id: "mxaYWwt52eAb6OAzYHMVzg", features: "userByRestId", chunk: "main" },
        UserByScreenName: { id: "AMIBMjtxEEATh4z8V9GtRg", features: "userByScreenName", chunk: "main" },
        UsersByRestIds: { id: "ubfbnAM4qTlMTOYleYhXSg", features: "usersByRestIds", chunk: "main" },
        ListLatestTweetsTimeline: { id: "uV0pbd0DrW8hTbMrtZ1SYQ", features: "homeLatestTimeline", chunk: "shared~JetfuelWrapper~bundle.AudioSpaceDetail~bundle.AudioSpaceDiscovery~bundle.AudioSpacebarScreen~bundle.Bi" },
        ListMembers: { id: "fFCNliJG5Gq4yEnINo6-1A", features: "homeLatestTimeline", chunk: "shared~JetfuelWrapper~bundle.AudioSpaceDetail~bundle.AudioSpaceDiscovery~bundle.AudioSpacebarScreen~bundle.Bi" },
        ListAddMember: { id: "-Kf1YVC1rNKkPvPFk7YXZw", features: "usersByRestIds", chunk: "shared~JetfuelWrapper~bundle.AudioSpaceDetail~bundle.AudioSpaceDiscovery~bundle.AudioSpacebarScreen~bundle.Bi" },
        ListRemoveMember: { id: "_2o1-wSMWGFSi5HUscn1Hw", features: "usersByRestIds", chunk: "shared~JetfuelWrapper~bundle.AudioSpaceDetail~bundle.AudioSpaceDiscovery~bundle.AudioSpacebarScreen~bundle.Bi" },
        Bookmarks: { id: "zFGFGLIm1akEv8PE3uut8w", features: "homeLatestTimeline", chunk: "shared~bundle.Birdwatch~bundle.Compose~bundle.Display~bundle.Grok~bundle.GrokDrawer~bundle.News~bundle.Ocf~bu" },
        CombinedLists: { id: "60iDk55u-rTx1qB8KQMZKw", features: "homeLatestTimeline", chunk: "shared~JetfuelWrapper~bundle.AudioSpaceDetail~bundle.AudioSpaceDiscovery~bundle.AudioSpacebarScreen~bundle.Bi" },
        BlockedAccountsAll: { id: "jNDoO-7f4EPnrF3PvSy2XQ", features: "homeLatestTimeline", chunk: "main" },
        MutedAccounts: { id: "Sc8HpW2C7W_mOM0rvJJNhg", features: "homeLatestTimeline", chunk: "main" },
        ConversationControlChange: { id: "JWeo7tCAhI_HwcuPcL4JrQ", features: [], chunk: "main" },
    },
    values: {"articles_preview_enabled":true,"c9s_tweet_anatomy_moderator_badge_enabled":true,"communities_web_enable_tweet_community_results_fetch":true,"content_disclosure_ai_generated_indicator_enabled":true,"content_disclosure_indicator_enabled":true,"creator_subscriptions_tweet_preview_api_enabled":true,"freedom_of_speech_not_reach_fetch_enabled":true,"graphql_is_translatable_rweb_tweet_is_translatable_enabled":true,"hidden_profile_subscriptions_enabled":true,"highlights_tweets_tab_ui_enabled":true,"longform_notetweets_consumption_enabled":true,"longform_notetweets_inline_media_enabled":false,"longform_notetweets_rich_text_read_enabled":true,"post_ctas_fetch_enabled":false,"premium_content_api_read_enabled":false,"profile_label_improvements_pcf_label_in_post_enabled":true,"responsive_web_edit_tweet_api_enabled":true,"responsive_web_enhance_cards_enabled":false,"responsive_web_graphql_timeline_navigation_enabled":true,"responsive_web_grok_analysis_button_from_backend":true,"responsive_web_grok_analyze_button_fetch_trends_enabled":false,"responsive_web_grok_analyze_post_followups_enabled":true,"responsive_web_grok_annotations_enabled":true,"responsive_web_grok_community_note_auto_translation_is_enabled":true,"responsive_web_grok_image_annotation_enabled":true,"responsive_web_grok_imagine_annotation_enabled":true,"responsive_web_grok_share_attachment_enabled":true,"responsive_web_grok_show_grok_translated_post":true,"responsive_web_jetfuel_frame":true,"responsive_web_made_on_x_label_enabled":false,"responsive_web_nested_quote_preview_enabled":true,"responsive_web_profile_redirect_enabled":true,"responsive_web_twitter_article_notes_tab_enabled":true,"responsive_web_twitter_article_tweet_consumption_enabled":true,"rweb_cashtags_composer_attachment_enabled":true,"rweb_cashtags_enabled":true,"rweb_conversational_replies_downvote_enabled":false,"rweb_sports_post_context_enabled":true,"rweb_tipjar_consumption_enabled":false,"rweb_video_screen_enabled":false,"standardized_nudges_misinfo":true,"subscriptions_feature_can_gift_premium":false,"subscriptions_verification_info_is_identity_verified_enabled":true,"subscriptions_verification_info_verified_since_enabled":true,"tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled":true,"verified_phone_label_enabled":false,"view_counts_everywhere_api_enabled":true},
};

function builtinGraphqlTable() {
    const ops = {};
    for (const [name, op] of Object.entries(GRAPHQL_BUILTIN.ops)) {
        const features = typeof op.features === "string" ? GRAPHQL_BUILTIN_KEYS[op.features] : op.features;
        ops[name] = { id: op.id, features: [...(features || [])], chunk: op.chunk };
    }
    return { main: GRAPHQL_BUILTIN.main, fetchedAt: 0, builtin: true, ops, values: { ...GRAPHQL_BUILTIN.values } };
}

const savedGraphqlTable = validGraphqlTable(readStoredJSON(GRAPHQL_REGISTRY_KEY));
const graphqlRegistry = {
    table: savedGraphqlTable ?? builtinGraphqlTable(),
    hadSaved: !!savedGraphqlTable, // a first run has only the built-in table, and waits longer for the read
    pending: null, // the read in flight
    lastRefresh: 0, // when a 400 / 404 last forced one
    lastError: null, // why the last read failed, or fell short; for the notices
    noted: new Set(), // differences to the routes' values already logged this session
};

function validGraphqlTable(table) {
    const object = (v) => v && typeof v === "object";
    return object(table) && typeof table.main === "string" && object(table.ops) && object(table.values) ? table : null;
}

function graphqlRegistryMode() {
    return localStorage.OTDgraphqlRegistry;
}

// The logged-in x.com page. challenge.js reads the same page; whichever asks first fetches it.
function homepageHtml(fresh) {
    const shared = typeof window === "object" && window ? window : globalThis;
    if (fresh) delete shared.OTDhomepage;
    if (!shared.OTDhomepage) {
        shared.OTDhomepage = fetch(`https://${location.hostname}/`).then((res) => res.text());
        shared.OTDhomepage.catch(() => {
            delete shared.OTDhomepage;
        });
    }
    return shared.OTDhomepage;
}

async function fetchText(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return res.text();
}

// The webpack runtime in the page maps chunk numbers to names and to hashes:
//   ({346:"bundle.X",…})[e]||e)+"."+({346:"1c7c3aca047cef3f",…})[e]+"a.js"
function chunkUrlsFromHtml(html) {
    const names = [];
    const hashes = new Map();
    for (const m of html.matchAll(/(\d+):"([^"\\]+)"/g)) {
        if (/^[0-9a-f]{16}$/.test(m[2])) {
            if (!hashes.has(m[1])) hashes.set(m[1], m[2]);
        } else {
            names.push(m);
        }
    }
    const urls = {};
    for (const [, num, name] of names) {
        const hash = hashes.get(num);
        if (hash && !urls[name]) urls[name] = `https://abs.twimg.com/responsive-web/client-web/${name}.${hash}a.js`;
    }
    return urls;
}

function declaredOperations(source, wanted) {
    const found = {};
    for (const m of source.matchAll(GRAPHQL_DECLARATION)) {
        const [, id, name, switches] = m;
        if (!wanted.has(name) || found[name]) continue;
        try {
            found[name] = { id, features: switches ? JSON.parse(`[${switches}]`) : [] };
        } catch (e) {
            // not the shape we know; another chunk, or the route's fallback, serves this operation
        }
    }
    return found;
}

function featureValuesFromHtml(html, keys) {
    let config;
    try {
        config = extractAssignedJSON(html, "window.__INITIAL_STATE__")?.featureSwitch?.user?.config;
    } catch (e) {
        console.warn("OldTweetDeck: could not read x.com's feature switches", e);
        return null;
    }
    if (!config || typeof config !== "object") return null;
    const values = {};
    for (const key of keys) {
        const value = config[key]?.value;
        if (typeof value === "boolean") values[key] = value;
    }
    return values;
}

function graphqlChunkCandidates(op, chunkNames, remembered) {
    const ordered = [];
    if (remembered && remembered !== "main" && chunkNames.includes(remembered)) ordered.push(remembered);
    for (const hint of GRAPHQL_OPERATIONS[op] || []) {
        const matching = chunkNames.filter((name) => name.includes(hint)).sort((a, b) => a.length - b.length);
        for (const name of matching) if (!ordered.includes(name)) ordered.push(name);
    }
    return ordered;
}

async function discoverGraphqlOperations({ force = false } = {}) {
    const html = await homepageHtml(force);
    const main = html.match(/https:\/\/abs\.twimg\.com\/responsive-web\/client-web\/main\.\w+\.js/)?.[0];
    if (!main) throw new Error("the x.com page names no main.js");
    const saved = graphqlRegistry.table;
    const wanted = new Set(Object.keys(GRAPHQL_OPERATIONS));
    const incomplete = saved && [...wanted].some((op) => !saved.ops[op]) && Date.now() - (saved.fetchedAt || 0) > GRAPHQL_INCOMPLETE_RETRY;
    let ops;
    let declared;
    if (saved && saved.main === main && !force && !incomplete) {
        ops = saved.ops;
    } else {
        ops = {};
        const chunkUrls = chunkUrlsFromHtml(html);
        const chunkNames = Object.keys(chunkUrls);
        for (const [name, decl] of Object.entries(declaredOperations(await fetchText(main), wanted))) {
            ops[name] = { ...decl, chunk: "main" };
        }
        const budget = { ...GRAPHQL_DISCOVERY_BUDGET };
        const fetched = new Set();
        for (const op of wanted) {
            if (ops[op]) continue;
            let tries = 0;
            for (const chunk of graphqlChunkCandidates(op, chunkNames, saved?.ops?.[op]?.chunk)) {
                if (ops[op] || tries >= budget.perOperation || budget.chunks <= 0 || budget.bytes <= 0) break;
                if (fetched.has(chunk)) continue;
                fetched.add(chunk);
                tries++;
                budget.chunks--;
                let text;
                try {
                    text = await fetchText(chunkUrls[chunk]);
                } catch (e) {
                    console.warn(`OldTweetDeck: could not read x.com's ${chunk}`, e);
                    continue;
                }
                budget.bytes -= text.length;
                // every wanted operation this chunk declares counts, not only the one looked for
                for (const [name, decl] of Object.entries(declaredOperations(text, wanted))) {
                    if (!ops[name]) ops[name] = { ...decl, chunk };
                }
            }
        }
        declared = Object.keys(ops).length;
        // what was not found keeps its last entry, which is at least as new as the route's
        for (const op of wanted) if (!ops[op] && saved?.ops?.[op]) ops[op] = saved.ops[op];
    }
    // An operation this file learned after the saved table was written (the saved table is kept
    // as it is otherwise) takes the built-in entry until the next full read declares it.
    const builtin = builtinGraphqlTable();
    for (const op of wanted) if (!ops[op] && builtin.ops[op]) ops = { ...ops, [op]: builtin.ops[op] };
    const keys = new Set();
    for (const op of Object.values(ops)) for (const key of op.features || []) keys.add(key);
    const values = featureValuesFromHtml(html, keys) ?? saved?.values ?? {};
    const table = { main, fetchedAt: Date.now(), ops, values };
    if (declared !== undefined) table.declared = declared; // by this read; absent when only the page was read
    graphqlRegistry.table = table;
    try {
        localStorage[GRAPHQL_REGISTRY_KEY] = JSON.stringify(table);
    } catch (e) {
        console.warn("OldTweetDeck: could not save the GraphQL operations", e);
    }
    return table;
}

function startGraphqlDiscovery(reason, options) {
    if (graphqlRegistryMode() === "off" || typeof fetch !== "function") return null;
    if (graphqlRegistry.pending) return graphqlRegistry.pending;
    graphqlRegistry.pending = discoverGraphqlOperations(options).then(
        (table) => {
            graphqlRegistry.pending = null;
            const total = Object.keys(GRAPHQL_OPERATIONS).length;
            const known = Object.keys(GRAPHQL_OPERATIONS).filter((op) => table.ops[op]).length;
            const declared = table.declared === undefined ? "" : `, ${table.declared} declared by this deploy`;
            console.log(`OldTweetDeck: GraphQL operations read ${reason}: ${known} of ${total} known${declared}, ${table.main.split("/").pop()}`);
            // A deploy whose bundles declare few of them means the format changed, or the chunks
            // moved: the table is as new as the saved one at best, and goes stale with the next deploy.
            if (table.declared !== undefined && table.declared < total / 2) {
                graphqlRegistry.lastError = `only ${table.declared} of ${total} operations were found in x.com's bundles`;
                noteRegistryProblem(graphqlRegistry.lastError);
            } else {
                graphqlRegistry.lastError = null;
            }
            const behind = Object.keys(GRAPHQL_BUILTIN.ops).filter((op) => table.ops[op] && table.ops[op].id !== GRAPHQL_BUILTIN.ops[op].id);
            if (behind.length) noteGraphqlDifference("builtin", `the built-in GraphQL table (${GRAPHQL_BUILTIN.date}) is behind x.com for ${behind.join(", ")}`);
            return table;
        },
        (e) => {
            graphqlRegistry.pending = null;
            graphqlRegistry.lastError = e?.message || String(e);
            const using = graphqlRegistry.table?.builtin ? `the built-in table (${GRAPHQL_BUILTIN.date})` : "the saved table";
            console.warn(`OldTweetDeck: could not read x.com's GraphQL operations ${reason}; using ${using}`, e);
            if (graphqlRegistry.table?.builtin) noteRegistryProblem(graphqlRegistry.lastError);
            return graphqlRegistry.table;
        }
    );
    return graphqlRegistry.pending;
}

// Said once per session, once legacy is up. The built-in table is all a fresh install has, and
// it goes stale within days; a saved table that a new deploy could not be read into, likewise.
let registryProblemNoted = false;
function noteRegistryProblem(detail) {
    if (registryProblemNoted) return;
    registryProblemNoted = true;
    const using = graphqlRegistry.table?.builtin ? `its built-in copy from ${GRAPHQL_BUILTIN.date}` : "the copy it saved earlier";
    toastWhenReady(`OldTweetDeck could not read x.com's current API settings (${detail}) and is using ${using}. `
        + "If columns stop loading, reload TweetDeck; if that does not help, OldTweetDeck needs an update.");
}

// Why a request with a known operation was rejected, as far as this file can tell.
function queryIdFailureDetail(op) {
    if (graphqlRegistry.lastError) return `OldTweetDeck could not read x.com's current settings: ${graphqlRegistry.lastError}`;
    const known = graphqlRegistry.table?.ops?.[op.name];
    if (known && known.id !== op.id) return "a newer query id was read since, and the next request uses it";
    if (graphqlRegistry.table?.builtin) return `the id came from OldTweetDeck's built-in copy of ${GRAPHQL_BUILTIN.date}`;
    return "the id is the one x.com's own bundle names";
}

function graphqlOperationOf(url) {
    const m = /\/i\/api\/graphql\/([\w-]+)\/(\w+)(?=[/?#]|$)/.exec(String(url || ""));
    return m ? { id: m[1], name: m[2] } : null;
}

function graphqlFeaturesFor(known, table) {
    const features = {};
    for (const key of known.features) features[key] = table.values[key] === true;
    return features;
}

// Logged once per operation and session: the cue to refresh a route's hard-coded values.
function noteGraphqlDifference(key, message) {
    if (graphqlRegistry.noted.has(key)) return;
    graphqlRegistry.noted.add(key);
    console.log(`OldTweetDeck: ${message}`);
}

function noteFeatureDifference(op, sent, features) {
    let before;
    try {
        before = JSON.parse(sent);
    } catch (e) {
        return;
    }
    if (!before || typeof before !== "object") return;
    const added = Object.keys(features).filter((k) => !(k in before));
    const removed = Object.keys(before).filter((k) => !(k in features));
    const changed = Object.keys(features).filter((k) => k in before && before[k] !== features[k]);
    if (!added.length && !removed.length && !changed.length) return;
    // with the values, so the route's hard-coded features can be brought up to date from the log
    const part = (label, items) => (items.length ? ` ${label}: ${items.join(", ")}.` : "");
    noteGraphqlDifference(`${op}:features`, `${op} features differ from the route's.`
        + part("Added", added.map((k) => `${k}=${features[k]}`))
        + part("Removed", removed)
        + part("Other value", changed.map((k) => `${k}: ${before[k]} -> ${features[k]}`)));
}

// Rewrites xhr.modUrl to x.com's query id and features; true when it changed.
function applyGraphqlRegistryUrl(xhr) {
    const mode = graphqlRegistryMode();
    const table = graphqlRegistry.table;
    if (mode === "off" || !table) return false;
    const op = graphqlOperationOf(xhr.modUrl);
    const known = op && table.ops[op.name];
    if (!known || typeof known.id !== "string") return false;
    let url = xhr.modUrl;
    if (known.id !== op.id) {
        noteGraphqlDifference(`${op.name}:id`, `${op.name} query id ${op.id} -> ${known.id} (${table.builtin ? `built-in table of ${GRAPHQL_BUILTIN.date}` : "x.com's bundle"})`);
        url = url.replace(`/i/api/graphql/${op.id}/${op.name}`, `/i/api/graphql/${known.id}/${op.name}`);
    }
    if (mode !== "ids" && Array.isArray(known.features) && known.features.length) {
        let parsed = null;
        try {
            parsed = new URL(url);
        } catch (e) {
            // not a URL we can read; leave the features alone
        }
        const sent = parsed?.searchParams.get("features");
        if (sent) {
            const features = graphqlFeaturesFor(known, table);
            noteFeatureDifference(op.name, sent, features);
            const text = JSON.stringify(features);
            if (text !== sent) {
                parsed.searchParams.set("features", text);
                url = parsed.toString();
            }
        }
    }
    if (url === xhr.modUrl) return false;
    xhr.modUrl = url;
    return true;
}

// The same for a JSON body: x.com's mutations carry queryId and features there.
function applyGraphqlRegistryBody(xhr, body) {
    const mode = graphqlRegistryMode();
    const table = graphqlRegistry.table;
    if (mode === "off" || !table || typeof body !== "string" || body[0] !== "{") return body;
    const op = graphqlOperationOf(xhr.modUrl);
    const known = op && table.ops[op.name];
    if (!known || typeof known.id !== "string") return body;
    let json;
    try {
        json = JSON.parse(body);
    } catch (e) {
        return body;
    }
    if (!json || typeof json !== "object") return body;
    let changed = false;
    if (json.queryId && json.queryId !== known.id) {
        json.queryId = known.id;
        changed = true;
    }
    if (mode !== "ids" && Array.isArray(known.features) && known.features.length && json.features && typeof json.features === "object") {
        const features = graphqlFeaturesFor(known, table);
        const sent = JSON.stringify(json.features);
        noteFeatureDifference(op.name, sent, features);
        if (JSON.stringify(features) !== sent) {
            json.features = features;
            changed = true;
        }
    }
    return changed ? JSON.stringify(json) : body;
}

async function awaitGraphqlRegistry() {
    if (!graphqlRegistry.pending || Date.now() - OTD_INIT_TIME > GRAPHQL_STARTUP_WAIT.within) return;
    const atMost = graphqlRegistry.hadSaved ? GRAPHQL_STARTUP_WAIT.atMost : GRAPHQL_STARTUP_WAIT.firstRun;
    await Promise.race([graphqlRegistry.pending, new Promise((resolve) => setTimeout(resolve, atMost))]);
}

// A 400 or 404 on a known operation usually means X retired its query id, or wants a feature key
// the request lacks: read the bundles again, forced, at most once per 10 minutes.
function graphqlRegistryOnResponse(xhr) {
    const status = xhr._status || xhr.status;
    if (status !== 400 && status !== 404) return;
    const op = graphqlOperationOf(xhr.modUrl);
    if (!op || !(op.name in GRAPHQL_OPERATIONS)) return;
    let body = "";
    try {
        body = String(xhr.responseText || "").slice(0, 300);
    } catch (e) {
        // a response that is not text; the status is what matters
    }
    console.warn(`OldTweetDeck: ${status} for GraphQL ${op.name} (${op.id}): ${body}`);
    if (xhr.storage && !xhr.storage.failure) {
        xhr.storage.failure = { kind: "query-id", status, operation: op.name, detail: queryIdFailureDetail(op) };
    }
    const now = Date.now();
    if (now - graphqlRegistry.lastRefresh < GRAPHQL_REFRESH_INTERVAL) return;
    graphqlRegistry.lastRefresh = now;
    startGraphqlDiscovery(`after a ${status} for ${op.name}`, { force: true });
}

startGraphqlDiscovery("at startup");

// ---- the login account when verify_credentials is gone ----------------------------------------

// Legacy starts with GET /1.1/account/verify_credentials.json and cannot start without it
// (updateAccountFromVerifySuccess in bundle.js throws). x.com itself stopped calling it, and X
// retired help/configuration.json the same way in 2026-10 (410). The logged-in x.com page, which
// the registry and challenge.js already fetch, carries the same user in the same v1.1 shape at
// window.__INITIAL_STATE__.entities.users.entities[session.user_id]; the profile X confirmed last
// time is in localStorage too. Either stands in when X refuses, for the account the session's
// twid cookie names. An acting (Teams) account has no stand-in: only X can confirm it.
let pageLoginUser = null;

function readPageLoginUser() {
    if (typeof fetch !== "function") return Promise.resolve(null);
    return homepageHtml().then((html) => {
        const state = extractAssignedJSON(html);
        const id = state?.session?.user_id;
        const user = id ? state?.entities?.users?.entities?.[id] : null;
        if (user?.id_str && user.screen_name) pageLoginUser = user;
        return pageLoginUser;
    }).catch((e) => {
        console.warn("OldTweetDeck: could not read the login account from x.com's page", e);
        return null;
    });
}

function cookieUserId() {
    try {
        const m = /(?:^|;\s*)twid=([^;]*)/.exec(document.cookie);
        return m ? decodeURIComponent(m[1]).replace(/^u=/, "") : null;
    } catch (e) {
        return null;
    }
}

function standInLoginUser() {
    const session = cookieUserId();
    if (pageLoginUser && (!session || String(pageLoginUser.id_str) === session)) {
        return { user: pageLoginUser, source: "the profile on x.com's page" };
    }
    if (session && verifiedUser?.id_str && verifiedUser.screen_name && String(verifiedUser.id_str) === session) {
        return { user: verifiedUser, source: "the profile X confirmed last time" };
    }
    return null;
}

readPageLoginUser();

function extractAssignedJSON(html, varName = "window.__INITIAL_STATE__") {
    const assignPos = html.indexOf(varName);
    if (assignPos === -1) {
        throw new Error(`Variable ${varName} not found`);
    }
  
    let i = assignPos + varName.length;
    while (i < html.length && /\s/.test(html[i])) i++;
    if (html[i] !== '=') {
      i = html.indexOf('=', i);
      if (i === -1) throw new Error(`Assignment for ${varName} not found`);
    }
    i++; // skip '='
    while (i < html.length && /\s/.test(html[i])) i++;
  
    const opener = html[i];
    if (opener !== '{' && opener !== '[') {
      throw new Error(`Expected JSON object/array after ${varName} = ...`);
    }
    const closer = opener === '{' ? '}' : ']';
  
    let depth = 0, inStr = false, quote = null, escaped = false;
    const start = i;
    for (; i < html.length; i++) {
      const ch = html[i];
  
      if (inStr) {
        if (escaped) {
          escaped = false;
        } else if (ch === '\\') {
          escaped = true;
        } else if (ch === quote) {
          inStr = false;
          quote = null;
        }
        continue;
      }
      if (ch === '"' || ch === "'") {
        inStr = true;
        quote = ch;
        continue;
      }
      if (ch === opener) depth++;
      else if (ch === closer) {
        depth--;
        if (depth === 0) break;
      }
    }
    if (depth !== 0) throw new Error(`Unterminated JSON for ${varName}`);
  
    let jsonText = html.slice(start, i + 1);
  
    let j = i + 1;
    while (j < html.length && /\s/.test(html[j])) j++;
    if (html[j] === ';') j++;
  
    try {
      return JSON.parse(stripBOM(jsonText));
    } catch (e) {
      const repaired = repairCommonJSONIssues(jsonText);
      try {
        return JSON.parse(repaired);
      } catch (e2) {
        const ctx = repaired.slice(0, 1200);
        throw new Error(
          `Found assignment, but JSON.parse failed twice. First: ${e.message}. Second: ${e2.message}. ` +
          `Sample of repaired text start:\n${ctx}`
        );
      }
    }
  
    function stripBOM(s) {
      return s.charCodeAt(0) === 0xFEFF ? s.slice(1) : s;
    }
  
    function repairCommonJSONIssues(s) {
      s = stripBOM(s);
  
      let out = '';
      let inStr = false;
      let quote = null;
      let escaped = false;
  
      for (let k = 0; k < s.length; k++) {
        let ch = s[k];
  
        if (!inStr) {
          if (ch === '"' || ch === "'") {
            inStr = true;
            quote = ch;
            out += ch;
            continue;
          }
          out += ch;
          continue;
        }
  
        if (escaped) {
          escaped = false;
          out += ch;
          continue;
        }
        if (ch === '\\') {
          escaped = true;
          out += ch;
          continue;
        }
        if (ch === quote) {
          inStr = false;
          quote = null;
          out += ch;
          continue;
        }
  
        const code = ch.charCodeAt(0);
  
        if (code === 0x2028) { out += '\\u2028'; continue; }
        if (code === 0x2029) { out += '\\u2029'; continue; }
  
        if (code >= 0x00 && code <= 0x1F) {
          if (ch === '\n') { out += '\\n'; continue; }
          if (ch === '\r') { out += '\\r'; continue; }
          if (ch === '\t') { out += '\\t'; continue; }
          if (ch === '\b') { out += '\\b'; continue; }
          if (ch === '\f') { out += '\\f'; continue; }
          out += '\\u' + code.toString(16).padStart(4, '0');
          continue;
        }
  
        out += ch;
      }
  
      return out;
    }
}
// Notification types this file does not turn into a legacy action, said once each per session
// (the Notifications column is read every few seconds).
const unknownNotificationsNoted = new Set();
function noteUnknownNotification(type, why) {
    if (unknownNotificationsNoted.has(type)) return;
    unknownNotificationsNoted.add(type);
    console.warn(`OldTweetDeck: notification type ${type} is not shown${why ? ` (${why})` : ""}`);
}

// "{{user}} accepted your follow request": legacy has no action for it (X added the notification
// after TweetDeck's API), so one is derived from its follow action: the same card and user menu,
// another line of text. TwitterAction._getActionConstructor is what processRESTAction asks for
// the constructor of an action name; it answers null, and the action is dropped, for names it does
// not know. Done lazily, from the Notifications route, because the route runs only once legacy is up.
const FOLLOW_REQUEST_ACCEPTED = "follow_request_accepted";
let followRequestActionReady = false;
function ensureFollowRequestAction() {
    if (followRequestActionReady) return true;
    try {
        const Action = TD.services.TwitterAction;
        const Follow = TD.services.TwitterActionFollow;
        if (typeof Action !== "function" || typeof Follow !== "function" || typeof Action._getActionConstructor !== "function") return false;
        const Accepted = function (account) {
            this.account = account;
        };
        Accepted.prototype = new Follow();
        Accepted.prototype.action = FOLLOW_REQUEST_ACCEPTED;
        Accepted.prototype.isAboutYou = function () {
            return true;
        };
        Accepted.prototype.isOwnChirp = function () {
            return false;
        };
        Accepted.prototype.generateText = function () {
            const template = "{{{user}}} accepted your follow request";
            const user = this.following;
            this.text = TD.ui.template.toHtml(template, { user: user.name });
            this.htmlText = TD.ui.template.toHtml(template, {
                user: TD.ui.template.render("text/user_link_fullname", {
                    profileUrl: `https://x.com/${user.screenName || user.screen_name}`,
                    name: user.emojifiedName || user.name,
                    withBold: true,
                    unsafe: true,
                }),
            });
        };
        const original = Action._getActionConstructor;
        Action._getActionConstructor = function (name) {
            return name === FOLLOW_REQUEST_ACCEPTED ? Accepted : original.call(this, name);
        };
        TD.services.TwitterActionFollowRequestAccepted = Accepted;
        followRequestActionReady = true;
        return true;
    } catch (e) {
        return false;
    }
}

// Legacy TweetDeck derives a chirp id from the REST action object (generateInternalID on
// TwitterActionOnTweet / TwitterActionFollow in bundle.js); mirror it so we can ask its pollers
// whether they already hold a notification. "reply" renders as a mention, "quote" as quoted_tweet.
function legacyNotificationId(action, userId, targetId) {
    const legacyAction = action === "reply" ? "mention" : action === "quote" ? "quoted_tweet" : action;
    return `${legacyAction}_${userId}_${targetId}`;
}

// Legacy's fromRESTData throws when a mention's author is missing, and processActions
// then drops the whole page. Skip that entry. A quote whose tweet or author is missing
// is left off the entry instead of failing it.
function notificationTweet(go, tweetId) {
    const tweet = go?.tweets?.[tweetId];
    const user = tweet && go.users?.[tweet.user_id_str];
    if (!tweet || !user) return null;
    tweet.user = user;
    if (tweet.quoted_status_id_str) {
        const quoted = go.tweets[tweet.quoted_status_id_str];
        const quotedUser = quoted && go.users?.[quoted.user_id_str];
        if (quoted && quotedUser) {
            quoted.user = quotedUser;
            tweet.quoted_status = quoted;
        }
    }
    return tweet;
}

// all.json users are v1.1 users: they already carry following / followed_by and the ext_ checkmark
// fields, with `verified` false for every checkmark X gives out now.
function markNotificationUsers(go) {
    for (const user of Object.values(go?.users || {})) markVerified(user);
}

function notificationPollers(user_id) {
    const pollers = [];
    try {
        const accountKey = `twitter:${user_id}`;
        const columns = TD.controller.columnManager.getAll();
        for (const key in columns) {
            for (const feed of columns[key].getFeeds()) {
                if (feed.getType() !== "interactions" || feed.getAccountKey() !== accountKey) continue;
                const poller = TD.controller.feedManager.getPoller(feed.getKey());
                if (poller && !pollers.includes(poller)) pollers.push(poller);
            }
        }
    } catch (e) {
        // TD not ready or its internals changed: notificationDeliveryFilter falls back to the session-wide set.
    }
    return pollers;
}

// Every Notifications column polls through the same route, and one account can have several of
// them (each filter combination gets its own feed and poller). Judging "already delivered" with one
// global set starves whichever poller asks second, so judge it per poller instead: a notification
// is only skipped once every poller for that account already holds it.
function notificationDeliveryFilter(user_id) {
    const pollers = notificationPollers(user_id);
    if (pollers.length === 0) {
        return (id) => {
            if (seenNotifications.has(id)) return false;
            seenNotifications.add(id);
            return true;
        };
    }
    return (id) => !pollers.every((poller) => poller.chirpIndex && poller.chirpIndex[id]);
}

function stableNotificationPosition(id, position) {
    if (!notificationPositions.has(id)) notificationPositions.set(id, position);
    return notificationPositions.get(id);
}

// X folds new followers into one notification ("A and 9 others followed you"). It keeps that
// notification's id, puts the newest follower first, moves it to the time of that follow and gives
// no time for the others. Such an aggregate spans hours and drops below the page a poll reads, so
// its next follower brought it back to the top with everyone in it, and each follower not
// delivered yet arrived at the new time: old followers filled the top of the column. A poll
// (since_id) now only gets the followers an aggregate gained since it was last seen, or its first
// one when it was not seen before in this session. The first load and scrolling still get them
// all. The answer is kept per state of the aggregate, so every Notifications column that reads the
// same page gets the same followers. Likes and retweets are left as they were: their aggregates
// stay near the top while the post is active, and taking only the first of an unseen one would
// drop likes that arrive together.
const AGGREGATE_STATE_LIMIT = 1000;
const aggregateStates = new Map();

function freshAggregateActions(user_id, notificationId, sortIndex, ids) {
    const key = `${user_id}:${notificationId}`;
    let state = aggregateStates.get(key);
    if (!state || state.sortIndex !== sortIndex) {
        const members = state && state.members;
        state = {
            sortIndex,
            members: new Set([...(members || []), ...ids]),
            fresh: new Set(members ? ids.filter((id) => !members.has(id)) : ids.slice(0, 1)),
        };
        aggregateStates.delete(key);
        aggregateStates.set(key, state);
        if (aggregateStates.size > AGGREGATE_STATE_LIMIT) aggregateStates.delete(aggregateStates.keys().next().value);
    }
    return state.fresh;
}

function formatTwitterStyle(date) {
    const days = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  
    const day = days[date.getUTCDay()];
    const month = months[date.getUTCMonth()];
    const dayNum = String(date.getUTCDate()).padStart(2, "0");
    const hours = String(date.getUTCHours()).padStart(2, "0");
    const mins = String(date.getUTCMinutes()).padStart(2, "0");
    const secs = String(date.getUTCSeconds()).padStart(2, "0");
    const year = date.getUTCFullYear();
  
    return `${day} ${month} ${dayNum} ${hours}:${mins}:${secs} +0000 ${year}`;
}

function emulateResponse(xhr) {
    xhr._status = xhr._status ?? 200;
    xhr._readyState = 4;
    xhr.responseHeaderOverride = {
        "content-type": () => "application/json"
    }
    const loadEvent = new ProgressEvent('load');
    loadEvent.lengthComputable = true;
    loadEvent.loaded = 1;
    loadEvent.total = 1;

    if(xhr.onload) xhr.onload(loadEvent);
    if(xhr.onloadend) xhr.onloadend(loadEvent);

    const readyStateEvent = new Event('readystatechange');
    if(xhr.onreadystatechange) xhr.onreadystatechange(readyStateEvent);
}

let counter = 0;
let bookmarkTimes = {};

// screen_name -> id, filled as GraphQL users are parsed, so adding a list member
// can use the id TweetDeck's form does not send.
const screenNameIds = {};
const USER_BY_SCREEN_NAME_FEATURES = {"hidden_profile_subscriptions_enabled":true,"profile_label_improvements_pcf_label_in_post_enabled":true,"responsive_web_profile_redirect_enabled":true,"rweb_tipjar_consumption_enabled":false,"verified_phone_label_enabled":false,"subscriptions_verification_info_is_identity_verified_enabled":true,"subscriptions_verification_info_verified_since_enabled":true,"highlights_tweets_tab_ui_enabled":true,"responsive_web_twitter_article_notes_tab_enabled":true,"subscriptions_feature_can_gift_premium":false,"creator_subscriptions_tweet_preview_api_enabled":true,"responsive_web_graphql_timeline_navigation_enabled":true};
const USER_BY_REST_ID_FEATURES = {"hidden_profile_subscriptions_enabled":true,"profile_label_improvements_pcf_label_in_post_enabled":true,"responsive_web_profile_redirect_enabled":true,"rweb_tipjar_consumption_enabled":false,"verified_phone_label_enabled":false,"highlights_tweets_tab_ui_enabled":true,"responsive_web_twitter_article_notes_tab_enabled":true,"subscriptions_feature_can_gift_premium":false,"creator_subscriptions_tweet_preview_api_enabled":true,"responsive_web_graphql_timeline_navigation_enabled":true};
const LIST_MEMBER_MUTATION_FEATURES = {"profile_label_improvements_pcf_label_in_post_enabled":true,"responsive_web_profile_redirect_enabled":true,"rweb_tipjar_consumption_enabled":false,"verified_phone_label_enabled":false,"responsive_web_graphql_timeline_navigation_enabled":true};
const LIST_MEMBERS_FEATURES = {"rweb_video_screen_enabled":false,"rweb_cashtags_enabled":true,"profile_label_improvements_pcf_label_in_post_enabled":true,"responsive_web_profile_redirect_enabled":true,"rweb_tipjar_consumption_enabled":false,"verified_phone_label_enabled":false,"creator_subscriptions_tweet_preview_api_enabled":true,"responsive_web_graphql_timeline_navigation_enabled":true,"premium_content_api_read_enabled":false,"communities_web_enable_tweet_community_results_fetch":true,"c9s_tweet_anatomy_moderator_badge_enabled":true,"responsive_web_grok_analyze_button_fetch_trends_enabled":false,"responsive_web_grok_analyze_post_followups_enabled":true,"rweb_cashtags_composer_attachment_enabled":true,"responsive_web_jetfuel_frame":true,"rweb_sports_post_context_enabled":true,"responsive_web_grok_share_attachment_enabled":true,"responsive_web_grok_annotations_enabled":true,"articles_preview_enabled":true,"responsive_web_edit_tweet_api_enabled":true,"rweb_conversational_replies_downvote_enabled":false,"graphql_is_translatable_rweb_tweet_is_translatable_enabled":true,"view_counts_everywhere_api_enabled":true,"longform_notetweets_consumption_enabled":true,"responsive_web_twitter_article_tweet_consumption_enabled":true,"content_disclosure_indicator_enabled":true,"content_disclosure_ai_generated_indicator_enabled":true,"responsive_web_grok_show_grok_translated_post":true,"responsive_web_grok_analysis_button_from_backend":true,"post_ctas_fetch_enabled":false,"freedom_of_speech_not_reach_fetch_enabled":true,"standardized_nudges_misinfo":true,"tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled":true,"longform_notetweets_rich_text_read_enabled":true,"longform_notetweets_inline_media_enabled":false,"responsive_web_nested_quote_preview_enabled":true,"responsive_web_grok_image_annotation_enabled":true,"responsive_web_grok_imagine_annotation_enabled":true,"responsive_web_grok_community_note_auto_translation_is_enabled":true,"responsive_web_enhance_cards_enabled":false};

function rememberUser(user) {
    if (user && user.screen_name && user.id_str) {
        screenNameIds[String(user.screen_name).toLowerCase()] = String(user.id_str);
    }
}

function legacyUserFromGraph(result) {
    if (!result || result.__typename === "UserUnavailable") return null;
    const legacy = result.legacy || {};
    const id = result.rest_id || legacy.id_str;
    const screen = legacy.screen_name || result.core?.screen_name;
    if (!id || !screen) return null;
    const image = String(legacy.profile_image_url_https || result.avatar?.image_url || "").replace("http://", "https://");
    const user = Object.assign({}, legacy, {
        id_str: String(id),
        id: +id,
        screen_name: screen,
        name: legacy.name || result.core?.name || screen,
        profile_image_url_https: image,
        created_at: legacy.created_at || result.core?.created_at || "",
    });
    if (!user.profile_image_url) user.profile_image_url = image.replace("https://", "http://");
    fillUserFromGraph(user, result);
    rememberUser(user);
    return user;
}

function listMemberTimeline(data) {
    return data?.data?.list?.members_timeline?.timeline
        || data?.data?.list?.membersTimeline?.timeline
        || null;
}

function listMemberEntries(data) {
    const instructions = listMemberTimeline(data)?.instructions || [];
    const add = instructions.find((i) => i.type === "TimelineAddEntries");
    return add?.entries || [];
}

function listMemberMutationHeaders(xhr) {
    xhr.modReqHeaders["Content-Type"] = "application/json";
    xhr.modReqHeaders["X-Twitter-Active-User"] = "yes";
    xhr.modReqHeaders["X-Twitter-Client-Language"] = "en";
    xhr.modReqHeaders["Authorization"] = PUBLIC_TOKENS[0];
    delete xhr.modReqHeaders["X-Twitter-Client-Version"];
}

function lookupUserId(screenName) {
    const known = screenNameIds[String(screenName || "").toLowerCase()];
    if (known) return Promise.resolve(known);
    return new Promise((resolve, reject) => {
        let req;
        try {
            req = new XMLHttpRequest();
        } catch (e) {
            reject(e);
            return;
        }
        if (!req || typeof req.open !== "function") {
            reject(new Error("user lookup unavailable"));
            return;
        }
        const url = `${NEW_API}/AMIBMjtxEEATh4z8V9GtRg/UserByScreenName?${generateParams(
            USER_BY_SCREEN_NAME_FEATURES,
            { screen_name: screenName, withGrokTranslatedBio: true },
            { withPayments: false, withAuxiliaryUserLabels: true }
        )}`;
        req.open("GET", url, true);
        req.onload = () => {
            try {
                const data = JSON.parse(req.responseText);
                const user = legacyUserFromGraph(data?.data?.user?.result);
                if (!user) reject(new Error("missing user"));
                else resolve(user.id_str);
            } catch (e) {
                reject(e);
            }
        };
        req.onerror = () => reject(new Error("user lookup failed"));
        req.send();
    });
}

function legacyListFromGraph(data, fallback) {
    const raw = data?.data?.list
        || data?.data?.list_add_member
        || data?.data?.listAddMember
        || data?.data?.list_remove_member
        || data?.data?.listRemoveMember;
    return legacyListFromNode(raw && typeof raw === "object" ? raw : {}, fallback);
}

// A GraphQL List node (a mutation's result, or a TimelineTwitterList item) as the v1.1 list
// legacy's TwitterList.fromJSONObject reads.
function legacyListFromNode(node, fallback = {}) {
    const id = node.id_str || node.rest_id || fallback.listId || "";
    const owner = legacyUserFromGraph(node.user_results?.result || node.user_result?.result) || {
        id_str: "0",
        id: 0,
        screen_name: "",
        name: "",
        profile_image_url_https: "",
    };
    const mode = String(node.mode || "public").toLowerCase();
    return {
        id_str: String(id),
        id: +id || 0,
        name: node.name || "",
        description: node.description || "",
        slug: node.slug || "",
        full_name: node.full_name || node.name || "",
        member_count: node.member_count ?? 0,
        mode: mode === "private" ? "private" : "public",
        user: owner,
    };
}

function listMutationResult(xhr) {
    if (xhr.storage.listResult) return xhr.storage.listResult;
    let data;
    try {
        data = JSON.parse(xhr.responseText);
    } catch (e) {
        xhr._status = 503;
        return { errors: [{ message: "Could not update list members" }] };
    }
    if (data?.errors && !data?.data) {
        xhr._status = 503;
        return { errors: [{ message: data.errors[0]?.message || "Could not update list members" }] };
    }
    return legacyListFromGraph(data, { listId: xhr.storage.listId });
}

function postListMember(listId, userId, queryId, operation) {
    return new Promise((resolve, reject) => {
        let req;
        try {
            req = new XMLHttpRequest();
        } catch (e) {
            reject(e);
            return;
        }
        if (!req || typeof req.open !== "function") {
            reject(new Error("list mutation unavailable"));
            return;
        }
        req.open("POST", `${NEW_API}/${queryId}/${operation}`, true);
        req.onload = () => {
            try {
                resolve(JSON.parse(req.responseText));
            } catch (e) {
                reject(e);
            }
        };
        req.onerror = () => reject(new Error("list mutation failed"));
        req.send(JSON.stringify({
            variables: { listId, userId },
            features: LIST_MEMBER_MUTATION_FEATURES,
            queryId,
        }));
    });
}

function sendListMemberMutation(xhr, body) {
    const params = new URLSearchParams(body || "");
    const listId = params.get("list_id") || "";
    const names = (params.get("screen_name") || "").split(",").map((name) => name.trim()).filter(Boolean);
    xhr.storage.listId = listId;
    Promise.all(names.map((name) => lookupUserId(name))).then(async (ids) => {
        if (!listId || !ids.length || ids.some((id) => !id)) {
            failWithoutRequest(xhr, "could not resolve a list member");
            emulateResponse(xhr);
            return;
        }
        if (!xhr.storage.many) {
            xhr.send(JSON.stringify({
                variables: { listId, userId: ids[0] },
                features: LIST_MEMBER_MUTATION_FEATURES,
                queryId: xhr.storage.queryId,
            }));
            return;
        }
        try {
            let last;
            for (const userId of ids) {
                last = await postListMember(listId, userId, xhr.storage.queryId, xhr.storage.operation);
            }
            xhr.storage.listResult = legacyListFromGraph(last, { listId });
            emulateResponse(xhr);
        } catch (e) {
            console.error(e);
            failWithoutRequest(xhr, "could not add list members");
            emulateResponse(xhr);
        }
    }).catch((e) => {
        console.error(e);
        failWithoutRequest(xhr, "could not resolve a list member");
        emulateResponse(xhr);
    });
}

const OriginalXHR = XMLHttpRequest;
const proxyRoutes = [
    // Home timeline
    {
        path: "/1.1/statuses/home_timeline.json",
        method: "GET",
        inspectResponse: graphqlPageInspector((data) => data?.data?.home?.home_timeline_urt),
        beforeRequest: (xhr) => {
            try {
                let params = new URL(xhr.modUrl).searchParams;
                xhr.storage.max_id = params.get("max_id");
                xhr.storage.since_id = params.get("since_id");
                if (params.get("user_id")) {
                    xhr.storage.user_id = params.get("user_id");
                }
                // Legacy adds x-act-as-user-id after open(), so which account's cursor to use is
                // only known in beforeSend; until then this is the cursor-less URL.
                xhr.modUrl = homeTimelineUrl();
            } catch (e) {
                console.error(e);
            }
        },
        openHandler: deferOpen,
        beforeSend: (xhr) => {
            const user_id = requestUserId(xhr);
            xhr.storage.user_id = user_id;
            const feedKey = `home-${user_id}`;
            const { max_id, since_id } = xhr.storage;
            let cursor;
            if (max_id) {
                const requested = String(BigInt(max_id) + 1n);
                cursor = timelineCursor(feedKey, requested, "bottom");
                if (!cursor) {
                    // Legacy wants tweets below a chirp we never handed it. The only thing we could
                    // fetch is the top of the timeline, which it would discard and retry five times.
                    failWithoutRequest(xhr, `no bottom cursor for home max_id=${max_id}`);
                    return;
                }
                xhr.storage.requested_id = requested;
            } else if (since_id && !topFetchDue(feedKey)) {
                cursor = timelineCursor(feedKey, since_id, "top");
                if (!cursor) noteTopFetch(feedKey);
            } else {
                noteTopFetch(feedKey);
            }
            // Pacing is left to legacy's scheduler (see POLL_FLOORS).
            xhr.modUrl = homeTimelineUrl(cursor);
            openDeferred(xhr);
        },
        sendHandler: (xhr, data) => {
            if (xhr.storage.cancelled) {
                emulateResponse(xhr);
            } else {
                xhr.send(data);
            }
        },
        beforeSendHeaders: (xhr) => {
            xhr.modReqHeaders["Content-Type"] = "application/json";
            xhr.modReqHeaders["X-Twitter-Active-User"] = "yes";
            xhr.modReqHeaders["X-Twitter-Client-Language"] = "en";
            xhr.modReqHeaders["Authorization"] = PUBLIC_TOKENS[0];
            delete xhr.modReqHeaders["X-Twitter-Client-Version"];
        },
        afterRequest: (xhr) => {
            if (xhr.storage.cancelled || xhr._status) {
                return [];
            }
            if (xhr.storage.data) {
                return xhr.storage.data;
            }
            let data = xhr.storage.parsed;
            if (!data) {
                try {
                    data = JSON.parse(xhr.responseText);
                } catch (e) {
                    console.error(e);
                    return [];
                }
            }
            const timeline = data?.data?.home?.home_timeline_urt;
            if (!timeline) {
                if (data?.errors) console.warn("OldTweetDeck: home timeline errors", data.errors);
                return [];
            }
            let entries = timeline.instructions?.find((i) => i.type === "TimelineAddEntries")?.entries;
            if (!entries) {
                return [];
            }
            const user_id = xhr.storage.user_id;
            const feedKey = `home-${user_id}`;
            let tweets = [];
            let threads = [];
            for (let e of entries) {
                // thats a lot of trash https://lune.dimden.dev/0bf524e52eb.png
                if (e.entryId.startsWith("tweet-")) {
                    if (isPromoted(e)) continue;
                    let res = e.content.itemContent.tweet_results.result;
                    let tweet = safeParseTweet(res);
                    if (!tweet || tweetHidden(tweet)) continue;

                    tweets.push(tweet);
                } else if (e.entryId.startsWith("home-conversation-")) {
                    let items = e.content.items;

                    let thread = [];
                    for (let i = 0; i < items.length; i++) {
                        let item = items[i];
                        if (
                            (item.entryId.startsWith("tweet-") || item.entryId.includes("-tweet-")) &&
                            !isPromoted(item)
                        ) {
                            let res = item.item.itemContent.tweet_results.result;
                            let tweet = safeParseTweet(res);
                            if (!tweet || tweetHidden(tweet)) continue;
                            if (item.item.feedbackInfo) {
                                tweet.feedback = item.item.feedbackInfo.feedbackKeys
                                    .map(
                                        (f) =>
                                            timeline.responseObjects?.feedbackActions?.find(
                                                (a) => a.key === f
                                            )?.value
                                    )
                                    .filter((f) => f);
                                if (tweet.feedback) {
                                    tweet.feedbackMetadata =
                                        item.item.feedbackInfo.feedbackMetadata;
                                }
                            }
                            thread.push(tweet);
                        }
                    }
                    if (thread.length) threads.push(thread);
                }
            }
            for (let tweet of threadTweetsInRange(tweets, threads, xhr.storage.since_id)) {
                // a poll can re-send a thread the column already shows
                if (xhr.storage.since_id && !rememberHomeTweet(user_id, tweet.id_str)) continue;
                tweets.push(tweet);
            }

            const bottomCursor = findCursor(entries, "bottom");
            if (tweets.length === 0) {
                // Nothing survived the filters but there may be more below: let the next request
                // for the same bound go one page deeper instead of fetching this one again.
                if (xhr.storage.requested_id && bottomCursor) {
                    advanceTimelineCursor(feedKey, xhr.storage.requested_id, bottomCursor);
                }
                return tweets;
            }

            sortNewestFirst(tweets);
            for (let tweet of tweets) {
                rememberHomeTweet(user_id, tweet.id_str);
            }
            rememberTimelinePage(feedKey, tweets, bottomCursor, findCursor(entries, "top"));

            xhr.storage.data = tweets;

            return tweets;
        },
    },
    // List timeline
    {
        path: "/1.1/lists/statuses.json",
        method: "GET",
        inspectResponse: graphqlPageInspector((data) => data?.data?.list?.tweets_timeline?.timeline),
        beforeRequest: (xhr) => {
            try {
                let url = new URL(xhr.modUrl);
                let params = new URLSearchParams(url.search);
                let variables = { count: 40, includePromotedContent: false };
                let features = {"rweb_video_screen_enabled":false,"payments_enabled":false,"profile_label_improvements_pcf_label_in_post_enabled":true,"rweb_tipjar_consumption_enabled":true,"verified_phone_label_enabled":false,"creator_subscriptions_tweet_preview_api_enabled":true,"responsive_web_graphql_timeline_navigation_enabled":true,"responsive_web_graphql_skip_user_profile_image_extensions_enabled":false,"premium_content_api_read_enabled":false,"communities_web_enable_tweet_community_results_fetch":true,"c9s_tweet_anatomy_moderator_badge_enabled":true,"responsive_web_grok_analyze_button_fetch_trends_enabled":false,"responsive_web_grok_analyze_post_followups_enabled":true,"responsive_web_jetfuel_frame":true,"responsive_web_grok_share_attachment_enabled":true,"articles_preview_enabled":true,"responsive_web_edit_tweet_api_enabled":true,"graphql_is_translatable_rweb_tweet_is_translatable_enabled":true,"view_counts_everywhere_api_enabled":true,"longform_notetweets_consumption_enabled":true,"responsive_web_twitter_article_tweet_consumption_enabled":true,"tweet_awards_web_tipping_enabled":false,"responsive_web_grok_show_grok_translated_post":false,"responsive_web_grok_analysis_button_from_backend":false,"creator_subscriptions_quote_tweet_preview_enabled":false,"freedom_of_speech_not_reach_fetch_enabled":true,"standardized_nudges_misinfo":true,"tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled":true,"longform_notetweets_rich_text_read_enabled":true,"longform_notetweets_inline_media_enabled":true,"responsive_web_grok_image_annotation_enabled":true,"responsive_web_grok_community_note_auto_translation_is_enabled":false,"responsive_web_enhance_cards_enabled":false};

                let list_id = params.get("list_id");
                let max_id = params.get("max_id");
                let since_id = params.get("since_id");
                const feedKey = `list-${list_id}`;
                xhr.storage.max_id = max_id;
                xhr.storage.since_id = since_id;
                if (max_id) {
                    const requested = String(BigInt(max_id) + 1n);
                    const cursor = timelineCursor(feedKey, requested, "bottom");
                    if (cursor) {
                        variables.cursor = cursor;
                        xhr.storage.requested_id = requested;
                    } else {
                        xhr.storage.missingCursor = true;
                    }
                } else if (since_id && !topFetchDue(feedKey)) {
                    const cursor = timelineCursor(feedKey, since_id, "top");
                    if (cursor) {
                        variables.cursor = cursor;
                        xhr.storage.cursor = true;
                    } else {
                        noteTopFetch(feedKey);
                    }
                } else {
                    noteTopFetch(feedKey);
                }
                variables.listId = list_id;
                xhr.storage.list_id = list_id;
                xhr.modUrl = `${NEW_API}/uV0pbd0DrW8hTbMrtZ1SYQ/ListLatestTweetsTimeline?${generateParams(
                    features,
                    variables
                )}`;
            } catch (e) {
                console.error(e);
            }
        },
        beforeSendHeaders: (xhr) => {
            xhr.modReqHeaders["Content-Type"] = "application/json";
            xhr.modReqHeaders["X-Twitter-Active-User"] = "yes";
            xhr.modReqHeaders["X-Twitter-Client-Language"] = "en";
            xhr.modReqHeaders["Authorization"] = PUBLIC_TOKENS[0];
            delete xhr.modReqHeaders["X-Twitter-Client-Version"];
        },
        openHandler: (xhr, method, url, async, username, password) => {
            const list_id = xhr.storage.list_id;
            if(!timings.list[list_id]) {
                timings.list[list_id] = 0;
            }
            if (xhr.storage.missingCursor) {
                failWithoutRequest(xhr, `no bottom cursor for list ${list_id} max_id=${xhr.storage.max_id}`);
            } else if(Date.now() - timings.list[list_id] < refreshInterval && xhr.storage.cursor) {
                xhr.storage.cancelled = true;
            } else {
                xhr.open(method, url, async ?? true, username, password);
                timings.list[list_id] = Date.now();
            }
        },
        sendHandler: (xhr, data) => {
            if(xhr.storage.cancelled) {
                emulateResponse(xhr);
            } else {
                xhr.send(data);
            }
        },
        afterRequest: (xhr) => {
            if(xhr.storage.cancelled || xhr._status) {
                return [];
            }
            let data = xhr.storage.parsed;
            if (!data) {
                try {
                    data = JSON.parse(xhr.responseText);
                } catch (e) {
                    console.error(e);
                    return [];
                }
            }
            let list = data?.data?.list?.tweets_timeline?.timeline?.instructions?.find(
                (i) => i.type === "TimelineAddEntries"
            );
            if (!list) return [];
            list = list.entries;
            let tweets = [];
            let threads = [];
            for (let e of list) {
                if (e.entryId.startsWith("tweet-")) {
                    if (isPromoted(e)) continue;
                    let res = e.content.itemContent.tweet_results.result;
                    let tweet = safeParseTweet(res);
                    if (tweet) {
                        tweets.push(tweet);
                    }
                } else if (e.entryId.startsWith("list-conversation-")) {
                    let lt = e.content.items;
                    let thread = [];
                    for (let i = 0; i < lt.length; i++) {
                        let t = lt[i];
                        if ((t.entryId.startsWith("tweet-") || t.entryId.includes("-tweet-")) && !isPromoted(t)) {
                            let res = t.item.itemContent.tweet_results.result;
                            let tweet = safeParseTweet(res);
                            if (!tweet) continue;
                            thread.push(tweet);
                        }
                    }
                    if (thread.length) threads.push(thread);
                }
            }

            const visible = (t) => !tweetHidden(t);
            tweets = tweets.filter(visible);
            threads = threads.map((thread) => thread.filter(visible)).filter((thread) => thread.length);
            tweets.push(...threadTweetsInRange(tweets, threads, xhr.storage.since_id));

            const feedKey = `list-${xhr.storage.list_id}`;
            const bottomCursor = findCursor(list, "bottom");
            if (tweets.length === 0) {
                if (xhr.storage.requested_id && bottomCursor) {
                    advanceTimelineCursor(feedKey, xhr.storage.requested_id, bottomCursor);
                }
                return tweets;
            }
            sortNewestFirst(tweets);
            rememberTimelinePage(feedKey, tweets, bottomCursor, findCursor(list, "top"));

            return tweets;
        },
    },
    // User timeline
    {
        path: "/1.1/statuses/user_timeline.json",
        method: "GET",
        inspectResponse: graphqlPageInspector((data) => data?.data?.user?.result?.timeline_v2?.timeline),
        beforeRequest: (xhr) => {
            try {
                let url = new URL(xhr.modUrl);
                let params = new URLSearchParams(url.search);
                let user_id = params.get("user_id");
                let variables = {
                    count: 20,
                    includePromotedContent: false,
                    withQuickPromoteEligibilityTweetFields: false,
                    withVoice: true,
                    withV2Timeline: true,
                };
                let features = {
                    rweb_lists_timeline_redesign_enabled: false,
                    responsive_web_graphql_exclude_directive_enabled: true,
                    verified_phone_label_enabled: false,
                    creator_subscriptions_tweet_preview_api_enabled: true,
                    responsive_web_graphql_timeline_navigation_enabled: true,
                    responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
                    tweetypie_unmention_optimization_enabled: true,
                    responsive_web_edit_tweet_api_enabled: true,
                    graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
                    view_counts_everywhere_api_enabled: true,
                    longform_notetweets_consumption_enabled: true,
                    responsive_web_twitter_article_tweet_consumption_enabled: false,
                    tweet_awards_web_tipping_enabled: false,
                    freedom_of_speech_not_reach_fetch_enabled: true,
                    standardized_nudges_misinfo: true,
                    tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
                    longform_notetweets_rich_text_read_enabled: true,
                    longform_notetweets_inline_media_enabled: true,
                    responsive_web_media_download_video_enabled: false,
                    responsive_web_enhance_cards_enabled: false,
                };

                if (!user_id) {
                    variables.userId = getCurrentUserId();
                } else {
                    variables.userId = user_id;
                }
                let since_id = params.get("since_id");
                let max_id = params.get("max_id");
                const feedKey = `user-${variables.userId}`;
                xhr.storage.max_id = max_id;
                xhr.storage.since_id = since_id;
                if (max_id) {
                    const requested = String(BigInt(max_id) + 1n);
                    const cursor = timelineCursor(feedKey, requested, "bottom");
                    if (cursor) {
                        variables.cursor = cursor;
                        xhr.storage.requested_id = requested;
                    } else {
                        xhr.storage.missingCursor = true;
                    }
                } else if (since_id && !topFetchDue(feedKey)) {
                    const cursor = timelineCursor(feedKey, since_id, "top");
                    if (cursor) {
                        variables.cursor = cursor;
                        xhr.storage.cursor = true;
                    } else {
                        noteTopFetch(feedKey);
                    }
                } else {
                    noteTopFetch(feedKey);
                }
                xhr.storage.user_id = variables.userId;

                xhr.modUrl = `${NEW_API}/MbxTcSWPt8RWRFMwenOtyQ/UserTweetsAndReplies?${generateParams(
                    features,
                    variables
                )}`;
            } catch (e) {
                console.error(e);
            }
        },
        beforeSendHeaders: (xhr) => {
            xhr.modReqHeaders["Content-Type"] = "application/json";
            xhr.modReqHeaders["X-Twitter-Active-User"] = "yes";
            xhr.modReqHeaders["X-Twitter-Client-Language"] = "en";
            xhr.modReqHeaders["Authorization"] =
                PUBLIC_TOKENS[0];
            delete xhr.modReqHeaders["X-Twitter-Client-Version"];
            // delete xhr.modReqHeaders["x-act-as-user-id"];
        },
        openHandler: (xhr, method, url, async, username, password) => {
            const user_id = xhr.storage.user_id;
            if(!timings.user[user_id]) {
                timings.user[user_id] = 0;
            }
            if (xhr.storage.missingCursor) {
                failWithoutRequest(xhr, `no bottom cursor for user ${user_id} max_id=${xhr.storage.max_id}`);
            } else if(Date.now() - timings.user[user_id] < refreshInterval && xhr.storage.cursor) {
                xhr.storage.cancelled = true;
            } else {
                xhr.open(method, url, async ?? true, username, password);
                timings.user[user_id] = Date.now();
            }
        },
        sendHandler: (xhr, data) => {
            if(xhr.storage.cancelled) {
                emulateResponse(xhr);
            } else {
                xhr.send(data);
            }
        },
        afterRequest: (xhr) => {
            if(xhr.storage.cancelled || xhr._status) {
                return [];
            }
            let data = xhr.storage.parsed;
            if (!data) {
                try {
                    data = JSON.parse(xhr.responseText);
                } catch (e) {
                    console.error(e);
                    return [];
                }
            }
            let instructions = data?.data?.user?.result?.timeline_v2?.timeline?.instructions;
            let entries = instructions?.find((e) => e.type === "TimelineAddEntries");
            if (!entries) {
                return [];
            }
            entries = entries.entries;
            let tweets = [];
            let threads = [];
            for (let entry of entries) {
                if (entry.entryId.startsWith("tweet-")) {
                    let result = entry.content.itemContent.tweet_results.result;
                    let tweet = safeParseTweet(result);
                    if (tweet) {
                        tweets.push(tweet);
                    }
                } else if (entry.entryId.startsWith("profile-conversation-")) {
                    let items = entry.content.items;
                    let thread = [];
                    for (let i = 0; i < items.length; i++) {
                        let item = items[i];
                        let result = item.item.itemContent.tweet_results.result;
                        if (item.entryId.startsWith("tweet-") || item.entryId.includes("-tweet-")) {
                            let tweet = safeParseTweet(result);
                            if (tweet && tweet.user.id_str === xhr.storage.user_id) {
                                thread.push(tweet);
                            }
                        }
                    }
                    if (thread.length) threads.push(thread);
                }
            }
            tweets.push(...threadTweetsInRange(tweets, threads, xhr.storage.since_id));

            const feedKey = `user-${xhr.storage.user_id}`;
            const bottomCursor = findCursor(entries, "bottom");
            if (tweets.length === 0) {
                if (xhr.storage.requested_id && bottomCursor) {
                    advanceTimelineCursor(feedKey, xhr.storage.requested_id, bottomCursor);
                }
                return tweets;
            }
            sortNewestFirst(tweets);
            rememberTimelinePage(feedKey, tweets, bottomCursor, findCursor(entries, "top"));

            let pinEntry = instructions.find((e) => e.type === "TimelinePinEntry");
            if (
                pinEntry &&
                pinEntry.entry &&
                pinEntry.entry.content &&
                pinEntry.entry.content.itemContent
            ) {
                let result = pinEntry.entry.content.itemContent.tweet_results.result;
                let pinnedTweet = safeParseTweet(result);
                if (pinnedTweet) {
                    let tweetTimes = tweets.map((t) => [
                        t.id_str,
                        new Date(t.created_at).getTime(),
                    ]);
                    tweetTimes.push([
                        pinnedTweet.id_str,
                        new Date(pinnedTweet.created_at).getTime(),
                    ]);
                    tweetTimes.sort((a, b) => b[1] - a[1]);
                    let index = tweetTimes.findIndex((t) => t[0] === pinnedTweet.id_str);
                    if (index !== tweets.length) {
                        tweets.splice(index, 0, pinnedTweet);
                    }
                }
            }

            return tweets;
        },
    },
    // Bookmarks timeline
    {
        path: "/1.1/statuses/bookmarks.json",
        method: "GET",
        beforeRequest: (xhr) => {
            try {
                let url = new URL(xhr.modUrl);
                let params = new URLSearchParams(url.search);
                xhr.storage.variables = {
                    "count": 40,
                    "includePromotedContent":false
                };
                xhr.storage.features = {"graphql_timeline_v2_bookmark_timeline":true,"blue_business_profile_image_shape_enabled":true,"responsive_web_graphql_exclude_directive_enabled":true,"verified_phone_label_enabled":false,"responsive_web_graphql_timeline_navigation_enabled":true,"responsive_web_graphql_skip_user_profile_image_extensions_enabled":false,"tweetypie_unmention_optimization_enabled":true,"vibe_api_enabled":true,"responsive_web_edit_tweet_api_enabled":true,"graphql_is_translatable_rweb_tweet_is_translatable_enabled":true,"view_counts_everywhere_api_enabled":true,"longform_notetweets_consumption_enabled":true,"tweet_awards_web_tipping_enabled":false,"freedom_of_speech_not_reach_fetch_enabled":true,"standardized_nudges_misinfo":true,"tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled":false,"interactive_text_enabled":true,"responsive_web_text_conversations_enabled":false,"longform_notetweets_rich_text_read_enabled":true,"responsive_web_enhance_cards_enabled":false};

                let max_id = params.get("max_id");
                if (max_id) {
                    xhr.storage.bn = String(BigInt(max_id) + 1n);
                }
                if (params.get("user_id")) xhr.storage.user_id = params.get("user_id");
            } catch (e) {
                console.error(e);
            }
        },
        // The acting account is only known once legacy has set x-act-as-user-id.
        openHandler: deferOpen,
        beforeSend: (xhr) => {
            const user_id = requestUserId(xhr);
            xhr.storage.user_id = user_id;
            if (!xhr.storage.variables || !xhr.storage.features) {
                openDeferred(xhr);
                return;
            }
            const bn = xhr.storage.bn;
            if (bn && cursors[`bookmarks-${user_id}-${bn}`]) {
                xhr.storage.variables.cursor = cursors[`bookmarks-${user_id}-${bn}`];
            }
            if (bn && bookmarkTimes[`${user_id}:${bn}`] !== undefined) {
                xhr.storage.time = bookmarkTimes[`${user_id}:${bn}`];
            }
            xhr.modUrl = `${NEW_API}/zFGFGLIm1akEv8PE3uut8w/Bookmarks?${generateParams(
                xhr.storage.features,
                xhr.storage.variables
            )}`;
            openDeferred(xhr);
        },
        sendHandler: (xhr, data) => {
            if (xhr.storage.cancelled) {
                emulateResponse(xhr);
            } else {
                xhr.send(data);
            }
        },
        beforeSendHeaders: (xhr) => {
            xhr.modReqHeaders["Content-Type"] = "application/json";
            xhr.modReqHeaders["X-Twitter-Active-User"] = "yes";
            xhr.modReqHeaders["X-Twitter-Client-Language"] = "en";
            xhr.modReqHeaders["Authorization"] =
                PUBLIC_TOKENS[0];
            delete xhr.modReqHeaders["X-Twitter-Client-Version"];
            // delete xhr.modReqHeaders["x-act-as-user-id"];
        },
        // artificially slow down, because theres an invisible rate limit that gets hit after a few hours
        responseHeaderOverride: {
            "x-rate-limit-limit": (value) => {
                return Math.floor(+value/5);
            },
            "x-rate-limit-remaining": (value) => {
                return Math.floor(+value/5);
            },
        },
        afterRequest: (xhr) => {
            let data;
            try {
                data = JSON.parse(xhr.responseText);
            } catch (e) {
                console.error(e);
                return [];
            }
            // if (data.errors && data.errors[0]) {
            //     return [];
            // }
            let instructions = data?.data?.bookmark_timeline_v2?.timeline?.instructions;
            let entries = instructions?.find((e) => e.type === "TimelineAddEntries");
            if (!entries) {
                return [];
            }
            entries = entries.entries;
            let tweets = [];
            for (let entry of entries) {
                if (entry.entryId.startsWith("tweet-")) {
                    let result = entry.content.itemContent.tweet_results.result;
                    let tweet = safeParseTweet(result);
                    if (tweet) {
                        tweets.push(tweet);
                    }
                } else if (entry.entryId.startsWith("profile-conversation-")) {
                    let items = entry.content.items;
                    for (let i = 0; i < items.length; i++) {
                        let item = items[i];
                        let result = item.item.itemContent.tweet_results.result;
                        if (item.entryId.startsWith("tweet-") || item.entryId.includes("-tweet-")) {
                            let tweet = safeParseTweet(result);
                            if (tweet && tweet.user.id_str === xhr.storage.user_id) {
                                tweets.push(tweet);
                            }
                        }
                    }
                }
            }

            if (tweets.length === 0) return tweets;

            const user_id = xhr.storage.user_id || "0";
            for(let i = 0; i < tweets.length; i++) {
                const tweet = tweets[i];
                const timeKey = `${user_id}:${tweet.id_str}`;
                tweet.receiveTime = bookmarkTimes[timeKey] ?? ((xhr.storage.time ?? Date.now()) - i);
                bookmarkTimes[timeKey] = tweet.receiveTime;
            }

            let cursor = entries.find(
                (e) =>
                    e.entryId.startsWith("sq-cursor-bottom-") ||
                    e.entryId.startsWith("cursor-bottom-")
            )?.content?.value;
            if (cursor) {
                cursors[`bookmarks-${user_id}-${tweets[tweets.length - 1].id_str}`] = cursor;
            }

            return tweets;
        },
    },
    // Notifications column
    {
        path: "/1.1/activity/about_me.json",
        method: "GET",
        inspectResponse: notificationsPageInspector,
        beforeRequest: (xhr) => {
            const params = new URL(xhr.modUrl).searchParams;
            xhr.storage.since_id = params.get("since_id");
            xhr.storage.max_id = params.get("max_id");
            if (params.get("user_id")) {
                xhr.storage.user_id = params.get("user_id");
            }
            xhr.modUrl = notificationsUrl();
        },
        // Which account's cursor applies is only known once legacy has set its headers.
        openHandler: deferOpen,
        beforeSend: (xhr) => {
            xhr.storage.user_id = requestUserId(xhr);
            const cursor = notificationsPollCursor(xhr, "notifications");
            xhr.storage.topPage = !cursor || !!xhr.storage.topPoll;
            xhr.modUrl = notificationsUrl(cursor);
            openDeferred(xhr);
        },
        sendHandler: (xhr, data) => {
            if (xhr.storage.cancelled) {
                emulateResponse(xhr);
            } else if (xhr.storage.topPage) {
                sendNotificationsTopPage(xhr, data, "mentions");
            } else {
                xhr.send(data);
            }
        },
        beforeSendHeaders: (xhr) => {
            xhr.modReqHeaders["Content-Type"] = "application/json";
            xhr.modReqHeaders["X-Twitter-Active-User"] = "yes";
            xhr.modReqHeaders["X-Twitter-Client-Language"] = navigator.language.split("-")[0];
            xhr.modReqHeaders["Authorization"] =
                PUBLIC_TOKENS[0];
            delete xhr.modReqHeaders["X-Twitter-Client-Version"];
        },
        afterRequest: (xhr) => {
            if(xhr.storage.notifications) {
                return xhr.storage.notifications;
            }
            try {
                const { entries, go } = notificationsPage(notificationsResponseText(xhr));
                markNotificationUsers(go);
                const notifications = [];
                const shouldDeliver = notificationDeliveryFilter(xhr.storage.user_id);
                const poll = Boolean(xhr.storage.since_id);
                for(let entry of entries) {
                    try {
                        if(entry.entryId.startsWith("notification-")) {
                            const sortIndex = entry.sortIndex;
                            const item = entry.content.item;
                            const type = item.clientEventInfo.element;
                            const notif = item.content.notification;
    
                            switch(type) {
                                case "users_retweeted_your_retweet":
                                case "users_retweeted_your_tweet":
                                case "user_liked_multiple_tweets": 
                                case "users_liked_your_retweet":
                                case "users_liked_your_tweet": {
                                    const nf = go.notifications[notif.id];
                                    const actions = nf.template.aggregateUserActionsV1;
                                    const users = actions.fromUsers.map(u => u.user.id);
                                    const tweets = actions.targetObjects.map(t => t.tweet.id);
                                    let i = 0;
                                    for(const userId of users) {
                                        for(const tweetId of tweets) {
                                            const user = go.users[userId];
                                            const tweet = notificationTweet(go, tweetId);
                                            const action = type === "users_retweeted_your_tweet" || type === "users_retweeted_your_retweet" ? "retweet" : "favorite";
                                            if(!tweet || !user || userHidden(user)) continue;
                                            const id = legacyNotificationId(action, userId, tweetId);
                                            if(!shouldDeliver(id)) continue;
                                            const notifSortIndex = stableNotificationPosition(id, +sortIndex - (i++));
    
                                            const sources = [user];
                                            const targets = [tweet];
                                            const target_objects = [tweet];
                                            notifications.push({
                                                action,
                                                created_at: formatTwitterStyle(new Date(notifSortIndex)),
                                                max_position: notifSortIndex+"",
                                                min_position: notifSortIndex+"",
                                                sources,
                                                sources_size: sources.length,
                                                target_objects,
                                                target_objects_size: target_objects.length,
                                                targets,
                                                targets_size: targets.length,
                                            })
                                        }
                                    }
                                    break;
                                }
                                case "user_mentioned_you":
                                case "user_replied_to_your_tweet": 
                                case "user_quoted_your_tweet":{
                                    const tweetId = item.content.tweet.id;
                                    const tweet = notificationTweet(go, tweetId);
                                    if(!tweet || tweetHidden(tweet)) continue;
                                    const type = item.clientEventInfo.element === "user_mentioned_you" ? "mention" : item.clientEventInfo.element === "user_replied_to_your_tweet" ? "reply" : "quote";
                                    
                                    const id = legacyNotificationId(type, tweet.user_id_str, tweetId);
                                    if(!shouldDeliver(id)) continue;
                                    const position = stableNotificationPosition(id, +sortIndex);
    
                                    notifications.push({
                                        action: type,
                                        created_at: formatTwitterStyle(new Date(position)),
                                        max_position: position+"",
                                        min_position: position+"",
                                        sources: [tweet.user],
                                        sources_size: 1,
                                        target_objects: [tweet],
                                        target_objects_size: 1,
                                        targets: [tweet],
                                        targets_size: 1,
                                    });
                                    break;
                                }
                                case "follow_from_recommended_user":
                                case "users_followed_you":
                                case "users_accepted_your_follow_request": {
                                    // X added "accepted your follow request" after legacy's API. Its action is derived
                                    // from legacy's follow action once legacy is up (ensureFollowRequestAction).
                                    const action = type === "users_accepted_your_follow_request" ? FOLLOW_REQUEST_ACCEPTED : "follow";
                                    if (action === FOLLOW_REQUEST_ACCEPTED && !ensureFollowRequestAction()) {
                                        noteUnknownNotification(type, "legacy's follow action is not loaded");
                                        break;
                                    }
                                    const nf = go.notifications[notif.id];
                                    const users = nf.template.aggregateUserActionsV1.fromUsers.map(u => u.user.id);
                                    // legacy builds this id from (source user, target user) and OTD hands it the same user for both
                                    const ids = users.map(userId => legacyNotificationId(action, userId, userId));
                                    const fresh = freshAggregateActions(xhr.storage.user_id, notif.id, sortIndex, ids);
                                    for(let i = 0; i < users.length; i++) {
                                        const id = ids[i];
                                        if(poll && !fresh.has(id)) continue;
                                        const user = go.users[users[i]];
                                        if(!user || userHidden(user)) continue;
                                        if(!shouldDeliver(id)) continue;
                                        const position = stableNotificationPosition(id, +sortIndex - i);
                                        notifications.push({
                                            action,
                                            created_at: formatTwitterStyle(new Date(position)),
                                            max_position: position+"",
                                            min_position: position+"",
                                            sources: [user],
                                            sources_size: 1,
                                            target_objects: [user],
                                            target_objects_size: 1,
                                            targets: [user],
                                            targets_size: 1
                                        });
                                    }
                                    break;
                                }
                                case "generic_login_notification":
                                case "generic_acid_notification":
                                case "generic_safety_label_added":
                                    break;
                                default:
                                    noteUnknownNotification(type);
                            }
                        }
                    } catch (e) {
                        console.error(`Error parsing notification`, JSON.stringify(entry));
                    }
                }
                xhr.storage.notifications = notifications;
                storeNotificationCursors(entries, xhr.storage, "notifications");
                return notifications;
            } catch (e) {
                console.error(`Error parsing notifications`, e);
                return [];
            }
        },
    },
    // Mentions timeline
    {
        path: "/1.1/statuses/mentions_timeline.json",
        method: "GET",
        inspectResponse: notificationsPageInspector,
        beforeRequest: (xhr) => {
            const params = new URL(xhr.modUrl).searchParams;
            xhr.storage.since_id = params.get("since_id");
            xhr.storage.max_id = params.get("max_id");
            if (params.get("user_id")) {
                xhr.storage.user_id = params.get("user_id");
            }
            // X's mentions timeline lags the "All" notifications timeline by half an hour or more and does
            // not catch up while being polled, so fetch the "All" page instead and keep only the
            // mention / reply / quote entries below (the cursors stay under their own `mentions-` keys).
            xhr.modUrl = notificationsUrl();
        },
        // Which account's cursor applies is only known once legacy has set its headers.
        openHandler: deferOpen,
        beforeSend: (xhr) => {
            xhr.storage.user_id = requestUserId(xhr);
            const cursor = notificationsPollCursor(xhr, "mentions");
            xhr.storage.topPage = !cursor || !!xhr.storage.topPoll;
            xhr.modUrl = notificationsUrl(cursor);
            openDeferred(xhr);
        },
        sendHandler: (xhr, data) => {
            if (xhr.storage.cancelled) {
                emulateResponse(xhr);
            } else if (xhr.storage.topPage) {
                sendNotificationsTopPage(xhr, data, "interactions");
            } else {
                xhr.send(data);
            }
        },
        beforeSendHeaders: (xhr) => {
            xhr.modReqHeaders["Content-Type"] = "application/json";
            xhr.modReqHeaders["X-Twitter-Active-User"] = "yes";
            xhr.modReqHeaders["X-Twitter-Client-Language"] = "en";
            xhr.modReqHeaders["Authorization"] = PUBLIC_TOKENS[0];
            delete xhr.modReqHeaders["X-Twitter-Client-Version"];
        },
        afterRequest: (xhr) => {
            try {
                const { entries, go } = notificationsPage(notificationsResponseText(xhr));
                markNotificationUsers(go);
                const tweets = [];
                for(let entry of entries) {
                    if(entry.entryId.startsWith("notification-")) {
                        const sortIndex = entry.sortIndex;
                        const item = entry.content.item;
                        const type = item.clientEventInfo.element;

                        switch(type) {
                            case "user_mentioned_you":
                            case "user_replied_to_your_tweet": 
                            case "user_quoted_your_tweet":{
                                const tweet = notificationTweet(go, item.content.tweet.id);
                                if(!tweet || tweetHidden(tweet)) continue;
                                tweets.push(tweet);
                                break;
                            }
                        }
                    }
                }
                storeNotificationCursors(entries, xhr.storage, "mentions");
                return tweets;
            } catch (e) {
                console.error(`Error parsing mentions`, e);
                return [];
            }
        }
    },
    // User likes timeline
    {
        path: "/1.1/favorites/list.json",
        method: "GET",
        beforeRequest: (xhr) => {
            try {
                let url = new URL(xhr.modUrl);
                let params = new URLSearchParams(url.search);
                let user_id = params.get("user_id") ?? getCurrentUserId();
                let variables = {
                    "userId": user_id,
                    "count": 50,
                    "includePromotedContent": false,
                    "withSuperFollowsUserFields": true,
                    "withDownvotePerspective": false,
                    "withReactionsMetadata": false,
                    "withReactionsPerspective": false,
                    "withSuperFollowsTweetFields": true,
                    "withClientEventToken": false,
                    "withBirdwatchNotes": false,
                    "withVoice": true,
                    "withV2Timeline": true
                };
                let features = {
                    "dont_mention_me_view_api_enabled": true,
                    "interactive_text_enabled": true,
                    "responsive_web_uc_gql_enabled": false,
                    "vibe_tweet_context_enabled": false,
                    "responsive_web_edit_tweet_api_enabled": false,
                    "standardized_nudges_misinfo": false,
                    "responsive_web_enhance_cards_enabled": false
                };

                let max_id = params.get("max_id");
                if (max_id) {
                    let bn = BigInt(params.get("max_id"));
                    bn += BigInt(1);
                    if (cursors[`${variables.userId}-${bn}-likes`]) {
                        variables.cursor = cursors[`${variables.userId}-${bn}-likes`];
                    }
                }
                xhr.storage.user_id = variables.userId;

                xhr.modUrl = `${NEW_API}/mzOgReEsktOIIXzWkqf0ig/Likes?${generateParams(
                    features,
                    variables
                )}`;
            } catch (e) {
                console.error(e);
            }
        },
        beforeSendHeaders: (xhr) => {
            xhr.modReqHeaders["Content-Type"] = "application/json";
            xhr.modReqHeaders["X-Twitter-Active-User"] = "yes";
            xhr.modReqHeaders["X-Twitter-Client-Language"] = "en";
            xhr.modReqHeaders["Authorization"] =
                PUBLIC_TOKENS[0];
            delete xhr.modReqHeaders["X-Twitter-Client-Version"];
            // delete xhr.modReqHeaders["x-act-as-user-id"];
        },
        afterRequest: (xhr) => {
            let data;
            try {
                data = JSON.parse(xhr.responseText);
            } catch (e) {
                console.error(e);
                return [];
            }
            // if (data.errors && data.errors[0]) {
            //     return [];
            // }
            let instructions = data?.data?.user?.result?.timeline_v2?.timeline?.instructions;
            let entries = instructions?.find((e) => e.type === "TimelineAddEntries");
            if (!entries) {
                return [];
            }
            entries = entries.entries;

            let tweets = entries
                .filter(e => e.entryId.startsWith('tweet-') && e.content.itemContent.tweet_results.result)
                .map(e => safeParseTweet(e.content.itemContent.tweet_results.result))
                .filter(e => e);

            if (tweets.length === 0) return tweets;

            let cursor = entries.find(
                (e) =>
                    e.entryId.startsWith("sq-cursor-bottom-") ||
                    e.entryId.startsWith("cursor-bottom-")
            )?.content?.value;
            if (cursor) {
                cursors[`${xhr.storage.user_id}-${tweets[tweets.length - 1].id_str}-likes`] = cursor;
            }

            // i didn't know they return tweets unsorted???
            tweets.sort(
                (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
            );

            return tweets;
        },
    },
    // Liking / unliking
    restOrGraphqlRoute("/1.1/lists/ownerships.json", (xhr) => answerListsFromGraph(xhr, "owned")),
    restOrGraphqlRoute("/1.1/lists/subscriptions.json", (xhr) => answerListsFromGraph(xhr, "subscribed")),
    restOrGraphqlRoute("/1.1/blocks/ids.json", (xhr) => answerIdsFromGraph(xhr, "BlockedAccountsAll")),
    restOrGraphqlRoute("/1.1/mutes/users/ids.json", (xhr) => answerIdsFromGraph(xhr, "MutedAccounts")),
    emptyWhenRetiredRoute("/1.1/users/contributees.json"),
    emptyWhenRetiredRoute("/1.1/users/contributees/pending.json"),
    emptyWhenRetiredRoute("/1.1/saved_searches/list.json"),
    friendshipShowRoute,
    friendshipChangeRoute("/1.1/friendships/create.json"),
    friendshipChangeRoute("/1.1/friendships/destroy.json"),
    {
        path: "/1.1/help/configuration.json",
        method: "GET",
        openHandler: () => {},
        sendHandler: emulateResponse,
        afterRequest: () => HELP_CONFIGURATION,
    },
    // Better TweetDeck restricts who can reply by POSTing ConversationControlChange to the old
    // api.x.com/graphql/<id>/ path with a 2023 query id, and shows nothing when that fails. Send it
    // where x.com sends it; once the URL is x.com's, the registry keeps the id and the body's
    // queryId current like any other operation.
    {
        path: /^\/graphql\/[\w-]+\/ConversationControlChange$/,
        method: "POST",
        beforeRequest: (xhr) => {
            const table = graphqlRegistry.table || builtinGraphqlTable();
            const known = table.ops.ConversationControlChange || builtinGraphqlTable().ops.ConversationControlChange;
            xhr.modUrl = `${NEW_API}/${known.id}/ConversationControlChange`;
        },
        beforeSendHeaders: (xhr) => {
            xhr.modReqHeaders["Content-Type"] = "application/json";
            if (!getRequestHeader(xhr, "Authorization")) xhr.modReqHeaders["Authorization"] = PUBLIC_TOKENS[0];
            if (!getRequestHeader(xhr, "X-Csrf-Token")) xhr.modReqHeaders["X-Csrf-Token"] = csrfToken();
            xhr.modReqHeaders["X-Twitter-Auth-Type"] = "OAuth2Session";
            xhr.modReqHeaders["X-Twitter-Active-User"] = "yes";
        },
    },
    {
        path: /\/1\.1\/favorites\/.*\.json/,
        method: "POST",
        beforeRequest: (xhr) => {
            const isFavorite = xhr.modUrl.includes("create.json");
            xhr.storage.isFavorite = isFavorite;

            xhr.modUrl = isFavorite ? 
                `https://${location.hostname}/i/api/graphql/lI07N6Otwv1PhnEgXILM7A/FavoriteTweet` : 
                `https://${location.hostname}/i/api/graphql/ZYKSe-w7KEslx3JhSIk5LA/UnfavoriteTweet`;
        },
        sendHandler: (xhr, data) => {
            const tweet_id = new URLSearchParams(data).get("id");
            xhr.send(JSON.stringify({"variables":{"tweet_id":tweet_id},"queryId":xhr.storage.isFavorite ? "lI07N6Otwv1PhnEgXILM7A" : "ZYKSe-w7KEslx3JhSIk5LA"}));
        },
        beforeSendHeaders: (xhr) => {
            xhr.modReqHeaders["Content-Type"] = "application/json";
            xhr.modReqHeaders["X-Twitter-Active-User"] = "yes";
            xhr.modReqHeaders["X-Twitter-Client-Language"] = "en";
            xhr.modReqHeaders["Authorization"] = PUBLIC_TOKENS[0];
            delete xhr.modReqHeaders["X-Twitter-Client-Version"];
        },
        afterRequest: (xhr) => {
            return {};
        },
    },
    // Collections
    {
        path: /\/1\.1\/collections\/.*\.json/,
        method: "GET",
        openHandler: () => {},
        sendHandler: emulateResponse,
        afterRequest: (xhr) => {
            xhr._status = 404;
            return "";
        },
    },
    {
        path: /\/1\.1\/collections\/.*\.json/,
        method: "POST",
        openHandler: () => {},
        sendHandler: emulateResponse,
        afterRequest: (xhr) => {
            xhr._status = 404;
            return "";
        },
    },
    // User profile. REST users/show is gone; GraphQL ids are the ones current x.com publishes
    // (twitter-openapi placeholder, 2026-10). A missing user stays an error: code 34 on
    // users/show is what TweetDeck turns into "That user does not exist".
    {
        path: "/1.1/users/show.json",
        method: "GET",
        beforeRequest: (xhr) => {
            try {
                const params = new URL(xhr.modUrl).searchParams;
                const screenName = params.get("screen_name");
                const userId = params.get("user_id");
                xhr.storage.screen_name = screenName;
                xhr.storage.user_id = userId;
                if (userId) {
                    xhr.modUrl = `${NEW_API}/mxaYWwt52eAb6OAzYHMVzg/UserByRestId?${generateParams(
                        USER_BY_REST_ID_FEATURES,
                        { userId, withSafetyModeUserFields: true }
                    )}`;
                } else {
                    xhr.modUrl = `${NEW_API}/AMIBMjtxEEATh4z8V9GtRg/UserByScreenName?${generateParams(
                        USER_BY_SCREEN_NAME_FEATURES,
                        { screen_name: screenName || "", withGrokTranslatedBio: true },
                        { withPayments: false, withAuxiliaryUserLabels: true }
                    )}`;
                }
            } catch (e) {
                console.error(e);
            }
        },
        beforeSendHeaders: (xhr) => {
            xhr.modReqHeaders["Content-Type"] = "application/json";
            xhr.modReqHeaders["X-Twitter-Active-User"] = "yes";
            xhr.modReqHeaders["X-Twitter-Client-Language"] = "en";
            xhr.modReqHeaders["Authorization"] = PUBLIC_TOKENS[0];
            delete xhr.modReqHeaders["X-Twitter-Client-Version"];
        },
        afterRequest: (xhr) => {
            let data;
            try {
                data = JSON.parse(xhr.responseText);
            } catch (e) {
                xhr._status = 404;
                return { errors: [{ code: 34, message: "That user does not exist" }] };
            }
            const result = data?.data?.user?.result;
            const user = legacyUserFromGraph(result);
            if (!user) {
                xhr._status = 404;
                return { errors: [{ code: 34, message: "That user does not exist" }] };
            }
            return user;
        },
    },
    // List members. The edit-members modal reads one page (it asks for 5000 and does not follow
    // next_cursor), so this returns the first GraphQL page, capped at 100.
    {
        path: "/1.1/lists/members.json",
        method: "GET",
        beforeRequest: (xhr) => {
            try {
                const params = new URL(xhr.modUrl).searchParams;
                let count = parseInt(params.get("count") || "20", 10);
                if (!count || count < 1) count = 20;
                if (count > 100) count = 100;
                const variables = { listId: params.get("list_id"), count };
                const cursor = params.get("cursor");
                if (cursor && cursor !== "-1" && cursor !== "0") variables.cursor = cursor;
                xhr.modUrl = `${NEW_API}/fFCNliJG5Gq4yEnINo6-1A/ListMembers?${generateParams(
                    LIST_MEMBERS_FEATURES,
                    variables
                )}`;
            } catch (e) {
                console.error(e);
            }
        },
        beforeSendHeaders: (xhr) => {
            xhr.modReqHeaders["Content-Type"] = "application/json";
            xhr.modReqHeaders["X-Twitter-Active-User"] = "yes";
            xhr.modReqHeaders["X-Twitter-Client-Language"] = "en";
            xhr.modReqHeaders["Authorization"] = PUBLIC_TOKENS[0];
            delete xhr.modReqHeaders["X-Twitter-Client-Version"];
        },
        afterRequest: (xhr) => {
            let data;
            try {
                data = JSON.parse(xhr.responseText);
            } catch (e) {
                console.error(e);
                xhr._status = 503;
                return { errors: [{ message: "Could not read list members" }] };
            }
            if (data?.errors && !listMemberTimeline(data)) {
                xhr._status = 503;
                return { errors: [{ message: data.errors[0]?.message || "Could not read list members" }] };
            }
            const entries = listMemberEntries(data);
            const users = [];
            for (const entry of entries) {
                const result = entry?.content?.itemContent?.user_results?.result
                    || entry?.content?.itemContent?.userResults?.result
                    || entry?.content?.content?.user_results?.result;
                const user = legacyUserFromGraph(result);
                if (user) users.push(user);
            }
            const bottom = entries.find((e) => e.entryId && (e.entryId.startsWith("cursor-bottom-") || e.entryId.startsWith("sq-cursor-bottom-")))?.content?.value;
            return {
                users,
                next_cursor: 0,
                next_cursor_str: bottom || "0",
                previous_cursor: 0,
                previous_cursor_str: "0",
            };
        },
    },
    {
        path: "/1.1/lists/members/create.json",
        method: "POST",
        beforeRequest: (xhr) => {
            xhr.storage.queryId = "-Kf1YVC1rNKkPvPFk7YXZw";
            xhr.storage.operation = "ListAddMember";
            xhr.modUrl = `${NEW_API}/-Kf1YVC1rNKkPvPFk7YXZw/ListAddMember`;
        },
        beforeSendHeaders: listMemberMutationHeaders,
        sendHandler: (xhr, body) => { sendListMemberMutation(xhr, body); },
        afterRequest: (xhr) => listMutationResult(xhr),
    },
    {
        path: "/1.1/lists/members/destroy.json",
        method: "POST",
        beforeRequest: (xhr) => {
            xhr.storage.queryId = "_2o1-wSMWGFSi5HUscn1Hw";
            xhr.storage.operation = "ListRemoveMember";
            xhr.modUrl = `${NEW_API}/_2o1-wSMWGFSi5HUscn1Hw/ListRemoveMember`;
        },
        beforeSendHeaders: listMemberMutationHeaders,
        sendHandler: (xhr, body) => { sendListMemberMutation(xhr, body); },
        afterRequest: (xhr) => listMutationResult(xhr),
    },
    {
        path: "/1.1/lists/members/create_all.json",
        method: "POST",
        beforeRequest: (xhr) => {
            xhr.storage.queryId = "-Kf1YVC1rNKkPvPFk7YXZw";
            xhr.storage.operation = "ListAddMember";
            xhr.storage.many = true;
            xhr.modUrl = `${NEW_API}/-Kf1YVC1rNKkPvPFk7YXZw/ListAddMember`;
        },
        beforeSendHeaders: listMemberMutationHeaders,
        sendHandler: (xhr, body) => { sendListMemberMutation(xhr, body); },
        afterRequest: (xhr) => listMutationResult(xhr),
    },
    // Search
    {
        path: "/1.1/search/universal.json",
        method: "GET",
        beforeRequest: (xhr) => {
            try {
                let url = new URL(xhr.modUrl);
                let params = new URLSearchParams(url.search);
                let variables = {
                    rawQuery: params.get("q"),
                    count: 20,
                    querySource: "typed_query",
                    product: "Latest",
                };
                let features = {"responsive_web_graphql_exclude_directive_enabled":true,"verified_phone_label_enabled":false,"creator_subscriptions_tweet_preview_api_enabled":true,"responsive_web_graphql_timeline_navigation_enabled":true,"responsive_web_graphql_skip_user_profile_image_extensions_enabled":false,"communities_web_enable_tweet_community_results_fetch":true,"c9s_tweet_anatomy_moderator_badge_enabled":true,"tweetypie_unmention_optimization_enabled":true,"responsive_web_edit_tweet_api_enabled":true,"graphql_is_translatable_rweb_tweet_is_translatable_enabled":true,"view_counts_everywhere_api_enabled":true,"longform_notetweets_consumption_enabled":true,"responsive_web_twitter_article_tweet_consumption_enabled":true,"tweet_awards_web_tipping_enabled":false,"freedom_of_speech_not_reach_fetch_enabled":true,"standardized_nudges_misinfo":true,"tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled":true,"rweb_video_timestamps_enabled":true,"longform_notetweets_rich_text_read_enabled":true,"longform_notetweets_inline_media_enabled":true,"responsive_web_enhance_cards_enabled":false};

                xhr.storage.query = variables.rawQuery;
                xhr.storage.cursor = params.get("since_id");
                xhr.modUrl = `${NEW_API}/f7SuGIm11eLbQs7c0K9X9w/SearchTimeline?${generateParams(
                    features,
                    variables
                )}`;
            } catch (e) {
                console.error(e);
            }
        },
        openHandler: (xhr, method, url, async, username, password) => {
            if(!timings.search[xhr.storage.query]) {
                timings.search[xhr.storage.query] = 0;
            }
            if(Date.now() - timings.search[xhr.storage.query] < 60000*1.5 && xhr.storage.cursor) {
                xhr.storage.cancelled = true;
            } else {
                xhr.open(method, url, async, username, password);
                timings.search[xhr.storage.query] = Date.now();
            }
        },
        sendHandler: (xhr, data) => {
            if(xhr.storage.cancelled) {
                emulateResponse(xhr);
            } else {
                xhr.send(data);
            }
        },
        beforeSendHeaders: (xhr) => {
            xhr.modReqHeaders["Content-Type"] = "application/json";
            xhr.modReqHeaders["X-Twitter-Active-User"] = "yes";
            xhr.modReqHeaders["X-Twitter-Client-Language"] = "en";
            xhr.modReqHeaders["Authorization"] =
                PUBLIC_TOKENS[0];
            delete xhr.modReqHeaders["X-Twitter-Client-Version"];
        },
        afterRequest: (xhr) => {
            if(xhr.storage.cancelled) {
                return [];
            }
            let data;
            try {
                data = JSON.parse(xhr.responseText);
            } catch (e) {
                console.error(e);
                return [];
            }
            // if (data.errors && data.errors[0]) {
            //     return [];
            // }
            let instructions = data?.data?.search_by_raw_query?.search_timeline?.timeline?.instructions;
            let entries = instructions?.find((i) => i.entries);
            if (!entries) {
                return [];
            }
            entries = entries.entries;
            let res = [];
            for (let entry of entries) {
                if (entry.entryId.startsWith("sq-I-t-") || entry.entryId.startsWith("tweet-")) {
                    let result = entry.content.itemContent.tweet_results.result;

                    if (isPromoted(entry)) {
                        continue;
                    }
                    let tweet = safeParseTweet(result);
                    if (!tweet || tweetHidden(tweet)) {
                        continue;
                    }
                    res.push(tweet);
                }
            }
            let cursor = entries.find(
                (e) =>
                    e.entryId.startsWith("sq-cursor-bottom-") ||
                    e.entryId.startsWith("cursor-bottom-")
            );
            if (cursor) {
                cursor = cursor.content.value;
            } else {
                cursor = instructions.find(
                    (e) =>
                        e.entry_id_to_replace &&
                        (e.entry_id_to_replace.startsWith("sq-cursor-bottom-") ||
                            e.entry_id_to_replace.startsWith("cursor-bottom-"))
                );
                if (cursor) {
                    cursor = cursor.entry.content.value;
                } else {
                    cursor = null;
                }
            }

            return {
                metadata: {
                    cursor,
                    refresh_interval_in_sec: 30,
                },
                modules: res.map((t) => ({ status: { data: t } })),
            };
        },
    },
    // User search
    {
        path: "/1.1/users/search.json",
        method: "GET",
        beforeRequest: (xhr) => {
            try {
                let url = new URL(xhr.modUrl);
                let params = new URLSearchParams(url.search);
                let variables = {
                    rawQuery: params.get("q"),
                    count: 20,
                    querySource: "typed_query",
                    product: "People",
                };
                let features = {
                    rweb_lists_timeline_redesign_enabled: false,
                    responsive_web_graphql_exclude_directive_enabled: true,
                    verified_phone_label_enabled: false,
                    creator_subscriptions_tweet_preview_api_enabled: true,
                    responsive_web_graphql_timeline_navigation_enabled: true,
                    responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
                    tweetypie_unmention_optimization_enabled: true,
                    responsive_web_edit_tweet_api_enabled: true,
                    graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
                    view_counts_everywhere_api_enabled: true,
                    longform_notetweets_consumption_enabled: true,
                    responsive_web_twitter_article_tweet_consumption_enabled: false,
                    tweet_awards_web_tipping_enabled: false,
                    freedom_of_speech_not_reach_fetch_enabled: true,
                    standardized_nudges_misinfo: true,
                    tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
                    longform_notetweets_rich_text_read_enabled: true,
                    longform_notetweets_inline_media_enabled: true,
                    responsive_web_media_download_video_enabled: false,
                    responsive_web_enhance_cards_enabled: false,
                };

                xhr.modUrl = `${NEW_API}/f7SuGIm11eLbQs7c0K9X9w/SearchTimeline?${generateParams(
                    features,
                    variables
                )}`;
            } catch (e) {
                console.error(e);
            }
        },
        beforeSendHeaders: (xhr) => {
            xhr.modReqHeaders["Content-Type"] = "application/json";
            xhr.modReqHeaders["X-Twitter-Active-User"] = "yes";
            xhr.modReqHeaders["X-Twitter-Client-Language"] = "en";
            xhr.modReqHeaders["Authorization"] =
                PUBLIC_TOKENS[0];
            delete xhr.modReqHeaders["X-Twitter-Client-Version"];
        },
        afterRequest: (xhr) => {
            let data;
            try {
                data = JSON.parse(xhr.responseText);
            } catch (e) {
                console.error(e);
                return [];
            }
            if (data.errors && data.errors[0]) {
                return [];
            }
            let instructions = data.data.search_by_raw_query.search_timeline.timeline.instructions;
            let entries = instructions.find((i) => i.entries);
            if (!entries) {
                return [];
            }
            entries = entries.entries;
            let res = [];
            for (let entry of entries) {
                if (entry.entryId.startsWith("sq-I-u-") || entry.entryId.startsWith("user-")) {
                    // Users come without `legacy` now; legacyUserFromGraph builds the v1.1 user either way.
                    const user = legacyUserFromGraph(entry.content.itemContent.user_results?.result);
                    if (!user) {
                        console.log("Bug: no user", entry);
                        continue;
                    }
                    res.push(user);
                }
            }
            let cursor = entries.find(
                (e) =>
                    e.entryId.startsWith("sq-cursor-bottom-") ||
                    e.entryId.startsWith("cursor-bottom-")
            );
            if (cursor) {
                cursor = cursor.content.value;
            } else {
                cursor = instructions.find(
                    (e) =>
                        e.entry_id_to_replace &&
                        (e.entry_id_to_replace.startsWith("sq-cursor-bottom-") ||
                            e.entry_id_to_replace.startsWith("cursor-bottom-"))
                );
                if (cursor) {
                    cursor = cursor.entry.content.value;
                } else {
                    cursor = null;
                }
            }

            return res;
        },
    },
    // Tweet creation
    {
        path: "/1.1/statuses/update.json",
        method: "POST",
        beforeRequest: (xhr) => {
            xhr.modUrl = `https://${location.hostname}/i/api/graphql/5CVj-J0FZWyGgJpcjeBJEA/CreateTweet`;
        },
        beforeSendHeaders: (xhr) => {
            xhr.modReqHeaders["Content-Type"] = "application/json";
            xhr.modReqHeaders["X-Twitter-Active-User"] = "yes";
            xhr.modReqHeaders["X-Twitter-Client-Language"] = "en";
            xhr.modReqHeaders["Authorization"] = PUBLIC_TOKENS[0];
            delete xhr.modReqHeaders["X-Twitter-Client-Version"];
        },
        beforeSendBody: (xhr, body) => {
            let params = Object.fromEntries(new URLSearchParams(body));
            let variables = {
                tweet_text: params.status,
                media: {
                    media_entities: [],
                    possibly_sensitive: false,
                },
                semantic_annotation_ids: [],
                dark_request: false,
            };
            if (params.in_reply_to_status_id) {
                variables.reply = {
                    in_reply_to_tweet_id: params.in_reply_to_status_id,
                    exclude_reply_user_ids: [],
                };
                if (params.exclude_reply_user_ids) {
                    variables.reply.exclude_reply_user_ids =
                        params.exclude_reply_user_ids.split(",");
                }
            }
            if (params.media_ids) {
                variables.media.media_entities = params.media_ids
                    .split(",")
                    .map((id) => ({ media_id: id, tagged_users: [] }));
            }
            if (params.attachment_url) {
                variables.attachment_url = params.attachment_url;
            }

            return JSON.stringify({
                variables,
                features: {"communities_web_enable_tweet_community_results_fetch":true,"c9s_tweet_anatomy_moderator_badge_enabled":true,"tweetypie_unmention_optimization_enabled":true,"responsive_web_edit_tweet_api_enabled":true,"graphql_is_translatable_rweb_tweet_is_translatable_enabled":true,"view_counts_everywhere_api_enabled":true,"longform_notetweets_consumption_enabled":true,"responsive_web_twitter_article_tweet_consumption_enabled":true,"tweet_awards_web_tipping_enabled":false,"creator_subscriptions_quote_tweet_preview_enabled":false,"longform_notetweets_rich_text_read_enabled":true,"longform_notetweets_inline_media_enabled":true,"articles_preview_enabled":true,"rweb_video_timestamps_enabled":true,"rweb_tipjar_consumption_enabled":true,"responsive_web_graphql_exclude_directive_enabled":true,"verified_phone_label_enabled":false,"freedom_of_speech_not_reach_fetch_enabled":true,"standardized_nudges_misinfo":true,"tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled":true,"responsive_web_graphql_skip_user_profile_image_extensions_enabled":false,"responsive_web_graphql_timeline_navigation_enabled":true,"responsive_web_enhance_cards_enabled":false},
                queryId: "5CVj-J0FZWyGgJpcjeBJEA",
            });
        },
        afterRequest: (xhr) => {
            let data;
            try {
                data = JSON.parse(xhr.responseText);
            } catch (e) {
                console.error(e);
                return {};
            }
            if (data.errors && data.errors[0]) {
                return {};
            }
            let tweet = parseTweet(data.data.create_tweet.tweet_results.result);
            return tweet;
        },
    },
    // Retweeting
    {
        path: /\/1.1\/statuses\/retweet\/(\d+).json/,
        method: "POST",
        beforeRequest: (xhr) => {
            let originalUrl = new URL(xhr.originalUrl);
            xhr.storage.tweet_id = originalUrl.pathname.match(
                /\/1.1\/statuses\/retweet\/(\d+).json/
            )[1];
            xhr.storage.retweeter = getCurrentUserId();
            xhr.modUrl = `https://${location.hostname}/i/api/graphql/mbRO74GrOvSfRcJnlMapnQ/CreateRetweet`;
        },
        beforeSendHeaders: (xhr) => {
            xhr.modReqHeaders["Content-Type"] = "application/json";
            xhr.modReqHeaders["X-Twitter-Active-User"] = "yes";
            xhr.modReqHeaders["X-Twitter-Client-Language"] = "en";
            xhr.modReqHeaders["Authorization"] = PUBLIC_TOKENS[0];
            delete xhr.modReqHeaders["X-Twitter-Client-Version"];
            if (xhr.modReqHeaders["x-act-as-user-id"]) {
                xhr.storage.retweeter = xhr.modReqHeaders["x-act-as-user-id"];
            }
        },
        beforeSendBody: (xhr, body) => {
            return JSON.stringify({
                variables: {
                    tweet_id: xhr.storage.tweet_id,
                    dark_request: false,
                },
                queryId: "mbRO74GrOvSfRcJnlMapnQ",
            });
        },
        afterRequest: (xhr) => {
            let data;
            try {
                data = JSON.parse(xhr.responseText);
            } catch (e) {
                console.error(e);
                return {};
            }
            if (data.errors && data.errors[0]) {
                return {};
            }
            let res = data.data.create_retweet.retweet_results.result;
            let tweet = res.legacy;
            tweet.id_str = res.rest_id;
            if (!tweet.user) {
                tweet.user = {
                    id_str: xhr.storage.retweeter,
                };
            }
            return tweet;
        },
    },
    // Unretweeting
    {
        path: /\/1.1\/statuses\/unretweet\/(\d+).json/,
        method: "POST",
        beforeRequest: (xhr) => {
            let originalUrl = new URL(xhr.originalUrl);
            xhr.storage.tweet_id = originalUrl.pathname.match(
                /\/1.1\/statuses\/unretweet\/(\d+).json/
            )[1];
            xhr.storage.retweeter = getCurrentUserId();
            xhr.modUrl = `https://${location.hostname}/i/api/graphql/ZyZigVsNiFO6v1dEks1eWg/DeleteRetweet`;
        },
        beforeSendHeaders: (xhr) => {
            xhr.modReqHeaders["Content-Type"] = "application/json";
            xhr.modReqHeaders["X-Twitter-Active-User"] = "yes";
            xhr.modReqHeaders["X-Twitter-Client-Language"] = "en";
            xhr.modReqHeaders["Authorization"] =
                PUBLIC_TOKENS[0];
            delete xhr.modReqHeaders["X-Twitter-Client-Version"];
            if (xhr.modReqHeaders["x-act-as-user-id"]) {
                xhr.storage.retweeter = xhr.modReqHeaders["x-act-as-user-id"];
            }
        },
        beforeSendBody: (xhr, body) => {
            return JSON.stringify({
                variables: { source_tweet_id: xhr.storage.tweet_id, dark_request: false },
                queryId: "ZyZigVsNiFO6v1dEks1eWg",
            });
        },
        afterRequest: (xhr) => {
            let data;
            try {
                data = JSON.parse(xhr.responseText);
            } catch (e) {
                console.error(e);
                return {};
            }
            if (data.errors && data.errors[0]) {
                return {};
            }
            let res = data.data.unretweet.source_tweet_results.result;
            let tweet = res.legacy;
            tweet.id_str = res.rest_id;
            if (!tweet.user) {
                tweet.user = {
                    id_str: xhr.storage.retweeter,
                };
            }
            return tweet;
        },
    },
    // Getting tweet details
    {
        path: /\/1.1\/statuses\/show\/(\d+).json/,
        method: "GET",
        beforeRequest: (xhr) => {
            let originalUrl = new URL(xhr.originalUrl);
            xhr.storage.tweet_id = originalUrl.pathname.match(
                /\/1.1\/statuses\/show\/(\d+).json/
            )[1];
            xhr.modUrl = `https://${location.hostname}/i/api/graphql/gJoREC4Bspo4kJ0ax9C3sQ/TweetDetail?variables=${encodeURIComponent(
                JSON.stringify({
                    focalTweetId: xhr.storage.tweet_id,
                    with_rux_injections: false,
                    includePromotedContent: false,
                    withCommunity: true,
                    withQuickPromoteEligibilityTweetFields: true,
                    withBirdwatchNotes: true,
                    withVoice: true,
                    withV2Timeline: true,
                })
            )}&features=${encodeURIComponent(
                JSON.stringify({
                    rweb_lists_timeline_redesign_enabled: false,
                    blue_business_profile_image_shape_enabled: true,
                    responsive_web_graphql_exclude_directive_enabled: true,
                    verified_phone_label_enabled: false,
                    creator_subscriptions_tweet_preview_api_enabled: false,
                    responsive_web_graphql_timeline_navigation_enabled: true,
                    responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
                    tweetypie_unmention_optimization_enabled: true,
                    vibe_api_enabled: true,
                    responsive_web_edit_tweet_api_enabled: true,
                    graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
                    view_counts_everywhere_api_enabled: true,
                    longform_notetweets_consumption_enabled: true,
                    tweet_awards_web_tipping_enabled: false,
                    freedom_of_speech_not_reach_fetch_enabled: true,
                    standardized_nudges_misinfo: true,
                    tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: false,
                    interactive_text_enabled: true,
                    responsive_web_text_conversations_enabled: false,
                    longform_notetweets_rich_text_read_enabled: true,
                    longform_notetweets_inline_media_enabled: false,
                    responsive_web_enhance_cards_enabled: false,
                })
            )}`;
        },
        beforeSendHeaders: (xhr) => {
            xhr.modReqHeaders["Content-Type"] = "application/json";
            xhr.modReqHeaders["X-Twitter-Active-User"] = "yes";
            xhr.modReqHeaders["X-Twitter-Client-Language"] = "en";
            xhr.modReqHeaders["Authorization"] =
                PUBLIC_TOKENS[0];
            delete xhr.modReqHeaders["X-Twitter-Client-Version"];
        },
        afterRequest: (xhr) => {
            let data;
            try {
                data = JSON.parse(xhr.responseText);
            } catch (e) {
                console.error(e);
                return {};
            }
            if (data.errors && data.errors[0]) {
                return {};
            }
            let ic = data.data.threaded_conversation_with_injections_v2.instructions
                .find((i) => i.type === "TimelineAddEntries")
                .entries.find((e) => e.entryId === `tweet-${xhr.storage.tweet_id}`)
                .content.itemContent;
            let res = ic.tweet_results.result;
            let tweet = parseTweet(res, { expandNotes: true });
            return tweet;
        },
    },
    {
        path: "/1.1/statuses/show.json",
        method: "GET",
        beforeRequest: (xhr) => {
            let originalUrl = new URL(xhr.originalUrl);
            xhr.storage.tweet_id = originalUrl.searchParams.get("id");
            xhr.modUrl = `https://${location.hostname}/i/api/graphql/gJoREC4Bspo4kJ0ax9C3sQ/TweetDetail?variables=${encodeURIComponent(
                JSON.stringify({
                    focalTweetId: xhr.storage.tweet_id,
                    with_rux_injections: false,
                    includePromotedContent: false,
                    withCommunity: true,
                    withQuickPromoteEligibilityTweetFields: true,
                    withBirdwatchNotes: true,
                    withVoice: true,
                    withV2Timeline: true,
                })
            )}&features=${encodeURIComponent(
                JSON.stringify({
                    rweb_lists_timeline_redesign_enabled: false,
                    blue_business_profile_image_shape_enabled: true,
                    responsive_web_graphql_exclude_directive_enabled: true,
                    verified_phone_label_enabled: false,
                    creator_subscriptions_tweet_preview_api_enabled: false,
                    responsive_web_graphql_timeline_navigation_enabled: true,
                    responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
                    tweetypie_unmention_optimization_enabled: true,
                    vibe_api_enabled: true,
                    responsive_web_edit_tweet_api_enabled: true,
                    graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
                    view_counts_everywhere_api_enabled: true,
                    longform_notetweets_consumption_enabled: true,
                    tweet_awards_web_tipping_enabled: false,
                    freedom_of_speech_not_reach_fetch_enabled: true,
                    standardized_nudges_misinfo: true,
                    tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: false,
                    interactive_text_enabled: true,
                    responsive_web_text_conversations_enabled: false,
                    longform_notetweets_rich_text_read_enabled: true,
                    longform_notetweets_inline_media_enabled: false,
                    responsive_web_enhance_cards_enabled: false,
                })
            )}`;
        },
        beforeSendHeaders: (xhr) => {
            xhr.modReqHeaders["Content-Type"] = "application/json";
            xhr.modReqHeaders["X-Twitter-Active-User"] = "yes";
            xhr.modReqHeaders["X-Twitter-Client-Language"] = "en";
            xhr.modReqHeaders["Authorization"] =
                PUBLIC_TOKENS[0];
            delete xhr.modReqHeaders["X-Twitter-Client-Version"];
        },
        afterRequest: (xhr) => {
            let data;
            try {
                data = JSON.parse(xhr.responseText);
            } catch (e) {
                console.error(e);
                return {};
            }
            if (data.errors && data.errors[0]) {
                return {};
            }
            let ic = data.data.threaded_conversation_with_injections_v2.instructions
                .find((i) => i.type === "TimelineAddEntries")
                .entries.find((e) => e.entryId === `tweet-${xhr.storage.tweet_id}`)
                .content.itemContent;
            let res = ic.tweet_results.result;
            let tweet = parseTweet(res, { expandNotes: true });
            return tweet;
        },
    },
    // Tweet deletion
    {
        path: /\/1.1\/statuses\/destroy\/(\d+).json/,
        method: "POST",
        beforeRequest: (xhr) => {
            let originalUrl = new URL(xhr.originalUrl);
            xhr.storage.tweet_id = originalUrl.pathname.match(
                /\/1.1\/statuses\/destroy\/(\d+).json/
            )[1];
            xhr.modUrl = `https://${location.hostname}/i/api/graphql/nxpZCY2K-I6QoFHAHeojFQ/DeleteTweet`;
        },
        beforeSendHeaders: (xhr) => {
            xhr.modReqHeaders["Content-Type"] = "application/json";
            xhr.modReqHeaders["X-Twitter-Active-User"] = "yes";
            xhr.modReqHeaders["X-Twitter-Client-Language"] = "en";
            xhr.modReqHeaders["Authorization"] =
                PUBLIC_TOKENS[0];
            delete xhr.modReqHeaders["X-Twitter-Client-Version"];
        },
        beforeSendBody: (xhr, body) => {
            return JSON.stringify({
                variables: { tweet_id: xhr.storage.tweet_id, dark_request: false },
                queryId: "nxpZCY2K-I6QoFHAHeojFQ",
            });
        },
    },
    // Tweet replies
    {
        path: /\/2\/timeline\/conversation\/(\d+).json/,
        method: "GET",
        // REST while it answers (see "v1.1 endpoints x.com itself no longer calls"); TweetDetail,
        // which x.com reads, once a 404 / 410 is remembered or with OTDpreferGraphql.
        openHandler: deferOpen,
        beforeSend: (xhr) => {
            xhr.storage.graphql = useGraphqlFor("/2/timeline/conversation/{id}.json");
            if (!xhr.storage.graphql) openDeferred(xhr);
        },
        sendHandler: (xhr, body) => {
            if (xhr.storage.graphql) answerConversationFromGraph(xhr, xhr.storage.tweet_id);
            else xhr.send(body);
        },
        beforeRequest: (xhr) => {
            let originalUrl = new URL(xhr.originalUrl);
            xhr.storage.tweet_id = originalUrl.pathname.match(/\/2\/timeline\/conversation\/(\d+)\.json/)?.[1];
            let params = new URLSearchParams(originalUrl.search);

            params.delete("ext");
            params.delete("include_ext_has_nft_avatar");
            params.delete("include_ext_is_blue_verified");
            params.delete("include_ext_verified_type");
            params.delete("include_ext_sensitive_media_warning");
            params.delete("include_ext_media_color");

            originalUrl.search = params.toString();

            xhr.modUrl = originalUrl.toString();
        },
        beforeSendHeaders: (xhr) => {
            xhr.modReqHeaders["X-Twitter-Active-User"] = "yes";
            xhr.modReqHeaders["X-Twitter-Client-Language"] = "en";
            xhr.modReqHeaders["Authorization"] =
                PUBLIC_TOKENS[0];
            delete xhr.modReqHeaders["X-Twitter-Client-Version"];
        },
        afterRequest: (xhr) => {
            let data;
            try {
                data = JSON.parse(xhr.responseText);
            } catch (e) {
                console.error(e);
                return data;
            }
            if (data.errors && data.errors[0]) {
                return data;
            }
            for (let id in data.globalObjects.tweets) {
                let tweet = data.globalObjects.tweets[id];
                for (const status of [tweet, tweet.retweeted_status, tweet.quoted_status, tweet.retweeted_status?.quoted_status]) {
                    const card = parseTweetCard({ legacy: status?.card });
                    if (card) status.card = card;
                }

                if (!tweet.contributors) tweet.contributors = null;
                if (tweet.conversation_id_str)
                    tweet.conversation_id = parseInt(tweet.conversation_id_str);
                if (!tweet.coordinates) tweet.coordinates = null;
                if (!tweet.conversation_muted) tweet.conversation_muted = false;
                if (!tweet.favorited) tweet.favorited = false;
                if (!tweet.geo) tweet.geo = null;
                if (!tweet.id) tweet.id = parseInt(id);
                if (!tweet.in_reply_to_screen_name) tweet.in_reply_to_screen_name = null;
                if (!tweet.in_reply_to_status_id) tweet.in_reply_to_status_id = null;
                if (!tweet.in_reply_to_status_id_str) tweet.in_reply_to_status_id_str = null;
                if (!tweet.in_reply_to_user_id) tweet.in_reply_to_user_id = null;
                if (!tweet.in_reply_to_user_id_str) tweet.in_reply_to_user_id_str = null;
                if (!tweet.is_quote_status) tweet.is_quote_status = false;
                if (!tweet.place) tweet.place = null;
                if (!tweet.supplemental_language) tweet.supplemental_language = null;
                if (!tweet.retweeted) tweet.retweeted = false;
                if (!tweet.truncated) tweet.truncated = false;
                if (!tweet.user_id) tweet.user_id = parseInt(tweet.user_id_str);
            }

            for (let id in data.globalObjects.users) {
                let user = data.globalObjects.users[id];

                if (!user.default_profile) user.default_profile = false;
                if (!user.default_profile_image) user.default_profile_image = false;
                if (!user.entities.description) user.entities.description = { urls: [] };
                if (!user.entities.description.urls) user.entities.description.urls = [];
                if (!user.entities.url) user.entities.url = { urls: [] };
                if (!user.entities.url.urls) user.entities.url.urls = [];
                if (!user.follow_request_sent) user.follow_request_sent = false;
                if (!user.following) user.following = false;
                if (!user.has_extended_profile) user.has_extended_profile = false;
                if (!user.is_translation_enabled) user.is_translation_enabled = false;
                if (!user.is_translator) user.is_translator = false;
                if (!user.followed_by) user.followed_by = false;
                if (!user.id) user.id = parseInt(id);
                if (!user.lang) user.lang = null;
                if (!user.notifications) user.notifications = false;
                if (!user.profile_background_color) user.profile_background_color = "C0DEED";
                if (!user.profile_background_image_url)
                    user.profile_background_image_url =
                        "http://abs.twimg.com/images/themes/theme1/bg.png";
                if (!user.profile_background_image_url_https)
                    user.profile_background_image_url_https =
                        "https://abs.twimg.com/images/themes/theme1/bg.png";
                if (!user.profile_background_tile) user.profile_background_tile = false;
                if (!user.profile_link_color) user.profile_link_color = "1DA1F2";
                if (!user.profile_image_url && user.profile_image_url_https)
                    user.profile_image_url = user.profile_image_url_https.replace(
                        "https://",
                        "http://"
                    );
                if (!user.profile_sidebar_border_color)
                    user.profile_sidebar_border_color = "000000";
                if (!user.profile_sidebar_fill_color) user.profile_sidebar_fill_color = "DDEEF6";
                if (!user.profile_text_color) user.profile_text_color = "333333";
                if (!user.profile_use_background_image) user.profile_use_background_image = true;
                if (!user.protected) user.protected = false;
                if (!user.require_some_consent) user.require_some_consent = false;
                if (!user.time_zone) user.time_zone = null;
                if (!user.utc_offset) user.utc_offset = null;
                if (!user.verified) user.verified = false;
            }

            const hiddenTweetIds = new Set();
            for (const id in data.globalObjects.tweets) {
                const tweet = data.globalObjects.tweets[id];
                const author = data.globalObjects.users?.[tweet.user_id_str];
                const retweeted = tweet.retweeted_status && data.globalObjects.users?.[tweet.retweeted_status.user_id_str];
                if (userHidden(author) || userHidden(retweeted)) hiddenTweetIds.add(id);
                const quoted = tweet.quoted_status;
                const quotedUser = quoted && (data.globalObjects.users?.[quoted.user_id_str] || quoted.user);
                if (userHidden(quotedUser)) {
                    delete tweet.quoted_status;
                    tweet.is_quote_status = false;
                }
            }
            for (const id of hiddenTweetIds) delete data.globalObjects.tweets[id];

            let entries = data.timeline.instructions.find((i) => i.addEntries);
            if (entries) {
                entries.addEntries.entries = entries.addEntries.entries.filter(
                    (e) => !e.entryId.startsWith("tweetComposer-") && !hiddenTweetIds.has(e.entryId.replace(/^tweet-/, ""))
                );
                for (let entry of entries.addEntries.entries) {
                    if (entry.entryId.startsWith("conversationThread-")) {
                        let newContent = {
                            item: {
                                content: {
                                    conversationThread: {
                                        conversationComponents: [],
                                    },
                                },
                            },
                        };
                        if (entry.content.timelineModule.items)
                            for (let item of entry.content.timelineModule.items) {
                                if (item.item && item.item.content && item.item.content.tweet) {
                                    const tweetId = String(item.item.content.tweet.id_str || item.item.content.tweet.id || "");
                                    if (hiddenTweetIds.has(tweetId)) continue;
                                    newContent.item.content.conversationThread.conversationComponents.push(
                                        {
                                            conversationTweetComponent: {
                                                tweet: item.item.content.tweet,
                                            },
                                        }
                                    );
                                }
                            }
                        entry.content = newContent;
                    }
                }
            }

            return data;
        },
    },
    // getting user
    {
        path: "/1.1/account/verify_credentials.json",
        method: "GET",
        beforeRequest: (xhr) => {
            // xhr.modUrl = `https://x.com/home/`;
        },
        beforeSendHeaders: (xhr) => {
            // delete xhr.modReqHeaders["Content-Type"];
            // delete xhr.modReqHeaders["X-Twitter-Active-User"];
            // delete xhr.modReqHeaders["X-Twitter-Client-Language"];
            // delete xhr.modReqHeaders["X-Twitter-Auth-Type"];
            // delete xhr.modReqHeaders["Authorization"];
            // delete xhr.modReqHeaders["X-Csrf-Token"];
            xhr.storage.user_id = xhr.modReqHeaders["x-act-as-user-id"];
            xhr.modReqHeaders["Content-Type"] = "application/json";
            xhr.modReqHeaders["X-Twitter-Active-User"] = "yes";
            xhr.modReqHeaders["X-Twitter-Client-Language"] = "en";
            xhr.modReqHeaders["Authorization"] =
                PUBLIC_TOKENS[0];
            delete xhr.modReqHeaders["X-Twitter-Client-Version"];
        },
        // Legacy reads the status first: a refusal is turned into the stand-in here, before that.
        inspectResponse: (xhr) => {
            if (xhr.storage.user_id) return;
            let data = null;
            try {
                data = JSON.parse(xhr.responseText);
            } catch (e) {
                // not JSON: an error page, or nothing
            }
            if (xhr.status >= 200 && xhr.status < 300 && data?.id_str && !data.errors) return;
            // a retired endpoint (404, 410) or a broken one (5xx); a refused session (401, 403) must
            // still reach the login screen, and a rate limit (429) its own message
            if (xhr.status !== 404 && xhr.status !== 410 && xhr.status < 500) return;
            const standIn = standInLoginUser();
            if (!standIn) return;
            console.warn(`OldTweetDeck: X answered account verification with ${xhr.status}; using ${standIn.source}`);
            xhr.storage.standIn = standIn.user;
            xhr._status = 200;
            xhr._statusText = "OK";
            // once a day, so that a retired endpoint is noticed without nagging on every start
            const noticedAt = Number(localStorage.OTDverifyStandInNoticedAt) || 0;
            if (Date.now() - noticedAt > 24 * 60 * 60 * 1000) {
                localStorage.OTDverifyStandInNoticedAt = String(Date.now());
                toastWhenReady(`X no longer confirms your account to TweetDeck (${xhr.status}); OldTweetDeck used ${standIn.source} instead. `
                    + "If the profile shown is wrong, open x.com in another tab, then reload TweetDeck.");
            }
        },
        afterRequest: (xhr) => {
            const data = xhr.storage.standIn ?? JSON.parse(xhr.responseText);
            try {
                if(!xhr.storage.user_id && !data.errors) {
                    localStorage.OTDverifiedUser = JSON.stringify(data);
                    verifiedUser = data;
                    if (data.id_str) ensureAccount(data.id_str);
                } 
            } catch (e) {
                console.error('error parsing verified user', e);
            }
            return data;
        },
    },
    // DM messages
    {
        path: /\/1.1\/dm\/conversation\/(\d+)-(\d+).json/,
        method: "GET",
        afterRequest: (xhr) => {
            return xhr.responseText.replaceAll("\\/\\/ton.twitter.com\\/1.1", "\\/\\/ton.x.com\\/i");
        }
    },
    // Inbox
    {
        path: "/1.1/dm/user_updates.json",
        method: "GET",
        afterRequest: (xhr) => {
            return xhr.responseText.replaceAll("\\/\\/ton.twitter.com\\/1.1", "\\/\\/ton.x.com\\/i");
        }
    },
    // Translating tweets
    {
        path: "/1.1/translations/show.json",
        method: "GET",
        beforeRequest: (xhr) => {
            let url = new URL(xhr.modUrl);
            let params = new URLSearchParams(url.search);
            let tweet_id = params.get("id");
            let dest = params.get("dest");
            xhr.modUrl = `https://${location.hostname}/i/api/1.1/strato/column/None/tweetId=${tweet_id},destinationLanguage=None,translationSource=Some(Google),feature=None,timeout=None,onlyCached=None/translation/service/translateTweet`;
        },
        beforeSendHeaders: (xhr) => {
            xhr.modReqHeaders["Content-Type"] = "application/json";
            xhr.modReqHeaders["X-Twitter-Active-User"] = "yes";
            xhr.modReqHeaders["X-Twitter-Client-Language"] = navigator.language.split("-")[0];
            xhr.modReqHeaders["Authorization"] =
                PUBLIC_TOKENS[0];
            delete xhr.modReqHeaders["X-Twitter-Client-Version"];
        },
        afterRequest: (xhr) => {
            const response = JSON.parse(xhr.responseText);

            return JSON.stringify({
                text: response.translation,
                entities: response.entities,
                translated_lang: response.sourceLanguage,
            });
        }
    },

    // TweetDeck state
    {
        path: "/1.1/tweetdeck/clients/blackbird/all",
        method: "GET",
        openHandler: () => {},
        sendHandler: async (xhr) => {
            // Account verification and state loading run concurrently on first login.
            // Do not build default settings until verification has supplied the ID.
            const deadline = Date.now() + 20000;
            while (!settings && !verifiedUser?.id_str) {
                if (Date.now() >= deadline) {
                    // Complete the request as an error so TweetDeck can show its
                    // normal login error instead of leaving an unresolved spinner.
                    if (xhr.storage) xhr.storage.failure = { kind: "verification-timeout" };
                    xhr._status = 503;
                    xhr._responseText = JSON.stringify({ errors: [{
                        message: "Account verification timed out. Please refresh TweetDeck.",
                    }] });
                    emulateResponse(xhr);
                    return;
                }
                await new Promise(resolve => setTimeout(resolve, 50));
            }
            if (verifiedUser?.id_str) ensureAccount(verifiedUser.id_str);
            emulateResponse(xhr);
        },
        afterRequest: (xhr) => {
            const state = {
                client: {
                    columns: columnIdsOfActive(),
                    mtime: new Date().toISOString(),
                    name: "blackbird",
                    settings: settings ?? {
                        account_whitelist: [`twitter:${verifiedUser.id_str}`],
                        default_account: `twitter:${verifiedUser.id_str}`,
                        recent_searches: [],
                        display_sensitive_media: false,
                        name_cache: {
                            customTimelines: {},
                            lists: {},
                            users: {}
                        },
                        navbar_width: "full-size",
                        previous_splash_version: "4.0.220811153004",
                        show_search_filter_callout: false,
                        show_trends_filter_callout: false,
                        theme: "light",
                        use_narrow_columns: null,
                        version: 2
                    },
                },
                columns: columns ?? {},
                decider: {},
                feeds: feeds ?? {},
                messages: [],
                new: true
            };
            if(!settings) {
                settings = state.client.settings;
                persistAccountState();
            }
            cleanUp();
            keepLegacyPollerCache();
            relaxLegacyExhaustion();
            tuneLegacyPolling();
            noteUnencryptedDm();
            console.log('account state', state);

            return state;
        },
    },
    // emulate sending state data
    {
        path: "/1.1/tweetdeck/clients/blackbird",
        method: "POST",
        responseHeaderOverride: {
            "x-td-mtime": () => {
                return new Date().toISOString();
            },
        },
        openHandler: () => {},
        sendHandler: emulateResponse,
        beforeSendBody: (xhr, body) => {
            let json = JSON.parse(body);
            console.log('state push', json);
            if(json.columns) {
                writeColumnIds(json.columns);
            }
            if(json.settings && settings) {
                for(let key in json.settings) {
                    settings[key] = json.settings[key];
                }
                persistAccountState();
            }
            cleanUp();
            return body;
        },
        afterRequest: (xhr) => {
            return "";
        }
    },
    // emulate sending feeds
    {
        path: "/1.1/tweetdeck/feeds",
        method: "POST",
        responseHeaderOverride: {
            "X-Td-Mtime": () => {
                return new Date().toISOString();
            },
        },
        openHandler: () => {},
        sendHandler: emulateResponse,
        beforeSendBody: (xhr, body) => {
            let json = JSON.parse(body);
            let ids = [];
            for(let i = 0; i < json.length; i++) {
                const id = json[i].id ?? generateID();
                ids.push(id);
                feeds[id] = json[i];
            }
            xhr.storage.ids = ids;
            persistAccountState();
            console.log('feeds push', json, ids);
            return body;
        },
        afterRequest: (xhr) => {
            return xhr.storage.ids;
        }
    },
    // emulate sending columns
    {
        path: "/1.1/tweetdeck/columns",
        method: "POST",
        responseHeaderOverride: {
            "X-Td-Mtime": () => {
                return new Date().toISOString();
            },
        },
        openHandler: () => {},
        sendHandler: emulateResponse,
        beforeSendBody: (xhr, body) => {
            let json = JSON.parse(body);
            let ids = [];
            for(let i = 0; i < json.length; i++) {
                const id = json[i].id ?? generateID();
                ids.push(id);
                columns[id] = json[i];
            }
            xhr.storage.ids = ids;
            persistAccountState();
            console.log('columns push', json, ids);
            return body;
        },
        afterRequest: (xhr) => {
            return xhr.storage.ids;
        }
    },
    // tweetdeck stuff
    {
        path: "/decider",
        method: "GET",
        openHandler: () => {},
        sendHandler: emulateResponse,
        afterRequest: (xhr) => {
            console.log("Got decider");
            return {"decider":{"tweetdeck_subsequent_follows":true,"scheduler_write":true,"in_reply_to_indicator":true,"enable_cors_firefox":true,"create_moment":true,"simplified_edit_collection_flow":true,"suggest_refresh":true,"poll_streamed_feed_favorites":true,"disable_oauth_echo":true,"scheduler_read_visible":true,"upload_big_gifs":true,"cookie_force_migrate":true,"action_retweeted_retweet":true,"native_animated_gifs":true,"touchdeck_sidebar_v2":true,"account_settings_join_team_flow":true,"enable_rewrite_columns":true,"touchdeck_font_size_v2":true,"touchdeck_search_v2":true,"disable_typeahead_search_with_feather_v2":true,"dataminr_proxied_auth_flow":true,"disable_streaming":true,"abuse_emergency_filter_info":true,"poll_streamed_feed_home":true,"compose_quoted_tweet_as_attachment":true,"send_twitter_auth_type_header":true,"dataminr":true,"heartfave_animation":true,"touchdeck_column_options_v2":true,"tweets_emoji":true,"column_unread_bar":true,"with_video_upload":true,"continuous_pipeline_staging":true,"universal_search_timelines":true,"machine_translated_tweets":true,"hashflags":true,"scheduler_read_background":true,"cookie_streaming":true,"poll_streamed_feed_usertweets":true,"faster_notifications":false,"disable_scheduled_messages":true,"streamed_chirp_lookup_metrics":true,"tweet_up_to_four_images":true,"sample_failed_requests":true,"iq_tweets":true,"add_column_by_url_query_param":true,"use_twitter_api_sync":true,"track_search_engagement":true,"quote_tweet_read":true,"cookie_access_tweetdeck":true,"account_settings_redesign":true,"windows_migration_logged_in_2":true,"tweetstorms":true,"action_favorited_retweet":true,"tweetdeck_subsequent_likes":true,"touchdeck_tweet_controls_v3":true,"trends_tailored":true,"live_video_timelines":true,"slow_collection_refresh":true,"fetch_entire_blocklist":true,"report_flow_iframe":true,"tweet_hide_suffix":true,"windows_migration_warning_2":true,"version_poll_force_upgrade":true,"quote_tweet_write":true,"poll_cards_enabled":true,"version_poll":true,"migrate_chrome_app_session_to_web":true,"add_account":true,"disable_quote_tweet_unavailable_msg":true,"convert_new_oauth_account_to_contributor":true,"iq_rts":true,"migrate_mac_app_session_to_web_gt_3_9_482":true,"enable_cors_2":true,"windows_migration_logged_out_2":true,"simplified_replies":true,"scheduler_write_media":true,"multi_photo_media_grid":true,"touchdeck_modals_v2":true,"non_destructive_chirp_rerender":true,"touchdeck_dropdowns_v2":true,"umf_prompts":true,"cramming":true,"trends_regional":true,"cookie_td_cookie_migration":true,"universal_search_timelines_by_id":true,"add_account_via_xauth_2":true,"native_video":true,"chirp_lateness_metric":true,"upload_use_sru":true,"mute_conversation":true,"action_quoted_tweet":true,"dm_rounded_avatars":true,"compose_character_limit_do_not_count_attachments":true,"touchdeck_compose_v2":true,"autocomplete_remote_sources":true,"cards_enabled_detail_view":true}};
        },
    },
    {
        path: "/web/dist/version.json",
        method: "GET",
        openHandler: () => {},
        sendHandler: emulateResponse,
        afterRequest: (xhr) => {
            console.log("Got version.json");
            return {"version":"4.0.220811153004","minimum":"4.0.190610153508"};
        },
    },
    {
        path: "/1.1/help/settings.json",
        method: "GET",
        openHandler: () => {},
        sendHandler: emulateResponse,
        afterRequest: (xhr) => {
            console.log("Got settings.json");
            return {"versions":{"feature_switches":"a6da3a3fb61e9c1423276a8df0da3258980b42cf","experiments":"a6da3a3fb61e9c1423276a8df0da3258980b42cf","settings":"a88b5266c59f52ccf8a8f1fd85f2b92a"},"config":{"live_engagement_in_column_8020":{"value":"live_engagement_enabled"},"tweetdeck_activity_streaming":{"value":false},"tweetdeck_content_render_search_tweets":{"value":true},"tweetdeck_live_engagements":{"value":true},"tweetdeck_scheduled_new_api":{"value":true},"tweetdeck_trends_column":{"value":true},"twitter_text_emoji_counting_enabled":{"value":true}},"impression_pointers":{}};
        },
    },
    {
        path: "/i/jot",
        method: "GET",
        openHandler: () => {},
        sendHandler: emulateResponse,
        afterRequest: (xhr) => {
            return "";
        },
    },
];

// wrap the XMLHttpRequest
XMLHttpRequest = function () {
    return new Proxy(new OriginalXHR(), {
        open(method, url, async, username = null, password = null) {
            this.modMethod = method;
            this.modUrl = url;
            this.originalUrl = url;
            this.modReqHeaders = {};
            this.modOpen = { async, username, password };
            this.storage = {};


            try {
                let parsedUrl = new URL(url);
                this.proxyRoute = proxyRoutes.find((route) => {
                    if(!route) return false;
                    if (route.method.toUpperCase() !== method.toUpperCase()) return false;
                    if (typeof route.path === "string") {
                        return route.path === parsedUrl.pathname;
                    } else if (route.path instanceof RegExp) {
                        return route.path.test(parsedUrl.pathname);
                    }
                });
            } catch (e) {
                console.error(e);
            }
            if (this.proxyRoute && this.proxyRoute.beforeRequest) {
                this.proxyRoute.beforeRequest(this);
            }

            // both handlers must be set, because if openHandler never opens the request 'send' will always error
            if(this.proxyRoute && this.proxyRoute.openHandler && this.proxyRoute.sendHandler) {
                this.proxyRoute.openHandler(this, this.modMethod, this.modUrl, async, username, password);
            } else {
                this.open(this.modMethod, this.modUrl, async, username, password);
            }
        },
        setRequestHeader(name, value) {
            this.modReqHeaders[name] = value;
        },
        async send(body = null) {
            // The route may still need the headers legacy set after open() (the acting account)
            // to finish its URL, so it gets one last look before anything is sent.
            if (this.proxyRoute && this.proxyRoute.beforeSend) {
                try {
                    this.proxyRoute.beforeSend(this);
                } catch (e) {
                    console.error(e);
                    this.storage.cancelled = true;
                    this._status = 503;
                }
            }
            rememberStartupRequest(this);
            watchStartup();
            let parsedUrl = new URL(this.modUrl);
            let method = this.modMethod;
            if(!method) {
                method = "GET";
            } else {
                method = method.toUpperCase();
            }
            if(
                this.readyState === 1 &&
                (
                    this.modUrl.includes("api.twitter.com") || 
                    this.modUrl.includes("api.x.com") || 
                    this.modUrl.includes("twitter.com/i/api") ||
                    this.modUrl.includes("x.com/i/api")
                )
            ) {
                if(localStorage.device_id) this.setRequestHeader('X-Client-UUID', localStorage.device_id);
                if(Date.now() - OTD_INIT_TIME < 3000 && !window.solveChallenge) {
                    console.log('waiting for challenge');
                    let i = 0;
                    while(!window.solveChallenge && i++ < 50) {
                        await new Promise(resolve => setTimeout(resolve, 100));
                    }
                }
                // x.com's query id and features for this operation, when its bundles were read
                if (graphqlOperationOf(this.modUrl)) {
                    await awaitGraphqlRegistry();
                    if (applyGraphqlRegistryUrl(this) && this.readyState === 1) {
                        // The raw request was opened with the route's URL: open it again with this
                        // one. The headers are set below, after this.
                        const open = this.storage.open || this.modOpen || {};
                        this.open(this.modMethod || "GET", this.modUrl, open.async ?? true, open.username ?? null, open.password ?? null);
                    }
                    parsedUrl = new URL(this.modUrl);
                }
                if(window.solveChallenge) {
                    try {
                        this.setRequestHeader('x-client-transaction-id', await solveChallenge(parsedUrl.pathname, method));
                    } catch (e) {
                        // Rethrowing leaves the XHR neither sent nor finished. Legacy has no
                        // timeout, so the column stays on "Loading…". Complete it as a failure.
                        console.error(`Challenge error for ${method} ${parsedUrl.pathname}:`, e);
                        failWithoutRequest(this, `challenge solver failed for ${method} ${parsedUrl.pathname}`);
                        this.storage.failure = { kind: "solver", detail: String(e) };
                        emulateResponse(this);
                        return;
                    }
                }
            }
            if (this.proxyRoute && this.proxyRoute.beforeSendHeaders) {
                this.proxyRoute.beforeSendHeaders(this);
            }
            try {
                for (const [name, value] of Object.entries(this.modReqHeaders)) {
                    this.setRequestHeader(name, value);
                }
            } catch(e) {
                if(!String(e).includes('OPENED')) {
                    console.error(e);
                }
            }
            if (this.proxyRoute && this.proxyRoute.beforeSendBody) {
                body = this.proxyRoute.beforeSendBody(this, body);
            }
            body = flattenArrayParams(this, body);
            body = applyGraphqlRegistryBody(this, body);
            if(this.proxyRoute && this.proxyRoute.sendHandler) {
                this.proxyRoute.sendHandler(this, body);
            } else {
                this.send(body);
            }
        },
        get(xhr, key) {
            if (!key in xhr) return undefined;
            if (
                (key === "status" || key === "statusText" || key === "responseText") &&
                xhr.readyState === 4 && !xhr._inspected &&
                xhr.proxyRoute && xhr.proxyRoute.inspectResponse
            ) {
                // Legacy reads status before responseText, so a route that wants to fail a 200
                // whose body is only an error looks at the response here, once, before either.
                xhr._inspected = true;
                try {
                    xhr.proxyRoute.inspectResponse(xhr);
                } catch (e) {
                    console.error(e);
                }
            }
            if (key === "status" && !xhr._failureChecked && (xhr.readyState === 4 || xhr._readyState === 4)) {
                xhr._failureChecked = true;
                try {
                    graphqlRegistryOnResponse(xhr);
                } catch (e) {
                    console.error(e);
                }
                try {
                    noteRestRetirement(xhr);
                } catch (e) {
                    console.error(e);
                }
                try {
                    noteRequestFailure(xhr, failureFromStatus(xhr));
                } catch (e) {
                    console.error(e);
                }
            }
            if (key === "responseText" && xhr._responseText) return xhr._responseText;
            if (key === "responseText") return this.interceptResponseText(xhr);
            if (key === "readyState" && xhr._readyState) return xhr._readyState;
            if (key === "status" && xhr._status) return xhr._status;
            if (key === "statusText" && (xhr._statusText || xhr._status)) return xhr._statusText ? xhr._statusText : xhr._status+"";

            let value = xhr[key];
            if (typeof value === "function") {
                value = this[key] || value;
                return (...args) => value.apply(xhr, args);
            } else {
                return value;
            }
        },
        set(xhr, key, value) {
            if (key in xhr) {
                xhr[key] = value;
            }
            return value;
        },
        interceptResponseText(xhr) {
            if (xhr.proxyRoute && xhr.proxyRoute.afterRequest) {
                let out;
                try {
                    out = xhr.proxyRoute.afterRequest(xhr);
                } catch (e) {
                    // jQuery reads responseText after detaching its handlers, so a throw here (a
                    // 429 or an HTML error page that is not JSON) left the request unfinished for
                    // good: the startup spinner, or "Loading…" in a column. A body that is not
                    // JSON makes jQuery fail the request as a parse error instead.
                    console.error(`OldTweetDeck: could not read the response for ${xhr.modUrl}`, e);
                    noteRequestFailure(xhr, { kind: "unreadable", status: xhr._status || xhr.status });
                    return "OldTweetDeck: unreadable response";
                }
                if (typeof out === "object") {
                    return JSON.stringify(out);
                } else {
                    return out;
                }
            }
            return xhr.responseText;
        },
        getResponseHeader(name) {
            let override = this.responseHeaderOverride ? this.responseHeaderOverride : this.proxyRoute ? this.proxyRoute.responseHeaderOverride : undefined;
            if(this.proxyRoute && override) {
                for(let header in override) {
                    if(header.toLowerCase() === name.toLowerCase()) {
                        return override[header](this.getResponseHeader(header));
                    }
                }
            }
            return this.getResponseHeader(name);
        },
        getAllResponseHeaders() {
            let headers = this.getAllResponseHeaders();

            let override = this.responseHeaderOverride ? this.responseHeaderOverride : this.proxyRoute ? this.proxyRoute.responseHeaderOverride : undefined;
            if (this.proxyRoute && override) {
                let splitHeaders = headers.split("\r\n");
                let objHeaders = {};
                for (let header of splitHeaders) {
                    let splitHeader = header.split(": ");
                    let headerName = splitHeader[0];
                    let headerValue = splitHeader[1];
                    objHeaders[headerName.toLowerCase()] = headerValue;
                }
                for(let header in override) {
                    objHeaders[header.toLowerCase()] = override[header](objHeaders[header.toLowerCase()], objHeaders);
                }
                headers = Object.entries(objHeaders).filter(([_, value]) => value).map(([name, value]) => `${name}: ${value}`).join("\r\n");
            }

            return headers;
        },
    });
};
