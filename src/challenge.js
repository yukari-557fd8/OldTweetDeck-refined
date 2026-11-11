let solveId = 0;
let solveCallbacks = {};
let solverErrored = false;
let ready = false;

let solverIframe = document.createElement('iframe');
solverIframe.style.position = 'absolute';
solverIframe.width = '0px';
solverIframe.height = '0px';
solverIframe.style.border = 'none';
solverIframe.style.opacity = 0;
solverIframe.style.pointerEvents = 'none';
solverIframe.tabIndex = -1;
solverIframe.src = "https://tweetdeck.dimden.dev/solver.html?4"; // check source code of that page to make sure its safe if u dont trust it
fetch(solverIframe.src).catch(() => {
    console.error("Cannot load solver iframe");
    solverErrored = true;
    for(let id in solveCallbacks) {
        solveCallbacks[id].reject('Solver errored');
        delete solveCallbacks[id];
    }
});
let injectedBody = document.getElementById('injected-body');
if(injectedBody) injectedBody.appendChild(solverIframe);
else {
    let int = setInterval(() => {
        injectedBody = document.getElementById('injected-body');
        if(injectedBody) {
            clearInterval(int);
            injectedBody.appendChild(solverIframe);
        }
    }, 50);
}

function solveChallenge(path, method) {
    return new Promise((resolve, reject) => {
        if(solverErrored) {
            reject('Solver errored');
            return;
        }
        let id = solveId++;
        solveCallbacks[id] = { resolve, reject, time: Date.now() };
        if(!solverIframe.contentWindow) {
            let loaded = false;
            // The iframe may never load (blocked, or #injected-body never shows up). Fail the
            // request then too, or it is never sent and its column never stops loading.
            setTimeout(() => {
                if(!loaded && solveCallbacks[id]) {
                    solveCallbacks[id].reject('Solver did not load');
                    delete solveCallbacks[id];
                }
            }, 30000);
            solverIframe.addEventListener('load', () => {
                loaded = true;
                solverIframe.contentWindow.postMessage({ action: 'solve', id, path, method }, '*');
                setTimeout(() => {
                    if(solveCallbacks[id]) {
                        // try again
                        solverIframe.contentWindow.postMessage({ action: 'solve', id, path, method }, '*');
                    }
                }, 5000);
                setTimeout(() => {
                    if(solveCallbacks[id]) {
                        solveCallbacks[id].reject('Solver timed out');
                        delete solveCallbacks[id];
                    }
                }, 20000);
            });
        } else {
            solverIframe.contentWindow.postMessage({ action: 'solve', id, path, method }, '*');
            setTimeout(() => {
                if(solveCallbacks[id]) {
                    // try again
                    solverIframe.contentWindow.postMessage({ action: 'solve', id, path, method }, '*');
                }
            }, 5000);
            setTimeout(() => {
                if(solveCallbacks[id]) {
                    solveCallbacks[id].reject('Solver timed out');
                    delete solveCallbacks[id];
                }
            }, 20000);
        }
    });
}

window.addEventListener('message', e => {
    if(e.source !== solverIframe.contentWindow) return;
    let data = e.data;
    if(data.action === 'solved') {
        let { id, result } = data;
        if(solveCallbacks[id]) {
            solveCallbacks[id].resolve(result);
            delete solveCallbacks[id];
        }
    } else if(data.action === 'error') {
        let { id, error } = data;
        if(solveCallbacks[id]) {
            solveCallbacks[id].reject(error);
            delete solveCallbacks[id];
        }
    } else if(data.action === 'initError') {
        console.error('Solver init error:', data.error);
        solverErrored = true;
        for(let id in solveCallbacks) {
            solveCallbacks[id].reject('Solver errored');
            delete solveCallbacks[id];
        }
    } else if(data.action === 'ready') {
        ready = true;
    }
});

(async () => {
    try {
        // Older builds kept a device id here (x.com's DM key id, or one they made up) and sent it
        // as X-Client-UUID. x.com's page sends that header only once its on-demand DM key module
        // has run, which never happens in TweetDeck: none of x.com's own requests in the HARs of
        // 2026-11-11 had it. interception.js no longer sends it, so the id is dropped.
        delete localStorage.device_id;

        // interception.js reads the same page for x.com's GraphQL query ids; whichever asks first fetches it.
        if(!window.OTDhomepage) {
            window.OTDhomepage = fetch(`https://${location.hostname}/`).then(res => res.text());
            window.OTDhomepage.catch(() => { delete window.OTDhomepage; });
        }
        let homepageData = await window.OTDhomepage;
        let dom = new DOMParser().parseFromString(homepageData, 'text/html');
        let anims = Array.from(dom.querySelectorAll('svg[id^="loading-x"]')).map(svg => svg.outerHTML);

        let vendorCode = homepageData.match(/vendor.(\w+).js"/)[1];
        let challengePos = homepageData.match(/(\d+):"ondemand.s"/)[1];
        let challengeCode = homepageData.match(new RegExp(`${challengePos}:"(\\w+)"`))[1];
        let challengeData = await fetch(`https://abs.twimg.com/responsive-web/client-web/ondemand.s.${challengeCode}a.js`).then(res => res.text());
        console.log(`Successfully fetched challenge data (${challengeCode} / ${challengeData.length})`);
        let vendorData = await fetch(`https://abs.twimg.com/responsive-web/client-web/vendor.${vendorCode}.js`).then(res => res.text());
        console.log(`Successfully fetched vendor data (${vendorCode} / ${vendorData.length})`);

        function sendInit() {
            console.log('Sending init');
            solverIframe.contentWindow.postMessage({
                action: 'init',
                challenge: challengeData,
                vendor: vendorData,
                anims,
                verificationCode: dom.querySelector('meta[name="twitter-site-verification"]').content,
            }, '*');
        }
        if(solverIframe.contentWindow) {
            sendInit();
            setTimeout(() => {
                if(!ready) {
                    sendInit();
                }
            }, 2500);
        } else {
            setTimeout(() => {
                if(!ready) {
                    sendInit();
                }
            }, 2500);
            solverIframe.addEventListener('load', () => sendInit());
        }
    } catch (e) {
        console.error(`Error during challenge:`);
        console.error(e);
    }
})()