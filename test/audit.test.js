"use strict";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { auditPage } = require("../src/auditPage");
const { runAudit } = require("../src/audit");
const { startServer, html } = require("./helpers/mockServer");

const FAST = { timeoutMs: 800, retries: 0, retryDelayMs: 5, concurrency: 3 };
const XML = { "Content-Type": "application/xml" };

let site;

const page = ({ title, description, canonical, h1 = "Heading", extraHead = "", body = "" }) => html({
    head: [
        title !== undefined ? `<title>${title}</title>` : "",
        description !== undefined ? `<meta name="description" content="${description}">` : "",
        canonical !== undefined ? `<link rel="canonical" href="${canonical}">` : "",
        extraHead
    ].join(""),
    body: `<h1>${h1}</h1>${body}`
});

before(async () => {
    site = await startServer({
        "/robots.txt": (req, res, api) => {
            res.writeHead(200, { "Content-Type": "text/plain" });
            res.end(`User-agent: *\nDisallow:\nSitemap: ${api.url("/sitemap_index.xml")}\n`);
        },
        "/sitemap_index.xml": (req, res, api) => {
            res.writeHead(200, XML);
            res.end(`<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
                <sitemap><loc>${api.url("/sitemap-pages.xml")}</loc></sitemap>
                <sitemap><loc>${api.url("/sitemap-more.xml")}</loc></sitemap>
            </sitemapindex>`);
        },
        "/sitemap-pages.xml": (req, res, api) => {
            res.writeHead(200, XML);
            res.end(`<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
                ${["/", "/car", "/home", "/dup-a", "/dup-b", "/noindex", "/header-noindex", "/old", "/gone",
                    "/reset", "/slow", "/pdf", "/canon-to-404", "/canon-elsewhere"]
                    .map(p => `<url><loc>${api.url(p)}</loc></url>`).join("")}
                <url><loc>https://other-site.example/foreign</loc></url>
            </urlset>`);
        },
        "/sitemap-more.xml": (req, res, api) => {
            res.writeHead(200, XML);
            res.end(`<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
                <url><loc>${api.url("/search?q=car&amp;page=2")}</loc></url>
            </urlset>`);
        },
        "/": { body: page({
            title: "Home | Insurer", description: "Home page", canonical: "/",
            body: `<a href="/car">Car</a><a href="/home#cover">Home</a><a href="/missing-page">Broken</a>
                   <a href="/old">Old</a><a href="https://partner.example/">Partner</a>
                   <a href="mailto:hi@insurer.gr">Mail</a><img src="/a.png"><img src="/b.png" alt="">`
        }) },
        "/car": { body: page({
            title: "Car insurance", description: "Cover for your car", canonical: "/car",
            h1: "Car insurance</h1><h1>Second H1",
            extraHead: `<script type="application/ld+json">{"@context":"https://schema.org","@type":"Product"}</script>`,
            body: `<a href="quote">Relative quote link</a>`
        }) },
        "/home": { body: page({ title: "Home insurance", description: "Cover for your home", canonical: "/home" }) },
        "/dup-a": { body: page({ title: "Same Title", description: "Same description", canonical: "/dup-a" }) },
        "/dup-b": { body: page({ title: "same  title", description: "Same description", canonical: "/dup-b" }) },
        "/noindex": { body: page({
            title: "Hidden", description: "Hidden page", canonical: "/noindex",
            extraHead: `<meta name="robots" content="noindex, follow">`
        }) },
        "/header-noindex": {
            headers: { "X-Robots-Tag": "noindex" },
            body: page({ title: "Header hidden", description: "x", extraHead: `<meta name="robots" content="index">` })
        },
        "/old": { status: 301, headers: { Location: "/home" } },
        "/gone": { status: 410, body: "gone" },
        "/reset": (req) => req.socket.destroy(),
        "/slow": (req, res) => setTimeout(() => { res.writeHead(200); res.end("late"); }, 3000),
        "/pdf": { headers: { "Content-Type": "application/pdf" }, body: "%PDF-1.4" },
        "/canon-to-404": { body: page({ title: "Canon 404", description: "c404", canonical: "/does-not-exist" }) },
        "/canon-elsewhere": { body: page({ title: "Canon other", description: "co", canonical: "/home" }) },
        "/search": { body: page({ title: "Search", description: "Search results", canonical: "/search?q=car&page=2" }) },
        "/no-meta": { body: html({ body: "<p>No head data</p>" }) }
    });
});

after(() => site.close());

test("auditPage returns structured data for the requested page (no URL mix-up)", async () => {
    const p = await auditPage(site.url("/car"), { ...FAST, rootUrl: site.url("/") });
    assert.equal(p.requestedUrl, site.url("/car"));
    assert.equal(p.finalUrl, site.url("/car"));
    assert.equal(p.status, 200);
    assert.equal(p.title.text, "Car insurance");
    assert.equal(p.title.length, 13);
    assert.equal(p.metaDescription.text, "Cover for your car");
    assert.equal(p.canonical.url, site.url("/car"));
    assert.equal(p.h1.count, 2);
    // "quote" on /car (no trailing slash) resolves to /quote, as in a browser.
    assert.deepEqual(p.links.internal, [site.url("/quote")]);
    assert.match(p.contentType, /text\/html/);
    assert.equal(p.indexability.indexable, true);
    assert.ok(p.issues.some(i => i.code === "H1_MULTIPLE"));
    assert.ok(p.issues.some(i => i.code === "JSONLD_GOOGLE_REQUIRED_MISSING"));
});

test("auditPage: missing metadata produces issues, not crashes", async () => {
    const p = await auditPage(site.url("/no-meta"), { ...FAST, rootUrl: site.url("/") });
    const codes = p.issues.map(i => i.code);
    for (const code of ["TITLE_MISSING", "DESCRIPTION_MISSING", "CANONICAL_MISSING", "H1_MISSING"]) {
        assert.ok(codes.includes(code), code);
    }
    assert.equal(p.indexability.canonicalStatus, "missing");
});

test("auditPage: non-HTML content is not parsed as HTML", async () => {
    const p = await auditPage(site.url("/pdf"), { ...FAST, rootUrl: site.url("/") });
    assert.equal(p.analyzed, false);
    assert.ok(p.issues.some(i => i.code === "NOT_HTML"));
});

test("auditPage: X-Robots-Tag noindex overrides meta index and is reported", async () => {
    const p = await auditPage(site.url("/header-noindex"), { ...FAST, rootUrl: site.url("/") });
    assert.deepEqual(p.xRobotsTag.all, ["noindex"]);
    assert.equal(p.indexability.noindex, true);
    assert.ok(p.issues.some(i => i.code === "ROBOTS_CONFLICT"));
});

test("auditPage: network failure and timeout are captured", async () => {
    const reset = await auditPage(site.url("/reset"), { ...FAST, rootUrl: site.url("/") });
    assert.ok(reset.fetchError);
    assert.ok(reset.issues.some(i => i.code === "FETCH_FAILED"));
    const slow = await auditPage(site.url("/slow"), { ...FAST, timeoutMs: 200, rootUrl: site.url("/") });
    assert.equal(slow.fetchError.code, "ETIMEDOUT");
});

test("full audit from the root URL: discovers sitemaps via robots.txt and audits every page", async () => {
    const report = await runAudit(site.url("/"), FAST);
    const byPath = Object.fromEntries(report.pages.map(p => [new URL(p.requestedUrl).pathname + new URL(p.requestedUrl).search, p]));

    // Every in-scope sitemap URL was audited independently.
    assert.equal(report.sitemap.urlCount, 16);
    assert.deepEqual(report.sitemap.outOfScope, ["https://other-site.example/foreign"]);
    assert.equal(report.pages.length, 15);
    assert.ok(byPath["/search?q=car&page=2"], "query-string URL kept distinct");

    // Results are attached to the right URLs.
    assert.equal(byPath["/home"].title.text, "Home insurance");
    assert.equal(byPath["/car"].title.text, "Car insurance");

    // Failures did not stop the audit.
    assert.equal(report.summary.fetchFailures, 2);
    assert.ok(byPath["/reset"].fetchError);
    assert.equal(byPath["/slow"].fetchError.code, "ETIMEDOUT");
    assert.equal(byPath["/gone"].status, 410);

    // Redirect recorded.
    assert.equal(byPath["/old"].finalUrl, site.url("/home"));
    assert.equal(byPath["/old"].redirectChain[0].status, 301);

    // Links classified against the mock site's own origin.
    const root = byPath["/"];
    assert.ok(root.links.internal.includes(site.url("/home")), "fragment stripped");
    assert.deepEqual(root.links.external, ["https://partner.example/"]);
    assert.equal(root.images.missingAlt.length, 1);
    assert.equal(root.images.emptyAlt, 1);
    assert.equal(root.inSitemap, true);

    const { site: s } = report;

    // Duplicate titles (case/whitespace-insensitive) and descriptions.
    assert.equal(s.duplicateTitles.length, 1);
    assert.deepEqual(s.duplicateTitles[0].urls.sort(), [site.url("/dup-a"), site.url("/dup-b")]);
    assert.equal(s.duplicateDescriptions.length, 1);

    // Missing canonical.
    assert.ok(s.missingCanonical.includes(site.url("/header-noindex")));

    // Invalid canonical destination.
    const c404 = s.canonicalIssues.find(c => c.canonical === site.url("/does-not-exist"));
    assert.ok(c404, JSON.stringify(s.canonicalIssues));
    assert.ok(c404.problems.some(p => /404/.test(p)));
    assert.ok(!s.canonicalIssues.some(c => c.canonical === site.url("/home")), "valid canonical target not flagged");

    // Indexability conflicts.
    const conflict = (p) => s.indexabilityConflicts.find(c => c.url === site.url(p));
    assert.ok(conflict("/noindex").conflicts.some(c => /noindex/.test(c)));
    assert.ok(conflict("/header-noindex").conflicts.some(c => /noindex/.test(c)));
    assert.ok(conflict("/old").conflicts.some(c => /redirects/.test(c)));
    assert.ok(conflict("/gone").conflicts.some(c => /410/.test(c)));
    assert.ok(conflict("/canon-elsewhere").conflicts.some(c => /canonicalised/.test(c)));
    assert.equal(conflict("/home"), undefined);

    // Broken and redirecting internal links.
    const broken = s.brokenInternalLinks.map(l => l.url);
    assert.ok(broken.includes(site.url("/missing-page")));
    assert.ok(broken.includes(site.url("/quote")), "relative link resolved against /car is broken");
    assert.ok(!broken.includes(site.url("/home")));
    assert.ok(s.redirectingInternalLinks.some(l => l.url === site.url("/old")));
    assert.equal(s.brokenInternalLinks.find(l => l.url === site.url("/missing-page")).sources[0], site.url("/"));
});

test("audit from a sitemap URL directly with link checking disabled", async () => {
    const report = await runAudit(site.url("/sitemap-more.xml"), { ...FAST, checkLinks: false });
    assert.equal(report.pages.length, 1);
    assert.equal(report.site.linkCheck.skipped, true);
});

test("bot-protection challenge is reported as blocked, not as SEO issues", async () => {
    const waf = await startServer({
        "/sitemap.xml": (req, res, api) => {
            res.writeHead(200, XML);
            res.end(`<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
                <url><loc>${api.url("/challenged")}</loc></url><url><loc>${api.url("/fine")}</loc></url></urlset>`);
        },
        "/challenged": { body: `<html><head><META NAME="robots" CONTENT="noindex,nofollow">
            <script src="/_Incapsula_Resource?SWJIYLWA=x"></script><body></body></html>` },
        "/fine": { body: page({ title: "Fine", description: "Fine page", canonical: "/fine" }) }
    });
    try {
        const report = await runAudit(waf.url("/sitemap.xml"), { ...FAST, checkLinks: false });
        const blocked = report.pages.find(p => p.requestedUrl.endsWith("/challenged"));
        assert.equal(blocked.blocked.vendor, "Imperva Incapsula");
        assert.deepEqual(blocked.issues.map(i => i.code), ["BLOCKED_BY_BOT_PROTECTION"]);
        assert.equal(blocked.indexability, null, "indexability unknown, not 'noindex'");
        assert.equal(report.summary.blockedByBotProtection, 1);
        assert.equal(report.site.indexabilityConflicts.length, 0, "WAF noindex is not a site conflict");
        assert.ok(!report.site.missingCanonical.some(u => u.endsWith("/challenged")));
        assert.deepEqual(report.site.blockedPages.map(b => b.vendor), ["Imperva Incapsula"]);
    } finally {
        await waf.close();
    }
});

test("hosts the root redirects to (rebrand) are added to the crawl scope", async () => {
    // Old brand: http://localhost:<port>, new brand: http://127.0.0.1:<port>.
    const brand = await startServer({
        "/robots.txt": (req, res, api) => {
            if (req.headers.host.startsWith("localhost")) {
                res.writeHead(301, { Location: api.url("/robots.txt") });
                res.end();
                return;
            }
            res.writeHead(200, { "Content-Type": "text/plain" });
            res.end(`Sitemap: ${api.url("/sitemap.xml")}`);
        },
        "/sitemap.xml": (req, res, api) => {
            res.writeHead(200, XML);
            res.end(`<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${api.url("/p")}</loc></url></urlset>`);
        },
        "/p": (req, res, api) => {
            res.writeHead(200, { "Content-Type": "text/html" });
            res.end(page({ title: "P", description: "p", canonical: "/p",
                body: `<a href="${api.url("/q")}">same site, new host</a><a href="https://elsewhere.example/">ext</a>` }));
        }
    });
    try {
        const oldRoot = brand.origin.replace("127.0.0.1", "localhost") + "/";
        const report = await runAudit(oldRoot, { ...FAST, checkLinks: false });
        assert.deepEqual(report.config.autoScopeHosts, ["127.0.0.1"]);
        assert.equal(report.pages.length, 1);
        assert.deepEqual(report.pages[0].links.internal, [brand.url("/q")]);
        assert.deepEqual(report.pages[0].links.external, ["https://elsewhere.example/"]);

        const strict = await runAudit(oldRoot, { ...FAST, checkLinks: false, followRootRedirect: false });
        assert.equal(strict.sitemap.outOfScope.length, 1, "without the alias the new host is out of scope");
    } finally {
        await brand.close();
    }
});

test("maxUrls limits the audit and reports what was skipped", async () => {
    const report = await runAudit(site.url("/sitemap-pages.xml"), { ...FAST, maxUrls: 3, checkLinks: false });
    assert.equal(report.pages.length, 3);
    assert.equal(report.sitemap.skippedByLimit, 11);
});
