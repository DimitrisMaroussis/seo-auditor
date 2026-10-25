"use strict";

/*
 * PageSpeed Insights API v5: runs Lighthouse on Google's servers.
 * Docs: developers.google.com/speed/docs/insights/v5/get-started
 *
 * Written against real Lighthouse 13 responses (see test/fixtures/google).
 * Lighthouse 13 reports most advice as "insights" (ids ending in -insight)
 * plus a few classic diagnostics; each carries a score and `metricSavings`,
 * the estimated improvement per metric (ms, or unitless for CLS).
 */

const ENDPOINT = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";

const LAB_METRICS = {
    fcp: "first-contentful-paint",
    lcp: "largest-contentful-paint",
    tbt: "total-blocking-time",
    cls: "cumulative-layout-shift",
    si: "speed-index"
};

// Groups in the performance category that hold actionable advice.
const ADVICE_GROUPS = new Set(["insights", "diagnostics", "load-opportunities"]);
const SCORED_MODES = new Set(["metricSavings", "numeric", "binary"]);

// Metric each piece of advice affects, used when Lighthouse reports no
// positive metricSavings for it (it often reports 0 even when failing).
const DEFAULT_METRIC = {
    "cache-insight": "LCP",
    "cls-culprits-insight": "CLS",
    "document-latency-insight": "LCP",
    "dom-size-insight": "INP",
    "duplicated-javascript-insight": "LCP",
    "font-display-insight": "FCP",
    "forced-reflow-insight": "INP",
    "image-delivery-insight": "LCP",
    "inp-breakdown-insight": "INP",
    "lcp-breakdown-insight": "LCP",
    "lcp-discovery-insight": "LCP",
    "legacy-javascript-insight": "LCP",
    "network-dependency-tree-insight": "LCP",
    "render-blocking-insight": "LCP",
    "third-parties-insight": "TBT",
    "viewport-insight": "INP",
    "unminified-css": "LCP",
    "unminified-javascript": "LCP",
    "unused-css-rules": "LCP",
    "unused-javascript": "LCP",
    "total-byte-weight": "LCP",
    "bootup-time": "TBT",
    "mainthread-work-breakdown": "TBT",
    "long-tasks": "TBT",
    "non-composited-animations": "CLS",
    "unsized-images": "CLS"
};

// The LCP breakdown is shown separately; its rows are not "offenders".
const NO_ITEMS = new Set(["lcp-breakdown-insight"]);

const MAX_ITEMS = 5;

/** Turn Lighthouse's nested details (list → table → items) into flat rows. */
function flattenItems(details) {
    if (!details || !Array.isArray(details.items)) return [];
    if (details.type === "list") {
        return details.items.flatMap(entry => (entry && entry.type === "table" ? entry.items || [] : []));
    }
    return details.items;
}

function entityName(entity) {
    if (!entity) return null;
    return typeof entity === "string" ? entity : entity.text || entity.name || null;
}

/** Describe one row: what it is (label) and how much it costs. */
function summarizeItem(item) {
    const label = item.url
        || (item.source && item.source.url)
        || entityName(item.entity)
        || (item.node && (item.node.selector || item.node.snippet || item.node.nodeLabel))
        || item.groupLabel
        || item.label
        || null;
    if (!label) return null;

    const timeMs = item.wastedMs ?? item.duration ?? item.mainThreadTime ?? item.reflowTime ?? item.total ?? null;
    const bytes = item.wastedBytes ?? item.transferSize ?? item.totalBytes ?? null;
    const row = { label: String(label) };
    if (typeof timeMs === "number") row.timeMs = Math.round(timeMs);
    if (typeof bytes === "number") row.bytes = Math.round(bytes);
    if (item.node && item.node.snippet) row.snippet = item.node.snippet;
    return row;
}

/** Remove Markdown links "[text](url)" → "text". */
const plainText = (md) => (md || "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").trim();

/**
 * Extract the actionable findings: advice audits that fail (score < 0.9), or
 * informative ones that still estimate savings. Sorted by largest saving.
 */
function extractFindings(lh) {
    const audits = lh.audits || {};
    const refs = (lh.categories && lh.categories.performance && lh.categories.performance.auditRefs) || [];
    const findings = [];

    for (const ref of refs) {
        if (!ADVICE_GROUPS.has(ref.group)) continue;
        const audit = audits[ref.id];
        if (!audit || audit.scoreDisplayMode === "notApplicable" || audit.scoreDisplayMode === "error") continue;

        const savings = {};
        for (const [metric, value] of Object.entries(audit.metricSavings || {})) {
            if (typeof value === "number" && value > 0) savings[metric] = value;
        }
        const failing = SCORED_MODES.has(audit.scoreDisplayMode) && typeof audit.score === "number" && audit.score < 0.9;
        const informativeWithSavings = audit.scoreDisplayMode === "informative" && Object.keys(savings).length > 0;
        if (!failing && !informativeWithSavings) continue;

        const metrics = Object.keys(savings).length
            ? Object.keys(savings)
            : (DEFAULT_METRIC[ref.id] ? [DEFAULT_METRIC[ref.id]] : []);

        const items = NO_ITEMS.has(ref.id)
            ? []
            : flattenItems(audit.details).map(summarizeItem).filter(Boolean).slice(0, MAX_ITEMS);
        findings.push({
            id: ref.id,
            title: audit.title,
            description: plainText(audit.description),
            score: audit.score,
            displayValue: audit.displayValue || null,
            savings,
            metrics,
            items
        });
    }

    // Biggest estimated time saving first; CLS savings (unitless) rank by ×10,000 so 0.1 ≈ 1 s.
    const weight = (f) => Math.max(0, ...Object.entries(f.savings).map(([m, v]) => (m === "CLS" ? v * 10000 : v)));
    return findings.sort((a, b) => weight(b) - weight(a));
}

/** The LCP element and its time breakdown, from lcp-breakdown-insight. */
function extractLcp(lh) {
    const details = lh.audits && lh.audits["lcp-breakdown-insight"] && lh.audits["lcp-breakdown-insight"].details;
    if (!details || !Array.isArray(details.items)) return { element: null, breakdown: [] };
    const node = details.items.find(i => i && i.type === "node");
    const table = details.items.find(i => i && i.type === "table");
    return {
        element: node ? { snippet: node.snippet || null, selector: node.selector || null, label: node.nodeLabel || null } : null,
        breakdown: table ? table.items.map(i => ({ subpart: i.subpart, label: i.label, durationMs: Math.round(i.duration) })) : []
    };
}

function extractThirdParties(lh) {
    const audit = lh.audits && lh.audits["third-parties-insight"];
    return flattenItems(audit && audit.details)
        .map(i => ({
            name: entityName(i.entity) || i.url || "Unknown",
            mainThreadMs: Math.round(i.mainThreadTime || 0),
            transferBytes: Math.round(i.transferSize || 0)
        }))
        .sort((a, b) => b.mainThreadMs - a.mainThreadMs)
        .slice(0, 10);
}

/**
 * Lighthouse runs a real browser, so a WAF can still show it a challenge page.
 * Flag it when the run made very few requests and one of them is a known
 * challenge endpoint. A real page that merely includes the WAF's script makes
 * many requests and is not flagged.
 */
function detectChallenge(lh) {
    const requests = flattenItems(lh.audits && lh.audits["network-requests"] && lh.audits["network-requests"].details);
    const challengeRequest = requests.some(r => /_Incapsula_Resource|\/cdn-cgi\/challenge-platform\/|captcha-delivery\.com|px-captcha/i.test(r.url || ""));
    return challengeRequest && requests.length < 15;
}

/** Convert a runPagespeed response body into the dashboard's lab result. */
function parsePsi(body) {
    const lh = body && body.lighthouseResult;
    if (!lh) return null;

    const lab = {};
    for (const [id, auditId] of Object.entries(LAB_METRICS)) {
        const a = lh.audits && lh.audits[auditId];
        lab[id] = a && typeof a.numericValue === "number" ? a.numericValue : null;
    }

    const finalUrl = lh.finalDisplayedUrl || lh.finalUrl || lh.mainDocumentUrl || null;
    return {
        requestedUrl: lh.requestedUrl || null,
        finalUrl,
        redirected: Boolean(lh.requestedUrl && finalUrl && lh.requestedUrl !== finalUrl),
        lighthouseVersion: lh.lighthouseVersion || null,
        fetchTime: lh.fetchTime || null,
        performanceScore: lh.categories && lh.categories.performance ? lh.categories.performance.score : null,
        lab,
        lcp: extractLcp(lh),
        thirdParties: extractThirdParties(lh),
        findings: extractFindings(lh),
        warnings: lh.runWarnings || [],
        challengeSuspected: detectChallenge(lh)
    };
}

async function runPsi(url, strategy, { apiKey, fetchImpl = fetch, timeoutMs = 180000 }) {
    const query = new URLSearchParams({ url, strategy, category: "performance", key: apiKey });
    const res = await fetchImpl(`${ENDPOINT}?${query}`, { signal: AbortSignal.timeout(timeoutMs) });
    const body = await res.json().catch(() => null);
    if (res.status !== 200) {
        const msg = body && body.error ? body.error.message : `HTTP ${res.status}`;
        const err = new Error(`PageSpeed Insights (${strategy}): ${msg}`);
        err.status = res.status;
        throw err;
    }
    return parsePsi(body);
}

module.exports = { parsePsi, runPsi, extractFindings, flattenItems, detectChallenge };
