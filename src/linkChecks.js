"use strict";

const dns = require("dns");
const { fetchUrl } = require("./http");

/*
 * Link and image checks.
 *
 * Pure validators (no network) for the links a page carries that are not web
 * pages: mailto:, tel:, sms:, javascript: and hrefs that cannot be parsed.
 * Network checks for external links, images and email domains, all done once
 * per unique URL or domain across the whole audit.
 */

// ---------- contact and other non-page links ----------

const LABEL = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
const TLD = "(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})";
const HOSTNAME = new RegExp(`^(?:${LABEL}\\.)+${TLD}$`, "i");
// Local part: anything but whitespace and the characters an address cannot hold unquoted.
const LOCAL_PART = /^[^\s@<>()[\]\\,;:"]+$/;

/** Domain in ASCII (punycode) form, or null when it is not a valid hostname. */
function asciiDomain(domain) {
    try {
        const host = new URL(`http://${domain}`).hostname;
        return HOSTNAME.test(host) && host.length <= 253 ? host : null;
    } catch {
        return null;
    }
}

/** Why an email address is not valid, or null when it is. */
function emailProblem(address) {
    const at = address.lastIndexOf("@");
    if (at < 0) return "no @";
    const local = address.slice(0, at);
    const domain = address.slice(at + 1);
    if (!local) return "nothing before the @";
    if (!LOCAL_PART.test(local) || local.length > 64 || /^\.|\.$|\.\./.test(local)) return "invalid characters before the @";
    if (!domain) return "no domain after the @";
    if (!asciiDomain(domain)) return `"${domain}" is not a valid domain`;
    return null;
}

const decode = (text) => {
    try {
        return decodeURIComponent(text);
    } catch {
        return text;
    }
};

/**
 * Check a mailto: href. "mailto:?subject=…" (no recipient) is a valid way to
 * open a new message for the visitor to address, so it passes.
 * @returns {{ valid: boolean, reason: string|null, domains: string[] }}
 */
function checkMailto(href) {
    const [target, query] = href.replace(/^mailto:/i, "").split("?");
    const addresses = decode(target).split(",").map(a => a.trim()).filter(Boolean);
    if (!addresses.length) {
        return query ? { valid: true, reason: null, domains: [] } : { valid: false, reason: "no email address", domains: [] };
    }
    for (const address of addresses) {
        const problem = emailProblem(address);
        if (problem) return { valid: false, reason: `${address}: ${problem}`, domains: [] };
    }
    return { valid: true, reason: null, domains: [...new Set(addresses.map(a => asciiDomain(a.slice(a.lastIndexOf("@") + 1))))] };
}

/**
 * Check a tel: or sms: href. Separators people type (spaces, dots, dashes,
 * brackets) are allowed; what is left must be 3–15 digits with an optional
 * leading +. Short numbers such as 112 or 5-digit service lines pass.
 * @returns {{ valid: boolean, reason: string|null }}
 */
function checkPhone(href) {
    const number = decode(href.replace(/^(tel|sms):/i, "").split(/[;?]/)[0]).trim();
    if (!number) return { valid: false, reason: "no number" };
    const digits = number.replace(/[\s().\- ]/g, "");
    if (/[^\d+]/.test(digits)) return { valid: false, reason: `"${number}" contains characters that are not digits` };
    if (digits.lastIndexOf("+") > 0) return { valid: false, reason: `"${number}" has a + that is not at the start` };
    const count = digits.replace("+", "").length;
    if (count < 3) return { valid: false, reason: `"${number}" is too short to be a phone number` };
    if (count > 15) return { valid: false, reason: `"${number}" has more than 15 digits` };
    return { valid: true, reason: null };
}

/**
 * Sort a page's non-page links into what each check needs.
 * @param {string[]} other    hrefs classified "other" (schemes, #anchors)
 * @param {string[]} invalid  hrefs that are empty or cannot be parsed
 */
function checkOtherLinks(other, invalid) {
    const result = { invalidEmail: [], invalidPhone: [], javascript: [], malformed: [], emailDomains: new Set() };
    for (const href of other) {
        if (/^mailto:/i.test(href)) {
            const r = checkMailto(href);
            if (!r.valid) result.invalidEmail.push({ href, reason: r.reason });
            r.domains.forEach(d => result.emailDomains.add(d));
        } else if (/^(tel|sms):/i.test(href)) {
            const r = checkPhone(href);
            if (!r.valid) result.invalidPhone.push({ href, reason: r.reason });
        } else if (/^javascript:/i.test(href)) {
            result.javascript.push(href);
        }
    }
    for (const href of invalid) result.malformed.push({ href, reason: href ? "the address cannot be read" : "empty href" });
    return { ...result, emailDomains: [...result.emailDomains] };
}

// ---------- network checks ----------

// Statuses that mean "the site would not answer an automated check", not "the link is broken".
const UNVERIFIABLE = new Set([401, 403, 429, 999]);

/**
 * Check one URL with HEAD, falling back to a headers-only GET whenever HEAD
 * fails, since some servers answer HEAD wrongly. Never throws.
 */
async function checkUrl(url, cfg, { accept } = {}) {
    let res = await fetchUrl(url, { ...cfg, method: "HEAD", accept });
    if (!res.ok || res.status >= 400) {
        const get = await fetchUrl(url, { ...cfg, method: "GET", headersOnly: true, accept });
        if (get.ok || !res.ok) res = get;
    }
    return {
        url,
        ok: res.ok,
        status: res.status,
        contentType: res.headers?.["content-type"] || null,
        finalUrl: res.finalUrl,
        redirectChain: res.redirectChain,
        error: res.error
    };
}

/**
 * Sort a check result: "ok", "broken" (with a reason) or "unverified" (the
 * server refused automated checks, so the link may well work for people).
 */
function verdict(r, { image = false } = {}) {
    if (r.error && !r.status) return { state: "broken", reason: r.error.code || r.error.message };
    if (UNVERIFIABLE.has(r.status)) return { state: "unverified", reason: `HTTP ${r.status}` };
    if (r.status >= 400) return { state: "broken", reason: `HTTP ${r.status}` };
    if (image && r.contentType && !/^image\//i.test(r.contentType)) {
        return { state: "broken", reason: `not an image (${r.contentType.split(";")[0]})` };
    }
    return { state: "ok", reason: null };
}

/**
 * Whether an email domain can receive mail: an MX record, or failing that an
 * A/AAAA record (the fallback mail servers use). Only a definite "does not
 * exist" counts as invalid; lookup timeouts and network errors are "unknown".
 * @returns {Promise<"ok"|"invalid"|"unknown">}
 */
async function checkEmailDomain(domain, { timeoutMs = 5000 } = {}) {
    const resolver = new dns.promises.Resolver({ timeout: timeoutMs, tries: 1 });
    const missing = (err) => ["ENOTFOUND", "ENODATA", "ENODOMAIN", "NXDOMAIN"].includes(err.code);
    try {
        await resolver.resolveMx(domain);
        return "ok";
    } catch (err) {
        if (!missing(err)) return "unknown";
    }
    for (const lookup of ["resolve4", "resolve6"]) {
        try {
            await resolver[lookup](domain);
            return "ok";
        } catch (err) {
            if (!missing(err)) return "unknown";
        }
    }
    return "invalid";
}

module.exports = { checkMailto, checkPhone, checkOtherLinks, checkUrl, verdict, checkEmailDomain, UNVERIFIABLE };
