"use strict";

/*
 * Chrome UX Report (CrUX) API: real-user field data from Chrome visitors.
 * Docs: developer.chrome.com/docs/crux/api
 *   queryRecord         → the latest 28-day window
 *   queryHistoryRecord  → weekly 28-day windows (about 25 of them)
 * A 404 means Google has too little traffic data for that URL or origin.
 */

const { METRICS, rate } = require("./metrics");

const ENDPOINT = "https://chromeuxreport.googleapis.com/v1/records";

// LCP sub-parts reported for pages whose LCP element is an image.
const LCP_SUBPARTS = [
    { id: "ttfb", crux: "largest_contentful_paint_image_time_to_first_byte" },
    { id: "loadDelay", crux: "largest_contentful_paint_image_resource_load_delay" },
    { id: "loadDuration", crux: "largest_contentful_paint_image_resource_load_duration" },
    { id: "renderDelay", crux: "largest_contentful_paint_image_element_render_delay" }
];

const toNumber = (v) => (v === null || v === undefined || v === "" ? null : Number(v));
const isoDate = (d) => (d ? `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}` : null);

/** Convert a queryRecord response body into { metrics, lcpSubparts, ... } or null when absent. */
function parseCruxRecord(body) {
    const record = body && body.record;
    if (!record || !record.metrics) return null;

    const metrics = {};
    for (const m of METRICS) {
        const raw = record.metrics[m.crux];
        if (!raw) continue;
        const p75 = toNumber(raw.percentiles && raw.percentiles.p75);
        const hist = raw.histogram || [];
        metrics[m.id] = {
            p75,
            rating: rate(m.id, p75),
            // Share of visits rated good / needs improvement / poor (bins follow the thresholds).
            distribution: {
                good: hist[0] ? hist[0].density : null,
                needsImprovement: hist[1] ? hist[1].density : null,
                poor: hist[2] ? hist[2].density : null
            }
        };
    }

    const lcpSubparts = {};
    for (const part of LCP_SUBPARTS) {
        const raw = record.metrics[part.crux];
        if (raw && raw.percentiles) lcpSubparts[part.id] = toNumber(raw.percentiles.p75);
    }

    const resourceType = record.metrics.largest_contentful_paint_resource_type;
    return {
        key: record.key,
        period: record.collectionPeriod
            ? { from: isoDate(record.collectionPeriod.firstDate), to: isoDate(record.collectionPeriod.lastDate) }
            : null,
        metrics,
        lcpSubparts: Object.keys(lcpSubparts).length ? lcpSubparts : null,
        lcpResourceType: resourceType ? resourceType.fractions : null,
        navigationTypes: record.metrics.navigation_types ? record.metrics.navigation_types.fractions : null
    };
}

/** Convert a queryHistoryRecord body into { periods: [endDate], metrics: { lcp: [p75|null] } } or null. */
function parseCruxHistory(body) {
    const record = body && body.record;
    if (!record || !record.metrics) return null;
    const periods = (record.collectionPeriods || []).map(p => isoDate(p.lastDate));
    const metrics = {};
    for (const m of METRICS) {
        const raw = record.metrics[m.crux];
        const p75s = raw && raw.percentilesTimeseries && raw.percentilesTimeseries.p75s;
        if (!p75s) continue;
        metrics[m.id] = p75s.map(v => {
            const n = toNumber(v);
            return n === null || Number.isNaN(n) ? null : n;
        });
    }
    return { periods, metrics };
}

/**
 * Call the CrUX API. Returns { status, body }. Never throws for HTTP errors;
 * network failures reject. `fetchImpl` is injectable for tests.
 */
async function callCrux(kind, query, { apiKey, fetchImpl = fetch, timeoutMs = 30000 }) {
    const endpoint = kind === "history" ? "queryHistoryRecord" : "queryRecord";
    const res = await fetchImpl(`${ENDPOINT}:${endpoint}?key=${encodeURIComponent(apiKey)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(query),
        signal: AbortSignal.timeout(timeoutMs)
    });
    const body = await res.json().catch(() => null);
    return { status: res.status, body };
}

/**
 * Field data for one target ({ url } or { origin }) on phone and desktop,
 * current window plus history.
 */
async function getFieldData(target, opts) {
    const result = {};
    for (const formFactor of ["PHONE", "DESKTOP"]) {
        const query = { ...target, formFactor };
        const [current, history] = await Promise.all([
            callCrux("record", query, opts),
            callCrux("history", query, opts)
        ]);
        for (const r of [current, history]) {
            if (r.status !== 200 && r.status !== 404) {
                const msg = r.body && r.body.error ? r.body.error.message : `HTTP ${r.status}`;
                const err = new Error(`Chrome UX Report API: ${msg}`);
                err.status = r.status;
                throw err;
            }
        }
        result[formFactor === "PHONE" ? "mobile" : "desktop"] = {
            current: current.status === 200 ? parseCruxRecord(current.body) : null,
            history: history.status === 200 ? parseCruxHistory(history.body) : null
        };
    }
    return result;
}

module.exports = { parseCruxRecord, parseCruxHistory, callCrux, getFieldData, LCP_SUBPARTS };
