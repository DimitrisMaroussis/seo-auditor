"use strict";

const cheerio = require("cheerio");

/*
 * Bot-protection / WAF challenge detection.
 *
 * When a WAF serves a challenge page instead of the real document, every SEO
 * check on that HTML is meaningless (e.g. Imperva's challenge carries
 * <meta name="robots" content="noindex,nofollow"> and no title). Such pages
 * must be reported as "blocked", never as SEO findings.
 *
 * A vendor marker alone is not enough: Imperva, for example, also injects its
 * _Incapsula_Resource script into real pages. A page is only treated as a
 * challenge when it has a marker AND almost no visible text.
 */
const SIGNATURES = [
    { vendor: "Imperva Incapsula", pattern: /_Incapsula_Resource|Incapsula incident ID/i },
    { vendor: "Cloudflare", pattern: /cf-browser-verification|cf_chl_opt|\/cdn-cgi\/challenge-platform\/|<title>\s*Just a moment\.\.\.\s*<\/title>|Attention Required! \| Cloudflare/i },
    { vendor: "DataDome", pattern: /captcha-delivery\.com/i },
    { vendor: "HUMAN / PerimeterX", pattern: /_pxCaptcha|px-captcha|perimeterx/i },
    { vendor: "AWS WAF", pattern: /AwsWafIntegration|awswaf/i },
    { vendor: "Sucuri", pattern: /Sucuri WebSite Firewall/i },
    { vendor: "Akamai", pattern: /<title>\s*Access Denied\s*<\/title>[\s\S]*Reference\s*#[\d.a-f]+/i }
];

const THIN_TEXT_CHARS = 300;

function visibleTextLength(html) {
    const $ = cheerio.load(html || "");
    $("script, style, noscript, template").remove();
    return $("body").text().replace(/\s+/g, " ").trim().length;
}

/**
 * @param {string} body  response body (HTML)
 * @returns {{ vendor: string, visibleTextChars: number } | null}
 */
function detectBotChallenge(body) {
    if (!body) return null;
    const match = SIGNATURES.find(sig => sig.pattern.test(body));
    if (!match) return null;
    const textChars = visibleTextLength(body);
    if (textChars >= THIN_TEXT_CHARS) return null;   // real page that merely includes a vendor script
    return { vendor: match.vendor, visibleTextChars: textChars };
}

module.exports = { detectBotChallenge, SIGNATURES };
