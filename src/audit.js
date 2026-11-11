"use strict";

const { mergeConfig } = require("./config");
const { fetchUrl } = require("./http");
const { loadSitemap } = require("./sitemap");
const { normalizeUrl, inScope } = require("./url");
const { mapWithConcurrency } = require("./pool");
const { auditPage } = require("./auditPage");
const { runSiteChecks } = require("./siteChecks");
const { parseRobots, isAllowed } = require("./robots");

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
            timeoutMs: cfg.timeoutMs, maxRedirects: cfg.maxRedirects, retries: cfg.retries,
            crawl: Boolean(cfg.crawl), userAgent: cfg.userAgent,
            // The header's name only: its value is a secret.
            siteHeader: cfg.siteHeaders?.headers ? Object.keys(cfg.siteHeaders.headers)[0] : null
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

/** Click depth from the home page at which a page counts as hard to reach. */
const DEEP_PAGE_DEPTH = 4;
/** Crawl stop when no page limit is set, so a site with endless URLs (calendars, filters) still finishes. */
const MAX_CRAWL_PAGES = 5000;

/**
 * robots.txt rules per host, fetched once each. A missing or unreadable
 * robots.txt allows everything, as it does for search engines.
 */
function robotsChecker(cfg) {
    const cache = new Map();
    const rulesFor = (origin) => {
        if (!cache.has(origin)) {
            cache.set(origin, fetchUrl(`${origin}/robots.txt`, cfg).then(res =>
                res.ok && res.status === 200 ? parseRobots(res.body, cfg.userAgent) : null));
        }
        return cache.get(origin);
    };
    return async (url) => isAllowed(await rulesFor(new URL(url).origin), url);
}

/**
 * Breadth-first crawl from the root page along internal links, auditing every
 * page it reaches, as a search engine discovers a site. Links robots.txt
 * disallows are noted, not followed. Only HTML pages are kept (one per final
 * URL); error pages, redirects to a page already kept and files are left to
 * the link checks.
 * @returns {{ kept, results, complete, robotsBlocked }}
 *   results: every URL audited (kept or not); complete: false when the page
 *   limit stopped the crawl, so pages it never reached may still be linked.
 */
async function crawlSite(rootUrl, ctx, { limit, allowed, onPage, signal }) {
    const results = new Map();
    const depthOf = new Map([[rootUrl, 0]]);
    const kept = [];
    const keptFinals = new Set();
    const robotsBlocked = new Map();   // URL → Set of pages linking to it
    const queue = [rootUrl];

    while (queue.length && kept.length < limit) {
        throwIfAborted(signal);
        const batch = queue.splice(0, Math.min(limit - kept.length, ctx.concurrency * 4));
        const audited = await mapWithConcurrency(batch, ctx.concurrency, url => auditPage(url, ctx), { signal });
        throwIfAborted(signal);

        for (const [i, url] of batch.entries()) {
            const page = audited[i];
            results.set(url, page);
            const final = normalizeUrl(page.finalUrl || "") || url;
            if (keptFinals.has(final) || !(page.analyzed || page.blocked || url === rootUrl)) continue;
            keptFinals.add(final);
            page.crawlDepth = depthOf.get(url);
            kept.push(page);
            onPage(page);
            if (!page.analyzed) continue;

            for (const link of page.links.internal) {
                if (robotsBlocked.has(link)) robotsBlocked.get(link).add(final);
                if (depthOf.has(link)) continue;
                depthOf.set(link, page.crawlDepth + 1);
                if (await allowed(link)) queue.push(link);
                else robotsBlocked.set(link, new Set([final]));
            }
        }
    }
    return { kept, results, complete: queue.length === 0, robotsBlocked, depthOf };
}

/** For every audited page, how many other audited pages link to it (by final URL). */
function countInlinks(pages, known) {
    const finalOf = new Map();
    for (const page of [...known, ...pages]) {
        const final = normalizeUrl(page.finalUrl || "");
        if (!final) continue;
        finalOf.set(normalizeUrl(page.requestedUrl), final);
        finalOf.set(final, final);
    }
    const inlinks = new Map();
    for (const page of pages) {
        if (!page.analyzed) continue;
        const source = finalOf.get(normalizeUrl(page.requestedUrl));
        for (const link of page.links.internal) {
            const target = finalOf.get(link) || link;
            if (target === source) continue;
            if (!inlinks.has(target)) inlinks.set(target, new Set());
            inlinks.get(target).add(source);
        }
    }
    for (const page of pages) {
        const key = finalOf.get(normalizeUrl(page.requestedUrl)) || normalizeUrl(page.requestedUrl);
        page.inlinks = inlinks.get(key)?.size ?? 0;
    }
}

/**
 * Audit a site from a root URL or a sitemap URL.
 *
 * @param {string} input   e.g. "https://www.example.gr/" or ".../sitemap.xml"
 * @param {object} options config overrides plus
 *   { rootUrl?, sitemapUrls?: string[], signal?: AbortSignal,
 *     onPhase?(phase, info), onProgress?(done, total, page) }
 *   Phases: "sitemap", "crawl" (with options.crawl), "pages" ({ total }), "siteChecks".
 */
async function runAudit(input, options = {}) {
    let cfg = mergeConfig(options);
    const { signal } = options;
    const inputUrl = normalizeUrl(input);
    if (!inputUrl) throw new Error(`Invalid URL: ${input}`);

    const looksLikeSitemap = /\.xml(\.gz)?$/i.test(new URL(inputUrl).pathname);
    const rootUrl = options.rootUrl || new URL("/", inputUrl).href;
    const rootHost = new URL(rootUrl).hostname;
    let scopeHosts = cfg.scopeHosts;
    const isSiteHost = (host) => inScope(host, rootHost, cfg.subdomainPolicy, scopeHosts);
    if (cfg.siteHeaders?.headers) cfg = { ...cfg, siteHeaders: { headers: cfg.siteHeaders.headers, isSiteHost } };

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
    scopeHosts = [...new Set([...cfg.scopeHosts, ...autoScopeHosts])];

    // Only URLs inside the crawl scope are audited.
    const scoped = [];
    const outOfScope = [];
    for (const url of pageUrls) {
        if (isSiteHost(new URL(url).hostname)) scoped.push(url);
        else outOfScope.push(url);
    }

    const ctx = { ...cfg, rootUrl, scopeHosts, sitemapUrls: pageUrls, signal };
    const allowed = robotsChecker(cfg);
    const pages = [];
    let crawl = null;

    if (cfg.crawl) {
        throwIfAborted(signal);
        emit(options.onPhase, "crawl", { total: Number.isFinite(cfg.maxUrls) ? cfg.maxUrls : 0 });
        crawl = await crawlSite(rootUrl, ctx, {
            limit: Math.min(cfg.maxUrls, MAX_CRAWL_PAGES), allowed, signal,
            onPage: (page) => emit(options.onProgress, pages.push(page), Number.isFinite(cfg.maxUrls) ? cfg.maxUrls : 0, page)
        });
    }

    // Sitemap pages: those the crawl already audited are reused; every sitemap
    // URL is a page of its own, even when it redirects to one the crawl kept.
    const listed = new Set(pages);
    const toAudit = [];
    for (const url of scoped) {
        if (pages.length + toAudit.length >= cfg.maxUrls) break;
        const seen = crawl?.results.get(url);
        if (seen) {
            if (!listed.has(seen)) {
                seen.crawlDepth = crawl.depthOf.get(url);
                pages.push(seen);
                listed.add(seen);
            }
        } else toAudit.push(url);
    }
    const skippedByLimit = scoped.filter(u => !crawl?.results.has(u)).length - toAudit.length;

    // Sitemap-less fallback: audit the root page itself.
    if (pages.length + toAudit.length === 0 && !looksLikeSitemap && !options.sitemapUrls) toAudit.push(rootUrl);

    throwIfAborted(signal);
    emit(options.onPhase, "pages", { total: toAudit.length });
    let done = 0;
    const audited = await mapWithConcurrency(toAudit, cfg.concurrency, async (url) => {
        const page = await auditPage(url, ctx);
        done++;
        emit(options.onProgress, done, toAudit.length, page);
        return page;
    }, { signal });
    throwIfAborted(signal);
    pages.push(...audited);

    // ---------- discovery: robots.txt, crawl reach, sitemap coverage ----------
    const known = crawl ? [...crawl.results.values()] : [];
    for (const page of pages) {
        if (page.inSitemap && !(await allowed(page.requestedUrl))) {
            page.issues.push({ severity: "warning", code: "SITEMAP_ROBOTS_BLOCKED",
                message: "Listed in the sitemap but robots.txt disallows it, so search engines are told both to crawl it and not to" });
        }
    }
    if (crawl) {
        countInlinks(pages, known);
        const reachedFinals = new Set(crawl.kept.map(p => normalizeUrl(p.finalUrl || p.requestedUrl)));
        for (const page of audited) {
            // A sitemap URL that redirects to a page the crawl reached is reachable too.
            if (page.crawlDepth === undefined && reachedFinals.has(normalizeUrl(page.finalUrl || ""))) {
                page.crawlDepth = crawl.kept.find(p => normalizeUrl(p.finalUrl || "") === normalizeUrl(page.finalUrl)).crawlDepth;
            }
            if (page.crawlDepth === undefined) page.crawlDepth = null;
        }
        for (const page of pages) {
            if (page.inSitemap && page.crawlDepth === null && crawl.complete && !page.blocked) {
                page.issues.push({ severity: "warning", code: "ORPHAN_PAGE",
                    message: `In the sitemap but no page reachable from the home page links to it${page.inlinks ? ` (only ${page.inlinks} other unreachable page(s) do)` : ""}` });
            }
            if (page.inSitemap === false && pageUrls.size > 0 && page.status === 200 && page.indexability?.indexable) {
                page.issues.push({ severity: "info", code: "NOT_IN_SITEMAP",
                    message: "Found by following links but not listed in the sitemap" });
            }
            if (page.crawlDepth >= DEEP_PAGE_DEPTH) {
                page.issues.push({ severity: "info", code: "DEEP_PAGE",
                    message: `${page.crawlDepth} clicks from the home page (guide: 3 or fewer)` });
            }
        }
    }

    emit(options.onPhase, "siteChecks");
    const site = await runSiteChecks(pages, { ...ctx, scopeHosts, knownPages: known });
    throwIfAborted(signal);

    const pageUrl = (p) => p.finalUrl || p.requestedUrl;
    site.sitemapRobotsBlocked = pages.filter(p => p.issues.some(i => i.code === "SITEMAP_ROBOTS_BLOCKED")).map(p => p.requestedUrl);
    if (crawl) {
        site.crawl = {
            startUrl: rootUrl,
            complete: crawl.complete,
            pagesReached: crawl.kept.length,
            orphans: pages.filter(p => p.issues.some(i => i.code === "ORPHAN_PAGE")).map(p => p.requestedUrl),
            notInSitemap: pages.filter(p => p.issues.some(i => i.code === "NOT_IN_SITEMAP")).map(pageUrl),
            deep: pages.filter(p => p.crawlDepth >= DEEP_PAGE_DEPTH).map(p => ({ url: pageUrl(p), depth: p.crawlDepth })),
            robotsBlocked: [...crawl.robotsBlocked].map(([url, sources]) => ({ url, sources: [...sources] }))
        };
    }

    return buildReport({
        mode: "site",
        rootUrl, cfg, scopeHosts, autoScopeHosts, pages, site,
        sitemap: {
            sources: sitemapSources,
            sitemaps,
            errors: sitemapErrors,
            urlCount: pageUrls.size,
            outOfScope,
            skippedByLimit: Math.max(0, skippedByLimit)
        }
    });
}

/**
 * Audit one URL (no sitemap). Site checks run on that page alone, so they
 * cover its canonical target and its internal links; duplicate checks need
 * more than one page and will be empty.
 */
async function runPageAudit(input, options = {}) {
    let cfg = mergeConfig(options);
    const { signal } = options;
    const url = normalizeUrl(input);
    if (!url) throw new Error(`Invalid URL: ${input}`);
    const rootUrl = options.rootUrl || new URL("/", url).href;
    let scopeHosts = cfg.scopeHosts;
    if (cfg.siteHeaders?.headers) {
        const rootHost = new URL(rootUrl).hostname;
        const isSiteHost = (host) => inScope(host, rootHost, cfg.subdomainPolicy, scopeHosts);
        cfg = { ...cfg, siteHeaders: { headers: cfg.siteHeaders.headers, isSiteHost } };
    }

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
    scopeHosts = [...new Set([...cfg.scopeHosts, ...autoScopeHosts])];
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
