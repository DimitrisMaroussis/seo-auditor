#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { runAudit } = require("./src/audit");

const USAGE = `
Usage: node index.js <rootUrl | sitemapUrl> [options]

Options:
  --out <file>            JSON report path (default: seo-report.json)
  --concurrency <n>       parallel requests (default: 4)
  --timeout <ms>          per-request timeout (default: 15000)
  --retries <n>           retries on network errors / 5xx / 429 (default: 2)
  --max-redirects <n>     redirect hops before failing (default: 10)
  --max-urls <n>          audit at most n sitemap URLs
  --include-subdomains    treat subdomains of the root host as internal
  --root <url>            crawl scope root (default: origin of the input URL)
  --host <hostname>       extra hostname in scope (repeatable)
  --no-follow-root-redirect  do not add the host the root redirects to
  --user-agent <ua>       User-Agent header (e.g. one allowlisted in your WAF)
  --no-link-check         skip checking internal links for 4xx/5xx
  --no-external-check     skip checking external links and email-link domains
  --no-image-check        skip checking that images load

Examples:
  node index.js https://www.cosmoteinsurance.gr/sitemap.xml
  node index.js https://www.cosmoteinsurance.gr/ --max-urls 20 --out report.json
`;

function parseArgs(argv) {
    const args = { options: {}, out: "seo-report.json", input: null };
    const num = (flag, value) => {
        const n = Number(value);
        if (!Number.isFinite(n) || n < 0) throw new Error(`${flag} expects a non-negative number`);
        return n;
    };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        switch (arg) {
            case "--out": args.out = argv[++i]; break;
            case "--concurrency": args.options.concurrency = Math.max(1, num(arg, argv[++i])); break;
            case "--timeout": args.options.timeoutMs = num(arg, argv[++i]); break;
            case "--retries": args.options.retries = num(arg, argv[++i]); break;
            case "--max-redirects": args.options.maxRedirects = num(arg, argv[++i]); break;
            case "--max-urls": args.options.maxUrls = num(arg, argv[++i]); break;
            case "--include-subdomains": args.options.subdomainPolicy = "include-subdomains"; break;
            case "--root": args.options.rootUrl = argv[++i]; break;
            case "--no-link-check": args.options.checkLinks = false; break;
            case "--no-external-check": args.options.checkExternalLinks = false; break;
            case "--no-image-check": args.options.checkImages = false; break;
            case "--host": (args.options.scopeHosts ||= []).push(String(argv[++i]).toLowerCase()); break;
            case "--no-follow-root-redirect": args.options.followRootRedirect = false; break;
            case "--user-agent": args.options.userAgent = argv[++i]; break;
            case "-h": case "--help": args.help = true; break;
            default:
                if (arg.startsWith("--")) throw new Error(`Unknown option ${arg}`);
                args.input = arg;
        }
    }
    return args;
}

function printSummary(report) {
    const { summary, site, sitemap } = report;
    console.log("\n==============================");
    console.log("        AUDIT SUMMARY");
    console.log("==============================");
    console.log("Root:", report.rootUrl);
    console.log("Sitemaps read:", sitemap.sitemaps.length, "| URLs in sitemaps:", sitemap.urlCount);
    if (sitemap.errors.length) {
        console.log("Sitemap errors:");
        sitemap.errors.forEach(e => console.log("  ❌", e.url, "-", e.error));
    }
    if (report.config.scopeHosts.length) console.log("Also in scope:", report.config.scopeHosts.join(", "));
    if (sitemap.outOfScope.length) console.log("Out-of-scope sitemap URLs skipped:", sitemap.outOfScope.length);
    console.log("Pages audited:", summary.pagesAudited, "| fetch failures:", summary.fetchFailures);
    if (summary.blockedByBotProtection) {
        const vendors = [...new Set(site.blockedPages.map(b => b.vendor))].join(", ");
        console.log(`\n⚠️  ${summary.blockedByBotProtection} page(s) were blocked by bot protection (${vendors}).`);
        console.log("   Their on-page SEO was NOT audited and they are excluded from site checks.");
        console.log("   Allowlist this auditor's IP or --user-agent in the WAF, then re-run.");
    }
    console.log(`Page issues: ${summary.errors} errors, ${summary.warnings} warnings, ${summary.info} info`);

    const section = (title, items, fmt) => {
        console.log(`\n${title}: ${items.length}`);
        items.slice(0, 10).forEach(item => console.log("  -", fmt(item)));
        if (items.length > 10) console.log(`  … ${items.length - 10} more in the JSON report`);
    };
    section("Duplicate titles", site.duplicateTitles, g => `"${g.value}" on ${g.urls.length} pages`);
    section("Duplicate descriptions", site.duplicateDescriptions, g => `"${g.value.slice(0, 70)}…" on ${g.urls.length} pages`);
    section("Missing canonical", site.missingCanonical, u => u);
    section("Canonical destination problems", site.canonicalIssues, c => `${c.canonical}: ${c.problems.join("; ")}`);
    if (site.unverifiedCanonicals.length) {
        section("Canonical destinations not verifiable", site.unverifiedCanonicals, c => `${c.canonical}: ${c.reason}`);
    }
    section("Indexability conflicts", site.indexabilityConflicts, c => `${c.url}: ${c.conflicts.join("; ")}`);
    if (site.linkCheck.skipped) console.log("\nBroken internal links: not checked (--no-link-check)");
    else section(`Broken internal links (of ${site.linkCheck.checked} checked)`, site.brokenInternalLinks,
        l => `${l.url} → ${l.status ?? l.error} (linked from ${l.sources.length} page(s))`);
    if (!site.linkCheck.skipped) {
        section("Internal links that redirect", site.redirectingInternalLinks,
            l => `${l.url} → ${l.finalUrl} (linked from ${l.sources.length} page(s))`);
    }
    if (site.linkCheck.externalSkipped) console.log("\nExternal links: not checked (--no-external-check)");
    else {
        section(`Broken external links (of ${site.linkCheck.externalChecked} checked)`, site.brokenExternalLinks,
            l => `${l.url} → ${l.reason} (linked from ${l.sources.length} page(s))`);
        if (site.unverifiedExternalLinks.length) {
            section("External links that refused the check (open them by hand)", site.unverifiedExternalLinks, l => `${l.url} → ${l.reason}`);
        }
        section("Email links to domains that do not exist", site.invalidEmailDomains, d => `${d.domain} (on ${d.sources.length} page(s))`);
    }
    if (site.linkCheck.imagesSkipped) console.log("\nImages: not checked (--no-image-check)");
    else section(`Broken images (of ${site.linkCheck.imagesChecked} checked)`, site.brokenImages,
        i => `${i.url} → ${i.reason} (on ${i.sources.length} page(s))`);
}

async function main() {
    let args;
    try {
        args = parseArgs(process.argv.slice(2));
    } catch (err) {
        console.error(err.message, USAGE);
        process.exitCode = 2;
        return;
    }
    if (args.help || !args.input) {
        console.log(USAGE);
        process.exitCode = args.help ? 0 : 2;
        return;
    }

    const report = await runAudit(args.input, {
        ...args.options,
        onProgress: (done, total, page) => {
            const status = page.fetchError ? `ERROR ${page.fetchError.code}`
                : page.blocked ? `${page.status} BLOCKED (${page.blocked.vendor})` : page.status;
            console.log(`${done}/${total}`, status, page.requestedUrl);
        }
    });

    printSummary(report);
    const outPath = path.resolve(args.out);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
    console.log("\nFull report written to", outPath);
}

if (require.main === module) {
    main().catch(err => {
        console.error("Audit failed:", err.message);
        process.exitCode = 1;
    });
}

module.exports = { parseArgs };
