"use strict";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { fetchUrl } = require("../src/http");
const { startServer, TLS_CA } = require("./helpers/mockServer");

const FAST = { timeoutMs: 1500, retries: 0, retryDelayMs: 10, tls: { ca: TLS_CA } };

let site;
let secure;
let flakyCount = 0;
let resetCount = 0;

before(async () => {
    secure = await startServer({
        "/secure-page": { body: "<p>secure</p>" }
    }, { secure: true });

    site = await startServer({
        "/ok": { body: "<p>ok</p>" },
        "/relative-redirect": { status: 301, headers: { Location: "/ok" } },
        "/dot-relative": { status: 302, headers: { Location: "sub/../ok" } },
        "/absolute-redirect": (req, res, api) => {
            res.writeHead(308, { Location: api.url("/ok") });
            res.end();
        },
        "/chain-1": { status: 301, headers: { Location: "/chain-2" } },
        "/chain-2": { status: 302, headers: { Location: "/chain-3" } },
        "/chain-3": { status: 307, headers: { Location: "/ok" } },
        "/loop-a": { status: 301, headers: { Location: "/loop-b" } },
        "/loop-b": { status: 301, headers: { Location: "/loop-a" } },
        "/to-https": (req, res) => {
            res.writeHead(301, { Location: `${secure.origin}/secure-page` });
            res.end();
        },
        "/bad-location": { status: 301, headers: { Location: "http://[invalid" } },
        "/to-mailto": { status: 302, headers: { Location: "mailto:a@b.c" } },
        "/slow": (req, res) => {
            setTimeout(() => { res.writeHead(200); res.end("late"); }, 3000);
        },
        "/reset": (req) => {
            resetCount++;
            req.socket.destroy();
        },
        "/flaky": (req, res) => {
            flakyCount++;
            if (flakyCount < 3) { res.writeHead(503); res.end("busy"); return; }
            res.writeHead(200, { "Content-Type": "text/html" });
            res.end("recovered");
        },
        "/greek-split": (req, res) => {
            // "Ασφάλεια" sent with a multi-byte character split across writes.
            const bytes = Buffer.from("<title>Ασφάλεια</title>", "utf8");
            res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
            res.write(bytes.subarray(0, 8));   // 7 ASCII bytes + first byte of "Α"
            setTimeout(() => res.end(bytes.subarray(8)), 20);
        },
        "/missing": { status: 404, body: "nope" }
    });
});

after(async () => {
    await site.close();
    await secure.close();
});

test("plain 200 over HTTP", async () => {
    const res = await fetchUrl(site.url("/ok"), FAST);
    assert.equal(res.ok, true);
    assert.equal(res.status, 200);
    assert.equal(res.finalUrl, site.url("/ok"));
    assert.deepEqual(res.redirectChain, []);
    assert.match(res.contentType, /text\/html/);
    assert.equal(typeof res.responseTimeMs, "number");
});

test("HTTPS URL is fetched with the https transport", async () => {
    const res = await fetchUrl(secure.url("/secure-page"), FAST);
    assert.equal(res.ok, true, JSON.stringify(res.error));
    assert.equal(res.status, 200);
    assert.equal(res.body, "<p>secure</p>");
});

test("relative Location header is resolved against the current URL", async () => {
    const res = await fetchUrl(site.url("/relative-redirect"), FAST);
    assert.equal(res.ok, true);
    assert.equal(res.finalUrl, site.url("/ok"));
    assert.deepEqual(res.redirectChain, [
        { url: site.url("/relative-redirect"), status: 301, location: site.url("/ok") }
    ]);
});

test("dot-segment relative Location is resolved", async () => {
    const res = await fetchUrl(site.url("/dot-relative"), FAST);
    assert.equal(res.finalUrl, site.url("/ok"));
    assert.equal(res.status, 200);
});

test("absolute Location header is followed", async () => {
    const res = await fetchUrl(site.url("/absolute-redirect"), FAST);
    assert.equal(res.finalUrl, site.url("/ok"));
    assert.equal(res.redirectChain[0].status, 308);
});

test("every hop in a redirect chain is recorded", async () => {
    const res = await fetchUrl(site.url("/chain-1"), FAST);
    assert.equal(res.ok, true);
    assert.deepEqual(res.redirectChain.map(h => h.status), [301, 302, 307]);
    assert.deepEqual(res.redirectChain.map(h => h.url), [
        site.url("/chain-1"), site.url("/chain-2"), site.url("/chain-3")
    ]);
    assert.equal(res.finalUrl, site.url("/ok"));
});

test("HTTP → HTTPS cross-protocol redirect", async () => {
    const res = await fetchUrl(site.url("/to-https"), FAST);
    assert.equal(res.ok, true, JSON.stringify(res.error));
    assert.equal(res.finalUrl, secure.url("/secure-page"));
    assert.equal(res.status, 200);
});

test("redirect loop is detected and does not recurse forever", async () => {
    const res = await fetchUrl(site.url("/loop-a"), FAST);
    assert.equal(res.ok, false);
    assert.equal(res.error.code, "EREDIRECTLOOP");
    assert.equal(res.redirectChain.length, 2);
});

test("maximum redirect hops is enforced", async () => {
    const res = await fetchUrl(site.url("/chain-1"), { ...FAST, maxRedirects: 2 });
    assert.equal(res.ok, false);
    assert.equal(res.error.code, "ETOOMANYREDIRECTS");
    assert.equal(res.redirectChain.length, 3);
});

test("invalid Location header is reported, not thrown", async () => {
    const res = await fetchUrl(site.url("/bad-location"), FAST);
    assert.equal(res.ok, false);
    assert.equal(res.error.code, "EBADLOCATION");
});

test("redirect to a non-http scheme fails cleanly", async () => {
    const res = await fetchUrl(site.url("/to-mailto"), FAST);
    assert.equal(res.ok, false);
    assert.equal(res.error.code, "EPROTOCOL");
});

test("timeout is enforced", async () => {
    const start = Date.now();
    const res = await fetchUrl(site.url("/slow"), { ...FAST, timeoutMs: 300 });
    assert.equal(res.ok, false);
    assert.equal(res.error.code, "ETIMEDOUT");
    assert.ok(Date.now() - start < 2000, "should give up well before the server answers");
});

test("network error is retried up to the limit and then reported", async () => {
    resetCount = 0;
    const res = await fetchUrl(site.url("/reset"), { ...FAST, retries: 2 });
    assert.equal(res.ok, false);
    assert.equal(res.attempts, 3);
    assert.equal(resetCount, 3);
    assert.ok(res.error.code, "error code should be set");
});

test("5xx is retried and a later success is returned", async () => {
    flakyCount = 0;
    const res = await fetchUrl(site.url("/flaky"), { ...FAST, retries: 3 });
    assert.equal(res.ok, true);
    assert.equal(res.status, 200);
    assert.equal(res.attempts, 3);
});

test("connection refused is reported, not thrown", async () => {
    const closed = await startServer({});
    const url = closed.url("/x");
    await closed.close();
    const res = await fetchUrl(url, FAST);
    assert.equal(res.ok, false);
    assert.equal(res.error.code, "ECONNREFUSED");
});

test("multi-byte UTF-8 split across chunks is decoded correctly", async () => {
    const res = await fetchUrl(site.url("/greek-split"), FAST);
    assert.equal(res.body, "<title>Ασφάλεια</title>");
});

test("4xx is returned as ok:true with the status (HTTP worked)", async () => {
    const res = await fetchUrl(site.url("/missing"), FAST);
    assert.equal(res.ok, true);
    assert.equal(res.status, 404);
});

test("unsupported protocol and invalid URL are reported", async () => {
    assert.equal((await fetchUrl("ftp://example.com/", FAST)).error.code, "EPROTOCOL");
    assert.equal((await fetchUrl("not a url", FAST)).error.code, "EINVALIDURL");
});
