"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { extractSeo, parseXRobotsTag } = require("../src/html");

const PAGE = "https://www.example.gr/products/car/";
const opts = { rootUrl: "https://www.example.gr/" };
const doc = (head, body = "") => `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;

test("meta description: content before name, single quotes, uppercase attributes", () => {
    const variants = [
        `<meta name="description" content="Car insurance">`,
        `<meta content="Car insurance" name="description">`,
        `<meta content='Car insurance' name='description'>`,
        `<META CONTENT="Car insurance" NAME="Description">`,
        `<meta name=description content="Car insurance">`,
        `<meta\n  property="x"\n  content="Car insurance"\n  name="description"\n/>`
    ];
    for (const tag of variants) {
        assert.equal(extractSeo(doc(tag), PAGE, opts).metaDescription.text, "Car insurance", tag);
    }
});

test("quotes and entities inside attribute values are preserved", () => {
    const seo = extractSeo(doc(
        `<meta name="description" content="Driver's guide &amp; &quot;tips&quot;">` +
        `<title>Tom &amp; Jerry's Cover</title>`
    ), PAGE, opts);
    assert.equal(seo.metaDescription.text, `Driver's guide & "tips"`);
    assert.equal(seo.title.text, "Tom & Jerry's Cover");
});

test("title: missing, empty, multi-line, svg <title> ignored", () => {
    assert.equal(extractSeo(doc(""), PAGE, opts).title.text, null);
    assert.equal(extractSeo(doc("<title></title>"), PAGE, opts).title.text, "");
    assert.equal(extractSeo(doc("<title>\n  Car\n  Insurance </title>"), PAGE, opts).title.text, "Car Insurance");
    const svg = extractSeo(doc("", `<svg><title>Icon</title></svg>`), PAGE, opts);
    assert.equal(svg.title.text, null);
});

test("title length counts characters, not bytes (Greek)", () => {
    const seo = extractSeo(doc("<title>Ασφάλεια</title>"), PAGE, opts);
    assert.equal(seo.title.length, 8);
});

test("missing vs empty meta description", () => {
    assert.equal(extractSeo(doc(""), PAGE, opts).metaDescription.text, null);
    assert.equal(extractSeo(doc(`<meta name="description" content="">`), PAGE, opts).metaDescription.text, "");
    assert.equal(extractSeo(doc(`<meta name="description">`), PAGE, opts).metaDescription.text, "");
});

test("canonical: any attribute order, rel token list, relative href resolved", () => {
    const cases = [
        `<link rel="canonical" href="/products/car/">`,
        `<link href="/products/car/" rel="canonical">`,
        `<LINK HREF='/products/car/' REL='Canonical'>`,
        `<link rel="canonical nofollow" href="https://www.example.gr/products/car/">`
    ];
    for (const tag of cases) {
        const seo = extractSeo(doc(tag), PAGE, opts);
        assert.equal(seo.canonical.url, "https://www.example.gr/products/car/", tag);
        assert.equal(seo.canonical.count, 1);
    }
});

test("canonical missing, multiple, and in body", () => {
    assert.equal(extractSeo(doc(""), PAGE, opts).canonical.url, null);
    const multi = extractSeo(doc(`<link rel="canonical" href="/a"><link rel="canonical" href="/b">`), PAGE, opts);
    assert.equal(multi.canonical.count, 2);
    const inBody = extractSeo(doc("", `<link rel="canonical" href="/a">`), PAGE, opts);
    assert.equal(inBody.canonical.all[0].inHead, false);
});

test("stylesheet link with href is not mistaken for canonical", () => {
    const seo = extractSeo(doc(`<link rel="stylesheet" href="/canonical.css">`), PAGE, opts);
    assert.equal(seo.canonical.count, 0);
});

test("multiple H1 elements with nested markup", () => {
    const seo = extractSeo(doc("", `<h1>Car <span>insurance</span></h1><H1 class="x">Second</H1><h1></h1>`), PAGE, opts);
    assert.equal(seo.h1.count, 3);
    assert.deepEqual(seo.h1.texts, ["Car insurance", "Second", ""]);
});

test("images: alt missing vs decorative alt=\"\" vs present", () => {
    const seo = extractSeo(doc("", `
        <img src="a.png">
        <img src="b.png" alt="">
        <img alt src="c.png">
        <IMG SRC="d.png" ALT="Logo">
        <img src='e.png' alt='Driver&#39;s seat'>
    `), PAGE, opts);
    assert.equal(seo.images.count, 5);
    assert.equal(seo.images.missingAlt.length, 1);
    assert.equal(seo.images.missingAlt[0].src, "a.png");
    assert.equal(seo.images.emptyAlt, 2);   // alt="" and bare alt are decorative
    assert.equal(seo.images.all[4].alt, "Driver's seat");
});

test("links: internal vs external vs other, relative to page, deduped, fragment stripped", () => {
    const seo = extractSeo(doc("", `
        <a href="quote">Quote</a>
        <a href="quote#form">Quote again</a>
        <a HREF='/contact'>Contact</a>
        <a href="https://www.example.gr/contact">Contact abs</a>
        <a href="https://partner.com/x">Partner</a>
        <a href="https://blog.example.gr/">Blog</a>
        <a href="mailto:info@example.gr">Mail</a>
        <a href="tel:+302100000000">Call</a>
        <a href="#top">Top</a>
        <a href="">Empty</a>
        <a name="anchor">No href</a>
        <a href="/terms" rel="nofollow">Terms</a>
    `), PAGE, opts);
    assert.deepEqual(seo.links.internal.sort(), [
        "https://www.example.gr/contact",
        "https://www.example.gr/products/car/quote",
        "https://www.example.gr/terms"
    ]);
    assert.deepEqual(seo.links.external.sort(), ["https://blog.example.gr/", "https://partner.com/x"]);
    assert.equal(seo.links.other.length, 3);
    assert.equal(seo.links.invalid.length, 1);
    assert.deepEqual(seo.links.nofollow, ["https://www.example.gr/terms"]);
});

test("<base href> changes relative link resolution", () => {
    const seo = extractSeo(doc(`<base href="/other/">`, `<a href="page">x</a>`), PAGE, opts);
    assert.deepEqual(seo.links.internal, ["https://www.example.gr/other/page"]);
});

test("meta robots and googlebot directives are parsed", () => {
    const seo = extractSeo(doc(`<meta name="ROBOTS" content="NoIndex, follow"><meta content="nosnippet" name="googlebot">`), PAGE, opts);
    assert.deepEqual(seo.metaRobots.map(m => [m.name, m.directives]), [
        ["robots", ["noindex", "follow"]],
        ["googlebot", ["nosnippet"]]
    ]);
});

test("X-Robots-Tag header parsing, including agent-specific values", () => {
    assert.deepEqual(parseXRobotsTag("noindex, nofollow"), { all: ["noindex", "nofollow"], byAgent: {} });
    assert.deepEqual(parseXRobotsTag("googlebot: noindex"), { all: [], byAgent: { googlebot: ["noindex"] } });
    assert.deepEqual(parseXRobotsTag("max-snippet: 20, noarchive"), { all: ["max-snippet: 20", "noarchive"], byAgent: {} });
    assert.deepEqual(parseXRobotsTag(null), { all: [], byAgent: {} });
});

test("malformed HTML still yields data", () => {
    const malformed = `<html><head><title>Broken page<meta name="description" content="x">
        </head><body><h1>Unclosed <p>para <img src=x.png><a href=/ok>ok</body>`;
    const seo = extractSeo(malformed, PAGE, opts);
    // <title> is RCDATA: with no </title>, an HTML5 parser (and browsers)
    // treats the rest of the document as title text, so there is no <h1>.
    assert.equal(seo.title.count, 1);
    assert.match(seo.title.text, /^Broken page<meta name="description"/);
    assert.ok(seo.title.length > 60, "the swallowed markup makes the title long");
    assert.equal(seo.h1.count, 0);
    assert.equal(seo.metaDescription.text, null);
    const fixable = `<html><head><title>T</title><meta name=description content=D></head>
        <body><h1>A<h1>B<div><img src=x.png alt=Y><a href=/ok>ok</div>`;
    const seo2 = extractSeo(fixable, PAGE, opts);
    assert.equal(seo2.title.text, "T");
    assert.equal(seo2.metaDescription.text, "D");
    assert.equal(seo2.images.count, 1);
    assert.equal(seo2.images.missingAlt.length, 0);
    assert.deepEqual(seo2.links.internal, ["https://www.example.gr/ok"]);
});

test("empty or non-string input does not throw", () => {
    assert.doesNotThrow(() => extractSeo("", PAGE, opts));
    assert.doesNotThrow(() => extractSeo(null, PAGE, opts));
});

test("JSON-LD blocks are extracted raw, with type attribute variations", () => {
    const seo = extractSeo(doc(
        `<script type="application/ld+json">{"@type":"Thing","name":"a < b && c"}</script>` +
        `<SCRIPT TYPE='Application/LD+JSON'>{"x":1}</SCRIPT>` +
        `<script type="application/json">{"ignored":true}</script>`
    ), PAGE, opts);
    assert.equal(seo.jsonLdBlocks.length, 2);
    assert.deepEqual(JSON.parse(seo.jsonLdBlocks[0]), { "@type": "Thing", name: "a < b && c" });
});
