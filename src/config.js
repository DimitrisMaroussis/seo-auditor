"use strict";

// Defaults for every tunable used by the auditor. Callers can override any
// subset by passing an options object; see mergeConfig().
const DEFAULTS = Object.freeze({
    timeoutMs: 15000,           // per request (connect + full body)
    maxRedirects: 10,           // redirect hops before giving up
    retries: 2,                 // extra attempts on network errors / 5xx / 429
    retryDelayMs: 500,          // base delay, doubled on each retry
    concurrency: 4,             // parallel page audits / link checks
    maxBodyBytes: 10 * 1024 * 1024,
    maxSitemapDepth: 5,         // nested sitemap index levels
    maxUrls: Infinity,          // cap on sitemap URLs to audit
    checkLinks: true,           // HEAD/GET every unique internal link
    checkExternalLinks: true,   // HEAD/GET every unique external link; look up email-link domains
    checkImages: true,          // HEAD/GET every unique image (src, srcset, data-src)
    externalConcurrency: 8,     // external links spread over many hosts, so more can run at once
    // "exact-host": only the root URL's hostname is internal.
    // "include-subdomains": the root's registrable host and any subdomain of it
    //   (www.example.gr, blog.example.gr, example.gr) are internal.
    subdomainPolicy: "exact-host",
    // Additional hostnames treated as the same site (e.g. the host a
    // rebranded domain redirects to). The subdomain policy applies to each.
    scopeHosts: [],
    // Add hosts that the root URL or /robots.txt redirect to into scopeHosts.
    followRootRedirect: true,
    userAgent: "MagentaSEOAuditor/1.0 (+https://github.com/)",
    // Extra TLS options for https requests (e.g. { ca } in tests).
    tls: {}
});

function mergeConfig(options = {}) {
    return { ...DEFAULTS, ...options, tls: { ...DEFAULTS.tls, ...(options.tls || {}) } };
}

module.exports = { DEFAULTS, mergeConfig };
