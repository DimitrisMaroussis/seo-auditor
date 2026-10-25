"use strict";

const { fetchUrl } = require("./http");
const { mergeConfig } = require("./config");
const { normalizeUrl } = require("./url");
const { mapWithConcurrency } = require("./pool");
const { auditPage } = require("./auditPage");
const { checkUrl, verdict, checkEmailDomain } = require("./linkChecks");

const dupKey = (text) => text.replace(/\s+/g, " ").trim().toLowerCase();

function findDuplicates(pages, pick) {
    const groups = new Map();
    for (const page of pages) {
        const text = pick(page);
        if (!text) continue;
        const key = dupKey(text);
        if (!groups.has(key)) groups.set(key, { value: text, urls: [] });
        groups.get(key).urls.push(page.finalUrl);
    }
    return [...groups.values()].filter(g => g.urls.length > 1);
}

/** Index audited pages by requested and final URL. */
function indexPages(pages) {
    const map = new Map();
    for (const page of pages) {
        for (const u of [page.requestedUrl, page.finalUrl]) {
            const key = normalizeUrl(u || "");
            if (key && !map.has(key)) map.set(key, page);
        }
    }
    return map;
}

/** Check a link with HEAD, falling back to a headers-only GET when HEAD fails. */
const checkLinkStatus = (url, cfg) => checkUrl(url, cfg);

const IMAGE_ACCEPT = "image/avif,image/webp,image/apng,image/*,*/*;q=0.8";

/** Map each URL a page links to (normalised) to the pages that contain it. */
function collect(pages, pick) {
    const map = new Map();
    for (const page of pages) {
        for (const raw of pick(page) || []) {
            const key = normalizeUrl(raw);
            if (!key) continue;
            if (!map.has(key)) map.set(key, new Set());
            map.get(key).add(page);
        }
    }
    return map;
}

const finalUrls = (pages) => [...pages].map(p => p.finalUrl);

/** Short list for a page issue message: the first few items, then "…". */
const brief = (items) => items.slice(0, 3).join("; ") + (items.length > 3 ? "; …" : "");

/**
 * Cross-page checks that need every audited page.
 *
 * @param {Array} pages      results of auditPage()
 * @param {object} ctx       { rootUrl, sitemapUrls: Set, ...config }
 */
async function runSiteChecks(pages, ctx = {}) {
    const cfg = mergeConfig(ctx);
    const byUrl = indexPages(pages);
    // Several sitemap URLs can redirect to the same document; count each
    // final document once so it is not reported as a duplicate of itself.
    const seenFinal = new Set();
    const analysed = pages.filter(p => {
        if (!p.analyzed || p.status !== 200) return false;
        const key = normalizeUrl(p.finalUrl);
        if (seenFinal.has(key)) return false;
        seenFinal.add(key);
        return true;
    });
    // Only pages that can be indexed compete for titles/descriptions.
    const indexable = analysed.filter(p => !p.indexability.noindex && p.indexability.canonicalStatus !== "other");

    const report = {
        duplicateTitles: findDuplicates(indexable, p => p.title.text),
        duplicateDescriptions: findDuplicates(indexable, p => p.metaDescription.text),
        missingCanonical: analysed.filter(p => p.canonical.count === 0).map(p => p.finalUrl),
        canonicalIssues: [],
        unverifiedCanonicals: [],
        indexabilityConflicts: [],
        blockedPages: pages.filter(p => p.blocked).map(p => ({ url: p.requestedUrl, vendor: p.blocked.vendor })),
        brokenInternalLinks: [],
        redirectingInternalLinks: [],
        brokenExternalLinks: [],
        unverifiedExternalLinks: [],
        invalidEmailDomains: [],
        brokenImages: [],
        unverifiedImages: [],
        linkCheck: {
            checked: 0, skipped: !cfg.checkLinks,
            externalChecked: 0, externalSkipped: !cfg.checkExternalLinks,
            emailDomainsChecked: 0,
            imagesChecked: 0, imagesSkipped: !cfg.checkImages
        }
    };

    // Broken links and images found by the network checks, per source page.
    const brokenLinksOn = new Map();
    const brokenImagesOn = new Map();
    const badDomainsOn = new Map();
    const note = (map, pages, text) => pages.forEach(p => {
        if (!map.has(p)) map.set(p, []);
        map.get(p).push(text);
    });

    // ---------- canonical destinations ----------
    const canonicalTargets = new Map();   // canonical URL → [source pages]
    for (const page of analysed) {
        if (page.indexability.canonicalStatus !== "other") continue;
        const target = normalizeUrl(page.canonical.url);
        if (!target) continue;
        if (!canonicalTargets.has(target)) canonicalTargets.set(target, []);
        canonicalTargets.get(target).push(page.finalUrl);
    }

    const targetList = [...canonicalTargets.keys()];
    const targetResults = await mapWithConcurrency(targetList, cfg.concurrency, async (target) =>
        byUrl.get(target) || auditPage(target, { ...cfg, rootUrl: ctx.rootUrl })
    , { signal: cfg.signal });
    if (cfg.signal?.aborted) return report;

    targetList.forEach((target, i) => {
        const result = targetResults[i];
        const sources = canonicalTargets.get(target);
        const problems = [];
        if (result.blocked) {
            report.unverifiedCanonicals.push({ canonical: target, sources, reason: `blocked by ${result.blocked.vendor}` });
            return;
        }
        if (result.error) problems.push(result.error.message);
        else if (result.fetchError) problems.push(`unreachable (${result.fetchError.code})`);
        else {
            if (result.redirectChain.length) problems.push(`redirects to ${result.finalUrl}`);
            if (result.status !== 200) problems.push(`returns HTTP ${result.status}`);
            if (result.indexability?.noindex) problems.push("is noindex");
            if (result.indexability?.canonicalStatus === "other") {
                problems.push(`is itself canonicalised to ${result.canonical.url} (canonical chain)`);
            }
        }
        if (problems.length) {
            report.canonicalIssues.push({ canonical: target, sources, problems });
        }
    });

    // ---------- indexability conflicts ----------
    for (const page of pages) {
        // A blocked page's signals came from the WAF, not the site.
        if (!page.inSitemap || page.blocked) continue;
        const conflicts = [];
        if (page.fetchError) conflicts.push(`in sitemap but unreachable (${page.fetchError.code})`);
        else {
            if (page.redirectChain.length) conflicts.push(`in sitemap but redirects to ${page.finalUrl}`);
            if (page.status !== 200) conflicts.push(`in sitemap but returns HTTP ${page.status}`);
            if (page.indexability?.noindex) conflicts.push("in sitemap but noindex");
            if (page.indexability?.canonicalStatus === "other") {
                conflicts.push(`in sitemap but canonicalised to ${page.canonical.url}`);
            }
        }
        if (page.indexability?.noindex && page.indexability.canonicalStatus === "other") {
            conflicts.push("noindex combined with a canonical to another URL sends mixed signals");
        }
        if (conflicts.length) report.indexabilityConflicts.push({ url: page.requestedUrl, conflicts });
    }

    // ---------- broken internal links ----------
    if (cfg.checkLinks) {
        const linkSources = collect(analysed, p => p.links.internal);
        const links = [...linkSources.keys()];
        report.linkCheck.checked = links.length;
        const results = await mapWithConcurrency(links, cfg.concurrency, async (link) => {
            const known = byUrl.get(link);
            if (known) {
                return {
                    url: link, ok: !known.fetchError, status: known.status,
                    finalUrl: known.finalUrl, redirectChain: known.redirectChain, error: known.fetchError
                };
            }
            return checkLinkStatus(link, cfg);
        }, { signal: cfg.signal });
        if (cfg.signal?.aborted) return report;

        links.forEach((link, i) => {
            const r = results[i];
            const from = linkSources.get(link);
            const sources = finalUrls(from);
            if (r.error && !r.status) {
                const error = r.error.message || r.error.code;
                report.brokenInternalLinks.push({ url: link, status: null, error, sources });
                note(brokenLinksOn, from, `${link} (${r.error.code || error})`);
            } else if (r.status >= 400) {
                report.brokenInternalLinks.push({ url: link, status: r.status, sources });
                note(brokenLinksOn, from, `${link} (HTTP ${r.status})`);
            } else if (r.redirectChain?.length) {
                report.redirectingInternalLinks.push({ url: link, finalUrl: r.finalUrl, hops: r.redirectChain.length, sources });
            }
        });
    }

    // ---------- broken external links and email domains ----------
    if (cfg.checkExternalLinks) {
        const linkSources = collect(analysed, p => p.links.external);
        const links = [...linkSources.keys()];
        report.linkCheck.externalChecked = links.length;
        const results = await mapWithConcurrency(links, cfg.externalConcurrency, link => checkUrl(link, cfg), { signal: cfg.signal });
        if (cfg.signal?.aborted) return report;

        links.forEach((link, i) => {
            const r = results[i];
            const v = verdict(r);
            const from = linkSources.get(link);
            const item = { url: link, status: r.status ?? null, reason: v.reason, sources: finalUrls(from) };
            if (v.state === "broken") {
                report.brokenExternalLinks.push(item);
                note(brokenLinksOn, from, `${link} (${v.reason})`);
            } else if (v.state === "unverified") {
                report.unverifiedExternalLinks.push(item);
            }
        });

        // Email links: does the domain after the @ exist?
        const domainSources = new Map();
        for (const page of analysed) {
            for (const domain of page.otherLinks?.emailDomains || []) {
                if (!domainSources.has(domain)) domainSources.set(domain, new Set());
                domainSources.get(domain).add(page);
            }
        }
        const domains = [...domainSources.keys()];
        report.linkCheck.emailDomainsChecked = domains.length;
        const lookup = cfg.resolveEmailDomain || checkEmailDomain;
        const answers = await mapWithConcurrency(domains, cfg.externalConcurrency, d => lookup(d, cfg), { signal: cfg.signal });
        if (cfg.signal?.aborted) return report;
        domains.forEach((domain, i) => {
            if (answers[i] !== "invalid") return;
            const from = domainSources.get(domain);
            report.invalidEmailDomains.push({ domain, sources: finalUrls(from) });
            note(badDomainsOn, from, domain);
        });
    }

    // ---------- broken images ----------
    if (cfg.checkImages) {
        const imageSources = collect(analysed, p => p.images.urls);
        const images = [...imageSources.keys()];
        report.linkCheck.imagesChecked = images.length;
        const results = await mapWithConcurrency(images, cfg.concurrency,
            image => checkUrl(image, cfg, { accept: IMAGE_ACCEPT }), { signal: cfg.signal });
        if (cfg.signal?.aborted) return report;

        images.forEach((image, i) => {
            const r = results[i];
            const v = verdict(r, { image: true });
            const from = imageSources.get(image);
            const item = { url: image, status: r.status ?? null, reason: v.reason, sources: finalUrls(from) };
            if (v.state === "broken") {
                report.brokenImages.push(item);
                note(brokenImagesOn, from, `${image} (${v.reason})`);
            } else if (v.state === "unverified") {
                report.unverifiedImages.push(item);
            }
        });
    }

    // ---------- per-page issues from the network checks ----------
    for (const [page, items] of brokenLinksOn) {
        page.issues.push({ severity: "error", code: "LINK_BROKEN", message: `${items.length} broken link(s): ${brief(items)}` });
    }
    for (const [page, items] of brokenImagesOn) {
        page.issues.push({ severity: "error", code: "IMG_BROKEN", message: `${items.length} broken image(s): ${brief(items)}` });
    }
    for (const [page, items] of badDomainsOn) {
        page.issues.push({ severity: "warning", code: "EMAIL_DOMAIN_INVALID", message: `Email link(s) to a domain that does not exist: ${brief(items)}` });
    }

    return report;
}

module.exports = { runSiteChecks, findDuplicates, checkLinkStatus };
