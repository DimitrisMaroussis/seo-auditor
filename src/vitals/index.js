"use strict";

const fs = require("fs");
const path = require("path");
const { runPsi } = require("./psi");
const { getFieldData, callCrux } = require("./crux");

const KEY_FILE = path.join(__dirname, "..", "..", ".google-api-key");

/** The Google API key: GOOGLE_API_KEY env var, else the .google-api-key file. Null when missing. */
function loadApiKey(file = KEY_FILE) {
    if (process.env.GOOGLE_API_KEY) return process.env.GOOGLE_API_KEY.trim();
    try {
        const key = fs.readFileSync(file, "utf8").trim();
        return key || null;
    } catch {
        return null;
    }
}

/** Where the key came from: "env" (GOOGLE_API_KEY), "file", or null when there is none. */
function apiKeySource(file = KEY_FILE) {
    if (process.env.GOOGLE_API_KEY) return "env";
    return loadApiKey(file) ? "file" : null;
}

// Google API keys are 39 characters starting with "AIza"; accept any similar token
// so a future key format is not refused, but catch pasted URLs, quotes and spaces.
const KEY_SHAPE = /^[A-Za-z0-9_-]{30,64}$/;

/** Save the key to the key file (readable by this user only, where the OS supports it). */
function saveApiKey(key, file = KEY_FILE) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, key, { encoding: "utf8", mode: 0o600 });
}

/** Delete the key file. Returns true when there was one. */
function removeApiKey(file = KEY_FILE) {
    try {
        fs.unlinkSync(file);
        return true;
    } catch (err) {
        if (err.code === "ENOENT") return false;
        throw err;
    }
}

/**
 * Test a key with one small Chrome UX Report request (a second, unlike a
 * PageSpeed run). Resolves to:
 *   { ok: true }                              the key works for CrUX
 *   { ok: false, code: "EINVALIDKEY" }        Google does not know the key
 *   { ok: false, code: "ECRUXDISABLED" }      the key's project has not enabled the CrUX API
 *   { ok: false, code: "EVERIFY", message }   any other refusal (restrictions, billing…)
 *   { ok: null, code: "ENETWORK" }            Google could not be reached; the key is untested
 * The PageSpeed Insights API cannot be tested this cheaply; a check reports it if it is off.
 */
async function verifyApiKey(apiKey, { fetchImpl = fetch, timeoutMs = 10000 } = {}) {
    let r;
    try {
        r = await callCrux("record", { origin: "https://www.google.com" }, { apiKey, fetchImpl, timeoutMs });
    } catch {
        return { ok: null, code: "ENETWORK" };
    }
    if (r.status === 200 || r.status === 404 || r.status === 429) return { ok: true };   // 429: valid key, quota used up
    const error = (r.body && r.body.error) || {};
    const text = `${error.message || ""} ${JSON.stringify(error.details || [])}`;
    if (/API_KEY_INVALID|API key not valid|API key expired/i.test(text)) return { ok: false, code: "EINVALIDKEY" };
    if (/SERVICE_DISABLED|has not been used in project|is disabled/i.test(text)) return { ok: false, code: "ECRUXDISABLED" };
    return { ok: false, code: "EVERIFY", message: redact(error.message || `HTTP ${r.status}`, apiKey) };
}

/** Remove the API key from any text that could reach a report, log or the browser. */
const redact = (text, apiKey) => (apiKey ? String(text).split(apiKey).join("[key]") : String(text));

function abortError() {
    const err = new Error("Vitals check cancelled");
    err.code = "EABORTED";
    return err;
}

/**
 * Collect Core Web Vitals for one URL:
 *   lab   – PageSpeed Insights (Lighthouse) on mobile and desktop
 *   field – Chrome UX Report for this page and for the whole site (origin),
 *           using the URL the site actually ends on after redirects.
 * Partial failures are recorded in `errors`; the run only throws when nothing
 * could be fetched (e.g. a missing or rejected API key).
 *
 * @param {string} input
 * @param {object} opts { apiKey, fetchImpl?, signal?, onPhase?(phase) }
 */
async function runVitals(input, opts = {}) {
    const { apiKey, signal } = opts;
    if (!apiKey) {
        const err = new Error("No Google API key configured");
        err.code = "ENOKEY";
        throw err;
    }
    let url;
    try {
        url = new URL(input);
        if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error();
    } catch {
        throw new Error("Enter a full URL, starting with http:// or https://");
    }

    const callOpts = { apiKey, fetchImpl: opts.fetchImpl };
    const emit = (phase) => typeof opts.onPhase === "function" && opts.onPhase(phase);
    const errors = [];
    const fail = (source, err) => errors.push({ source, status: err.status ?? null, message: redact(err.message, apiKey) });

    // ---------- lab: Lighthouse via PageSpeed Insights ----------
    emit("lab");
    const [mobile, desktop] = await Promise.allSettled([
        runPsi(url.href, "mobile", callOpts),
        runPsi(url.href, "desktop", callOpts)
    ]);
    if (signal?.aborted) throw abortError();
    const lab = {
        mobile: mobile.status === "fulfilled" ? mobile.value : null,
        desktop: desktop.status === "fulfilled" ? desktop.value : null
    };
    if (mobile.status === "rejected") fail("lab-mobile", mobile.reason);
    if (desktop.status === "rejected") fail("lab-desktop", desktop.reason);

    // Real visitors land where the site redirects (e.g. a rebranded domain),
    // so field data is looked up for the final URL.
    const finalUrl = (lab.mobile && lab.mobile.finalUrl) || (lab.desktop && lab.desktop.finalUrl) || url.href;
    const origin = new URL(finalUrl).origin;

    // ---------- field: Chrome UX Report ----------
    emit("field");
    const field = { page: null, site: null };
    const [page, site] = await Promise.allSettled([
        getFieldData({ url: finalUrl }, callOpts),
        getFieldData({ origin }, callOpts)
    ]);
    if (signal?.aborted) throw abortError();
    if (page.status === "fulfilled") field.page = page.value; else fail("field-page", page.reason);
    if (site.status === "fulfilled") field.site = site.value; else fail("field-site", site.reason);

    if (!lab.mobile && !lab.desktop && !field.page && !field.site) {
        const err = new Error(errors[0] ? errors[0].message : "No data returned");
        err.status = errors[0] ? errors[0].status : null;
        throw err;
    }

    return {
        type: "vitals",
        generatedAt: new Date().toISOString(),
        requestedUrl: url.href,
        finalUrl,
        origin,
        field,
        lab,
        errors
    };
}

module.exports = { runVitals, loadApiKey, redact, apiKeySource, saveApiKey, removeApiKey, verifyApiKey, KEY_FILE, KEY_SHAPE };
