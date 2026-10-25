"use strict";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createApi, parseAuditRequest, reportFileName } = require("../src/api");
const { startServer, html } = require("./helpers/mockServer");

const XML = { "Content-Type": "application/xml" };

// Fake Google APIs for the vitals endpoints, answering with real captured responses.
const googleFixture = (name) => require(path.join(__dirname, "fixtures", "google", `${name}.json`)).body;
let vitalsKey = "AIzaTESTKEY";
async function fakeGoogle(url, init = {}) {
    const reply = (status, body) => ({ status, json: async () => body });
    if (url.includes("pagespeedonline")) {
        const strategy = new URL(url).searchParams.get("strategy");
        return reply(200, googleFixture(strategy === "mobile" ? "psi-mobile" : "psi-desktop"));
    }
    const query = JSON.parse(init.body);
    if (query.url) return reply(404, googleFixture("crux-url-notfound"));
    return reply(200, googleFixture(url.includes("History") ? "crux-history-origin-phone" : "crux-origin-phone"));
}

let site;
let api;
let apiUrl;
let reportsDir;

const page = (title, body = "") => html({
    head: `<title>${title}</title><meta name="description" content="${title} description"><link rel="canonical" href="">`,
    body: `<h1>${title}</h1>${body}`
});

before(async () => {
    site = await startServer({
        "/sitemap.xml": (req, res, s) => {
            res.writeHead(200, XML);
            res.end(`<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
                <url><loc>${s.url("/a")}</loc></url><url><loc>${s.url("/b")}</loc></url></urlset>`);
        },
        "/a": { body: page("Page A", `<a href="/b">B</a><a href="/missing">gone</a>`) },
        "/b": { body: page("Page B") },
        "/slow": (req, res) => setTimeout(() => { res.writeHead(200, { "Content-Type": "text/html" }); res.end(page("Slow")); }, 1500)
    });

    reportsDir = fs.mkdtempSync(path.join(os.tmpdir(), "seo-api-"));
    const handler = createApi({
        reportsDir,
        auditOptions: { timeoutMs: 3000, retries: 0 },
        vitals: { apiKey: () => vitalsKey, fetchImpl: fakeGoogle }
    });
    api = http.createServer((req, res) => handler(req, res));
    await new Promise(resolve => api.listen(0, "127.0.0.1", resolve));
    apiUrl = `http://127.0.0.1:${api.address().port}`;
});

after(async () => {
    await site.close();
    api.closeAllConnections?.();
    await new Promise(resolve => api.close(resolve));
    fs.rmSync(reportsDir, { recursive: true, force: true });
});

async function postAudit(body, init = {}) {
    return fetch(`${apiUrl}/api/audit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        ...init
    });
}

async function readEvents(res) {
    const text = await res.text();
    return text.trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
}

test("parseAuditRequest validates and clamps input", () => {
    assert.throws(() => parseAuditRequest({ url: "not a url" }), /full URL/);
    assert.throws(() => parseAuditRequest({ url: "ftp://x.gr/" }), /http/);
    const r = parseAuditRequest({ url: " https://x.gr/a ", mode: "page", maxUrls: "20", concurrency: 99, includeSubdomains: true, checkLinks: false, checkExternalLinks: false, checkImages: false });
    assert.deepEqual(r, {
        url: "https://x.gr/a", mode: "page",
        options: { maxUrls: 20, concurrency: 8, subdomainPolicy: "include-subdomains", checkLinks: false, checkExternalLinks: false, checkImages: false }
    });
    assert.equal(parseAuditRequest({ url: "https://x.gr/", mode: "anything" }).mode, "site");
});

test("reportFileName is filesystem-safe and descriptive", () => {
    const name = reportFileName("https://www.insurancemarket.gr/x", "site", new Date("2026-10-18T09:05:03.120Z"));
    assert.equal(name, "insurancemarket.gr-site-2026-10-18-09-05-03.json");
});

test("single-page audit streams progress and saves a report", async () => {
    const res = await postAudit({ url: site.url("/a"), mode: "page" });
    assert.equal(res.status, 200);
    const events = await readEvents(res);
    const types = events.map(e => e.type);
    assert.deepEqual(types, ["phase", "progress", "phase", "done"]);
    assert.equal(events[1].url, site.url("/a"));
    assert.equal(events[1].status, 200);

    const report = await (await fetch(`${apiUrl}/api/reports/${events.at(-1).file}`)).json();
    assert.equal(report.mode, "page");
    assert.equal(report.pages.length, 1);
    assert.equal(report.pages[0].title.text, "Page A");
    assert.deepEqual(report.site.brokenInternalLinks.map(l => l.url), [site.url("/missing")]);
});

test("whole-site audit goes through the sitemap", async () => {
    const res = await postAudit({ url: site.url("/sitemap.xml"), mode: "site", checkLinks: false });
    const events = await readEvents(res);
    assert.deepEqual(events.filter(e => e.type === "phase").map(e => e.phase), ["sitemap", "pages", "siteChecks"]);
    assert.equal(events.find(e => e.phase === "pages").total, 2);
    assert.equal(events.filter(e => e.type === "progress").length, 2);
    const done = events.at(-1);
    assert.equal(done.type, "done");
    const report = JSON.parse(fs.readFileSync(path.join(reportsDir, done.file), "utf8"));
    assert.equal(report.mode, "site");
    assert.equal(report.site.linkCheck.skipped, true);
});

test("requests from other websites are refused", async () => {
    const crossSite = await fetch(`${apiUrl}/api/audit`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "https://evil.example" },
        body: JSON.stringify({ url: site.url("/a"), mode: "page" })
    });
    assert.equal(crossSite.status, 403);

    // A "simple" cross-site form/fetch post (no preflight) uses text/plain.
    const simple = await fetch(`${apiUrl}/api/audit`, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify({ url: site.url("/a"), mode: "page" })
    });
    assert.equal(simple.status, 415);

    const sameOrigin = await fetch(`${apiUrl}/api/audit`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: apiUrl },
        body: JSON.stringify({ url: site.url("/b"), mode: "page", checkLinks: false })
    });
    assert.equal(sameOrigin.status, 200);
    await sameOrigin.text();
});

test("invalid URL is rejected with a clear message", async () => {
    const res = await postAudit({ url: "insurancemarket" });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /full URL/);
});

test("a second audit while one is running gets 409, and cancelling frees the slot", async () => {
    const controller = new AbortController();
    const first = await postAudit({ url: site.url("/slow"), mode: "page" }, { signal: controller.signal });
    assert.equal(first.status, 200);

    const second = await postAudit({ url: site.url("/a"), mode: "page" });
    assert.equal(second.status, 409);

    const before = fs.readdirSync(reportsDir).length;
    controller.abort();
    // Wait for the slow page to finish and the server to observe the cancel.
    await new Promise(resolve => setTimeout(resolve, 1800));
    assert.equal(fs.readdirSync(reportsDir).length, before, "cancelled audit is not saved");

    const third = await postAudit({ url: site.url("/b"), mode: "page", checkLinks: false });
    assert.equal(third.status, 200);
    assert.equal((await readEvents(third)).at(-1).type, "done");
});

test("report list is newest first and report names cannot escape the folder", async () => {
    const list = await (await fetch(`${apiUrl}/api/reports`)).json();
    assert.ok(list.length >= 2);
    assert.ok(list.every(r => r.name.endsWith(".json") && typeof r.size === "number"));
    assert.ok(list[0].modified >= list.at(-1).modified);

    assert.equal((await fetch(`${apiUrl}/api/reports/..%2Fpackage.json`)).status, 400);
    assert.equal((await fetch(`${apiUrl}/api/reports/nope.json`)).status, 404);
    assert.equal((await fetch(`${apiUrl}/api/unknown`)).status, 404);
});

test("clearing reports deletes only report files and refuses other sites", async () => {
    fs.writeFileSync(path.join(reportsDir, "keep-me.txt"), "not a report");
    fs.mkdirSync(path.join(reportsDir, "subfolder.json"), { recursive: true });
    const before = fs.readdirSync(reportsDir).filter(n => n.endsWith(".json") && fs.statSync(path.join(reportsDir, n)).isFile());
    assert.ok(before.length >= 1);

    const crossSite = await fetch(`${apiUrl}/api/reports`, { method: "DELETE", headers: { Origin: "https://evil.example" } });
    assert.equal(crossSite.status, 403);
    assert.equal(fs.readdirSync(reportsDir).filter(n => n.endsWith(".json")).length, before.length + 1, "nothing deleted");

    const res = await fetch(`${apiUrl}/api/reports`, { method: "DELETE" });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { deleted: before.length });
    assert.deepEqual(fs.readdirSync(reportsDir).sort(), ["keep-me.txt", "subfolder.json", "vitals"]);
    assert.deepEqual(await (await fetch(`${apiUrl}/api/reports`)).json(), []);
});

test("clearing reports is refused while an audit is running", async () => {
    const controller = new AbortController();
    const running = await postAudit({ url: site.url("/slow"), mode: "page" }, { signal: controller.signal });
    assert.equal(running.status, 200);
    const res = await fetch(`${apiUrl}/api/reports`, { method: "DELETE" });
    assert.equal(res.status, 409);
    controller.abort();
    await new Promise(resolve => setTimeout(resolve, 1800));
});

test("vitals: status reports whether a key is configured", async () => {
    assert.deepEqual(await (await fetch(`${apiUrl}/api/vitals/status`)).json(), { configured: true, source: "custom", last4: "TKEY" });
    vitalsKey = null;
    try {
        assert.deepEqual(await (await fetch(`${apiUrl}/api/vitals/status`)).json(), { configured: false, source: null, last4: null });
        const res = await fetch(`${apiUrl}/api/vitals`, {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: "https://www.insurancemarket.gr/" })
        });
        assert.equal(res.status, 412);
        assert.equal((await res.json()).code, "ENOKEY");
    } finally {
        vitalsKey = "AIzaTESTKEY";
    }
});

test("vitals: a check streams phases, saves the report separately, and can be read back", async () => {
    const res = await fetch(`${apiUrl}/api/vitals`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: "https://www.insurancemarket.gr/" })
    });
    assert.equal(res.status, 200);
    const events = await readEvents(res);
    assert.deepEqual(events.map(e => e.type), ["phase", "phase", "done"]);
    const file = events.at(-1).file;
    assert.match(file, /^insurancemarket\.gr-vitals-.*\.json$/);
    assert.ok(fs.existsSync(path.join(reportsDir, "vitals", file)));

    const list = await (await fetch(`${apiUrl}/api/vitals-reports`)).json();
    assert.equal(list[0].name, file);
    const audits = await (await fetch(`${apiUrl}/api/reports`)).json();
    assert.ok(!audits.some(r => r.name === file), "vitals reports stay out of the audit list");

    const report = await (await fetch(`${apiUrl}/api/vitals-reports/${file}`)).json();
    assert.equal(report.type, "vitals");
    assert.equal(report.lab.mobile.performanceScore, 0.52);
    assert.equal(report.field.page.mobile.current, null);
    assert.equal(report.field.site.mobile.current.metrics.lcp.p75, 3856);
    assert.ok(!JSON.stringify(report).includes("AIzaTESTKEY"));
});

test("vitals: other websites cannot start a check", async () => {
    const res = await fetch(`${apiUrl}/api/vitals`, {
        method: "POST", headers: { "Content-Type": "application/json", Origin: "https://evil.example" },
        body: JSON.stringify({ url: "https://www.insurancemarket.gr/" })
    });
    assert.equal(res.status, 403);
    const plain = await fetch(`${apiUrl}/api/vitals`, { method: "POST", headers: { "Content-Type": "text/plain" }, body: "{}" });
    assert.equal(plain.status, 415);
});

test("clearing reports also removes saved vitals reports", async () => {
    const vitalsFiles = () => fs.readdirSync(path.join(reportsDir, "vitals")).filter(n => n.endsWith(".json"));
    assert.ok(vitalsFiles().length >= 1);
    const res = await fetch(`${apiUrl}/api/reports`, { method: "DELETE" });
    assert.equal(res.status, 200);
    assert.equal(vitalsFiles().length, 0);
});
