"use strict";

const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createApi } = require("../src/api");
const { parseHistory, normalizePageUrl, getWeeklyVitals } = require("../src/vitals/tracking");

// ---------- a fake Chrome UX Report History API, shaped like Google's real answers ----------

const WEEKS = 15;
const date = (iso) => { const [year, month, day] = iso.split("-").map(Number); return { year, month, day }; };
const addDays = (iso, n) => new Date(Date.parse(iso + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);

function historyBody(count, valueFor) {
    const lastEnd = "2026-10-17";
    const collectionPeriods = Array.from({ length: count }, (_, i) => {
        const to = addDays(lastEnd, -7 * (count - 1 - i));
        return { firstDate: date(addDays(to, -27)), lastDate: date(to) };
    });
    const metric = (id) => ({ percentilesTimeseries: { p75s: collectionPeriods.map((_, i) => valueFor(id, i)) } });
    return {
        record: {
            key: {},
            metrics: {
                largest_contentful_paint: metric("lcp"),
                interaction_to_next_paint: metric("inp"),
                cumulative_layout_shift: metric("cls")
            },
            collectionPeriods
        }
    };
}

const queries = [];
async function fakeGoogle(url, init) {
    const query = JSON.parse(init.body);
    queries.push(query);
    const json = (status, body) => ({ status, json: async () => body });
    const target = query.url || query.origin;
    if (/quota/.test(target)) return json(429, { error: { code: 429, message: "Quota exceeded for quota metric" } });
    if (/tiny/.test(target)) return json(404, { error: { code: 404, message: "chrome ux report data not found" } });
    if (/empty-weeks/.test(target)) return json(200, historyBody(query.collectionPeriodCount, () => null));
    // Desktop CLS as a string, INP missing in two weeks: both happen in real responses.
    return json(200, historyBody(query.collectionPeriodCount, (id, i) =>
        id === "lcp" ? 2400 + i * 10 : id === "cls" ? (query.formFactor === "DESKTOP" ? "0.44" : 0.05) : (i < 2 ? null : 180 + i)));
}

test("history: parses the weeks, their dates and each metric, keeping gaps as null", () => {
    const parsed = parseHistory(historyBody(WEEKS, (id, i) => (id === "inp" && i === 0 ? null : id === "cls" ? "0.12" : 1000 + i)));
    assert.equal(parsed.periods.length, WEEKS);
    assert.deepEqual(parsed.periods.at(-1), { from: "2026-09-20", to: "2026-10-17" });
    assert.equal(parsed.values.inp[0], null);
    assert.equal(parsed.values.cls[3], 0.12, "string values from Google become numbers");
    assert.equal(parsed.values.lcp[14], 1014);
});

test("page addresses: scheme added, #fragment dropped, nonsense refused", () => {
    assert.equal(normalizePageUrl("www.magentainsurance.gr/car#top"), "https://www.magentainsurance.gr/car");
    assert.equal(normalizePageUrl(" https://x.gr/a?b=1 "), "https://x.gr/a?b=1");
    for (const bad of ["", "hello", "ftp://x.gr/a", "javascript:alert(1)"]) assert.throws(() => normalizePageUrl(bad), /page address|http/, bad);
});

test("weekly vitals: asks Google for 15 weeks of LCP, INP and CLS on both devices", async () => {
    queries.length = 0;
    const r = await getWeeklyVitals("https://www.example.gr/car", { apiKey: "k", fetchImpl: fakeGoogle });
    assert.equal(r.scope, "page");
    assert.equal(r.periods.length, 15);
    assert.deepEqual(queries.map(q => q.formFactor), ["PHONE", "DESKTOP"]);
    assert.ok(queries.every(q => q.collectionPeriodCount === 15 && q.metrics.length === 3));
    assert.equal(r.desktop.cls[0], 0.44);
    assert.deepEqual(r.mobile.inp.slice(0, 3), [null, null, 182]);
});

test("weekly vitals: falls back to the whole site when the page has no data, or only empty weeks", async () => {
    for (const url of ["https://www.example.gr/tiny-page", "https://www.example.gr/empty-weeks"]) {
        queries.length = 0;
        const r = await getWeeklyVitals(url, { apiKey: "k", fetchImpl: fakeGoogle });
        assert.equal(r.scope, "origin", url);
        assert.equal(queries.at(-1).origin, "https://www.example.gr");
        assert.equal(r.periods.length, 15);
    }
});

test("weekly vitals: Google errors are reported without the key in them", async () => {
    await assert.rejects(getWeeklyVitals("https://quota.example.gr/", { apiKey: "SECRETKEY", fetchImpl: fakeGoogle }),
        err => /Chrome UX Report API: Quota exceeded/.test(err.message) && !err.message.includes("SECRETKEY"));
});

// ---------- the API ----------

let dir, server, base, apiKey;
const redirects = { "https://www.cosmoteinsurance.gr/car": "https://www.magentainsurance.gr/car" };

function startApi() {
    const handler = createApi({
        reportsDir: dir,
        vitals: { apiKey: () => apiKey, fetchImpl: fakeGoogle, resolveUrl: async (u) => redirects[u] || u }
    });
    return http.createServer((req, res) => handler(req, res));
}

before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "seo-track-"));
    server = startApi();
    await new Promise(r => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${server.address().port}/api/tracked-pages`;
});
after(async () => {
    await new Promise(r => server.close(r));
    fs.rmSync(dir, { recursive: true, force: true });
});
beforeEach(() => {
    apiKey = "k";
    fs.rmSync(path.join(dir, "tracking"), { recursive: true, force: true });
});

const add = (url, headers = {}) => fetch(base, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify({ url }) });
const list = async () => (await (await fetch(base)).json()).pages;

test("api: a page is added with its 15 weeks, kept across restarts, and can be removed", async () => {
    const res = await add("www.magentainsurance.gr/home");
    assert.equal(res.status, 201);
    const { page } = await res.json();
    assert.equal(page.url, "https://www.magentainsurance.gr/home");
    assert.equal(page.vitals.periods.length, 15);
    assert.equal(page.vitals.scope, "page");

    // A second server on the same folder sees the same list, like reopening the app.
    const again = startApi();
    await new Promise(r => again.listen(0, "127.0.0.1", r));
    const pages = (await (await fetch(`http://127.0.0.1:${again.address().port}/api/tracked-pages`)).json()).pages;
    await new Promise(r => again.close(r));
    assert.deepEqual(pages.map(p => p.url), ["https://www.magentainsurance.gr/home"]);

    const del = await fetch(`${base}?url=${encodeURIComponent(page.url)}`, { method: "DELETE" });
    assert.deepEqual((await del.json()).pages, []);
    assert.deepEqual(await list(), []);
});

test("api: an old address is tracked under the address it redirects to, and is not added twice", async () => {
    const { page } = await (await add("https://www.cosmoteinsurance.gr/car")).json();
    assert.equal(page.url, "https://www.magentainsurance.gr/car");
    assert.equal(page.requestedUrl, "https://www.cosmoteinsurance.gr/car");

    for (const again of ["https://www.cosmoteinsurance.gr/car", "https://www.magentainsurance.gr/car#prices"]) {
        const res = await add(again);
        assert.equal(res.status, 409, again);
        assert.equal((await res.json()).code, "EEXISTS");
    }
    assert.equal((await list()).length, 1);
});

test("api: refresh fetches the weeks again", async () => {
    const { page } = await (await add("https://www.example.gr/a")).json();
    await new Promise(r => setTimeout(r, 5));
    const res = await fetch(`${base}/refresh`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: page.url }) });
    assert.equal(res.status, 200);
    const refreshed = (await res.json()).page;
    assert.ok(refreshed.vitals.fetchedAt > page.vitals.fetchedAt);
    const missing = await fetch(`${base}/refresh`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: "https://www.example.gr/never-added" }) });
    assert.equal(missing.status, 404);
});

test("api: quick adds in parallel are all kept", async () => {
    const urls = ["a", "b", "c", "d", "e"].map(x => `https://www.example.gr/${x}`);
    const results = await Promise.all(urls.map(u => add(u)));
    assert.ok(results.every(r => r.status === 201));
    assert.deepEqual((await list()).map(p => p.url).sort(), urls);
});

test("api: refused requests: no key, a bad address, a Google error, another website", async () => {
    apiKey = null;
    let res = await add("https://www.example.gr/a");
    assert.equal(res.status, 412);
    assert.equal((await res.json()).code, "ENOKEY");
    apiKey = "k";

    res = await add("not a page");
    assert.equal(res.status, 400);

    res = await add("https://quota.example.gr/");
    assert.equal(res.status, 502);
    assert.equal((await res.json()).code, "EGOOGLE");

    res = await add("https://www.example.gr/a", { Origin: "https://evil.example" });
    assert.equal(res.status, 403);
    assert.deepEqual(await list(), [], "nothing was saved");
});

test("api: the saved list is not a report: not listed, and not removed by 'Delete all'", async () => {
    await add("https://www.example.gr/a");
    const reports = await (await fetch(base.replace("/tracked-pages", "/reports"))).json();
    assert.ok(!reports.some(r => /pages|tracking/.test(r.name)));
    await fetch(base.replace("/tracked-pages", "/reports"), { method: "DELETE" });
    assert.equal((await list()).length, 1);
});
