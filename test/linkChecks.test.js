"use strict";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { checkMailto, checkPhone, checkOtherLinks, verdict } = require("../src/linkChecks");
const { parseSrcset } = require("../src/html");
const { runPageAudit } = require("../src/audit");
const { startServer, html } = require("./helpers/mockServer");

const FAST = { timeoutMs: 800, retries: 0, retryDelayMs: 5, concurrency: 3 };
const PNG = { "Content-Type": "image/png" };

// ---------- validators ----------

test("mailto: valid addresses, several recipients and recipient-less links pass", () => {
    for (const href of [
        "mailto:info@magentainsurance.gr",
        "mailto:a@x.gr,b@y.com",
        "mailto:first.last+tag@sub.example.co.uk?subject=Hi",
        "mailto:info%40example.gr",
        "mailto:πληροφορίες@παράδειγμα.ελ",
        "mailto:?subject=Share%20this"
    ]) {
        assert.equal(checkMailto(href).valid, true, href);
    }
    assert.deepEqual(checkMailto("mailto:Info@Magenta.GR").domains, ["magenta.gr"]);
});

test("mailto: typos and missing parts are invalid, with a reason", () => {
    const cases = {
        "mailto:": /no email address/,
        "mailto:info.magenta.gr": /no @/,
        "mailto:@magenta.gr": /nothing before/,
        "mailto:info@": /no domain/,
        "mailto:info@magenta": /not a valid domain/,
        "mailto:info@magenta..gr": /not a valid domain/,
        "mailto:in fo@magenta.gr": /invalid characters/,
        "mailto:ok@x.gr,broken@": /broken@: no domain/
    };
    for (const [href, reason] of Object.entries(cases)) {
        const r = checkMailto(href);
        assert.equal(r.valid, false, href);
        assert.match(r.reason, reason, href);
    }
});

test("tel: and sms: accept formatted, international and short numbers", () => {
    for (const href of ["tel:+302101234567", "tel:210 123 4567", "tel:(210) 123-45.67", "tel:112",
        "tel:18 300", "sms:+306912345678", "tel:+30%20210%201234567", "tel:+302101234567;ext=12"]) {
        assert.equal(checkPhone(href).valid, true, href);
    }
});

test("tel: letters, misplaced +, too short or too long are invalid", () => {
    assert.match(checkPhone("tel:").reason, /no number/);
    assert.match(checkPhone("tel:21O 1234567").reason, /not digits/);   // letter O, not zero
    assert.match(checkPhone("tel:210+1234").reason, /not at the start/);
    assert.match(checkPhone("tel:12").reason, /too short/);
    assert.match(checkPhone("tel:1234567890123456").reason, /more than 15/);
});

test("checkOtherLinks sorts email, phone, javascript and unreadable hrefs", () => {
    const r = checkOtherLinks(
        ["#top", "mailto:bad@", "mailto:ok@magenta.gr", "tel:abc", "javascript:void(0)", "whatsapp://send"],
        ["", "http://[bad"]
    );
    assert.deepEqual(r.invalidEmail.map(i => i.href), ["mailto:bad@"]);
    assert.deepEqual(r.invalidPhone.map(i => i.href), ["tel:abc"]);
    assert.deepEqual(r.javascript, ["javascript:void(0)"]);
    assert.deepEqual(r.malformed.map(i => i.reason), ["empty href", "the address cannot be read"]);
    assert.deepEqual(r.emailDomains, ["magenta.gr"]);
});

test("parseSrcset keeps commas inside URLs and splits candidates", () => {
    assert.deepEqual(parseSrcset("a.jpg 1x, b.jpg 2x"), ["a.jpg", "b.jpg"]);
    assert.deepEqual(parseSrcset("a.jpg 1x,b.jpg 2x"), ["a.jpg", "b.jpg"]);
    assert.deepEqual(parseSrcset("/w_400,h_300/a.jpg 400w, /w_800,h_600/a.jpg 800w"),
        ["/w_400,h_300/a.jpg", "/w_800,h_600/a.jpg"]);
    assert.deepEqual(parseSrcset(""), []);
});

test("verdict: refused automated checks are unverified, not broken", () => {
    for (const status of [401, 403, 429, 999]) assert.equal(verdict({ status }).state, "unverified", String(status));
    assert.equal(verdict({ status: 404 }).state, "broken");
    assert.equal(verdict({ status: 500 }).state, "broken");
    assert.equal(verdict({ status: null, error: { code: "ENOTFOUND" } }).reason, "ENOTFOUND");
    assert.equal(verdict({ status: 200 }).state, "ok");
    assert.equal(verdict({ status: 200, contentType: "text/html" }, { image: true }).state, "broken");
    assert.equal(verdict({ status: 200, contentType: "image/webp" }, { image: true }).state, "ok");
});

// ---------- network checks, end to end ----------

let site, partner;

before(async () => {
    partner = await startServer({
        "/ok": { body: "<html><body>Partner</body></html>" },
        "/gone": { status: 404 },
        "/members": { status: 403 },
        // Answers HEAD wrongly; a real visitor (GET) gets the page.
        "/head-broken": (req, res) => {
            res.writeHead(req.method === "HEAD" ? 404 : 200, { "Content-Type": "text/html" });
            res.end(req.method === "HEAD" ? undefined : "<html><body>Fine</body></html>");
        }
    });
    const ext = (p) => partner.url(p).replace("127.0.0.1", "localhost");   // another host = external

    site = await startServer({
        "/": { body: html({
            head: "<title>Links</title>",
            body: `<h1>Links</h1>
                <a href="${ext("/ok")}">ok</a>
                <a href="${ext("/gone")}">gone</a>
                <a href="${ext("/members")}">members only</a>
                <a href="${ext("/head-broken")}">head broken</a>
                <a href="http://localhost:1/">refused</a>
                <a href="mailto:info@magenta">typo</a>
                <a href="mailto:hello@nope.example">dead domain</a>
                <a href="mailto:hello@works.example">live domain</a>
                <a href="tel:21O 1234567">phone typo</a>
                <a href="tel:+30 210 1234567">phone ok</a>
                <a href="javascript:void(0)">js</a>
                <a href="">empty</a>
                <img src="/img/ok.png" alt="ok">
                <img src="/img/missing.png" alt="missing">
                <img src="/img/page.png" alt="html instead of an image">
                <img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="inline">
                <img data-src="/img/lazy.png" alt="lazy">
                <picture><source srcset="/img/w_400,h_300/a.png 1x, /img/b.png 2x"><img src="/img/ok.png" alt="pic"></picture>`
        }) },
        "/img/ok.png": { headers: PNG, body: "png" },
        "/img/lazy.png": { headers: PNG, body: "png" },
        "/img/w_400,h_300/a.png": { headers: PNG, body: "png" },
        "/img/b.png": { status: 500, headers: PNG },
        "/img/page.png": { body: "<html>soft 404</html>" }
    });
});

after(async () => {
    await site?.close();
    await partner?.close();
});

const resolveEmailDomain = async (domain) => (domain === "nope.example" ? "invalid" : "ok");

test("external links, email domains and images are checked once and reported per page", async () => {
    const report = await runPageAudit(site.url("/"), { ...FAST, resolveEmailDomain });
    const s = report.site;
    const ext = (p) => partner.url(p).replace("127.0.0.1", "localhost");

    assert.deepEqual(s.brokenExternalLinks.map(l => l.url).sort(), [ext("/gone"), "http://localhost:1/"].sort());
    assert.equal(s.brokenExternalLinks.find(l => l.url === ext("/gone")).reason, "HTTP 404");
    assert.deepEqual(s.unverifiedExternalLinks.map(l => l.url), [ext("/members")]);
    assert.ok(!s.brokenExternalLinks.some(l => l.url === ext("/head-broken")), "GET fallback rescues a wrong HEAD answer");
    assert.equal(s.linkCheck.externalChecked, 5);

    assert.deepEqual(s.invalidEmailDomains.map(d => d.domain), ["nope.example"]);
    assert.equal(s.linkCheck.emailDomainsChecked, 2, "the typo address has no valid domain to look up");

    const broken = Object.fromEntries(s.brokenImages.map(i => [new URL(i.url).pathname, i.reason]));
    assert.deepEqual(broken, {
        "/img/missing.png": "HTTP 404",
        "/img/page.png": "not an image (text/html)",
        "/img/b.png": "HTTP 500"
    });
    assert.equal(s.linkCheck.imagesChecked, 6, "ok.png counted once; data: URI skipped; lazy and srcset included");

    const codes = report.pages[0].issues.map(i => i.code);
    for (const code of ["LINK_BROKEN", "IMG_BROKEN", "EMAIL_DOMAIN_INVALID", "MAILTO_INVALID", "TEL_INVALID", "LINK_INVALID", "LINK_JAVASCRIPT"]) {
        assert.ok(codes.includes(code), `${code} in ${codes.join(", ")}`);
    }
    const linkIssue = report.pages[0].issues.find(i => i.code === "LINK_BROKEN");
    assert.match(linkIssue.message, /^2 broken link/);
    assert.ok(report.summary.errors >= 2, "network findings count in the summary");
});

test("external and image checks can be switched off", async () => {
    const report = await runPageAudit(site.url("/"), { ...FAST, checkExternalLinks: false, checkImages: false });
    const s = report.site;
    assert.equal(s.linkCheck.externalSkipped, true);
    assert.equal(s.linkCheck.imagesSkipped, true);
    assert.deepEqual([s.brokenExternalLinks.length, s.brokenImages.length, s.invalidEmailDomains.length], [0, 0, 0]);
    const codes = report.pages[0].issues.map(i => i.code);
    assert.ok(!codes.includes("IMG_BROKEN") && !codes.includes("EMAIL_DOMAIN_INVALID"));
    assert.ok(codes.includes("MAILTO_INVALID"), "address syntax is still checked without the network");
});
