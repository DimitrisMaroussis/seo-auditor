"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { detectBotChallenge } = require("../src/botProtection");

// Shape of the page www.cosmoteinsurance.gr served to this auditor (2026-10-17).
const IMPERVA_CHALLENGE = `<html>
<head>
<META NAME="robots" CONTENT="noindex,nofollow">
<script src="/_Incapsula_Resource?SWJIYLWA=5074a744e2e3d891814e9a2dace20bd4,719d34d31c8e3a6e6fffd425f7e032f3">
</script>
<body>
</body></html>`;

test("Imperva challenge page is detected", () => {
    const r = detectBotChallenge(IMPERVA_CHALLENGE);
    assert.equal(r.vendor, "Imperva Incapsula");
    assert.equal(r.visibleTextChars, 0);
});

test("a real page that merely includes the vendor script is NOT flagged", () => {
    const realPage = `<html><head><title>Car insurance</title>
        <script src="/_Incapsula_Resource?SWJIYLWA=abc"></script></head>
        <body><h1>Car insurance</h1><p>${"Real content about cover options. ".repeat(20)}</p></body></html>`;
    assert.equal(detectBotChallenge(realPage), null);
});

test("Cloudflare interstitial is detected", () => {
    const cf = `<!DOCTYPE html><html><head><title>Just a moment...</title></head>
        <body><noscript>Enable JavaScript and cookies to continue</noscript>
        <script>window._cf_chl_opt={cvId:'3'};</script></body></html>`;
    assert.equal(detectBotChallenge(cf).vendor, "Cloudflare");
});

test("ordinary pages and empty bodies are not flagged", () => {
    assert.equal(detectBotChallenge("<html><head><title>Hi</title></head><body>Hello</body></html>"), null);
    assert.equal(detectBotChallenge(""), null);
    assert.equal(detectBotChallenge(null), null);
});
