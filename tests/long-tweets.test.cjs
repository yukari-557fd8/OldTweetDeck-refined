const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

// What files/bundle.js does with a long post that src/interception.js left cut: the "Expand tweet"
// link under its text, and the click that swaps in the whole text (tests/parse-tweet.test.cjs has
// the other half, which posts get marked).
const source = fs.readFileSync('files/bundle.js', 'utf8');

// Source of the function that starts at or right after `marker`.
function method(marker, scope = {}) {
    const at = source.indexOf(marker);
    assert.notEqual(at, -1, marker);
    const start = source.indexOf('function', at);
    let depth = 0;
    for (let i = source.indexOf('{', start); i < source.length; i++) {
        if (source[i] === '{') depth++;
        else if (source[i] === '}' && --depth === 0) return new Function(...Object.keys(scope), `return (${source.slice(start, i + 1)});`)(...Object.values(scope));
    }
    throw new Error('unterminated ' + marker);
}

const TD = { util: { transform: (text) => `<t>${text}</t>` } };
const generateHTMLText = method('TD.services.TwitterStatus.prototype._generateHTMLText = ', { TD });
const chirp = (fields) => {
    const made = { id: '70', user: { screenName: 'alice' }, retweetedStatus: null, isLongTweetCut: false, ...fields };
    generateHTMLText.call(made);
    return made.htmlText;
};
const link = (id) => `onclick="expandTweet(event, '${id}')" class="expand-tweet" data-clicked="false">Expand tweet</a>`;

test('a post marked as cut gets Expand tweet whatever its length', () => {
    // 60 characters and 500 (a reply's hidden "@name @name ..." counts): outside the old 100 to 399
    for (const text of ['あ'.repeat(59) + '…', 'a'.repeat(499) + '…', 'cut here… https://t.co/aaaaaaaaaa', 'no ellipsis at all']) {
        assert.ok(chirp({ text, isLongTweetCut: true }).endsWith(link('70')), text.slice(-20));
    }
});

test('a retweet of a cut post expands the retweeted post', () => {
    const html = chirp({ id: '900', text: 'cut here…', retweetedStatus: { id: '70', isLongTweetCut: true } });
    assert.ok(html.endsWith(link('70')));
});

test('other posts are judged as before', () => {
    assert.equal(chirp({ text: 'short…' }), '<t>short…</t>');
    assert.equal(chirp({ text: 'a'.repeat(150) }), `<t>${'a'.repeat(150)}</t>`);
    // unmarked, ending in "…" and 100 to 399 long: the guess from before the mark
    assert.ok(chirp({ text: 'a'.repeat(150) + '…' }).endsWith(link('70')));
    assert.ok(chirp({ text: 'a'.repeat(150) + '… https://t.co/aaaaaaaaaa' }).endsWith(link('70')));
    assert.ok(!chirp({ text: 'a'.repeat(450) + '…' }).includes('expand-tweet'));
});

test('TweetDeck keeps the mark of a cut post when it builds the chirp', () => {
    const at = source.indexOf('TD.services.TwitterStatus.prototype.fromJSONObject = ');
    const body = source.slice(at, source.indexOf('TD.services.TwitterStatus.prototype.fromGraphQLJSONObject = ', at));
    assert.match(body, /this\.isLongTweetCut = Boolean\(e\.otd_long_tweet_cut\)/);
});

// The click: one request for the whole tweet, then the paragraph's content is replaced.
function click(respond) {
    const requests = [];
    class XMLHttpRequest {
        open(method, url) { this.url = url; }
        setRequestHeader() {}
        send() { requests.push(this); respond(this); }
    }
    const expandTweet = method('function expandTweet(e, tweet_id)', {
        XMLHttpRequest, TD, location: { hostname: 'x.com' }, document: { cookie: 'ct0=abc123' },
    });
    const paragraph = { innerHTML: 'cut… <a>Expand tweet</a>' };
    const target = { dataset: { clicked: 'false' }, parentElement: paragraph, style: {}, innerText: 'Expand tweet', onclick() {} };
    const event = { target, prevented: false, preventDefault() { this.prevented = true; } };
    expandTweet(event, '70');
    return { requests, paragraph, target, event, again: () => expandTweet(event, '70') };
}
const answer = (status, body, states = [4]) => (xhr) => {
    for (const readyState of states) {
        Object.assign(xhr, { readyState, status: readyState === 4 ? status : 0, responseText: readyState === 4 ? body : '' });
        xhr.onreadystatechange();
    }
};

test('Expand tweet asks for the tweet once and shows its whole text', () => {
    const run = click(answer(200, JSON.stringify({ full_text: 'the whole text', entities: {} }), [2, 3, 4]));
    assert.equal(run.event.prevented, true);
    assert.equal(run.requests[0].url, 'https://api.x.com/1.1/statuses/show/70.json');
    assert.equal(run.paragraph.innerHTML, '<t>the whole text</t>');
    assert.equal(run.target.style.color, undefined, 'no error shown while the answer was on its way');
    run.again();
    assert.equal(run.requests.length, 1);
});

test('Expand tweet leaves the text alone when the whole one did not come', () => {
    // {} is what the statuses/show route answers when X returns errors
    for (const respond of [answer(200, '{}'), answer(200, 'not json'), answer(404, ''), answer(0, '')]) {
        const run = click(respond);
        assert.equal(run.paragraph.innerHTML, 'cut… <a>Expand tweet</a>');
        assert.equal(run.target.innerText, 'Error');
        assert.equal(run.target.style.color, 'red');
    }
});
