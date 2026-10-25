"use strict";

/*
 * Core Web Vitals definitions and Google's thresholds (web.dev/articles/vitals).
 * Ratings are applied to the 75th percentile, as Google does.
 *   value <= good  → "good"
 *   value <= poor  → "needs-improvement"
 *   value >  poor  → "poor"
 */
const METRICS = [
    { id: "lcp", name: "LCP", crux: "largest_contentful_paint", unit: "ms", good: 2500, poor: 4000, core: true },
    { id: "inp", name: "INP", crux: "interaction_to_next_paint", unit: "ms", good: 200, poor: 500, core: true },
    { id: "cls", name: "CLS", crux: "cumulative_layout_shift", unit: "score", good: 0.1, poor: 0.25, core: true },
    { id: "fcp", name: "FCP", crux: "first_contentful_paint", unit: "ms", good: 1800, poor: 3000, core: false },
    { id: "ttfb", name: "TTFB", crux: "experimental_time_to_first_byte", unit: "ms", good: 800, poor: 1800, core: false }
];

const BY_ID = Object.fromEntries(METRICS.map(m => [m.id, m]));

function rate(metricId, value) {
    const m = BY_ID[metricId];
    if (!m || value === null || value === undefined || Number.isNaN(value)) return null;
    if (value <= m.good) return "good";
    if (value <= m.poor) return "needs-improvement";
    return "poor";
}

module.exports = { METRICS, BY_ID, rate };
