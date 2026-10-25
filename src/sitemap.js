"use strict";

const { XMLParser, XMLValidator } = require("fast-xml-parser");
const { fetchUrl } = require("./http");
const { mergeConfig } = require("./config");
const { normalizeUrl } = require("./url");

const parser = new XMLParser({
    ignoreAttributes: true,
    removeNSPrefix: true,       // <sm:urlset> → urlset
    trimValues: true,
    parseTagValue: false,       // keep <loc> as strings
    processEntities: true,      // &amp; → &
    isArray: (name) => name === "url" || name === "sitemap"
});

/**
 * Parse sitemap XML text.
 * @returns {{ type: "urlset"|"sitemapindex"|"unknown", locs: string[], error: string|null }}
 */
function parseSitemapXml(xml) {
    const text = (xml || "").replace(/^﻿/, "").trim();
    if (!text) return { type: "unknown", locs: [], error: "Empty sitemap document" };

    const valid = XMLValidator.validate(text);
    if (valid !== true) {
        return {
            type: "unknown",
            locs: [],
            error: `Invalid XML: ${valid.err.msg} (line ${valid.err.line})`
        };
    }

    let doc;
    try {
        doc = parser.parse(text);
    } catch (err) {
        return { type: "unknown", locs: [], error: `Invalid XML: ${err.message}` };
    }

    const readLocs = (entries) => (entries || [])
        .map(entry => (typeof entry?.loc === "string" ? entry.loc.trim() : ""))
        .filter(Boolean);

    if (doc.urlset) return { type: "urlset", locs: readLocs(doc.urlset.url), error: null };
    if (doc.sitemapindex) {
        return { type: "sitemapindex", locs: readLocs(doc.sitemapindex.sitemap), error: null };
    }
    return { type: "unknown", locs: [], error: "Root element is neither <urlset> nor <sitemapindex>" };
}

/**
 * Load a sitemap (or sitemap index) and all child sitemaps recursively.
 *
 * @returns {Promise<{
 *   pageUrls: string[], sitemaps: Array<{url, type, status, urlCount, error}>,
 *   errors: Array<{url, error}>
 * }>}
 */
async function loadSitemap(sitemapUrl, options = {}) {
    const cfg = mergeConfig(options);
    const pageUrls = new Set();
    const sitemaps = [];
    const errors = [];
    const visited = new Set();

    async function visit(url, depth) {
        const normalized = normalizeUrl(url);
        if (!normalized) {
            errors.push({ url, error: "Invalid sitemap URL" });
            return;
        }
        if (visited.has(normalized)) return;
        visited.add(normalized);

        if (depth > cfg.maxSitemapDepth) {
            errors.push({ url, error: `Sitemap nesting deeper than ${cfg.maxSitemapDepth}` });
            return;
        }

        const res = await fetchUrl(normalized, cfg);
        if (!res.ok) {
            sitemaps.push({ url: normalized, type: "unknown", status: res.status, urlCount: 0, error: res.error.message });
            errors.push({ url: normalized, error: res.error.message });
            return;
        }
        if (res.status !== 200) {
            const error = `HTTP ${res.status}`;
            sitemaps.push({ url: normalized, type: "unknown", status: res.status, urlCount: 0, error });
            errors.push({ url: normalized, error });
            return;
        }

        const parsed = parseSitemapXml(res.body);
        sitemaps.push({
            url: normalized,
            type: parsed.type,
            status: res.status,
            urlCount: parsed.locs.length,
            error: parsed.error
        });
        if (parsed.error) {
            errors.push({ url: normalized, error: parsed.error });
            return;
        }

        if (parsed.type === "sitemapindex") {
            // Children are fetched sequentially; sitemap counts are usually small.
            for (const child of parsed.locs) await visit(child, depth + 1);
            return;
        }

        for (const loc of parsed.locs) {
            const pageUrl = normalizeUrl(loc);
            if (pageUrl) pageUrls.add(pageUrl);
            else errors.push({ url: loc, error: `Invalid <loc> in ${normalized}` });
        }
    }

    await visit(sitemapUrl, 0);
    return { pageUrls: [...pageUrls], sitemaps, errors };
}

module.exports = { parseSitemapXml, loadSitemap };
