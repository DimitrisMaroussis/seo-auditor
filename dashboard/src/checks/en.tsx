import { C, Pre, UA, type Check } from "./shared";

// English content for "How the checks work". Section ids and issue codes must match checks/el.tsx.
export const CHECKS_EN: Check[] = [
  // ───────────────────────────── PIPELINE ─────────────────────────────
  {
    id: "overview",
    group: "pipeline",
    title: "How an audit runs",
    source: "src/audit.js (runAudit, runPageAudit)",
    summary: <>The auditor never browses the site like a person. It collects a list of URLs, downloads the raw HTML of each one, and inspects that HTML. Nothing is clicked and no JavaScript runs.</>,
    how: [
      <><b>1. Find the sitemap.</b> If the URL you enter ends in <C>.xml</C>, it is used as the sitemap. Otherwise the auditor reads <C>/robots.txt</C> and uses every <C>Sitemap:</C> line. If there are none, it tries <C>/sitemap.xml</C>.</>,
      <><b>2. Read the sitemap</b> (and any child sitemaps) into a list of page URLs. See <a href="#check-sitemap">Sitemap parsing</a>.</>,
      <><b>3. Decide the scope.</b> URLs on other hosts are skipped and listed under <C>sitemap.outOfScope</C> in the report. See <a href="#check-scope">Crawl scope</a>.</>,
      <><b>4. Apply the page limit</b> (Max pages). The first N URLs in sitemap order are audited; the rest are counted in <C>sitemap.skippedByLimit</C>.</>,
      <><b>5. Audit each page</b>, 4 at a time by default: fetch it, then run every per-page check below.</>,
      <><b>6. Run site-wide checks</b> that compare pages with each other or test what they link to (duplicates, canonical targets, broken links and images, email domains).</>,
      <><b>Single page mode</b> skips steps 1–4 and audits only the URL you entered. Site-wide checks still run on that one page, so its canonical target, links, images and email domains are checked, but duplicate checks are always empty.</>,
      <>If no sitemap URL can be read and you entered a site (not a sitemap), the home page alone is audited.</>
    ],
    verify: [
      <>Open <C>https://your-site/robots.txt</C> and look for <C>Sitemap:</C> lines, then open each sitemap in the browser. The URL count should match <b>Sitemap URLs</b> on the dashboard.</>,
      <>Open any page with <C>view-source:https://your-site/page</C> in Chrome or Edge. That source code is exactly what the auditor analyses; the Elements tab in DevTools is not.</>
    ],
    wrongWhen: [
      <><b>Pages that build their content with JavaScript.</b> The auditor sees only the HTML the server sends. A title, H1, canonical or link added later by JavaScript is invisible to it and will be reported as missing. Google does run JavaScript, so these are false positives. Always compare with <C>view-source:</C> before trusting a "missing" finding.</>,
      <>Pages not listed in the sitemap are never audited in whole-site mode. A clean report says nothing about pages missing from the sitemap.</>,
      <>The auditor does not obey or evaluate <C>robots.txt</C> <C>Disallow</C> rules. A page blocked from Google by robots.txt is still audited and can look indexable.</>
    ]
  },
  {
    id: "fetch",
    group: "pipeline",
    title: "Fetching pages and redirects",
    source: "src/http.js (fetchUrl)",
    summary: <>Every page, sitemap, canonical target and link is downloaded by the same function, which records each redirect hop.</>,
    codes: [
      { code: "FETCH_FAILED", severity: "error", when: <>No HTTP response after all retries: DNS failure, refused connection, timeout, TLS error, redirect loop, too many redirects, invalid <C>Location</C> header, or a body larger than 10 MB.</> },
      { code: "REDIRECT", severity: "warning", when: <>The URL from the sitemap redirected at least once before reaching its final page.</> },
      { code: "HTTP_STATUS", severity: "warning", when: <>Final status is not 200. It is an <b>error</b> for 400 and above, a <b>warning</b> otherwise (for example a 204 or a 3xx without a <C>Location</C> header).</> }
    ],
    how: [
      <>Request: <C>GET</C> with <C>User-Agent: {UA}</C>, <C>Accept: text/html,…</C> and <C>Accept-Encoding: identity</C> (no compression requested). No cookies are sent or kept.</>,
      <>Redirects (301, 302, 303, 307, 308) are followed manually, up to <b>10 hops</b>. A relative <C>Location</C> is resolved against the URL that sent it. Visiting the same URL twice in one chain stops with a redirect-loop error. Every hop is stored in <C>redirectChain</C>.</>,
      <>Timeout: <b>15 seconds</b> per request, covering connection, headers and the whole body.</>,
      <>Retries: network errors and status 429, 500, 502, 503, 504 are retried <b>2 more times</b>, waiting 0.5 s then 1 s. The last response is the one reported.</>,
      <>The body is decoded using the <C>charset</C> from the <C>Content-Type</C> header, defaulting to UTF-8.</>,
      <>Response time is measured from the first request to the end of the last body, so it includes redirects and retries.</>
    ],
    verify: [
      <>See the same status codes and redirect chain the auditor saw:<Pre>{`curl -sIL -A "${UA}" https://www.example.gr/page`}</Pre>Each block in the output is one hop; the last one is the final status.</>,
      <>In the browser: DevTools → Network → tick <i>Preserve log</i> → reload. Redirects appear as separate 301/302 rows.</>
    ],
    wrongWhen: [
      <>The server answers bots differently from browsers (by User-Agent, IP address or country). The auditor runs from your machine's IP, which may be rate-limited or geo-blocked. Retry with <C>curl</C> from the same machine to confirm.</>,
      <>Many quick requests trigger rate limiting (429 or 503). Lower the concurrency or the page limit and run again.</>,
      <>A page declares its encoding only in <C>{"<meta charset>"}</C> and not in the HTTP header, and it is not UTF-8. Text then decodes incorrectly, which affects title and description checks. Rare on modern sites.</>,
      <>Response times come from your network, not from Google's, and include redirects. Use them to compare pages with each other, not as a speed score.</>
    ]
  },
  {
    id: "bot",
    group: "pipeline",
    title: "Bot-protection detection",
    source: "src/botProtection.js (detectBotChallenge)",
    summary: <>Some firewalls (WAFs) return a challenge page instead of the real page. Auditing that page would produce nonsense, so the auditor detects it and reports the page as blocked instead.</>,
    codes: [
      { code: "BLOCKED_BY_BOT_PROTECTION", severity: "error", when: <>The response contains a known WAF marker and almost no visible text. No SEO checks run on the page, and it is left out of every site-wide check.</> }
    ],
    how: [
      <>Two conditions must both be true. (1) The HTML contains a known marker: Imperva <C>_Incapsula_Resource</C>, Cloudflare <C>cf_chl_opt</C> or a <i>Just a moment…</i> title, DataDome <C>captcha-delivery.com</C>, PerimeterX <C>px-captcha</C>, AWS WAF <C>awswaf</C>, Sucuri, or an Akamai <i>Access Denied</i> page with a reference number.</>,
      <>(2) The page has fewer than <b>300 characters</b> of visible text once scripts and styles are removed. This second rule matters because some WAFs inject their script into real pages too.</>
    ],
    verify: [
      <>Fetch the page as the auditor does and look at the size and content:<Pre>{`curl -s -A "${UA}" https://www.example.gr/ | head -c 600`}</Pre>A challenge page is usually under 2 KB and has an iframe or script but no real content.</>
    ],
    wrongWhen: [
      <>A real page with under 300 characters of text that also loads a WAF script would be marked blocked (false positive). Very rare.</>,
      <>A WAF the auditor does not know about will not be detected. Its challenge page is then audited as if it were real, usually showing missing title, missing H1 and noindex on every page. If every page fails the same way, suspect bot protection.</>,
      <>Only the Imperva and Cloudflare markers are covered by automated tests. The other vendors' markers come from their public documentation and have not been tested against live pages.</>
    ]
  },
  {
    id: "sitemap",
    group: "pipeline",
    title: "Sitemap parsing",
    source: "src/sitemap.js (parseSitemapXml, loadSitemap)",
    summary: <>Sitemaps are read with an XML parser, so formatting, namespaces and escaped characters are handled the same way search engines handle them.</>,
    how: [
      <>A <C>{"<urlset>"}</C> gives page URLs from each <C>{"<url><loc>"}</C>. A <C>{"<sitemapindex>"}</C> gives child sitemaps from each <C>{"<sitemap><loc>"}</C>, which are then read the same way.</>,
      <>Child sitemaps are followed up to <b>5 levels</b> deep. A sitemap is never read twice, so an index that lists itself does not loop.</>,
      <>Entities (<C>&amp;amp;</C>) and CDATA are decoded, whitespace is trimmed, and namespace prefixes such as <C>sm:urlset</C> are accepted. Image and video <C>{"<loc>"}</C> tags inside a URL entry are ignored.</>,
      <>Each URL has its <C>#fragment</C> removed. Duplicate URLs are counted once. URLs that are not valid http(s) addresses are listed under <C>sitemap.errors</C>.</>,
      <>A sitemap that does not return HTTP 200, or is not valid XML, is listed under <C>sitemap.errors</C>; the audit continues with the others.</>
    ],
    verify: [
      <>Open the sitemap in the browser and count the <C>{"<loc>"}</C> entries, or run:<Pre>{`curl -s https://www.example.gr/sitemap.xml | grep -o "<loc>" | wc -l`}</Pre>For a sitemap index, repeat this for each child sitemap.</>
    ],
    wrongWhen: [
      <>Gzipped sitemaps (<C>.xml.gz</C>) are not supported and are reported as invalid XML.</>,
      <><C>{"<lastmod>"}</C>, <C>{"<priority>"}</C>, the 50,000-URL limit and the 50 MB size limit are not checked.</>,
      <>Sitemaps declared only in Google Search Console and not in robots.txt are not found when you enter a site URL. Enter the sitemap URL directly instead.</>
    ]
  },
  {
    id: "scope",
    group: "pipeline",
    title: "Crawl scope: internal and external",
    source: "src/url.js (isSameSite, inScope, classifyLink), src/audit.js (discoverRedirectHosts)",
    summary: <>The scope decides which sitemap URLs are audited and which links count as internal. It is derived from the URL you enter.</>,
    how: [
      <>The <b>root host</b> is the host of the URL you enter, for example <C>www.insurancemarket.gr</C>. The port is ignored, and <C>http</C> and <C>https</C> on the same host are both internal.</>,
      <><b>Include subdomains off</b> (default): only that exact host is internal. <C>insurancemarket.gr</C> without <C>www</C> counts as external.</>,
      <><b>Include subdomains on</b>: the root host without <C>www.</C>, plus any subdomain of it, is internal (<C>insurancemarket.gr</C>, <C>blog.insurancemarket.gr</C>). Lookalikes such as <C>insurancemarket.gr.evil.com</C> are never internal.</>,
      <><b>Automatic redirect host.</b> Before auditing, the auditor sends a request to the home page and to <C>/robots.txt</C>. If either ends on a different host (for example after a rebrand), that host is added to the scope too. The report lists it under <C>config.autoScopeHosts</C>.</>
    ],
    verify: [
      <>Open <C>config</C> in the JSON report to see <C>subdomainPolicy</C>, <C>scopeHosts</C> and <C>autoScopeHosts</C> for that run.</>
    ],
    wrongWhen: [
      <>With subdomains off, links from <C>www.site.gr</C> to <C>site.gr</C> count as external, so broken links on the non-www host are not reported.</>,
      <>If the site's own redirect is hidden behind bot protection, the redirect host cannot be detected automatically.</>
    ]
  },

  // ───────────────────────────── PER-PAGE ─────────────────────────────
  {
    id: "content-type",
    group: "page",
    title: "Content type and which pages get analysed",
    source: "src/auditPage.js (auditPage)",
    summary: <>On-page checks run only on HTML pages that loaded successfully.</>,
    codes: [
      { code: "NOT_HTML", severity: "warning", when: <>The <C>Content-Type</C> header is not <C>text/html</C> or <C>application/xhtml+xml</C> (for example a PDF in the sitemap).</> }
    ],
    how: [
      <>A page is analysed only when the response arrived, was not a bot challenge, is HTML, and has a status below 400.</>,
      <>Pages returning 4xx or 5xx keep their status and redirect data but get no title, description or other on-page findings.</>,
      <>HTML is parsed with <C>cheerio</C> (the <C>parse5</C> HTML5 parser), the same parsing rules browsers use. Attribute order, quote style and upper/lower case do not matter.</>
    ],
    verify: [<><C>curl -sI URL</C> shows the <C>Content-Type</C> header.</>],
    wrongWhen: [<>A server that sends HTML with a wrong header such as <C>text/plain</C> is reported as NOT_HTML and skipped.</>]
  },
  {
    id: "title",
    group: "page",
    title: "Title",
    source: "src/html.js (extractSeo), src/auditPage.js",
    summary: <>Reads the page title from the <C>{"<title>"}</C> element inside <C>{"<head>"}</C>.</>,
    codes: [
      { code: "TITLE_MISSING", severity: "error", when: <>No <C>{"<title>"}</C> directly inside <C>{"<head>"}</C>.</> },
      { code: "TITLE_EMPTY", severity: "error", when: <>The title is present but contains only whitespace.</> },
      { code: "TITLE_LONG", severity: "info", when: <>More than 60 characters.</> },
      { code: "TITLE_MULTIPLE", severity: "warning", when: <>More than one <C>{"<title>"}</C> in <C>{"<head>"}</C>. The first one is reported.</> }
    ],
    how: [
      <>Selector: <C>{"head > title"}</C>, first match. Line breaks and repeated spaces are collapsed to single spaces and the ends are trimmed. Entities like <C>&amp;amp;</C> are decoded.</>,
      <><C>{"<title>"}</C> elements inside inline SVG icons are ignored, because they are not in <C>{"<head>"}</C>.</>,
      <>Length is counted in characters (Unicode code points), so Greek and emoji count as one each.</>
    ],
    verify: [<>In <C>view-source:</C>, search (Ctrl+F) for <C>{"<title"}</C>. In the DevTools console, <C>document.title</C> shows what a browser uses, but remember it includes JavaScript changes.</>],
    wrongWhen: [
      <>A <C>{"<title>"}</C> placed in <C>{"<body>"}</C> is reported as missing, although browsers still show it in the tab. (Verified against the parser.)</>,
      <>A title set by JavaScript is reported as missing (see <a href="#check-overview">How an audit runs</a>).</>,
      <>TITLE_LONG is a rough guide. Google cuts titles by pixel width (about 600 px), not by character count, so a 62-character title of narrow letters may display in full.</>
    ]
  },
  {
    id: "description",
    group: "page",
    title: "Meta description",
    source: "src/html.js (extractSeo), src/auditPage.js",
    summary: <>Reads <C>{'<meta name="description" content="…">'}</C>.</>,
    codes: [
      { code: "DESCRIPTION_MISSING", severity: "warning", when: <>No meta tag with name <C>description</C>.</> },
      { code: "DESCRIPTION_EMPTY", severity: "warning", when: <>The tag exists but <C>content</C> is empty or missing.</> },
      { code: "DESCRIPTION_LONG", severity: "info", when: <>More than 160 characters.</> },
      { code: "DESCRIPTION_MULTIPLE", severity: "warning", when: <>More than one description tag. The first one is reported.</> }
    ],
    how: [
      <>Matches any <C>{"<meta>"}</C> whose <C>name</C> equals <C>description</C> in any letter case, in any attribute order, anywhere in the document.</>,
      <>Whitespace is collapsed and trimmed; entities are decoded. Length is in characters.</>,
      <><C>og:description</C> and <C>twitter:description</C> are not considered.</>
    ],
    verify: [<>In <C>view-source:</C>, search for <C>name="description"</C>.</>],
    wrongWhen: [
      <>Unlike the title check, a description tag inside <C>{"<body>"}</C> is still counted. That is lenient: some search engines may ignore it there.</>,
      <>Google often writes its own snippet regardless of the description, so DESCRIPTION_LONG matters less than the code suggests.</>
    ]
  },
  {
    id: "canonical",
    group: "page",
    title: "Canonical tag",
    source: "src/html.js (extractSeo), src/auditPage.js",
    summary: <>Reads <C>{'<link rel="canonical" href="…">'}</C> and compares it with the page's final URL.</>,
    codes: [
      { code: "CANONICAL_MISSING", severity: "warning", when: <>No canonical link element.</> },
      { code: "CANONICAL_CONFLICT", severity: "error", when: <>Several canonical tags pointing to different URLs.</> },
      { code: "CANONICAL_DUPLICATE", severity: "info", when: <>Several canonical tags, all pointing to the same URL.</> },
      { code: "CANONICAL_INVALID", severity: "error", when: <>The href is empty, cannot be parsed as a URL, or resolves to something other than http(s).</> },
      { code: "CANONICAL_NOT_IN_HEAD", severity: "warning", when: <>The canonical element sits inside <C>{"<body>"}</C>.</> }
    ],
    how: [
      <>Matches <C>{"<link>"}</C> elements whose <C>rel</C> contains the word <C>canonical</C> among its space-separated values, so <C>rel="canonical nofollow"</C> also matches.</>,
      <>A relative href is resolved against the page's final URL, or against <C>{"<base href>"}</C> if the page has one.</>,
      <>The first canonical is compared with the final URL after removing the <C>#fragment</C>, lowercasing the host and dropping default ports. The result is <b>self</b>, <b>other</b> or <b>missing</b> (shown as <C>indexability.canonicalStatus</C>).</>,
      <>The path, trailing slash and query string must match exactly for <b>self</b>.</>
    ],
    verify: [<>In <C>view-source:</C>, search for <C>canonical</C>. Compare the href character by character with the URL in the address bar, including the trailing slash.</>],
    wrongWhen: [
      <>A canonical sent as an HTTP header (<C>{"Link: <…>; rel=\"canonical\""}</C>) is not read, so the page is reported as CANONICAL_MISSING. Check with <C>curl -sI URL</C>.</>,
      <>A canonical of <C>/page/</C> on the URL <C>/page</C> counts as pointing to another URL. (Verified.) This is technically correct, since they are different URLs, but it is often harmless when one redirects to the other.</>,
      <>Canonicals added by JavaScript are not seen.</>
    ]
  },
  {
    id: "robots",
    group: "page",
    title: "Meta robots, X-Robots-Tag and indexability",
    source: "src/html.js (parseXRobotsTag), src/auditPage.js (evaluateIndexability)",
    summary: <>Works out whether Google is allowed to index the page, from the signals on the page itself.</>,
    codes: [
      { code: "ROBOTS_CONFLICT", severity: "warning", when: <>The <C>X-Robots-Tag</C> header says <C>noindex</C> while the meta robots tag explicitly says <C>index</C>. The noindex wins.</> }
    ],
    how: [
      <>Meta tags: every <C>{"<meta>"}</C> named <C>robots</C> or <C>googlebot</C> (any case). The <C>content</C> is split on commas into lowercase directives.</>,
      <>HTTP header: <C>X-Robots-Tag</C>. Values without a prefix apply to every crawler; values like <C>googlebot: noindex</C> apply to that crawler. Only general and googlebot directives are evaluated.</>,
      <><C>noindex</C> or <C>none</C> in either place makes the page noindex.</>,
      <>A page is reported <b>indexable</b> only when: the status is 200, there was no redirect, there is no noindex, and the canonical is self or missing. Otherwise <C>indexability.reasons</C> lists each reason.</>
    ],
    verify: [
      <>Meta: search <C>view-source:</C> for <C>robots</C>.</>,
      <>Header:<Pre>{`curl -sI https://www.example.gr/page | grep -i x-robots-tag`}</Pre></>,
      <>For Google's own verdict, use URL Inspection in Google Search Console.</>
    ],
    wrongWhen: [
      <>robots.txt is not considered. A page blocked by <C>Disallow</C> can be reported as indexable.</>,
      <>Directives for other crawlers (<C>bingbot</C> and others) are ignored.</>,
      <>"Indexable" means "nothing on the page forbids it". Google may still choose not to index it, for example as a duplicate.</>
    ]
  },
  {
    id: "h1",
    group: "page",
    title: "H1 headings",
    source: "src/html.js (extractSeo), src/auditPage.js",
    summary: <>Counts every <C>{"<h1>"}</C> element and reads its text.</>,
    codes: [
      { code: "H1_MISSING", severity: "warning", when: <>No <C>{"<h1>"}</C> anywhere in the HTML.</> },
      { code: "H1_MULTIPLE", severity: "info", when: <>More than one <C>{"<h1>"}</C>. This is allowed in HTML5 and Google says it is fine, so it is only info.</> },
      { code: "H1_EMPTY", severity: "warning", when: <>An <C>{"<h1>"}</C> with no text.</> }
    ],
    how: [<>Every <C>{"<h1>"}</C> element counts, including hidden ones. Its text is the combined text of everything inside it, with whitespace collapsed.</>],
    verify: [<>In <C>view-source:</C>, search for <C>{"<h1"}</C> and count matches. Or run <C>document.querySelectorAll("h1")</C> in the console, which also counts headings added by JavaScript.</>],
    wrongWhen: [
      <>An <C>{"<h1>"}</C> that contains only an image (such as a logo) is reported as H1_EMPTY, because image <C>alt</C> text is not counted as text. Google does use that alt text. (Verified.)</>,
      <>Headings hidden with CSS, or headings added by JavaScript, are counted or missed differently than in the browser.</>,
      <>Styled text that looks like a heading but uses a <C>{"<div>"}</C> or <C>{"<h2>"}</C> does not count.</>
    ]
  },
  {
    id: "images",
    group: "page",
    title: "Image alt text and image URLs",
    source: "src/html.js (extractSeo, parseSrcset), src/auditPage.js",
    summary: <>Checks that every <C>{"<img>"}</C> has an <C>alt</C> attribute, and collects every image URL for the <a href="#check-broken-links">broken-image check</a>.</>,
    codes: [
      { code: "IMG_ALT_MISSING", severity: "warning", when: <>At least one <C>{"<img>"}</C> has no <C>alt</C> attribute at all.</> }
    ],
    how: [
      <>Three states: <b>missing</b> (no attribute, reported), <b>empty</b> (<C>alt=""</C>, treated as a decorative image and not reported), <b>present</b>.</>,
      <>An empty alt is correct for decorative images: it tells screen readers to skip them. That is why it is not an issue.</>,
      <>The image shown for a missing alt comes from <C>src</C>, or <C>data-src</C> for lazy-loaded images.</>,
      <>For the broken-image check, URLs are collected from <C>src</C>, <C>data-src</C>, <C>srcset</C> and <C>data-srcset</C> on <C>{"<img>"}</C>, and <C>srcset</C> / <C>data-srcset</C> on <C>{"<picture><source>"}</C>. They are resolved like links and deduplicated into <C>images.urls</C>. <C>data:</C> URIs are skipped.</>,
      <><C>srcset</C> is split with the HTML parsing rules: a URL runs until whitespace, so commas inside it (for example Cloudinary's <C>/w_400,h_300/</C>) are kept, and a comma after the URL or its descriptor ends the candidate.</>
    ],
    verify: [
      <>Run in the console:<Pre>{`[...document.querySelectorAll("img:not([alt])")].map(i => i.src)`}</Pre>Compare with the list in the page's detail panel. The console version also includes images added by JavaScript.</>,
      <>All image URLs the browser chose to load: DevTools → Network → filter <C>Img</C>. The auditor checks every <C>srcset</C> candidate, not only the one the browser picked.</>
    ],
    wrongWhen: [
      <>CSS background images, inline <C>{"<svg>"}</C> and images inserted by JavaScript are not checked.</>,
      <>The check cannot judge quality: an alt of <C>"image"</C> passes.</>
    ]
  },
  {
    id: "links",
    group: "page",
    title: "Links on the page",
    source: "src/html.js (extractSeo), src/url.js (classifyLink), src/linkChecks.js (checkOtherLinks)",
    summary: <>Collects every link for the site-wide link checks, and validates email, phone and other non-page links on the page itself, without any network request.</>,
    codes: [
      { code: "MAILTO_INVALID", severity: "warning", when: <>A <C>mailto:</C> address has no <C>@</C>, nothing before or after it, characters an unquoted address cannot hold (whitespace, <C>{'< > ( ) [ ] \\ , ; : "'}</C>), a local part over 64 characters or with a leading, trailing or double dot, or a domain that is not a valid hostname with a TLD. Each address in a comma-separated list is checked. <C>mailto:?subject=…</C> with no address is valid.</> },
      { code: "TEL_INVALID", severity: "warning", when: <>A <C>tel:</C> or <C>sms:</C> number, after removing spaces, dots, dashes, brackets and anything from <C>;</C> or <C>?</C> on, contains anything other than digits and a leading <C>+</C>, has a <C>+</C> elsewhere, or has fewer than 3 or more than 15 digits (the E.164 maximum).</> },
      { code: "LINK_INVALID", severity: "warning", when: <>An <C>{"<a>"}</C> has an empty <C>href</C>, or one that cannot be parsed as a URL.</> },
      { code: "LINK_JAVASCRIPT", severity: "info", when: <>An <C>href</C> starts with <C>javascript:</C>. Crawlers cannot follow it.</> }
    ],
    how: [
      <>Every <C>{"<a href>"}</C> is resolved against the page URL (or <C>{"<base href>"}</C>), exactly as a browser would. <C>quote</C> on <C>/car</C> becomes <C>/quote</C>; on <C>/car/</C> it becomes <C>/car/quote</C>.</>,
      <>The <C>#fragment</C> is removed and duplicates are counted once. The query string is kept, because <C>?page=2</C> can be a different page.</>,
      <>Each link is classified as <b>internal</b> or <b>external</b> (see <a href="#check-scope">Crawl scope</a>), <b>other</b> (<C>mailto:</C>, <C>tel:</C>, <C>sms:</C>, <C>javascript:</C>, <C>#anchor</C> and other schemes) or <b>invalid</b> (empty or unparsable href).</>,
      <>Links with <C>rel="nofollow"</C> are recorded separately in <C>links.nofollow</C>.</>,
      <>Email addresses are percent-decoded first, and internationalised domains are converted to punycode before the hostname check, so <C>info%40example.gr</C> and Greek domains such as <C>παράδειγμα.ελ</C> pass. Whether the domain exists is a network check, done once per domain in the <a href="#check-broken-links">site-wide step</a>.</>,
      <>Results are stored per page in <C>otherLinks</C> (<C>invalidEmail</C>, <C>invalidPhone</C>, <C>malformed</C>, <C>javascript</C>, <C>emailDomains</C>).</>
    ],
    verify: [
      <>Console: <C>{`new Set([...document.links].map(a => a.href.split("#")[0])).size`}</C> gives a similar total of unique links.</>,
      <>Email and phone links as written in the page:<Pre>{`[...document.querySelectorAll('a[href^="mailto:"], a[href^="tel:"]')].map(a => a.getAttribute("href"))`}</Pre></>
    ],
    wrongWhen: [
      <>Navigation built with JavaScript (click handlers, <C>{"<button>"}</C> elements, menus loaded after page load) is not seen, so broken links there are not found.</>,
      <>Phone numbers are checked for form, not against a numbering plan: a well-formed but unassigned number passes.</>
    ]
  },
  {
    id: "structured-data",
    group: "page",
    title: "Structured data (JSON-LD)",
    source: "src/schema/validate.js, src/schema/rules.js",
    summary: <>Checks JSON-LD in four separate layers, so a syntax error is never confused with a missing Google property.</>,
    codes: [
      { code: "JSONLD_INVALID_JSON", severity: "error", when: <>A <C>{'<script type="application/ld+json">'}</C> block is empty or is not valid JSON. Google ignores such blocks entirely.</> },
      { code: "JSONLD_SCHEMA_ERRORS", severity: "error", when: <>A top-level item is not an object, has no <C>@context</C>, or has neither <C>@type</C> nor <C>@graph</C>.</> },
      { code: "JSONLD_GOOGLE_REQUIRED_MISSING", severity: "warning", when: <>An entity of a type Google documents lacks a property that Google lists as required.</> }
    ],
    how: [
      <><b>Layer 1, JSON syntax:</b> each block is parsed with <C>JSON.parse</C>.</>,
      <><b>Layer 2, Schema.org structure:</b> <C>@context</C> must exist (and should mention schema.org); each item needs <C>@type</C> or <C>@graph</C>. Type and property <i>names</i> are not checked against the Schema.org vocabulary.</>,
      <><b>Layer 3, Google features:</b> every object with an <C>@type</C> is found, including nested ones. Objects sharing the same <C>@id</C> are merged first, so a short reference like <C>{'{"@id":"#org"}'}</C> is checked with the full data. The type is looked up in a hand-written rules table (Product, Article, BreadcrumbList, LocalBusiness and subtypes such as InsuranceAgency, AggregateRating, Review, Organization, WebSite, Event, JobPosting, Recipe, VideoObject, FAQPage, HowTo).</>,
      <><b>Layer 4, verdict:</b> <i>Required properties present</i>, <i>Missing required properties</i>, <i>Restricted by Google</i> (FAQ: shown only for government and health sites since August 2023) or <i>Deprecated by Google</i> (HowTo).</>,
      <>Missing <b>recommended</b> properties are listed as notes, never as errors. Optional properties with defaults (such as <C>bestRating</C>, default 5) are not flagged. A nested <C>AggregateRating</C> or <C>Review</C> does not need <C>itemReviewed</C>, because its parent is the reviewed item.</>
    ],
    verify: [
      <>Paste the page URL into Google's <a href="https://search.google.com/test/rich-results" target="_blank" rel="noopener noreferrer">Rich Results Test</a>. This is the final word on Google eligibility.</>,
      <>Paste it into the <a href="https://validator.schema.org/" target="_blank" rel="noopener noreferrer">Schema Markup Validator</a> to check type and property names.</>
    ],
    wrongWhen: [
      <><b>"Required properties present" does not mean the page will get a rich result.</b> Google also applies content policies and quality signals that this tool cannot see.</>,
      <>Value formats are not checked: a wrong date format or a relative image URL passes.</>,
      <>Microdata and RDFa markup are ignored; only JSON-LD is read.</>,
      <>The rules table is maintained by hand from Google's documentation and can fall behind when Google changes its requirements.</>,
      <>JSON-LD injected by JavaScript (some tag managers do this) is not seen.</>
    ]
  },

  // ───────────────────────────── SITE-WIDE ─────────────────────────────
  {
    id: "duplicates",
    group: "site",
    title: "Duplicate titles and descriptions",
    source: "src/siteChecks.js (findDuplicates)",
    summary: <>Finds groups of pages that share exactly the same title or meta description.</>,
    how: [
      <>Only pages that loaded with status 200, were analysed, are not noindex, and are not canonicalised to another URL take part. Those excluded pages are not competing in search, so sharing a title is harmless for them.</>,
      <>Pages that redirect to the same final URL are counted once, so a page is never a duplicate of itself.</>,
      <>Comparison is exact after lowercasing and collapsing whitespace: <C>"Car  Insurance"</C> and <C>"car insurance"</C> match; <C>"Car insurance |"</C> does not.</>
    ],
    verify: [<>Open each URL in a group and compare titles in <C>view-source:</C>. Google Search Console also reports duplicate pages under Pages → indexing reasons.</>],
    wrongWhen: [
      <>Near-duplicates (one extra word or punctuation) are not detected.</>,
      <>Intentional duplicates, such as paginated listing pages, are reported even if that is acceptable for your site.</>,
      <>Only audited pages are compared. With a page limit, duplicates outside the audited set are missed.</>
    ]
  },
  {
    id: "canonical-targets",
    group: "site",
    title: "Canonical destination problems",
    source: "src/siteChecks.js (runSiteChecks)",
    summary: <>When a page's canonical points to another URL, the auditor checks that the target is a healthy, indexable page.</>,
    how: [
      <>Every distinct canonical target that is not the page itself is checked once. If the target was already audited, that result is reused; otherwise it is fetched and fully audited.</>,
      <>Reported problems: the target is unreachable, redirects, does not return 200, is noindex, or has its own canonical pointing elsewhere (a canonical chain).</>,
      <>If the target is blocked by bot protection, it is listed under <C>site.unverifiedCanonicals</C> instead of being reported as a problem.</>
    ],
    verify: [<>Open the canonical URL in the browser, and check it with <C>curl -sIL</C>. It should return 200 directly, with no redirect, and should not contain <C>noindex</C>.</>],
    wrongWhen: [<>A target that redirects only for bots, or only from your location, is reported as a problem even if visitors and Google reach it directly.</>]
  },
  {
    id: "indexability-conflicts",
    group: "site",
    title: "Indexability conflicts",
    source: "src/siteChecks.js (runSiteChecks)",
    summary: <>A sitemap should list only pages you want indexed. This check finds sitemap URLs whose own signals say "don't index me".</>,
    how: [
      <>For every audited URL that came from the sitemap, it reports: unreachable, redirects, non-200 status, noindex, or canonical to another URL.</>,
      <>It also reports noindex combined with a canonical to another URL on the same page, which sends Google mixed signals.</>,
      <>Pages blocked by bot protection are skipped, because their signals come from the firewall, not from the site.</>
    ],
    verify: [<>For a listed URL, confirm it is in the sitemap, then check its status, meta robots and canonical as described in the sections above.</>],
    wrongWhen: [
      <>Sitemap URLs that differ from the final URL only by a trailing slash or <C>http</C> versus <C>https</C> are reported as redirects. That is correct (sitemaps should list final URLs) but the fix is usually trivial.</>,
      <>In single page mode the sitemap is not read, so this check finds nothing.</>
    ]
  },
  {
    id: "broken-links",
    group: "site",
    title: "Broken links, images and email domains",
    source: "src/siteChecks.js (runSiteChecks), src/linkChecks.js (checkUrl, verdict, checkEmailDomain)",
    summary: <>Tests every unique internal link, external link and image found on the audited pages, and looks up the domain of every email link.</>,
    codes: [
      { code: "LINK_BROKEN", severity: "error", when: <>Added to each page that contains at least one broken internal or external link. The message lists the first three with their reason.</> },
      { code: "IMG_BROKEN", severity: "error", when: <>Added to each page that contains at least one broken image.</> },
      { code: "EMAIL_DOMAIN_INVALID", severity: "warning", when: <>Added to each page with an email link whose domain has no MX, A or AAAA record.</> }
    ],
    how: [
      <>Links and images from all analysed pages are combined and deduplicated, and the pages containing each one are remembered (shown as "linked from N pages"). Each URL is requested once per audit.</>,
      <><b>Request:</b> <C>HEAD</C> first. If it fails or returns 400 or above, the URL is retried with a <C>GET</C> that stops reading once the headers arrive, because some servers answer <C>HEAD</C> wrongly. Redirects are followed and recorded. Network errors, 5xx and 429 are retried (2 retries by default).</>,
      <><b>Internal links</b> (<i>Check internal links</i>): a link to a page that was already audited reuses that result. <b>Broken:</b> no response, or a final status of 400 or higher. <b>Redirecting:</b> works but goes through at least one redirect; reported as info, since linking straight to the final URL only saves a hop.</>,
      <><b>External links</b> (<i>Check external links</i>, 8 at a time): broken on no response or a status of 400 or higher, except 401, 403, 429 and 999 (LinkedIn's bot answer). Those mean the site refused an automated check, so they go to <C>unverifiedExternalLinks</C> and are not counted as broken.</>,
      <><b>Images</b> (<i>Check that images load</i>): the same rules, plus broken when the response's <C>Content-Type</C> is not <C>image/*</C>. That catches a "not found" HTML page served with status 200. Refused checks go to <C>unverifiedImages</C>.</>,
      <><b>Email domains</b> (run with the external check): one DNS lookup per unique domain. MX first; if there is none, A and then AAAA, the fallback mail servers use (RFC 5321). Only a definite "does not exist" answer counts; timeouts and other DNS errors are ignored.</>,
      <>Findings are also added as issues to every page that contains them, so they count in the summary and appear in the page's <b>Links and images</b> section.</>,
      <>Report fields: <C>brokenInternalLinks</C>, <C>redirectingInternalLinks</C>, <C>brokenExternalLinks</C>, <C>unverifiedExternalLinks</C>, <C>invalidEmailDomains</C>, <C>brokenImages</C>, <C>unverifiedImages</C>, with counts in <C>linkCheck</C>. On the command line, <C>--no-link-check</C>, <C>--no-external-check</C> and <C>--no-image-check</C> skip each part.</>
    ],
    verify: [
      <>Check one link or image with:<Pre>{`curl -sIL -A "${UA}" https://www.example.gr/linked-page`}</Pre>For an image, look at the last <C>content-type</C> line. Then open one of the listed source pages and search its <C>view-source:</C> for the URL.</>,
      <>Check an email domain with:<Pre>{`nslookup -type=mx example.gr`}</Pre></>
    ],
    wrongWhen: [
      <>Internal pages behind a login return 401 or 403 and are reported as broken. Unlike external links, internal 401 and 403 are not treated as refused checks.</>,
      <>Rate limiting that lasts through the retries (429) is reported as broken for internal links. Re-check those links individually.</>,
      <>External sites that block bots with 404 or 503 instead of 403 are reported as broken. Open them to confirm.</>,
      <>An image served with a wrong <C>Content-Type</C> (for example <C>application/octet-stream</C>) is reported as broken, although some browsers still show it.</>,
      <>If a site is behind bot protection, links may return a 200 challenge page and look fine even when the real page is broken.</>,
      <>The email check proves that the domain can receive mail, not that the mailbox exists.</>
    ]
  }
];
