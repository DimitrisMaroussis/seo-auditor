"use strict";

const { fetchUrl } = require("./http");
const { mergeConfig } = require("./config");
const { normalizeUrl } = require("./url");
const { extractSeo, parseXRobotsTag } = require("./html");
const { validateStructuredData } = require("./schema/validate");
const { detectBotChallenge } = require("./botProtection");
const { checkOtherLinks } = require("./linkChecks");

// Character-count guidance only. Google truncates titles/descriptions by
// pixel width, so these are heuristics and reported as "info", not errors.
const TITLE_MAX_CHARS = 60;
const DESCRIPTION_MAX_CHARS = 160;

const isHtml = (contentType) => /\b(text\/html|application\/xhtml\+xml)\b/i.test(contentType || "");

/**
 * Work out whether a page can be indexed from the signals on the page itself.
 * Directives for "robots" apply to all crawlers; "googlebot" to Google only.
 */
function evaluateIndexability(page) {
    const reasons = [];

    if (page.status !== 200) reasons.push(`HTTP status ${page.status}`);
    if (page.redirectChain.length) reasons.push("URL redirects");

    const metaDirectives = page.metaRobots.flatMap(m => m.directives);
    const headerDirectives = [...page.xRobotsTag.all, ...(page.xRobotsTag.byAgent.googlebot || [])];

    const noindexMeta = metaDirectives.includes("noindex") || metaDirectives.includes("none");
    const noindexHeader = headerDirectives.includes("noindex") || headerDirectives.includes("none");
    if (noindexMeta) reasons.push("meta robots noindex");
    if (noindexHeader) reasons.push("X-Robots-Tag noindex");

    let canonicalStatus = "missing";
    if (page.canonical.url) {
        canonicalStatus = normalizeUrl(page.canonical.url) === normalizeUrl(page.finalUrl)
            ? "self"
            : "other";
    }
    if (canonicalStatus === "other") reasons.push(`canonicalised to ${page.canonical.url}`);

    return {
        indexable: reasons.length === 0,
        noindex: noindexMeta || noindexHeader,
        noindexSources: { meta: noindexMeta, header: noindexHeader },
        canonicalStatus,
        reasons
    };
}

function emptyPage(url) {
    return {
        requestedUrl: url,
        finalUrl: null,
        status: null,
        redirectChain: [],
        responseTimeMs: null,
        contentType: null,
        xRobotsTag: { raw: null, all: [], byAgent: {} },
        fetchError: null,
        blocked: null,
        title: { text: null, length: 0, count: 0 },
        metaDescription: { text: null, length: 0, count: 0 },
        canonical: { url: null, count: 0, all: [] },
        metaRobots: [],
        h1: { count: 0, texts: [] },
        images: { count: 0, missingAlt: [], emptyAlt: 0, all: [], urls: [] },
        links: { internal: [], external: [], other: [], invalid: [], nofollow: [] },
        otherLinks: { invalidEmail: [], invalidPhone: [], javascript: [], malformed: [], emailDomains: [] },
        structuredData: null,
        inSitemap: null,
        indexability: null,
        analyzed: false,
        issues: []
    };
}

/**
 * Fetch one URL and extract its SEO data. Never throws.
 *
 * @param {string} url
 * @param {object} ctx  { rootUrl, sitemapUrls?: Set<string>, ...config overrides }
 */
async function auditPage(url, ctx = {}) {
    const cfg = mergeConfig(ctx);
    const rootUrl = ctx.rootUrl || url;
    const page = emptyPage(url);
    const issue = (severity, code, message, extra = {}) =>
        page.issues.push({ severity, code, message, ...extra });

    if (ctx.sitemapUrls) {
        const key = normalizeUrl(url);
        page.inSitemap = ctx.sitemapUrls.has(key);
    }

    const res = await fetchUrl(url, cfg);
    page.finalUrl = res.finalUrl;
    page.status = res.status;
    page.redirectChain = res.redirectChain;
    page.responseTimeMs = res.responseTimeMs;

    if (!res.ok) {
        page.fetchError = res.error;
        issue("error", "FETCH_FAILED", `${res.error.code}: ${res.error.message}`);
        return page;
    }

    page.contentType = res.contentType;
    const xRobotsRaw = res.headers["x-robots-tag"] || null;
    page.xRobotsTag = { raw: xRobotsRaw, ...parseXRobotsTag(xRobotsRaw) };

    if (res.redirectChain.length) {
        issue("warning", "REDIRECT", `Redirects (${res.redirectChain.length} hop(s)) to ${res.finalUrl}`);
    }
    if (res.status !== 200) {
        issue(res.status >= 400 ? "error" : "warning", "HTTP_STATUS", `Final status ${res.status}`);
    }
    if (!isHtml(res.contentType)) {
        issue("warning", "NOT_HTML", `Content-Type is ${res.contentType || "missing"}; HTML checks skipped`);
        page.indexability = evaluateIndexability(page);
        return page;
    }
    const challenge = detectBotChallenge(res.body);
    if (challenge) {
        // The real document was never seen: report the block, not SEO issues.
        page.blocked = challenge;
        issue("error", "BLOCKED_BY_BOT_PROTECTION",
            `${challenge.vendor} served a challenge page instead of the document; on-page SEO was not audited. ` +
            "Allowlist the auditor's IP or User-Agent (--user-agent) in the WAF and re-run.");
        return page;
    }
    if (res.status >= 400) {
        // Error pages are not analysed for on-page SEO.
        page.indexability = evaluateIndexability(page);
        return page;
    }

    const seo = extractSeo(res.body, res.finalUrl, {
        rootUrl, subdomainPolicy: cfg.subdomainPolicy, extraHosts: cfg.scopeHosts
    });
    Object.assign(page, {
        title: seo.title,
        metaDescription: seo.metaDescription,
        canonical: seo.canonical,
        metaRobots: seo.metaRobots,
        h1: seo.h1,
        images: seo.images,
        links: seo.links,
        structuredData: validateStructuredData(seo.jsonLdBlocks),
        analyzed: true
    });

    // ---------- page-level issues ----------
    if (page.title.text === null) issue("error", "TITLE_MISSING", "No <title> in <head>");
    else if (page.title.text === "") issue("error", "TITLE_EMPTY", "<title> is empty");
    else if (page.title.length > TITLE_MAX_CHARS) {
        issue("info", "TITLE_LONG", `Title is ${page.title.length} characters (guide: ≤${TITLE_MAX_CHARS}; Google truncates by pixel width)`);
    }
    if (page.title.count > 1) issue("warning", "TITLE_MULTIPLE", `${page.title.count} <title> elements`);

    if (page.metaDescription.text === null) issue("warning", "DESCRIPTION_MISSING", "No meta description");
    else if (page.metaDescription.text === "") issue("warning", "DESCRIPTION_EMPTY", "Meta description is empty");
    else if (page.metaDescription.length > DESCRIPTION_MAX_CHARS) {
        issue("info", "DESCRIPTION_LONG", `Meta description is ${page.metaDescription.length} characters (guide: ≤${DESCRIPTION_MAX_CHARS})`);
    }
    if (page.metaDescription.count > 1) {
        issue("warning", "DESCRIPTION_MULTIPLE", `${page.metaDescription.count} meta descriptions`);
    }

    if (page.canonical.count === 0) issue("warning", "CANONICAL_MISSING", "No rel=canonical");
    if (page.canonical.count > 1) {
        const distinct = new Set(page.canonical.all.map(c => c.resolved));
        if (distinct.size > 1) issue("error", "CANONICAL_CONFLICT", `${distinct.size} different canonical URLs; Google may ignore all of them`);
        else issue("info", "CANONICAL_DUPLICATE", `${page.canonical.count} identical canonical tags`);
    }
    for (const c of page.canonical.all) {
        if (!c.resolved) issue("error", "CANONICAL_INVALID", `Invalid canonical href "${c.href}"`);
        else if (!/^https?:/i.test(c.resolved)) issue("error", "CANONICAL_INVALID", `Canonical is not http(s): ${c.resolved}`);
        if (!c.inHead) issue("warning", "CANONICAL_NOT_IN_HEAD", "rel=canonical outside <head> is ignored by Google");
    }

    if (page.h1.count === 0) issue("warning", "H1_MISSING", "No <h1>");
    else if (page.h1.count > 1) issue("info", "H1_MULTIPLE", `${page.h1.count} <h1> elements`);
    if (page.h1.texts.some(t => t === "")) issue("warning", "H1_EMPTY", "Empty <h1>");

    if (page.images.missingAlt.length) {
        issue("warning", "IMG_ALT_MISSING", `${page.images.missingAlt.length} image(s) without an alt attribute`);
    }

    // Links that are not web pages: email, phone, javascript: and unreadable hrefs.
    page.otherLinks = checkOtherLinks(page.links.other, page.links.invalid);
    const list = (items) => items.slice(0, 3).map(i => `${i.href || "(empty)"} (${i.reason})`).join("; ") + (items.length > 3 ? "; …" : "");
    const { invalidEmail, invalidPhone, javascript, malformed } = page.otherLinks;
    if (invalidEmail.length) issue("warning", "MAILTO_INVALID", `${invalidEmail.length} email link(s) with an invalid address: ${list(invalidEmail)}`);
    if (invalidPhone.length) issue("warning", "TEL_INVALID", `${invalidPhone.length} phone link(s) with an invalid number: ${list(invalidPhone)}`);
    if (malformed.length) issue("warning", "LINK_INVALID", `${malformed.length} link(s) with an empty or unreadable href: ${list(malformed)}`);
    if (javascript.length) issue("info", "LINK_JAVASCRIPT", `${javascript.length} link(s) run JavaScript instead of pointing to a page, so search engines cannot follow them`);

    const sd = page.structuredData;
    if (sd.jsonSyntax.invalid) issue("error", "JSONLD_INVALID_JSON", `${sd.jsonSyntax.invalid} JSON-LD block(s) are not valid JSON`);
    if (sd.schemaOrg.errors.length) issue("error", "JSONLD_SCHEMA_ERRORS", `${sd.schemaOrg.errors.length} Schema.org structure error(s)`);
    const missingRequired = sd.google.features.filter(f => f.verdict === "missingRequiredProperties");
    if (missingRequired.length) {
        issue("warning", "JSONLD_GOOGLE_REQUIRED_MISSING",
            `${missingRequired.length} entity(ies) lack properties Google requires: ${[...new Set(missingRequired.map(f => f.type))].join(", ")}`);
    }

    page.indexability = evaluateIndexability(page);

    const metaNoindex = page.indexability.noindexSources.meta;
    const headerNoindex = page.indexability.noindexSources.header;
    const metaSaysIndex = page.metaRobots.some(m => m.directives.includes("index"));
    if (headerNoindex && metaSaysIndex && !metaNoindex) {
        issue("warning", "ROBOTS_CONFLICT", "X-Robots-Tag says noindex but meta robots says index; noindex wins");
    }

    return page;
}

module.exports = { auditPage, evaluateIndexability, isHtml };
