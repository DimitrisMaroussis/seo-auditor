"use strict";

const { mergeConfig } = require("./config");
const { fetchUrl } = require("./http");
const { loadSitemap } = require("./sitemap");
const { normalizeUrl, inScope } = require("./url");
const { mapWithConcurrency } = require("./pool");
const { auditPage } = require("./auditPage");
const { runSiteChecks } = require("./siteChecks");

/**
 * Find sitemap URLs for a site: "Sitemap:" lines in robots.txt, falling back
 * to /sitemap.xml.
 */
async function discoverSitemaps(rootUrl, cfg) {
    const robotsUrl = new URL("/robots.txt", rootUrl).href;
    const res = await fetchUrl(robotsUrl, cfg);
    const found = [];
    if (res.ok && res.status === 200) {
        for (const line of res.body.split(/\r?\n/)) {
            const match = /^\s*sitemap\s*:\s*(\S+)/i.exec(line);
            if (match) {
                const url = normalizeUrl(match[1], robotsUrl);
                if (url && !found.includes(url)) found.push(url);
            }
        }
    }
    if (!found.length) found.push(new URL("/sitemap.xml", rootUrl).href);
    return found;
}

/**
 * Hosts the site itself redirects to (e.g. after a rebrand, old-brand.gr →
 * new-brand.gr). Both the home page and robots.txt are checked because a WAF
 * challenge can hide the home-page redirect.
 */
async function discoverRedirectHosts(rootUrl, cfg) {
    const rootHost = new URL(rootUrl).hostname;
    const hosts = new Set();
    for (const url of [rootUrl, new URL("/robots.txt", rootUrl).href]) {
        const res = await fetchUrl(url, { ...cfg, method: "HEAD" });
        if (res.finalUrl) {
            const host = new URL(res.finalUrl).hostname;
            if (host !== rootHost) hosts.add(host);
        }
    }
    return [...hosts];
}

function abortError() {
    const err = new Error("Audit cancelled");
    err.code = "EABORTED";
    return err;
}

function throwIfAborted(signal) {
    if (signal?.aborted) throw abortError();
}

const emit = (fn, ...args) => {
    if (typeof fn === "function") fn(...args);
};

/** Assemble the report object shared by site and single-page audits. */
function buildReport({ mode, rootUrl, cfg, scopeHosts, autoScopeHosts, sitemap, pages, site }) {
    const count = (sev) => pages.reduce((n, p) => n + p.issues.filter(i => i.severity === sev).length, 0);
    return {
        generatedAt: new Date().toISOString(),
        mode,
        rootUrl,
        config: {
            subdomainPolicy: cfg.subdomainPolicy, scopeHosts, autoScopeHosts, concurrency: cfg.concurrency,
            timeoutMs: cfg.timeoutMs, maxRedirects: cfg.maxRedirects, retries: cfg.retries
        },
        sitemap,
        summary: {
            pagesAudited: pages.length,
            fetchFailures: pages.filter(p => p.fetchError).length,
            blockedByBotProtection: pages.filter(p => p.blocked).length,
            errors: count("error"),
            warnings: count("warning"),
            info: count("info"),
            duplicateTitleGroups: site.duplicateTitles.length,
            duplicateDescriptionGroups: site.duplicateDescriptions.length,
            brokenInternalLinks: site.brokenInternalLinks.length,
            brokenExternalLinks: site.brokenExternalLinks.length,
            brokenImages: site.brokenImages.length,
            canonicalIssues: site.canonicalIssues.length,
            indexabilityConflicts: site.indexabilityConflicts.length
        },
        site,
        pages
    };
}

/**
 * Audit a site from a root URL or a sitemap URL.
 *
 * @param {string} input   e.g. "https://www.example.gr/" or ".../sitemap.xml"
 * @param {object} options config overrides plus
 *   { rootUrl?, sitemapUrls?: string[], signal?: AbortSignal,
 *     onPhase?(phase, info), onProgress?(done, total, page) }
 *   Phases: "sitemap", "pages" ({ total }), "siteChecks".
 */
async function runAudit(input, options = {}) {
    const cfg = mergeConfig(options);
    const { signal } = options;
    const inputUrl = normalizeUrl(input);
    if (!inputUrl) throw new Error(`Invalid URL: ${input}`);

    const looksLikeSitemap = /\.xml(\.gz)?$/i.test(new URL(inputUrl).pathname);
    const rootUrl = options.rootUrl || new URL("/", inputUrl).href;
    const rootHost = new URL(rootUrl).hostname;

    emit(options.onPhase, "sitemap");
    const sitemapSources = options.sitemapUrls
        || (looksLikeSitemap ? [inputUrl] : await discoverSitemaps(rootUrl, cfg));

    const pageUrls = new Set();
    const sitemaps = [];
    const sitemapErrors = [];
    for (const source of sitemapSources) {
        throwIfAborted(signal);
        const loaded = await loadSitemap(source, cfg);
        loaded.pageUrls.forEach(u => pageUrls.add(u));
        sitemaps.push(...loaded.sitemaps);
        sitemapErrors.push(...loaded.errors);
    }

    const autoScopeHosts = cfg.followRootRedirect === false ? [] : await discoverRedirectHosts(rootUrl, cfg);
    const scopeHosts = [...new Set([...cfg.scopeHosts, ...autoScopeHosts])];

    // Only URLs inside the crawl scope are audited.
    const scoped = [];
    const outOfScope = [];
    for (const url of pageUrls) {
        if (inScope(new URL(url).hostname, rootHost, cfg.subdomainPolicy, scopeHosts)) scoped.push(url);
        else outOfScope.push(url);
    }
    const toAudit = scoped.slice(0, cfg.maxUrls);

    // Sitemap-less fallback: audit the root page itself.
    if (toAudit.length === 0 && !looksLikeSitemap && !options.sitemapUrls) toAudit.push(rootUrl);

    throwIfAborted(signal);
    emit(options.onPhase, "pages", { total: toAudit.length });

    const ctx = { ...cfg, rootUrl, scopeHosts, sitemapUrls: pageUrls, signal };
    let done = 0;
    const pages = await mapWithConcurrency(toAudit, cfg.concurrency, async (url) => {
        const page = await auditPage(url, ctx);
        done++;
        emit(options.onProgress, done, toAudit.length, page);
        return page;
    }, { signal });
    throwIfAborted(signal);

    emit(options.onPhase, "siteChecks");
    const site = await runSiteChecks(pages, ctx);
    throwIfAborted(signal);

    return buildReport({
        mode: "site",
        rootUrl, cfg, scopeHosts, autoScopeHosts, pages, site,
        sitemap: {
            sources: sitemapSources,
            sitemaps,
            errors: sitemapErrors,
            urlCount: pageUrls.size,
            outOfScope,
            skippedByLimit: Math.max(0, scoped.length - toAudit.length)
        }
    });
}

/**
 * Audit one URL (no sitemap). Site checks run on that page alone, so they
 * cover its canonical target and its internal links; duplicate checks need
 * more than one page and will be empty.
 */
async function runPageAudit(input, options = {}) {
    const cfg = mergeConfig(options);
    const { signal } = options;
    const url = normalizeUrl(input);
    if (!url) throw new Error(`Invalid URL: ${input}`);
    const rootUrl = options.rootUrl || new URL("/", url).href;

    emit(options.onPhase, "pages", { total: 1 });
    const ctx = { ...cfg, rootUrl, signal };
    const page = await auditPage(url, ctx);
    emit(options.onProgress, 1, 1, page);
    throwIfAborted(signal);

    // Follow a cross-host redirect so links on the final page classify correctly.
    const autoScopeHosts = [];
    if (cfg.followRootRedirect !== false && page.finalUrl) {
        const finalHost = new URL(page.finalUrl).hostname;
        if (finalHost !== new URL(rootUrl).hostname) autoScopeHosts.push(finalHost);
    }
    const scopeHosts = [...new Set([...cfg.scopeHosts, ...autoScopeHosts])];
    if (autoScopeHosts.length) {
        const rootHost = new URL(rootUrl).hostname;
        const nowInternal = page.links.external.filter(link =>
            inScope(new URL(link).hostname, rootHost, cfg.subdomainPolicy, scopeHosts));
        page.links.internal = [...new Set([...page.links.internal, ...nowInternal])];
        page.links.external = page.links.external.filter(link => !nowInternal.includes(link));
    }
    const pages = [page];

    emit(options.onPhase, "siteChecks");
    const site = await runSiteChecks(pages, { ...ctx, scopeHosts });
    throwIfAborted(signal);

    return buildReport({
        mode: "page",
        rootUrl, cfg, scopeHosts, autoScopeHosts, pages, site,
        sitemap: { sources: [], sitemaps: [], errors: [], urlCount: 0, outOfScope: [], skippedByLimit: 0 }
    });
}

module.exports = { runAudit, runPageAudit, discoverSitemaps, discoverRedirectHosts };
