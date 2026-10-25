"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { rate } = require("../src/vitals/metrics");
const { parseCruxRecord, parseCruxHistory } = require("../src/vitals/crux");
const { parsePsi, detectChallenge } = require("../src/vitals/psi");
const { runVitals, redact } = require("../src/vitals");

// Real responses captured from Google's APIs (screenshots stripped).
const fixture = (name) => require(path.join(__dirname, "fixtures", "google", `${name}.json`));

test("ratings follow Google's thresholds, boundaries included", () => {
    assert.equal(rate("lcp", 2500), "good");
    assert.equal(rate("lcp", 2501), "needs-improvement");
    assert.equal(rate("lcp", 4000), "needs-improvement");
    assert.equal(rate("lcp", 4001), "poor");
    assert.equal(rate("cls", 0.1), "good");
    assert.equal(rate("cls", 0.26), "poor");
    assert.equal(rate("inp", 200), "good");
    assert.equal(rate("inp", 501), "poor");
    assert.equal(rate("lcp", null), null);
});

test("CrUX record: p75 values, ratings, distribution, CLS given as a string", () => {
    const r = parseCruxRecord(fixture("crux-origin-phone").body);
    assert.equal(r.metrics.lcp.p75, 3856);
    assert.equal(r.metrics.lcp.rating, "needs-improvement");
    assert.equal(r.metrics.inp.p75, 311);
    assert.equal(r.metrics.cls.p75, 0);            // API sends "0.00"
    assert.equal(r.metrics.cls.rating, "good");
    assert.equal(r.metrics.lcp.distribution.good, 0.541);
    assert.equal(r.metrics.lcp.distribution.poor, 0.2305);
    assert.ok(r.metrics.ttfb.p75 > 0);
    assert.deepEqual(r.period, { from: "2026-09-19", to: "2026-10-16" });
    assert.equal(r.lcpResourceType.image, 0.3712);
    assert.equal(r.lcpSubparts.renderDelay, 385);
});

test("CrUX 'not found' gives null, not an error", () => {
    assert.equal(parseCruxRecord(fixture("crux-url-notfound").body), null);
    assert.equal(parseCruxHistory(fixture("crux-url-notfound").body), null);
});

test("CrUX history: 25 weekly points per metric, aligned with periods", () => {
    const h = parseCruxHistory(fixture("crux-history-origin-phone").body);
    assert.equal(h.periods.length, 25);
    assert.equal(h.metrics.lcp.length, 25);
    assert.equal(h.metrics.cls.length, 25);
    assert.ok(h.metrics.lcp.every(v => v === null || typeof v === "number"));
    assert.equal(h.periods.at(-1), "2026-10-10");
});

test("PageSpeed: lab metrics, LCP element and breakdown (mobile)", () => {
    const r = parsePsi(fixture("psi-mobile").body);
    assert.equal(r.performanceScore, 0.52);
    assert.equal(r.lighthouseVersion, "13.5.0");
    assert.equal(Math.round(r.lab.lcp), 16140);
    assert.equal(Math.round(r.lab.tbt), 292);
    assert.match(r.lcp.element.snippet, /CybotCookiebotDialogBodyContentText/);
    assert.deepEqual(r.lcp.breakdown.map(b => b.subpart), ["timeToFirstByte", "elementRenderDelay"]);
    assert.equal(r.thirdParties[0].name, "Google Tag Manager");
    assert.equal(r.redirected, false);
    assert.equal(r.challengeSuspected, false);
});

test("PageSpeed findings: only failing advice, ranked by saving, each tied to a metric", () => {
    const r = parsePsi(fixture("psi-mobile").body);
    const ids = r.findings.map(f => f.id);
    assert.equal(ids[0], "unused-javascript");      // LCP saving 2700 ms
    assert.equal(ids[1], "render-blocking-insight"); // LCP saving 2450 ms
    assert.ok(!ids.includes("cls-culprits-insight"), "passing insight (score 1) is not a finding");
    assert.ok(!ids.includes("inp-breakdown-insight"), "not-applicable insight is skipped");
    assert.ok(r.findings.every(f => f.metrics.length > 0), "every finding is tied to a metric");
    const rb = r.findings.find(f => f.id === "render-blocking-insight");
    assert.deepEqual(rb.savings, { LCP: 2450, FCP: 2450 });
    assert.ok(rb.items.length > 0 && rb.items[0].label.startsWith("https://"));
    assert.ok(rb.items.every(i => typeof i.timeMs === "number"));
    assert.ok(!/\]\(http/.test(rb.description), "markdown links are stripped");
});

test("PageSpeed desktop: CLS culprits are reported when layout shifts", () => {
    const r = parsePsi(fixture("psi-desktop").body);
    assert.ok(r.lab.cls > 0.25);
    const cls = r.findings.find(f => f.id === "cls-culprits-insight");
    assert.ok(cls);
    assert.deepEqual(cls.metrics, ["CLS"]);
    assert.ok(cls.items.length > 0);
});

test("PageSpeed follows the rebrand redirect and gets past the WAF", () => {
    const r = parsePsi(fixture("psi-cosmote-mobile").body);
    assert.equal(r.requestedUrl, "https://www.cosmoteinsurance.gr/");
    assert.equal(r.finalUrl, "https://www.magentainsurance.gr/");
    assert.equal(r.redirected, true);
    assert.equal(r.warnings.length, 1);
    assert.equal(r.challengeSuspected, false, "real page with injected WAF script is not a challenge");
});

test("challenge detection: few requests including a challenge endpoint", () => {
    const lh = (urls) => ({ audits: { "network-requests": { details: { type: "table", items: urls.map(url => ({ url })) } } } });
    assert.equal(detectChallenge(lh(["https://x.gr/", "https://x.gr/_Incapsula_Resource?abc"])), true);
    assert.equal(detectChallenge(lh(["https://x.gr/", "https://x.gr/app.js"])), false);
    const many = Array.from({ length: 30 }, (_, i) => `https://x.gr/a${i}.js`).concat("https://x.gr/_Incapsula_Resource?abc");
    assert.equal(detectChallenge(lh(many)), false);
});

// ---------- runVitals with a fake fetch (no network) ----------

const KEY = "AIzaTESTKEY0000000000000000000000000000";
const json = (status, body) => ({ status, json: async () => body });

function fakeFetch({ psiStatus = 200, cruxStatus = 200 } = {}) {
    const calls = [];
    const impl = async (url, init = {}) => {
        calls.push({ url, body: init.body ? JSON.parse(init.body) : null });
        if (url.includes("pagespeedonline")) {
            const strategy = new URL(url).searchParams.get("strategy");
            if (psiStatus !== 200) return json(psiStatus, { error: { message: `API key not valid. key=${KEY}` } });
            return json(200, fixture(strategy === "mobile" ? "psi-cosmote-mobile" : "psi-desktop").body);
        }
        if (cruxStatus !== 200) return json(cruxStatus, { error: { message: "denied" } });
        const query = JSON.parse(init.body);
        if (query.url) return json(404, fixture("crux-url-notfound").body);
        return json(200, fixture(url.includes("History") ? "crux-history-origin-phone" : "crux-origin-magenta-phone").body);
    };
    return { impl, calls };
}

test("runVitals: lab on both devices, field for the final (redirected) site", async () => {
    const { impl, calls } = fakeFetch();
    const phases = [];
    const r = await runVitals("https://www.cosmoteinsurance.gr/", { apiKey: KEY, fetchImpl: impl, onPhase: p => phases.push(p) });
    assert.deepEqual(phases, ["lab", "field"]);
    assert.equal(r.finalUrl, "https://www.magentainsurance.gr/");
    assert.equal(r.origin, "https://www.magentainsurance.gr");
    const cruxBodies = calls.filter(c => c.url.includes("chromeuxreport")).map(c => c.body);
    assert.ok(cruxBodies.some(b => b.origin === "https://www.magentainsurance.gr"), "site data uses the final origin");
    assert.ok(cruxBodies.every(b => b.origin !== "https://www.cosmoteinsurance.gr"));
    assert.equal(r.field.page.mobile.current, null, "no page-level data → null");
    assert.ok(r.field.site.mobile.current.metrics.lcp.p75 > 0);
    assert.equal(r.field.site.desktop.history.periods.length, 25);
    assert.ok(r.lab.mobile && r.lab.desktop);
    assert.deepEqual(r.errors, []);
});

test("runVitals: the API key never appears in results or errors", async () => {
    const { impl } = fakeFetch({ psiStatus: 400 });
    const r = await runVitals("https://www.example.gr/", { apiKey: KEY, fetchImpl: impl });
    assert.equal(r.lab.mobile, null);
    assert.equal(r.errors.length, 2);
    assert.ok(!JSON.stringify(r).includes(KEY));
    assert.match(r.errors[0].message, /\[key\]/);
});

test("runVitals: fails clearly when nothing can be fetched, or no key is set", async () => {
    const { impl } = fakeFetch({ psiStatus: 403, cruxStatus: 403 });
    await assert.rejects(runVitals("https://www.example.gr/", { apiKey: KEY, fetchImpl: impl }), err => {
        assert.ok(!err.message.includes(KEY));
        return true;
    });
    await assert.rejects(runVitals("https://www.example.gr/", { apiKey: null }), { code: "ENOKEY" });
    await assert.rejects(runVitals("not a url", { apiKey: KEY, fetchImpl: impl }), /full URL/);
});

test("redact replaces every occurrence of the key", () => {
    assert.equal(redact(`a ${KEY} b ${KEY}`, KEY), "a [key] b [key]");
    assert.equal(redact("nothing", null), "nothing");
});
