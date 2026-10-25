# SEO Auditor

A sitemap-driven technical SEO auditor, available as a CLI and as a Windows desktop app (Electron + React dashboard).

## Screenshots

**Site audit:** every page from the sitemap checked, with issues grouped and explained.

![Site audit](docs/site-audit.png)

**Core Web Vitals:** real-visitor speed data from Google, with what each metric means and why it matters.

![Core Web Vitals](docs/core-web-vitals.png)

## Features

- Crawls every page listed in a site's sitemap
- Checks meta tags, headings, canonicals, structured data (schema), broken links and redirects
- Measures Core Web Vitals through Google PageSpeed Insights and the Chrome UX Report (CrUX)
- Bilingual dashboard (Greek / English) with a guide explaining every check
- Exports audit reports as JSON

## Tech stack

Node.js · Electron · React · TypeScript · Tailwind CSS · Vite · cheerio

## Getting started

Requires Node.js 18+.

```bash
npm install
npm --prefix dashboard install
npm run desktop        # build the dashboard and launch the desktop app
npm start              # run the CLI
npm test               # run the test suite
```

To build the Windows installer: `npm run desktop:dist`.

### Google API key

Core Web Vitals use the Google PageSpeed Insights / CrUX APIs. Create a free key in the [Google Cloud Console](https://console.cloud.google.com/apis/credentials) and enter it in the app. It is stored locally in `.google-api-key`, which is git-ignored.

## Author

Dimitris Maroussis
