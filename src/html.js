"use strict";

const cheerio = require("cheerio");
const { classifyLink, normalizeUrl } = require("./url");

const collapse = (text) => (text || "").replace(/\s+/g, " ").trim();

/** Split a robots directive string ("noindex, nofollow") into lowercase tokens. */
function parseRobotsDirectives(value) {
    return (value || "")
        .split(",")
        .map(token => token.trim().toLowerCase())
        .filter(Boolean);
}

/**
 * Parse an X-Robots-Tag header value. A header can apply to every crawler
 * ("noindex, nofollow") or to one user agent ("googlebot: noindex").
 * Node joins repeated headers with ", ", so the value is split on commas and
 * a "<agent>: " prefix starts a new agent-specific group.
 * @returns {{ all: string[], byAgent: Record<string, string[]> }}
 */
function parseXRobotsTag(header) {
    const result = { all: [], byAgent: {} };
    if (!header) return result;
    const raw = Array.isArray(header) ? header.join(", ") : String(header);

    // Known directives that legitimately contain a colon.
    const valued = /^(max-snippet|max-image-preview|max-video-preview|unavailable_after)\s*:/i;
    let agent = null;

    for (const part of raw.split(",")) {
        let token = part.trim();
        if (!token) continue;
        const agentMatch = /^([a-z0-9_-]+)\s*:\s*(.*)$/i.exec(token);
        if (agentMatch && !valued.test(token)) {
            agent = agentMatch[1].toLowerCase();
            token = agentMatch[2].trim();
            if (!token) continue;
        }
        const directive = token.toLowerCase();
        if (agent) (result.byAgent[agent] ||= []).push(directive);
        else result.all.push(directive);
    }
    return result;
}

/**
 * Extract on-page SEO data from an HTML document.
 * Attribute names are case-insensitive and attribute order/quoting do not
 * matter because the document is parsed by an HTML5 parser (parse5).
 *
 * @param {string} html
 * @param {string} pageUrl   final URL the HTML was served from
 * @param {object} opts      { rootUrl, subdomainPolicy, extraHosts }
 */
function extractSeo(html, pageUrl, { rootUrl = pageUrl, subdomainPolicy = "exact-host", extraHosts = [] } = {}) {
    const $ = cheerio.load(html || "");

    // <base href> changes how relative URLs on the page resolve.
    let baseUrl = pageUrl;
    const baseHref = $("base[href]").first().attr("href");
    if (baseHref) {
        try {
            baseUrl = new URL(baseHref.trim(), pageUrl).href;
        } catch { /* invalid base: ignore, use page URL */ }
    }

    // ---------- TITLE ----------
    // Only <title> in <head>; <svg><title> in the body is not the document title.
    const titleEls = $("head > title");
    const titleText = titleEls.length ? collapse(titleEls.first().text()) : null;

    // ---------- META (name attribute values are case-insensitive) ----------
    const metaByName = (name) => $("meta[name]").filter((_, el) =>
        ($(el).attr("name") || "").trim().toLowerCase() === name
    );

    const descEls = metaByName("description");
    const descText = descEls.length ? collapse(descEls.first().attr("content")) : null;

    const robotsMeta = [];
    $("meta[name]").each((_, el) => {
        const name = ($(el).attr("name") || "").trim().toLowerCase();
        if (name === "robots" || name === "googlebot") {
            robotsMeta.push({
                name,
                content: $(el).attr("content") ?? "",
                directives: parseRobotsDirectives($(el).attr("content"))
            });
        }
    });

    // ---------- CANONICAL (rel is a token list, e.g. "canonical nofollow") ----------
    const canonicals = [];
    $("link[rel][href]").each((_, el) => {
        const rels = ($(el).attr("rel") || "").toLowerCase().split(/\s+/);
        if (!rels.includes("canonical")) return;
        const href = ($(el).attr("href") || "").trim();
        let resolved = null;
        try {
            resolved = href ? new URL(href, baseUrl).href : null;
        } catch { /* keep null: invalid canonical */ }
        canonicals.push({ href, resolved, inHead: $(el).closest("head").length > 0 });
    });

    // ---------- H1 ----------
    const h1s = $("h1").map((_, el) => collapse($(el).text())).get();

    // Markup of an element as written, for showing it in the report: the start tag with
    // its attributes and, for links, the visible text. Long values are shortened, except
    // with `full` (images keep every srcset candidate); embedded data: files always are.
    const clip = (text, max) => text.length > max ? text.slice(0, max - 1) + "…" : text;
    const startTag = (el, { full = false } = {}) => {
        const attrs = Object.entries(el.attribs || {}).map(([name, value]) => {
            const shown = /^\s*data:/i.test(value) ? clip(value, 80) : full ? value : clip(value, 300);
            return ` ${name}="${shown.replace(/"/g, "&quot;")}"`;
        });
        return `<${el.name}${attrs.join("")}>`;
    };

    // ---------- IMAGES ----------
    const images = [];
    const imageUrls = new Set();   // every file the page can load as an image, resolved
    const addImage = (raw) => {
        const value = (raw || "").trim();
        if (!value || /^data:/i.test(value)) return;
        const url = normalizeUrl(value, baseUrl);
        if (url) imageUrls.add(url);
    };
    const addSrcset = (srcset) => parseSrcset(srcset).forEach(addImage);

    $("img").each((index, el) => {
        const alt = $(el).attr("alt");                       // undefined = missing
        images.push({
            index: index + 1,
            src: $(el).attr("src") || $(el).attr("data-src") || null,
            alt: alt === undefined ? null : alt,
            altStatus: alt === undefined ? "missing" : (alt.trim() === "" ? "empty" : "present"),
            html: startTag(el, { full: true })
        });
        addImage($(el).attr("src"));
        addImage($(el).attr("data-src"));
        addSrcset($(el).attr("srcset"));
        addSrcset($(el).attr("data-srcset"));
    });
    $("picture source").each((_, el) => {
        addSrcset($(el).attr("srcset"));
        addSrcset($(el).attr("data-srcset"));
    });

    // ---------- LINKS ----------
    const internal = new Set();
    const external = new Set();
    const other = [];
    const invalid = [];
    const nofollow = new Set();
    const linkElements = [];

    $("a[href]").each((index, el) => {
        const href = $(el).attr("href");
        const link = classifyLink(href, baseUrl, rootUrl, subdomainPolicy, extraHosts);
        const text = clip(collapse($(el).text()), 120);
        linkElements.push({
            index: index + 1, kind: link.kind, href: link.raw, url: link.url,
            html: `${startTag(el)}${text}</a>`
        });
        if (link.kind === "internal") internal.add(link.url);
        else if (link.kind === "external") external.add(link.url);
        else if (link.kind === "other") other.push(link.raw);
        else invalid.push(link.raw);

        const rel = ($(el).attr("rel") || "").toLowerCase().split(/\s+/);
        if (link.url && rel.includes("nofollow")) nofollow.add(link.url);
    });

    // ---------- JSON-LD ----------
    const jsonLdBlocks = [];
    $("script[type]").each((_, el) => {
        const type = ($(el).attr("type") || "").trim().toLowerCase().split(";")[0].trim();
        if (type === "application/ld+json") jsonLdBlocks.push($(el).html() ?? "");
    });

    return {
        title: { text: titleText, length: titleText === null ? 0 : [...titleText].length, count: titleEls.length },
        metaDescription: {
            text: descText,
            length: descText === null ? 0 : [...descText].length,
            count: descEls.length
        },
        canonical: {
            url: canonicals.length ? canonicals[0].resolved : null,
            count: canonicals.length,
            all: canonicals
        },
        metaRobots: robotsMeta,
        h1: { count: h1s.length, texts: h1s },
        images: {
            count: images.length,
            missingAlt: images.filter(img => img.altStatus === "missing"),
            emptyAlt: images.filter(img => img.altStatus === "empty").length,
            all: images,
            urls: [...imageUrls]
        },
        links: {
            internal: [...internal],
            external: [...external],
            other,
            invalid,
            nofollow: [...nofollow],
            all: linkElements
        },
        jsonLdBlocks
    };
}

/**
 * URLs in a srcset, following the HTML parsing rules: a URL runs until
 * whitespace, so commas inside it (e.g. Cloudinary's /w_400,h_300/) are kept;
 * a comma straight after it, or after its descriptors, ends the candidate.
 */
function parseSrcset(srcset) {
    const text = srcset || "";
    const urls = [];
    let i = 0;
    while (i < text.length) {
        while (i < text.length && /[\s,]/.test(text[i])) i++;
        let url = "";
        while (i < text.length && !/\s/.test(text[i])) url += text[i++];
        if (!url) break;
        const endsCandidate = /,+$/.test(url);
        urls.push(url.replace(/,+$/, ""));
        if (endsCandidate) continue;
        // Skip descriptors ("2x", "400w") up to the comma that ends this candidate.
        let depth = 0;
        while (i < text.length && !(text[i] === "," && depth === 0)) {
            if (text[i] === "(") depth++;
            else if (text[i] === ")") depth = Math.max(0, depth - 1);
            i++;
        }
    }
    return urls;
}

module.exports = { extractSeo, parseRobotsDirectives, parseXRobotsTag, parseSrcset };
