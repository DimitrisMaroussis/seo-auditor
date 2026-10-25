"use strict";

/*
 * HTTP API for running audits from the dashboard.
 *
 *   GET  /api/reports           → [{ name, size, modified }] newest first
 *   GET  /api/reports/<name>    → the saved report JSON
 *   DELETE /api/reports         → deletes every saved report → { deleted }
 *   GET  /api/vitals/status     → { configured } whether a Google API key is set
 *   POST /api/vitals            → Core Web Vitals for one URL; streams NDJSON:
 *        { type: "phase", phase: "lab"|"field" } then { type: "done", file } or error
 *     Body: { url }. Saved to reports/vitals/<file>.
 *   GET  /api/vitals-reports           → saved vitals reports, newest first
 *   GET  /api/vitals-reports/<name>    → one saved vitals report
 *   GET    /api/tracked-pages            → { pages, weeks } saved pages with their last 15 weeks
 *   POST   /api/tracked-pages            → add { url }; follows redirects, fetches its weeks → { page }
 *   POST   /api/tracked-pages/refresh    → fetch the latest weeks again for { url } → { page }
 *   DELETE /api/tracked-pages?url=…      → remove a page → { pages }
 *   POST /api/audit             → runs an audit; streams NDJSON events:
 *        { type: "phase", phase, total? }
 *        { type: "progress", done, total, url, status }
 *        { type: "done", file }            report saved to reports/<file>
 *        { type: "error", message }
 *     Body: { url, mode: "site"|"page", maxUrls?, concurrency?,
 *             includeSubdomains?, checkLinks?, checkExternalLinks?, checkImages? }
 *     Closing the request cancels the audit.
 *
 * Exposed as a connect-style middleware (req, res, next) so the Vite dev
 * server can mount it; it can also be passed to http.createServer().
 */

const fs = require("fs");
const path = require("path");
const { runAudit, runPageAudit } = require("./audit");
const { runVitals, loadApiKey, apiKeySource, saveApiKey, removeApiKey, verifyApiKey, KEY_FILE, KEY_SHAPE } = require("./vitals");
const tracking = require("./vitals/tracking");
const { fetchUrl } = require("./http");

const DEFAULT_REPORTS_DIR = path.join(__dirname, "..", "reports");
const REPORT_NAME = /^[\w.-]+\.json$/;
const MAX_BODY_BYTES = 16 * 1024;

function sendJson(res, status, body) {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(body));
}

function readJsonBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        req.on("data", (chunk) => {
            size += chunk.length;
            if (size > MAX_BODY_BYTES) {
                reject(new Error("Request body too large"));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on("end", () => {
            try {
                resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
            } catch {
                reject(new Error("Request body is not valid JSON"));
            }
        });
        req.on("error", reject);
    });
}

/** Validate and normalize the audit request body. Throws with a user-facing message. */
function parseAuditRequest(body) {
    let url;
    try {
        url = new URL(String(body.url || "").trim());
    } catch {
        throw new Error("Enter a full URL, starting with http:// or https://");
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new Error("Only http:// and https:// URLs can be audited");
    }
    const mode = body.mode === "page" ? "page" : "site";
    const options = {};
    const maxUrls = Number(body.maxUrls);
    if (Number.isFinite(maxUrls) && maxUrls > 0) options.maxUrls = Math.floor(maxUrls);
    const concurrency = Number(body.concurrency);
    if (Number.isFinite(concurrency) && concurrency > 0) options.concurrency = Math.min(8, Math.floor(concurrency));
    if (body.includeSubdomains) options.subdomainPolicy = "include-subdomains";
    if (body.checkLinks === false) options.checkLinks = false;
    if (body.checkExternalLinks === false) options.checkExternalLinks = false;
    if (body.checkImages === false) options.checkImages = false;
    return { url: url.href, mode, options };
}

/** True when the request carries an Origin header from another site. */
function isCrossOrigin(req) {
    const origin = req.headers.origin;
    if (!origin) return false;
    try {
        return new URL(origin).host !== req.headers.host;
    } catch {
        return true;
    }
}

function reportFileName(url, mode, date = new Date()) {
    const host = new URL(url).hostname.replace(/^www\./, "").replace(/[^\w.-]/g, "_");
    const stamp = date.toISOString().replace(/[:T]/g, "-").replace(/\..+$/, "");
    return `${host}-${mode}-${stamp}.json`;
}

/**
 * @param {object} opts
 *   reportsDir    where reports are saved (vitals in <reportsDir>/vitals)
 *   auditOptions  extra options for every audit (tests use short timeouts)
 *   vitals        { keyFile?, apiKey?: () => string|null, fetchImpl?, verifyKey? } for Google API calls.
 *                 keyFile is where the key is read from and saved to (default: .google-api-key in the
 *                 project). apiKey replaces reading it, and makes the key read-only (tests).
 *                 trackedFile and resolveUrl (tests) override where tracked pages are kept and
 *                 how their final address is found.
 */
function createApi({ reportsDir = DEFAULT_REPORTS_DIR, auditOptions = {}, vitals = {} } = {}) {
    let running = false;
    let vitalsRunning = false;
    const vitalsDir = path.join(reportsDir, "vitals");
    // Read the key on every request so adding it needs no restart.
    const keyFile = vitals.keyFile || KEY_FILE;
    const getApiKey = vitals.apiKey || (() => loadApiKey(keyFile));
    const verifyKey = vitals.verifyKey || ((key) => verifyApiKey(key, { fetchImpl: vitals.fetchImpl }));

    /** Whether a key is set, where from, and its last 4 characters. Never the key itself. */
    function keyStatus() {
        const key = getApiKey();
        const source = vitals.apiKey ? (key ? "custom" : null) : apiKeySource(keyFile);
        return { configured: Boolean(key), source, last4: key ? key.slice(-4) : null };
    }

    async function setKey(req, res) {
        if (!/^application\/json\b/i.test(req.headers["content-type"] || "")) {
            return sendJson(res, 415, { error: "Content-Type must be application/json" });
        }
        if (isCrossOrigin(req)) return sendJson(res, 403, { error: "Cross-origin requests are not allowed" });
        const status = keyStatus();
        if (status.source === "env" || status.source === "custom") {
            return sendJson(res, 409, { error: "The key is set outside the app and cannot be changed here", code: "EENV" });
        }
        let key;
        try {
            key = String((await readJsonBody(req)).key ?? "").trim().replace(/^["']|["']$/g, "");
        } catch (err) {
            return sendJson(res, 400, { error: err.message });
        }
        if (!KEY_SHAPE.test(key)) return sendJson(res, 400, { error: "This does not look like a Google API key", code: "EFORMAT" });

        const check = await verifyKey(key);
        if (check.ok === false) return sendJson(res, 422, { error: check.message || check.code, code: check.code });
        saveApiKey(key, keyFile);
        sendJson(res, 200, { ...keyStatus(), verified: check.ok === true });
    }

    // ---------- tracked pages ----------

    // In a subfolder, so "Delete all" reports and the report list never touch it.
    const trackedFile = vitals.trackedFile || path.join(reportsDir, "tracking", "pages.json");
    const resolveUrl = vitals.resolveUrl
        || ((url) => tracking.resolveFinalUrl(url, { fetchUrl, userAgent: auditOptions.userAgent }).catch(() => url));
    // Writes to the list run one after another, so two quick adds cannot overwrite each other.
    let listQueue = Promise.resolve();
    const updateList = (change) => {
        const run = listQueue.then(() => {
            const pages = tracking.readList(trackedFile);
            const result = change(pages);
            tracking.writeList(trackedFile, pages);
            return result;
        });
        listQueue = run.catch(() => {});
        return run;
    };
    const weeklyVitals = (url) => tracking.getWeeklyVitals(url, { apiKey: getApiKey(), fetchImpl: vitals.fetchImpl });
    const sameUrl = (page, url) => page.url === url || page.requestedUrl === url;

    async function readTrackRequest(req, res) {
        if (!/^application\/json\b/i.test(req.headers["content-type"] || "")) {
            sendJson(res, 415, { error: "Content-Type must be application/json" });
            return null;
        }
        if (isCrossOrigin(req)) {
            sendJson(res, 403, { error: "Cross-origin requests are not allowed" });
            return null;
        }
        if (!getApiKey()) {
            sendJson(res, 412, { error: "No Google API key configured", code: "ENOKEY" });
            return null;
        }
        try {
            return tracking.normalizePageUrl((await readJsonBody(req)).url);
        } catch (err) {
            sendJson(res, 400, { error: err.message, code: "EURL" });
            return null;
        }
    }

    async function addTrackedPage(req, res) {
        const requested = await readTrackRequest(req, res);
        if (!requested) return;
        const existing = tracking.readList(trackedFile);
        if (existing.length >= tracking.MAX_PAGES) {
            return sendJson(res, 400, { error: `At most ${tracking.MAX_PAGES} pages can be tracked`, code: "EFULL" });
        }
        const url = await resolveUrl(requested);
        const already = existing.find(p => sameUrl(p, url) || sameUrl(p, requested));
        if (already) return sendJson(res, 409, { error: "This page is already tracked", code: "EEXISTS", page: already });

        let weekly;
        try {
            weekly = await weeklyVitals(url);
        } catch (err) {
            return sendJson(res, 502, { error: err.message, code: "EGOOGLE" });
        }
        const page = { url, ...(url !== requested ? { requestedUrl: requested } : {}), addedAt: new Date().toISOString(), vitals: weekly };
        const added = await updateList(pages => {
            const dup = pages.find(p => sameUrl(p, url));
            if (dup) return dup;
            pages.push(page);
            return page;
        });
        sendJson(res, 201, { page: added });
    }

    async function refreshTrackedPage(req, res) {
        const url = await readTrackRequest(req, res);
        if (!url) return;
        if (!tracking.readList(trackedFile).some(p => sameUrl(p, url))) {
            return sendJson(res, 404, { error: "This page is not tracked", code: "ENOTFOUND" });
        }
        let weekly;
        try {
            weekly = await weeklyVitals(tracking.readList(trackedFile).find(p => sameUrl(p, url)).url);
        } catch (err) {
            return sendJson(res, 502, { error: err.message, code: "EGOOGLE" });
        }
        const page = await updateList(pages => {
            const entry = pages.find(p => sameUrl(p, url));
            if (entry) entry.vitals = weekly;
            return entry;
        });
        if (!page) return sendJson(res, 404, { error: "This page is not tracked", code: "ENOTFOUND" });
        sendJson(res, 200, { page });
    }

    async function removeTrackedPage(req, res, searchParams) {
        if (isCrossOrigin(req)) return sendJson(res, 403, { error: "Cross-origin requests are not allowed" });
        const url = searchParams.get("url") || "";
        const pages = await updateList(list => {
            const i = list.findIndex(p => sameUrl(p, url));
            if (i >= 0) list.splice(i, 1);
            return list.slice();
        });
        sendJson(res, 200, { pages });
    }

    function deleteKey(req, res) {
        if (isCrossOrigin(req)) return sendJson(res, 403, { error: "Cross-origin requests are not allowed" });
        const status = keyStatus();
        if (status.source === "env" || status.source === "custom") {
            return sendJson(res, 409, { error: "The key is set outside the app and cannot be changed here", code: "EENV" });
        }
        removeApiKey(keyFile);
        sendJson(res, 200, keyStatus());
    }

    function listReports(res, dir = reportsDir) {
        fs.mkdirSync(dir, { recursive: true });
        const reports = fs.readdirSync(dir)
            .filter(name => REPORT_NAME.test(name))
            .map(name => ({ name, stat: fs.statSync(path.join(dir, name)) }))
            .filter(({ stat }) => stat.isFile())
            .map(({ name, stat }) => ({ name, size: stat.size, modified: stat.mtime.toISOString() }))
            .sort((a, b) => b.modified.localeCompare(a.modified));
        sendJson(res, 200, reports);
    }

    function sendReport(res, name, dir = reportsDir) {
        if (!REPORT_NAME.test(name)) return sendJson(res, 400, { error: "Invalid report name" });
        const file = path.join(dir, name);
        if (!fs.existsSync(file)) return sendJson(res, 404, { error: "Report not found" });
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        fs.createReadStream(file).pipe(res);
    }

    function clearReports(req, res) {
        // DELETE always needs a CORS preflight, which this API never approves;
        // the Origin check also refuses any cross-site request that gets here.
        if (isCrossOrigin(req)) return sendJson(res, 403, { error: "Cross-origin requests are not allowed" });
        if (running || vitalsRunning) {
            return sendJson(res, 409, { error: "A check is running. Wait for it to finish before clearing reports." });
        }
        let deleted = 0;
        for (const dir of [reportsDir, vitalsDir]) {
            fs.mkdirSync(dir, { recursive: true });
            for (const name of fs.readdirSync(dir)) {
                if (!REPORT_NAME.test(name)) continue;
                const file = path.join(dir, name);
                if (!fs.statSync(file).isFile()) continue;
                fs.unlinkSync(file);
                deleted++;
            }
        }
        sendJson(res, 200, { deleted });
    }

    async function startVitals(req, res) {
        if (!/^application\/json\b/i.test(req.headers["content-type"] || "")) {
            return sendJson(res, 415, { error: "Content-Type must be application/json" });
        }
        if (isCrossOrigin(req)) return sendJson(res, 403, { error: "Cross-origin requests are not allowed" });

        let url;
        try {
            const body = await readJsonBody(req);
            url = parseAuditRequest(body).url;
        } catch (err) {
            return sendJson(res, 400, { error: err.message });
        }
        const apiKey = getApiKey();
        if (!apiKey) return sendJson(res, 412, { error: "No Google API key configured", code: "ENOKEY" });
        if (vitalsRunning) return sendJson(res, 409, { error: "A Core Web Vitals check is already running." });
        vitalsRunning = true;

        const controller = new AbortController();
        res.on("close", () => {
            if (!res.writableEnded) controller.abort();
        });
        res.writeHead(200, { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache" });
        const send = (event) => {
            if (!res.writableEnded) res.write(JSON.stringify(event) + "\n");
        };

        try {
            const report = await runVitals(url, {
                apiKey,
                fetchImpl: vitals.fetchImpl,
                signal: controller.signal,
                onPhase: (phase) => send({ type: "phase", phase })
            });
            const file = reportFileName(report.finalUrl, "vitals");
            fs.mkdirSync(vitalsDir, { recursive: true });
            fs.writeFileSync(path.join(vitalsDir, file), JSON.stringify(report, null, 2));
            send({ type: "done", file });
        } catch (err) {
            send({ type: "error", message: err.code === "EABORTED" ? "Check stopped" : err.message, status: err.status ?? null });
        } finally {
            vitalsRunning = false;
            if (!res.writableEnded) res.end();
        }
    }

    async function startAudit(req, res) {
        // Only the dashboard itself may start audits. Requiring JSON forces a
        // CORS preflight (which this API never approves), and a cross-origin
        // Origin header is refused outright, so other websites open in the
        // browser cannot make this machine fetch URLs.
        if (!/^application\/json\b/i.test(req.headers["content-type"] || "")) {
            return sendJson(res, 415, { error: "Content-Type must be application/json" });
        }
        if (isCrossOrigin(req)) return sendJson(res, 403, { error: "Cross-origin requests are not allowed" });

        let request;
        try {
            request = parseAuditRequest(await readJsonBody(req));
        } catch (err) {
            return sendJson(res, 400, { error: err.message });
        }
        if (running) return sendJson(res, 409, { error: "An audit is already running. Wait for it to finish or stop it." });
        running = true;

        const controller = new AbortController();
        res.on("close", () => {
            if (!res.writableEnded) controller.abort();
        });

        res.writeHead(200, {
            "Content-Type": "application/x-ndjson; charset=utf-8",
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no"
        });
        const send = (event) => {
            if (!res.writableEnded) res.write(JSON.stringify(event) + "\n");
        };

        const options = {
            ...auditOptions,
            ...request.options,
            signal: controller.signal,
            onPhase: (phase, info = {}) => send({ type: "phase", phase, ...info }),
            onProgress: (done, total, page) => send({
                type: "progress", done, total, url: page.requestedUrl,
                status: page.fetchError ? page.fetchError.code : page.blocked ? "BLOCKED" : page.status
            })
        };

        try {
            const report = request.mode === "page"
                ? await runPageAudit(request.url, options)
                : await runAudit(request.url, options);
            const file = reportFileName(request.url, request.mode);
            fs.mkdirSync(reportsDir, { recursive: true });
            fs.writeFileSync(path.join(reportsDir, file), JSON.stringify(report, null, 2));
            send({ type: "done", file });
        } catch (err) {
            send({ type: "error", message: err.code === "EABORTED" ? "Audit stopped" : err.message });
        } finally {
            running = false;
            if (!res.writableEnded) res.end();
        }
    }

    return function api(req, res, next) {
        const { pathname, searchParams } = new URL(req.url, "http://localhost");
        const notHandled = () => (next ? next() : sendJson(res, 404, { error: "Not found" }));
        if (!pathname.startsWith("/api/")) return notHandled();

        if (req.method === "GET" && pathname === "/api/reports") return listReports(res);
        if (req.method === "DELETE" && pathname === "/api/reports") return clearReports(req, res);
        if (req.method === "GET" && pathname.startsWith("/api/reports/")) {
            return sendReport(res, decodeURIComponent(pathname.slice("/api/reports/".length)));
        }
        if (req.method === "POST" && pathname === "/api/audit") return startAudit(req, res);
        if (req.method === "GET" && pathname === "/api/vitals/status") return sendJson(res, 200, keyStatus());
        if (req.method === "PUT" && pathname === "/api/vitals/key") return setKey(req, res);
        if (req.method === "GET" && pathname === "/api/tracked-pages") {
            return sendJson(res, 200, { pages: tracking.readList(trackedFile), weeks: tracking.WEEKS });
        }
        if (req.method === "POST" && pathname === "/api/tracked-pages") return addTrackedPage(req, res);
        if (req.method === "POST" && pathname === "/api/tracked-pages/refresh") return refreshTrackedPage(req, res);
        if (req.method === "DELETE" && pathname === "/api/tracked-pages") return removeTrackedPage(req, res, searchParams);
        if (req.method === "DELETE" && pathname === "/api/vitals/key") return deleteKey(req, res);
        if (req.method === "POST" && pathname === "/api/vitals") return startVitals(req, res);
        if (req.method === "GET" && pathname === "/api/vitals-reports") return listReports(res, vitalsDir);
        if (req.method === "GET" && pathname.startsWith("/api/vitals-reports/")) {
            return sendReport(res, decodeURIComponent(pathname.slice("/api/vitals-reports/".length)), vitalsDir);
        }
        return sendJson(res, 404, { error: "Not found" });
    };
}

module.exports = { createApi, parseAuditRequest, reportFileName };
