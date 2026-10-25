import { K, T, type GuideSection } from "./shared";

// Plain-language guide (English). Section ids and issue codes must match guide/el.tsx.
export const GUIDE_EN: GuideSection[] = [
  {
    id: "page-loads",
    title: "Does the page load?",
    techId: "fetch",
    what: <>Before anything else, the tool opens every page from your sitemap, the way a browser would, and notes what the website answers.</>,
    why: <>Google can only show pages that open correctly. A page that shows an error, or sends visitors somewhere else first, wastes Google's time and can drop out of search results.</>,
    looksAt: [
      <>Whether the page opens at all, or the website doesn't answer within 15 seconds.</>,
      <>The status code the website sends. 200 means "OK". 404 means "not found". 500 means "the server has a problem".</>,
      <>Whether the page sends you to a different address first (a <b>redirect</b>), and how many times.</>,
      <>Whether the address is a normal web page or a file such as a PDF.</>
    ],
    issues: [
      { code: "FETCH_FAILED", meaning: <>The tool couldn't open the page at all, even after retrying.</>, fix: <>Open the address in your browser. If it doesn't work there either, tell the web team. If it works for you, the website may be blocking the tool; see the next section.</> },
      { code: "HTTP_STATUS", meaning: <>The page opened, but with an error code instead of "OK". 404 is the most common: the page no longer exists.</>, fix: <>If the page was removed on purpose, take it out of the sitemap or redirect it to the closest page that still exists. If it should exist, tell the web team.</> },
      { code: "REDIRECT", meaning: <>The address in the sitemap sends visitors to another address.</>, fix: <>Put the final address in the sitemap instead. The redirect itself can stay for old links.</> },
      { code: "NOT_HTML", meaning: <>The address is a file (for example a PDF), not a web page, so the other checks were skipped.</>, fix: <>Usually nothing to fix. If the file shouldn't appear in Google, remove it from the sitemap.</> }
    ],
    selfCheck: [<>Paste the address into your browser. Watch the address bar: if it changes after the page loads, there was a redirect.</>],
    goodToKnow: [
      <>The tool runs from your computer's internet connection. A slow or unusual connection can cause failures that real visitors never see. Try the page again before reporting it.</>,
      <>Response times depend on your network too. Use them to compare pages with each other, not as an official speed score.</>
    ]
  },
  {
    id: "blocked",
    title: "Blocked by website protection",
    techId: "bot",
    what: <>Some websites use security services that stop automated tools. Instead of the page, they show a short "checking your browser" screen.</>,
    why: <>If the tool only sees that screen, it can't check the real page. Without this check, every page would look broken.</>,
    looksAt: [<>Whether the page is a known security screen (Imperva, Cloudflare and others) with almost no text on it.</>],
    issues: [
      { code: "BLOCKED_BY_BOT_PROTECTION", meaning: <>The tool got the security screen instead of the page, so this page was <b>not checked</b>. This is not an SEO problem on your website.</>, fix: <>Ask your IT or security team to allow the tool through the protection. Then run the audit again.</> }
    ],
    selfCheck: [<>Visitors don't see this screen, so there's nothing to check in your browser. The page itself is fine.</>],
    goodToKnow: [<>If many pages show "missing title" or "noindex" at the same time, a security screen the tool doesn't recognise could be the cause. Mention it to the web team.</>]
  },
  {
    id: "title",
    title: "Page title",
    techId: "title",
    what: <>The page title is the text shown in the browser tab and, usually, as the blue clickable headline in Google results.</>,
    why: <>It's one of the strongest signals Google uses to understand a page, and it's the first thing people read in search results. A clear title brings more clicks.</>,
    looksAt: [
      <>Whether the page has a title.</>,
      <>Whether the title has any text in it.</>,
      <>How long it is, counted in letters.</>,
      <>Whether the page accidentally has more than one title.</>
    ],
    issues: [
      { code: "TITLE_MISSING", meaning: <>The page has no title.</>, fix: <>Add a title that says what the page is about, for example "Car insurance online – compare prices | Brand".</> },
      { code: "TITLE_EMPTY", meaning: <>A title exists but it's blank.</>, fix: <>Fill in the title in your content management system.</> },
      { code: "TITLE_LONG", meaning: <>The title is over 60 letters, so Google may cut it off with "…".</>, fix: <>Put the most important words first. Shorten it if the important part is cut off.</> },
      { code: "TITLE_MULTIPLE", meaning: <>The page has more than one title in its code. Google picks one, and maybe not the one you want.</>, fix: <>Ask the web team to remove the extra title. Often a plugin or theme adds a second one.</> }
    ],
    selfCheck: [
      <>Hover over the browser tab to read the full title.</>,
      <>To see it exactly as the tool does: press <K>Ctrl</K>+<K>U</K> to open the page's source code, then <K>Ctrl</K>+<K>F</K> and search for <T>{"<title"}</T>.</>
    ],
    goodToKnow: [
      <>"Long title" is only a hint. Google cuts titles by width, not by letter count, so a slightly longer title may still fit.</>,
      <>On some websites the title is added after the page loads. The tool can't see that and may report "missing" even though the tab shows a title. If the title is in the tab but not in the source code (<K>Ctrl</K>+<K>U</K>), tell the web team: Google may see it late or not at all.</>
    ]
  },
  {
    id: "description",
    title: "Meta description",
    techId: "description",
    what: <>A short summary of the page, written for search results. Visitors don't see it on the page itself; Google often shows it as the grey text under the title.</>,
    why: <>A good description works like a small ad: it tells people why they should click. Without one, Google picks text from the page itself, which may not read well.</>,
    looksAt: [
      <>Whether the page has a description.</>,
      <>Whether it has any text in it.</>,
      <>How long it is (over 160 letters gets cut off).</>,
      <>Whether there is more than one.</>
    ],
    issues: [
      { code: "DESCRIPTION_MISSING", meaning: <>The page has no description.</>, fix: <>Write one or two sentences about what the page offers and why someone should click.</> },
      { code: "DESCRIPTION_EMPTY", meaning: <>A description exists but it's blank.</>, fix: <>Fill it in, in your content management system or SEO plugin.</> },
      { code: "DESCRIPTION_LONG", meaning: <>The description is over 160 letters and may be cut off.</>, fix: <>Keep the key message in the first 150 letters.</> },
      { code: "DESCRIPTION_MULTIPLE", meaning: <>The page has more than one description.</>, fix: <>Ask the web team to remove the extra one. This is often caused by two SEO plugins running at once.</> }
    ],
    selfCheck: [<>Press <K>Ctrl</K>+<K>U</K>, then <K>Ctrl</K>+<K>F</K> and search for <T>name="description"</T>. The text after <T>content=</T> is the description.</>],
    goodToKnow: [<>Google sometimes shows different text even when a good description exists, depending on what was searched. That's normal.</>]
  },
  {
    id: "h1",
    title: "Main heading (H1)",
    techId: "h1",
    what: <>The H1 is the main heading of the page, usually the big text at the top of the content.</>,
    why: <>It helps Google and visitors understand the page's topic at a glance. It's also important for people using screen readers.</>,
    looksAt: [
      <>Whether the page has a main heading.</>,
      <>How many it has.</>,
      <>Whether any of them is empty.</>
    ],
    issues: [
      { code: "H1_MISSING", meaning: <>The page has no main heading.</>, fix: <>Set the page's main title as "Heading 1" in your editor. Text that only looks big doesn't count.</> },
      { code: "H1_MULTIPLE", meaning: <>The page has several main headings. This is allowed; it's only a note.</>, fix: <>Optional: keep one main heading and turn the others into "Heading 2".</> },
      { code: "H1_EMPTY", meaning: <>A main heading exists but has no text.</>, fix: <>Add text to it, or remove it.</> }
    ],
    selfCheck: [<>Press <K>Ctrl</K>+<K>U</K>, then <K>Ctrl</K>+<K>F</K> and search for <T>{"<h1"}</T>. The search box shows how many were found.</>],
    goodToKnow: [
      <>If the main heading is a logo image, the tool reports it as "empty" because it only reads text. If the image has a description (alt text), Google understands it, so this is not a real problem.</>,
      <>Text that looks like a big heading but isn't marked as Heading 1 in the code doesn't count.</>
    ]
  },
  {
    id: "images",
    title: "Images: descriptions and broken images",
    techId: "images",
    what: <>Alt text is a short written description of an image, stored with the image but not shown on screen. The tool also checks that every image actually loads.</>,
    why: <>Screen readers read the description aloud to blind visitors, and Google uses it to understand images and show them in Google Images. A broken image shows an empty box or a broken-image icon, which looks careless and loses whatever the image was meant to say.</>,
    looksAt: [
      <>Every image on the page, and whether it has a description.</>,
      <>An intentionally empty description is treated as "decorative image, skip it". That's correct and is not reported.</>,
      <>Whether each image file opens. This includes images that load only when you scroll down, and the different sizes a page offers for phones and large screens.</>
    ],
    issues: [
      { code: "IMG_ALT_MISSING", meaning: <>One or more images have no description at all. The page's details list which ones.</>, fix: <>In your editor, fill in the "Alternative text" field for each image. Describe what it shows, for example "Family in a car on a coastal road". For purely decorative images, leave it empty on purpose.</> },
      { code: "IMG_BROKEN", meaning: <>One or more images on the page don't load. The file is missing, the server gives an error, or the address leads to a web page instead of an image. The page's details list each image with the reason.</>, fix: <>Upload the image again, or correct its address in your editor. If the image was removed on purpose, take it off the page too.</> }
    ],
    selfCheck: [
      <>In most content management systems, click an image to see its "Alt text" field.</>,
      <>Open the page and look for empty boxes or broken-image icons. To test one image, copy its address from the page's details and open it in a new tab.</>
    ],
    goodToKnow: [
      <>Background images and icons drawn with code are not checked.</>,
      <>The tool doesn't judge quality. A description like "image" passes, even though it doesn't help anyone.</>,
      <>Some image services refuse automated checks. Those images are listed separately as "Images that refused the check" and are not counted as broken. Open them to confirm they work.</>
    ]
  },
  {
    id: "canonical",
    title: "Preferred address (canonical)",
    techId: "canonical",
    what: <>When the same content can be reached at several addresses, the canonical tag tells Google which one is the "official" address to show in search results.</>,
    why: <>Without it, Google may split a page's ranking strength across several addresses, or show an address you didn't intend.</>,
    looksAt: [
      <>Whether the page names a preferred address.</>,
      <>Whether that address is valid.</>,
      <>Whether there are several that disagree.</>,
      <>Whether it points to the page itself or to a different page.</>
    ],
    issues: [
      { code: "CANONICAL_MISSING", meaning: <>The page doesn't say which address is preferred.</>, fix: <>Most SEO plugins add this automatically. Ask the web team to switch it on, pointing each page to itself.</> },
      { code: "CANONICAL_CONFLICT", meaning: <>The page names several different preferred addresses. Google may ignore all of them.</>, fix: <>Ask the web team to keep just one.</> },
      { code: "CANONICAL_DUPLICATE", meaning: <>The same preferred address appears twice. Harmless, only a note.</>, fix: <>Optional clean-up for the web team.</> },
      { code: "CANONICAL_INVALID", meaning: <>The preferred address is blank or isn't a real web address.</>, fix: <>Ask the web team to correct it.</> },
      { code: "CANONICAL_NOT_IN_HEAD", meaning: <>The tag is in the wrong part of the page's code, so Google ignores it.</>, fix: <>Ask the web team to move it to the page's head section.</> }
    ],
    selfCheck: [<>Press <K>Ctrl</K>+<K>U</K>, then <K>Ctrl</K>+<K>F</K> and search for <T>canonical</T>. Compare the address after <T>href=</T> with the one in your address bar.</>],
    goodToKnow: [
      <>Small differences count: <T>/car</T> and <T>/car/</T> (with a slash at the end) are different addresses to Google. That's usually easy to fix and rarely urgent.</>,
      <>Some websites send this information in a way the tool can't read. If you're told it's missing but the web team says it's set, they're probably right; ask them to confirm.</>
    ]
  },
  {
    id: "indexing",
    title: "Can Google show the page? (indexing)",
    techId: "robots",
    what: <>A page can tell Google "don't show me in search results" with a <b>noindex</b> instruction. The tool works out whether each page allows Google to show it.</>,
    why: <>A noindex left on an important page by mistake (often after a website launch) makes that page disappear from Google completely.</>,
    looksAt: [
      <>Whether the page contains a noindex instruction, written either in the page or sent by the server.</>,
      <>Whether the page loads without errors or redirects.</>,
      <>Whether the page points Google to a different preferred address.</>,
      <>Only if all of these are fine is the page marked "Indexable: Yes" in its details.</>
    ],
    issues: [
      { code: "ROBOTS_CONFLICT", meaning: <>The page says "show me" while the server says "don't show me". Google follows "don't show me".</>, fix: <>Decide whether the page should be in Google, and ask the web team to make both settings agree.</> }
    ],
    selfCheck: [
      <>Press <K>Ctrl</K>+<K>U</K>, then <K>Ctrl</K>+<K>F</K> and search for <T>noindex</T>.</>,
      <>For Google's own answer, use "URL Inspection" in Google Search Console.</>
    ],
    goodToKnow: [
      <>A website can also block Google through a separate file (robots.txt). The tool doesn't check that file, so a page can look "indexable" here and still be blocked.</>,
      <>"Indexable" means nothing on the page forbids it. Google can still decide not to show a page, for example if it's too similar to another.</>
    ]
  },
  {
    id: "structured-data",
    title: "Structured data (rich results)",
    techId: "structured-data",
    what: <>Structured data is hidden information in the page that describes it in a format Google understands: "this is a product with this price", "this is our company's logo", "these are breadcrumbs".</>,
    why: <>It can earn richer search results, such as star ratings, breadcrumbs or your logo, which stand out and get more clicks.</>,
    looksAt: [
      <>Whether the structured data is written correctly (a typo makes Google ignore all of it).</>,
      <>Whether it has the basic parts every block needs.</>,
      <>For the types Google uses, whether the information Google requires is present.</>,
      <>Whether a type is one Google has limited or stopped using. For example, FAQ results now appear only for government and health websites.</>
    ],
    issues: [
      { code: "JSONLD_INVALID_JSON", meaning: <>A block of structured data has a typo and Google can't read any of it.</>, fix: <>Ask the web team to fix it. Google's Rich Results Test shows exactly where the mistake is.</> },
      { code: "JSONLD_SCHEMA_ERRORS", meaning: <>A block is missing the basic labels that say what it describes.</>, fix: <>Ask the web team to correct the block.</> },
      { code: "JSONLD_GOOGLE_REQUIRED_MISSING", meaning: <>Google needs some information that is missing, for example a product without a price or rating. Without it, that rich result won't appear.</>, fix: <>The page details list exactly what's missing. Ask the web team to add it.</> }
    ],
    selfCheck: [<>Paste the page address into Google's <a href="https://search.google.com/test/rich-results" target="_blank" rel="noopener noreferrer">Rich Results Test</a>. It shows what Google can read and whether the page can get rich results.</>],
    goodToKnow: [
      <>When the tool says the required information is present, it doesn't guarantee that Google will show a rich result. Google also applies its own quality rules. The Rich Results Test has the final word.</>,
      <>Missing "recommended" information is only a suggestion, never an error.</>
    ]
  },
  {
    id: "duplicates",
    title: "Duplicate titles and descriptions",
    techId: "duplicates",
    what: <>The tool compares all checked pages and finds pages that use exactly the same title, or exactly the same description.</>,
    why: <>When several pages look identical in search results, Google can't tell which one to show, and people can't tell which one to click.</>,
    looksAt: [
      <>Only pages that load correctly and are allowed in Google. Hidden or redirected pages are left out.</>,
      <>Capital letters and extra spaces are ignored when comparing.</>
    ],
    issues: [],
    selfCheck: [<>Open the pages listed together and compare their tab titles.</>],
    goodToKnow: [
      <>Only exact matches are found. Titles that differ by one word are not reported, even if they're too similar.</>,
      <>Some duplicates are acceptable, such as page 2 and page 3 of a list.</>,
      <>If you limited the number of pages, duplicates among unchecked pages are missed.</>
    ]
  },
  {
    id: "canonical-targets",
    title: "Problems with the preferred address",
    techId: "canonical-targets",
    what: <>When a page says "my preferred address is that other page", the tool opens that other page to make sure it's healthy.</>,
    why: <>If the preferred page is broken, redirects elsewhere or is hidden from Google, Google receives confusing instructions and may show neither page.</>,
    looksAt: [<>Whether the preferred page opens without errors, doesn't redirect, isn't hidden from Google, and doesn't itself point to yet another page.</>],
    issues: [],
    selfCheck: [<>Open the preferred address listed in the results. It should open directly, without changing in the address bar.</>],
    goodToKnow: [<>If the preferred page is behind website protection, it's listed as "not verifiable" rather than as a problem.</>]
  },
  {
    id: "sitemap-conflicts",
    title: "Sitemap pages that shouldn't be there",
    techId: "indexability-conflicts",
    what: <>The sitemap is the list of pages you're asking Google to show. The tool finds pages in that list which, at the same time, tell Google not to show them.</>,
    why: <>Mixed messages waste Google's time and make the sitemap less trustworthy. Every page in the sitemap should be a working page you want in Google.</>,
    looksAt: [<>For every page in the sitemap: whether it fails to open, shows an error, redirects, contains noindex, or points to a different preferred address.</>],
    issues: [],
    selfCheck: [<>Open the sitemap (usually your website address + <T>/sitemap.xml</T>) and confirm the page is listed. Then open the page itself.</>],
    goodToKnow: [
      <>A redirect caused only by a missing slash at the end, or by http instead of https, is still reported. It's correct to fix, but rarely urgent.</>,
      <>When you check a single page, the sitemap isn't read, so this list stays empty.</>
    ]
  },
  {
    id: "broken-links",
    title: "Links: broken, redirecting, email and phone",
    techId: "broken-links",
    what: <>The tool collects every link on the checked pages and tests it: links to your own pages, links to other websites, email links and phone links.</>,
    why: <>Broken links frustrate visitors and waste Google's time. An email or phone link with a typo means a customer who wanted to contact you can't. Links that go through a redirect still work, but are a little slower.</>,
    looksAt: [
      <><b>Links to your own pages:</b> broken if the page shows an error (such as 404) or doesn't open at all. Links that pass through another address first (a redirect) are listed as information.</>,
      <><b>Links to other websites:</b> broken if the page shows an error or the website doesn't exist. Some websites, such as LinkedIn, Facebook or sites behind security protection, refuse automated checks. Those are listed separately for you to check by hand, and are not counted as broken.</>,
      <><b>Email links</b> (<T>mailto:</T>): the address must be written correctly, and the part after the @ must be a domain that exists.</>,
      <><b>Phone links</b> (<T>tel:</T>): the number may contain spaces, dashes, brackets and a + at the start, but nothing else, and must have 3 to 15 digits.</>,
      <>Empty links, and links that run a script instead of leading to a page.</>,
      <>The Results tab shows how many pages contain each problem link, and each page's details list the exact links under "Links and images".</>
    ],
    issues: [
      { code: "LINK_BROKEN", meaning: <>One or more links on the page lead to a page that shows an error or doesn't open. The page's details list each one with the reason, for example "HTTP 404".</>, fix: <>Change the link to point to the right page, or remove it. If one of your own pages was removed, redirect its old address to the closest page that still exists.</> },
      { code: "MAILTO_INVALID", meaning: <>An email link is written wrongly, for example <T>info@magenta</T> without the <T>.gr</T>, or with a space in it. Clicking it won't open a correct email.</>, fix: <>Correct the address in your editor.</> },
      { code: "EMAIL_DOMAIN_INVALID", meaning: <>An email address looks right, but the part after the @ doesn't exist on the internet, so emails to it can't be delivered. Usually a typo, such as <T>magentainsurace.gr</T>.</>, fix: <>Correct the domain, or replace the address with one that works.</> },
      { code: "TEL_INVALID", meaning: <>A phone link contains letters or other wrong characters (for example the letter O instead of zero), or has too few or too many digits. On a mobile, tapping it won't call the right number.</>, fix: <>Correct the number in your editor. Write it with the country code, for example <T>+30 210 1234567</T>.</> },
      { code: "LINK_INVALID", meaning: <>A link has no address, or an address that can't be read. Clicking it goes nowhere or reloads the same page.</>, fix: <>Add the right address, or remove the link.</> },
      { code: "LINK_JAVASCRIPT", meaning: <>A link runs a script instead of leading to a page. It may work for visitors, but Google can't follow it, so it doesn't help Google find your pages. This is only a note.</>, fix: <>If it leads to content, ask the web team to use a normal link. Buttons that open a menu or a pop-up can stay as they are.</> }
    ],
    selfCheck: [
      <>Click the link on one of the pages listed. To find it on a page, press <K>Ctrl</K>+<K>F</K> and search for the link's text.</>,
      <>For email and phone links, point at the link without clicking. The browser shows its address in the bottom corner of the window.</>
    ],
    goodToKnow: [
      <>Your own pages that need a login (such as a customer area) may be reported as broken even though they work for logged-in customers.</>,
      <>If a website briefly limited the tool's requests, working links can show as broken. Open them in your browser to confirm.</>,
      <>The email check confirms that the domain can receive email, not that the specific mailbox exists.</>,
      <>Fix links that appear on many pages first: often a single menu or footer change fixes them all.</>,
      <>Checking links to other websites and images makes an audit slower. For quicker results, untick "Check external links" or "Check that images load" before you run it.</>
    ]
  }
];
