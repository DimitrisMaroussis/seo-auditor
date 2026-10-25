"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { normalizeUrl, isSameSite, classifyLink } = require("../src/url");

const ROOT = "https://www.example.gr/";
const PAGE = "https://www.example.gr/insurance/car/";

test("normalizeUrl strips fragments but keeps the query string", () => {
    assert.equal(normalizeUrl("https://www.example.gr/a?id=2#top"), "https://www.example.gr/a?id=2");
    assert.notEqual(normalizeUrl("https://www.example.gr/a?id=1"), normalizeUrl("https://www.example.gr/a?id=2"));
});

test("normalizeUrl does not merge distinct paths", () => {
    assert.notEqual(normalizeUrl("https://www.example.gr/a"), normalizeUrl("https://www.example.gr/a/"));
    assert.notEqual(normalizeUrl("https://www.example.gr/A"), normalizeUrl("https://www.example.gr/a"));
});

test("normalizeUrl lowercases host and drops default ports", () => {
    assert.equal(normalizeUrl("HTTPS://WWW.Example.GR:443/x"), "https://www.example.gr/x");
    assert.equal(normalizeUrl("http://example.gr:80/x"), "http://example.gr/x");
});

test("normalizeUrl rejects non-http schemes and garbage", () => {
    assert.equal(normalizeUrl("mailto:a@b.c"), null);
    assert.equal(normalizeUrl("::::"), null);
});

test("relative links resolve against the page they were found on", () => {
    assert.equal(classifyLink("quote", PAGE, ROOT).url, "https://www.example.gr/insurance/car/quote");
    assert.equal(classifyLink("../home/", PAGE, ROOT).url, "https://www.example.gr/insurance/home/");
    assert.equal(classifyLink("/contact", PAGE, ROOT).url, "https://www.example.gr/contact");
    assert.equal(classifyLink("?page=2", PAGE, ROOT).url, "https://www.example.gr/insurance/car/?page=2");
});

test("protocol-relative links keep the page protocol", () => {
    assert.equal(classifyLink("//www.example.gr/x", PAGE, ROOT).url, "https://www.example.gr/x");
});

test("internal vs external is derived from the root URL, not hardcoded", () => {
    assert.equal(classifyLink("/x", PAGE, ROOT).kind, "internal");
    assert.equal(classifyLink("https://www.example.gr/x", PAGE, ROOT).kind, "internal");
    assert.equal(classifyLink("https://www.other.gr/x", PAGE, ROOT).kind, "external");
    // Same page, different root → classification follows the root.
    assert.equal(classifyLink("https://www.example.gr/x", PAGE, "https://www.other.gr/").kind, "external");
});

test("lookalike hosts are external under both policies", () => {
    for (const policy of ["exact-host", "include-subdomains"]) {
        assert.equal(classifyLink("https://www.example.gr.evil.com/", PAGE, ROOT, policy).kind, "external");
        assert.equal(classifyLink("https://notexample.gr/", PAGE, ROOT, policy).kind, "external");
    }
});

test("subdomain policy: exact-host vs include-subdomains", () => {
    assert.equal(classifyLink("https://blog.example.gr/", PAGE, ROOT, "exact-host").kind, "external");
    assert.equal(classifyLink("https://example.gr/", PAGE, ROOT, "exact-host").kind, "external");
    assert.equal(classifyLink("https://blog.example.gr/", PAGE, ROOT, "include-subdomains").kind, "internal");
    assert.equal(classifyLink("https://example.gr/", PAGE, ROOT, "include-subdomains").kind, "internal");
    assert.throws(() => isSameSite("a", "b", "bogus"));
});

test("http and https on the same host are both internal", () => {
    assert.equal(classifyLink("http://www.example.gr/x", PAGE, ROOT).kind, "internal");
});

test("mailto/tel/javascript/fragment-only links are 'other'", () => {
    for (const href of ["mailto:a@b.c", "tel:+30210", "javascript:void(0)", "#section", "data:text/plain,hi"]) {
        assert.equal(classifyLink(href, PAGE, ROOT).kind, "other", href);
    }
});

test("fragments are removed from classified URLs", () => {
    assert.equal(classifyLink("/faq#q1", PAGE, ROOT).url, "https://www.example.gr/faq");
});

test("empty and unparsable hrefs are 'invalid'", () => {
    assert.equal(classifyLink("", PAGE, ROOT).kind, "invalid");
    assert.equal(classifyLink("   ", PAGE, ROOT).kind, "invalid");
    assert.equal(classifyLink("http://[bad", PAGE, ROOT).kind, "invalid");
});
