"use strict";

/*
 * Tracked pages: a saved list of URLs, each with the last 15 weeks of
 * real-visitor Core Web Vitals (LCP, INP, CLS) on mobile and desktop.
 *
 * The weekly numbers come from the Chrome UX Report History API. Each week is
 * Google's 75th percentile over the 28 days ending that week, which is the
 * figure Google uses to rate a page. Lab-only figures (TBT, Speed Index, the
 * performance score) have no history at Google and are not included.
 *
 * The list lives in one JSON file next to the saved reports.
 */

const fs = require("fs");
const path = require("path");
const { callCrux } = require("./crux");
const { BY_ID } = require("./metrics");

const WEEKS = 15;
const TRACKED = ["lcp", "inp", "cls"];
const MAX_PAGES = 100;

// ---------- the saved list ----------

function readList(file) {
    try {
        const data = JSON.parse(fs.readFileSync(file, "utf8"));
        return Array.isArray(data.pages) ? data.pages : [];
    } catch {
        return [];
    }
}

function writeList(file, pages) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ pages }, null, 2));
    fs.renameSync(tmp, file);   // never leave a half-written list behind
}

/** A URL in the form it is saved under: http(s), no #fragment. Throws a user-facing message. */
function normalizePageUrl(input) {
    let url;
    try {
        const text = String(input || "").trim();
        url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
    } catch {
        throw new Error("Enter a page address, for example https://www.example.gr/page");
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Only http:// and https:// pages can be tracked");
    if (!url.hostname.includes(".")) throw new Error("Enter a page address, for example https://www.example.gr/page");
    url.hash = "";
    return url.href;
}

// ---------- Google history ----------

const isoDate = (d) => (d ? `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}` : null);
const toNumber = (v) => (v === null || v === undefined || v === "" || Number.isNaN(Number(v)) ? null : Number(v));

/** { periods: [{ from, to }], values: { lcp: [p75|null], inp, cls } } from one history response. */
function parseHistory(body) {
    const record = body && body.record;
    if (!record) return null;
    const periods = (record.collectionPeriods || []).map(p => ({ from: isoDate(p.firstDate), to: isoDate(p.lastDate) }));
    const values = {};
    for (const id of TRACKED) {
        const raw = record.metrics && record.metrics[BY_ID[id].crux];
        const p75s = raw && raw.percentilesTimeseries && raw.percentilesTimeseries.p75s;
        values[id] = p75s ? p75s.map(toNumber) : periods.map(() => null);
    }
    return { periods, values };
}

function cruxError(r, apiKey) {
    const message = (r.body && r.body.error && r.body.error.message) || `HTTP ${r.status}`;
    const err = new Error(`Chrome UX Report API: ${apiKey ? message.split(apiKey).join("[key]") : message}`);
    err.status = r.status;
    return err;
}

async function historyFor(target, opts) {
    const devices = {};
    let periods = null;
    for (const [device, formFactor] of [["mobile", "PHONE"], ["desktop", "DESKTOP"]]) {
        const query = { ...target, formFactor, metrics: TRACKED.map(id => BY_ID[id].crux), collectionPeriodCount: opts.weeks || WEEKS };
        const r = await callCrux("history", query, opts);
        if (r.status === 404) { devices[device] = null; continue; }
        if (r.status !== 200) throw cruxError(r, opts.apiKey);
        const parsed = parseHistory(r.body);
        // A device whose weeks are all empty has no data, same as a 404.
        const hasData = parsed && TRACKED.some(id => parsed.values[id].some(v => v !== null));
        devices[device] = hasData ? parsed.values : null;
        if (hasData) periods = parsed.periods;
    }
    return periods ? { periods, ...devices } : null;
}

/**
 * Where a page ends up after redirects (the address Google records visits
 * under). Falls back to the address given when the site cannot be reached.
 */
async function resolveFinalUrl(url, { fetchUrl, timeoutMs = 10000, userAgent } = {}) {
    if (!fetchUrl) return url;
    const res = await fetchUrl(url, { method: "HEAD", timeoutMs, retries: 0, ...(userAgent ? { userAgent } : {}) });
    if (!res.finalUrl || !res.redirectChain || !res.redirectChain.length) return url;
    try {
        const final = new URL(res.finalUrl);
        final.hash = "";
        return final.href;
    } catch {
        return url;
    }
}

/**
 * The last 15 weeks for a page. When Google has too few visits to report the
 * page on its own, the whole site's figures are returned instead, marked
 * scope: "origin".
 * @returns {Promise<{ fetchedAt, scope: "page"|"origin"|null, periods, mobile, desktop }>}
 */
async function getWeeklyVitals(url, opts) {
    const fetchedAt = new Date().toISOString();
    const page = await historyFor({ url }, opts);
    if (page) return { fetchedAt, scope: "page", ...page };
    const origin = await historyFor({ origin: new URL(url).origin }, opts);
    if (origin) return { fetchedAt, scope: "origin", ...origin };
    return { fetchedAt, scope: null, periods: [], mobile: null, desktop: null };
}

module.exports = { readList, writeList, normalizePageUrl, resolveFinalUrl, getWeeklyVitals, parseHistory, WEEKS, TRACKED, MAX_PAGES };
