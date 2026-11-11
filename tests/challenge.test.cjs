const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync('src/challenge.js', 'utf8');

// The solver iframe is created but #injected-body never appears, so it is never attached.
function load() {
    const timers = [];
    const iframe = { style: {}, contentWindow: null, listeners: [], addEventListener(type, fn) { this.listeners.push(fn); } };
    const context = vm.createContext({
        document: { createElement: () => iframe, getElementById: () => null },
        window: { addEventListener() {} },
        fetch: () => new Promise(() => {}), indexedDB: { open: () => ({}) },
        setTimeout: (fn, ms) => timers.push({ fn, ms }), setInterval: () => 1, clearInterval() {},
        localStorage: {}, location: { hostname: 'x.com' }, console: { ...console, log() {}, warn() {}, error() {} },
    });
    vm.runInContext(source, context);
    const solve = vm.runInContext('solveChallenge', context);
    const run = (ms) => timers.filter((t) => t.ms === ms).forEach((t) => t.fn());
    return { iframe, run, solve: (...args) => solve(...args).then(() => 'solved', (e) => e) };
}

// Without the fix this solve never settles, so fail it instead of hanging the run.
test('a solve fails when the solver iframe never loads', { timeout: 2000 }, async () => {
    const { solve, run } = load();
    const outcome = solve('/1.1/account/verify_credentials.json', 'GET');
    run(30000);
    assert.equal(await outcome, 'Solver did not load');
});

test('once the iframe has loaded, the usual 20 s timeout applies', async () => {
    const { solve, run, iframe } = load();
    const outcome = solve('/1.1/account/verify_credentials.json', 'GET');
    const posted = [];
    iframe.contentWindow = { postMessage: (message) => posted.push(message.action) };
    iframe.listeners.forEach((fn) => fn());
    run(30000);
    run(20000);
    assert.deepEqual(posted, ['solve']);
    assert.equal(await outcome, 'Solver timed out');
});

// x.com's localforage store as far as the device id needs it: the given entries, or a failing open.
function fakeIndexedDB(entries) {
    return {
        open() {
            const request = {};
            Promise.resolve().then(() => {
                if (!entries) return request.onerror({ type: 'error' });
                const db = {
                    objectStoreNames: { contains: (name) => name === 'keyvaluepairs' },
                    transaction: () => ({ objectStore: () => ({ openCursor() {
                        const cursorRequest = {};
                        let i = 0;
                        const step = () => Promise.resolve().then(() => {
                            const entry = entries[i++];
                            cursorRequest.onsuccess({ target: { result: entry ? { key: entry[0], value: entry[1], continue: step } : null } });
                        });
                        step();
                        return cursorRequest;
                    } }) }),
                };
                request.onsuccess({ target: { result: db } });
            });
            return request;
        },
    };
}
async function deviceIdAfter(entries, stored) {
    const localStorage = stored ? { device_id: stored } : {};
    const context = vm.createContext({
        document: { createElement: () => ({ style: {}, addEventListener() {} }), getElementById: () => null },
        window: { addEventListener() {} },
        fetch: () => new Promise(() => {}), indexedDB: fakeIndexedDB(entries),
        setTimeout() {}, setInterval: () => 1, clearInterval() {},
        localStorage, location: { hostname: 'x.com' }, console: { ...console, log() {}, warn() {}, error() {} },
    });
    vm.runInContext(source, context);
    await new Promise((resolve) => setImmediate(resolve));
    return localStorage.device_id;
}

test("the device id is x.com's own or none: it is never made up, and a made-up one is dropped", async () => {
    const key = ['device:rweb.dmCryptoKeys.1', { deviceId: 'real-device' }];
    assert.equal(await deviceIdAfter([['other', {}], key]), 'real-device');
    assert.equal(await deviceIdAfter([key], 'made-up-before'), 'real-device');
    // no key on x.com: no X-Client-UUID, as on x.com
    assert.equal(await deviceIdAfter([['other', {}]]), undefined);
    assert.equal(await deviceIdAfter([], 'made-up-before'), undefined);
    // a read that failed says nothing about the key: what is stored stays, nothing is invented
    assert.equal(await deviceIdAfter(null, 'stored'), 'stored');
    assert.equal(await deviceIdAfter(null), undefined);
});
