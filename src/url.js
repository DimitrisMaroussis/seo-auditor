"use strict";

const NON_HTTP_SCHEMES = /^(mailto|tel|sms|javascript|data|ftp|file|fax|skype|whatsapp):/i;

/**
 * Normalize a URL for deduplication:
 *  - removes the #fragment (same document)
 *  - lowercases scheme and host (URL does this), drops default ports
 *  - keeps the query string intact (it can select a different page)
 *  - keeps path case and trailing slash (servers may treat them differently)
 * Returns null for non-http(s) or unparsable input.
 */
function normalizeUrl(input, base) {
    let url;
    try {
        url = base ? new URL(input, base) : new URL(input);
    } catch {
        return null;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    return url.href;
}

/** Strip a leading "www." for subdomain comparisons. */
function baseHost(hostname) {
    return hostname.toLowerCase().replace(/^www\./, "");
}

/**
 * Decide whether a hostname is part of the audited site.
 *
 * Policies:
 *  - "exact-host": the hostname must equal the root hostname.
 *  - "include-subdomains": the hostname equals the root's base host
 *    (root host without "www.") or is a subdomain of it.
 *    Root www.example.gr → example.gr, www.example.gr, shop.example.gr are internal;
 *    notexample.gr and example.gr.evil.com are not.
 */
function isSameSite(hostname, rootHostname, policy = "exact-host") {
    const host = hostname.toLowerCase();
    const root = rootHostname.toLowerCase();
    if (policy === "exact-host") return host === root;
    if (policy === "include-subdomains") {
        const base = baseHost(root);
        return host === base || host.endsWith(`.${base}`);
    }
    throw new Error(`Unknown subdomain policy: ${policy}`);
}

/**
 * True when hostname belongs to the root host or any extra scope host.
 */
function inScope(hostname, rootHostname, policy = "exact-host", extraHosts = []) {
    return [rootHostname, ...extraHosts].some(root => isSameSite(hostname, root, policy));
}

/**
 * Classify an href found on pageUrl.
 * @returns {{ kind: "internal"|"external"|"other"|"invalid", url: string|null, raw: string }}
 */
function classifyLink(href, pageUrl, rootUrl, policy = "exact-host", extraHosts = []) {
    const raw = (href ?? "").trim();
    if (!raw) return { kind: "invalid", url: null, raw };
    if (raw.startsWith("#")) return { kind: "other", url: null, raw }; // same-page anchor
    if (NON_HTTP_SCHEMES.test(raw)) return { kind: "other", url: null, raw };

    let absolute;
    try {
        absolute = new URL(raw, pageUrl);
    } catch {
        return { kind: "invalid", url: null, raw };
    }
    if (absolute.protocol !== "http:" && absolute.protocol !== "https:") {
        return { kind: "other", url: null, raw };
    }
    absolute.hash = "";

    const rootHost = new URL(rootUrl).hostname;
    const kind = inScope(absolute.hostname, rootHost, policy, extraHosts) ? "internal" : "external";
    return { kind, url: absolute.href, raw };
}

module.exports = { normalizeUrl, isSameSite, inScope, classifyLink };
