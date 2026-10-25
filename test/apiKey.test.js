"use strict";

const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createApi } = require("../src/api");
const { verifyApiKey } = require("../src/vitals");

const GOOD = "AIzaSyGoodKey0123456789abcdefghijklmno";      // 39 characters, like a real key
const DISABLED = "AIzaSyCruxOff0123456789abcdefghijklmno";
const OFFLINE = "AIzaSyOffline0123456789abcdefghijklmno";

let dir, keyFile, server, base;
const savedEnv = process.env.GOOGLE_API_KEY;

// Stands in for Google: one key works, one belongs to a project without the CrUX API, one cannot be reached.
const verifyKey = async (key) => key === GOOD ? { ok: true }
    : key === DISABLED ? { ok: false, code: "ECRUXDISABLED" }
    : key === OFFLINE ? { ok: null, code: "ENETWORK" }
    : { ok: false, code: "EINVALIDKEY" };

before(async () => {
    delete process.env.GOOGLE_API_KEY;
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "seo-key-"));
    keyFile = path.join(dir, "app-data", ".google-api-key");   // parent folder does not exist yet, like a fresh install
    const handler = createApi({ reportsDir: path.join(dir, "reports"), vitals: { keyFile, verifyKey } });
    server = http.createServer((req, res) => handler(req, res));
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${server.address().port}/api/vitals`;
});

after(async () => {
    if (savedEnv === undefined) delete process.env.GOOGLE_API_KEY;
    else process.env.GOOGLE_API_KEY = savedEnv;
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => fs.rmSync(keyFile, { force: true }));

const put = (key, headers = {}) => fetch(`${base}/key`, {
    method: "PUT", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify({ key })
});
const status = async () => (await fetch(`${base}/status`)).json();

test("a working key is saved to the key file and only its last 4 characters are ever returned", async () => {
    assert.deepEqual(await status(), { configured: false, source: null, last4: null });

    const res = await put(`  "${GOOD}"\n`);   // pasted with quotes and whitespace
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body, { configured: true, source: "file", last4: "lmno", verified: true });
    assert.ok(!JSON.stringify(body).includes(GOOD.slice(0, 10)));
    assert.equal(fs.readFileSync(keyFile, "utf8"), GOOD);
    assert.deepEqual(await status(), { configured: true, source: "file", last4: "lmno" });
});

test("a key Google rejects is not saved, and the reason comes back as a code", async () => {
    const invalid = await put("AIzaSyWrongKey0123456789abcdefghijklmn");
    assert.equal(invalid.status, 422);
    assert.equal((await invalid.json()).code, "EINVALIDKEY");

    const disabled = await put(DISABLED);
    assert.equal(disabled.status, 422);
    assert.equal((await disabled.json()).code, "ECRUXDISABLED");

    assert.equal(fs.existsSync(keyFile), false);
});

test("text that is not shaped like a key is refused before calling Google", async () => {
    for (const bad of ["", "abc", "https://console.cloud.google.com/apis/credentials?key=AIzaSy123", "AIza key with spaces 0123456789abcdef"]) {
        const res = await put(bad);
        assert.equal(res.status, 400, bad);
        assert.equal((await res.json()).code, "EFORMAT", bad);
    }
});

test("when Google cannot be reached the key is saved but marked untested", async () => {
    const res = await put(OFFLINE);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).verified, false);
    assert.equal(fs.readFileSync(keyFile, "utf8"), OFFLINE);
});

test("the key can be replaced and removed", async () => {
    await put(OFFLINE);
    await put(GOOD);
    assert.equal(fs.readFileSync(keyFile, "utf8"), GOOD);

    const res = await fetch(`${base}/key`, { method: "DELETE" });
    assert.deepEqual(await res.json(), { configured: false, source: null, last4: null });
    assert.equal(fs.existsSync(keyFile), false);
});

test("other websites cannot set or remove the key", async () => {
    const res = await put(GOOD, { Origin: "https://evil.example" });
    assert.equal(res.status, 403);
    const del = await fetch(`${base}/key`, { method: "DELETE", headers: { Origin: "https://evil.example" } });
    assert.equal(del.status, 403);
    assert.equal(fs.existsSync(keyFile), false);
});

test("a key from the GOOGLE_API_KEY environment variable is reported but cannot be changed here", async () => {
    process.env.GOOGLE_API_KEY = GOOD;
    try {
        assert.deepEqual(await status(), { configured: true, source: "env", last4: "lmno" });
        const res = await put(OFFLINE);
        assert.equal(res.status, 409);
        assert.equal((await res.json()).code, "EENV");
        assert.equal(fs.existsSync(keyFile), false);
    } finally {
        delete process.env.GOOGLE_API_KEY;
    }
});

// ---------- verifyApiKey against Google's real error shapes ----------

const google = (status, error) => async () => ({ status, json: async () => (error ? { error } : { record: {} }) });

test("verifyApiKey tells a bad key, a disabled API and other refusals apart", async () => {
    assert.deepEqual(await verifyApiKey(GOOD, { fetchImpl: google(200) }), { ok: true });
    assert.deepEqual(await verifyApiKey(GOOD, { fetchImpl: google(404, { code: 404, message: "chrome ux report data not found" }) }), { ok: true });
    assert.deepEqual(await verifyApiKey(GOOD, { fetchImpl: google(429, { code: 429, message: "Quota exceeded" }) }), { ok: true });

    assert.equal((await verifyApiKey(GOOD, { fetchImpl: google(400, {
        code: 400, message: "API key not valid. Please pass a valid API key.", status: "INVALID_ARGUMENT",
        details: [{ reason: "API_KEY_INVALID" }]
    }) })).code, "EINVALIDKEY");

    assert.equal((await verifyApiKey(GOOD, { fetchImpl: google(403, {
        code: 403, message: "Chrome UX Report API has not been used in project 123 before or it is disabled.",
        status: "PERMISSION_DENIED", details: [{ reason: "SERVICE_DISABLED" }]
    }) })).code, "ECRUXDISABLED");

    const restricted = await verifyApiKey(GOOD, { fetchImpl: google(403, {
        code: 403, message: `Requests from referer <empty> are blocked. key=${GOOD}`, details: [{ reason: "API_KEY_HTTP_REFERRER_BLOCKED" }]
    }) });
    assert.equal(restricted.code, "EVERIFY");
    assert.ok(!restricted.message.includes(GOOD), "the key never appears in a message");

    assert.deepEqual(await verifyApiKey(GOOD, { fetchImpl: async () => { throw new TypeError("fetch failed"); } }), { ok: null, code: "ENETWORK" });
});
