"use strict";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { parseSitemapXml, loadSitemap } = require("../src/sitemap");
const { startServer } = require("./helpers/mockServer");

const XML = { "Content-Type": "application/xml" };
const urlset = (...locs) =>
    `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">` +
    locs.map(l => `<url><loc>${l}</loc></url>`).join("") + `</urlset>`;
const index = (...locs) =>
    `<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">` +
    locs.map(l => `<sitemap><loc>${l}</loc></sitemap>`).join("") + `</sitemapindex>`;

test("parses a urlset", () => {
    const r = parseSitemapXml(urlset("https://a.gr/1", "https://a.gr/2"));
    assert.equal(r.type, "urlset");
    assert.deepEqual(r.locs, ["https://a.gr/1", "https://a.gr/2"]);
    assert.equal(r.error, null);
});

test("single <url> entry is still an array", () => {
    assert.deepEqual(parseSitemapXml(urlset("https://a.gr/only")).locs, ["https://a.gr/only"]);
});

test("decodes entities and CDATA, trims whitespace", () => {
    const xml = `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        <url><loc>
            https://a.gr/search?q=car&amp;page=2
        </loc><lastmod>2024-01-01</lastmod></url>
        <url><loc><![CDATA[https://a.gr/x?a=1&b=2]]></loc></url>
    </urlset>`;
    assert.deepEqual(parseSitemapXml(xml).locs, ["https://a.gr/search?q=car&page=2", "https://a.gr/x?a=1&b=2"]);
});

test("does not pick up <loc> from image/video extensions as pages", () => {
    const xml = `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
        <url><loc>https://a.gr/page</loc>
            <image:image><image:loc>https://a.gr/img.jpg</image:loc></image:image>
        </url></urlset>`;
    assert.deepEqual(parseSitemapXml(xml).locs, ["https://a.gr/page"]);
});

test("parses a sitemap index", () => {
    const r = parseSitemapXml(index("https://a.gr/s1.xml", "https://a.gr/s2.xml"));
    assert.equal(r.type, "sitemapindex");
    assert.deepEqual(r.locs, ["https://a.gr/s1.xml", "https://a.gr/s2.xml"]);
});

test("namespace-prefixed root elements are recognised", () => {
    const xml = `<sm:urlset xmlns:sm="http://www.sitemaps.org/schemas/sitemap/0.9"><sm:url><sm:loc>https://a.gr/p</sm:loc></sm:url></sm:urlset>`;
    assert.deepEqual(parseSitemapXml(xml).locs, ["https://a.gr/p"]);
});

test("invalid, empty and non-sitemap XML report errors instead of throwing", () => {
    assert.match(parseSitemapXml("<urlset><url><loc>x</url>").error, /Invalid XML/);
    assert.match(parseSitemapXml("").error, /Empty/);
    assert.match(parseSitemapXml("<html><body>hi</body></html>").error, /neither/);
    assert.match(parseSitemapXml("<!doctype html><html>").error, /Invalid XML/);
});

test("UTF-8 BOM is tolerated", () => {
    assert.deepEqual(parseSitemapXml("﻿" + urlset("https://a.gr/1")).locs, ["https://a.gr/1"]);
});

let site;
before(async () => {
    site = await startServer({
        "/sitemap_index.xml": (req, res, api) => {
            res.writeHead(200, XML);
            res.end(index(api.url("/pages.xml"), api.url("/posts.xml"), api.url("/missing.xml"),
                api.url("/nested-index.xml"), api.url("/pages.xml")));
        },
        "/pages.xml": (req, res, api) => {
            res.writeHead(200, XML);
            res.end(urlset(api.url("/"), api.url("/about"), api.url("/about#team"), "not a url"));
        },
        "/posts.xml": (req, res, api) => {
            res.writeHead(200, XML);
            res.end(urlset(api.url("/post?id=1&amp;lang=el"), api.url("/post?id=2&amp;lang=el")));
        },
        "/nested-index.xml": (req, res, api) => {
            res.writeHead(200, XML);
            // Points back at the parent: must not loop.
            res.end(index(api.url("/sitemap_index.xml"), api.url("/deep.xml")));
        },
        "/deep.xml": (req, res, api) => {
            res.writeHead(200, XML);
            res.end(urlset(api.url("/deep-page")));
        },
        "/old-sitemap.xml": { status: 301, headers: { Location: "/pages.xml" } },
        "/broken.xml": { headers: XML, body: "<urlset><url><loc>oops</urlset>" }
    });
});
after(() => site.close());

const FAST = { timeoutMs: 1500, retries: 0 };

test("loads a sitemap index with child sitemaps, dedupes, survives loops and 404s", async () => {
    const r = await loadSitemap(site.url("/sitemap_index.xml"), FAST);
    assert.deepEqual(r.pageUrls.sort(), [
        site.url("/"),
        site.url("/about"),
        site.url("/deep-page"),
        site.url("/post?id=1&lang=el"),
        site.url("/post?id=2&lang=el")
    ].sort());
    assert.equal(site.hits.get("/pages.xml"), 1, "duplicate child sitemap fetched once");
    assert.equal(site.hits.get("/sitemap_index.xml"), 1, "loop back to the index is not refetched");
    assert.ok(r.errors.some(e => e.url.endsWith("/missing.xml") && /404/.test(e.error)));
    assert.ok(r.errors.some(e => e.url === "not a url"));
    const types = Object.fromEntries(r.sitemaps.map(s => [new URL(s.url).pathname, s.type]));
    assert.equal(types["/sitemap_index.xml"], "sitemapindex");
    assert.equal(types["/pages.xml"], "urlset");
});

test("follows a redirect to the sitemap", async () => {
    const r = await loadSitemap(site.url("/old-sitemap.xml"), FAST);
    assert.ok(r.pageUrls.includes(site.url("/about")));
});

test("malformed sitemap XML is reported", async () => {
    const r = await loadSitemap(site.url("/broken.xml"), FAST);
    assert.equal(r.pageUrls.length, 0);
    assert.match(r.errors[0].error, /Invalid XML/);
});

test("maximum nesting depth is enforced", async () => {
    const r = await loadSitemap(site.url("/sitemap_index.xml"), { ...FAST, maxSitemapDepth: 0 });
    assert.ok(r.errors.some(e => /deeper than 0/.test(e.error)));
    assert.equal(r.pageUrls.length, 0);
});
