"use strict";

const http = require("http");
const https = require("https");
const { mergeConfig } = require("./config");

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Perform a single HTTP(S) request without following redirects.
 * Resolves with { status, headers, body: Buffer } or rejects with an Error
 * whose `code` is set (ETIMEDOUT, ETOOLARGE, or the socket error code).
 * With `headersOnly`, resolves as soon as the headers arrive and drops the
 * body (link and image checks need the status, not the content).
 */
function requestOnce(url, { method, timeoutMs, maxBodyBytes, userAgent, tls, headersOnly = false, accept }) {
    return new Promise((resolve, reject) => {
        let parsed;
        try {
            parsed = new URL(url);
        } catch {
            const err = new Error(`Invalid URL: ${url}`);
            err.code = "EINVALIDURL";
            reject(err);
            return;
        }

        let transport;
        if (parsed.protocol === "https:") transport = https;
        else if (parsed.protocol === "http:") transport = http;
        else {
            const err = new Error(`Unsupported protocol: ${parsed.protocol}`);
            err.code = "EPROTOCOL";
            reject(err);
            return;
        }

        const options = {
            method,
            headers: {
                "User-Agent": userAgent,
                "Accept": accept || "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Encoding": "identity"
            },
            ...(parsed.protocol === "https:" ? tls : {})
        };

        let settled = false;
        const finish = (fn, value) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            fn(value);
        };

        const req = transport.request(parsed, options, (res) => {
            if (headersOnly) {
                finish(resolve, { status: res.statusCode, headers: res.headers, body: Buffer.alloc(0) });
                res.destroy();
                return;
            }
            const chunks = [];
            let size = 0;

            res.on("data", (chunk) => {
                size += chunk.length;
                if (size > maxBodyBytes) {
                    const err = new Error(`Response body exceeds ${maxBodyBytes} bytes`);
                    err.code = "ETOOLARGE";
                    req.destroy(err);
                    return;
                }
                chunks.push(chunk);
            });

            res.on("end", () => {
                // Concatenate buffers before decoding so multi-byte UTF-8
                // characters split across chunks are not corrupted.
                finish(resolve, {
                    status: res.statusCode,
                    headers: res.headers,
                    body: Buffer.concat(chunks)
                });
            });

            res.on("error", (err) => finish(reject, err));
        });

        // Overall deadline (covers slow headers and slow bodies).
        const timer = setTimeout(() => {
            const err = new Error(`Request timed out after ${timeoutMs} ms`);
            err.code = "ETIMEDOUT";
            req.destroy(err);
        }, timeoutMs);

        req.on("error", (err) => finish(reject, err));
        req.end();
    });
}

function decodeBody(buffer, contentType) {
    const charsetMatch = /charset\s*=\s*["']?([\w-]+)/i.exec(contentType || "");
    const charset = charsetMatch ? charsetMatch[1].toLowerCase() : "utf-8";
    try {
        return new TextDecoder(charset).decode(buffer);
    } catch {
        return new TextDecoder("utf-8").decode(buffer);
    }
}

/**
 * Fetch a URL, following redirects manually so every hop is recorded.
 * Never throws: failures are reported through `ok: false` and `error`.
 *
 * @returns {Promise<{
 *   ok: boolean, requestedUrl: string, finalUrl: string|null,
 *   status: number|null, headers: object, contentType: string|null,
 *   body: string|null, redirectChain: Array<{url, status, location}>,
 *   responseTimeMs: number, attempts: number,
 *   error: {code: string, message: string}|null
 * }>}
 */
async function fetchUrl(url, options = {}) {
    const cfg = mergeConfig(options);
    const method = options.method || "GET";
    const start = Date.now();
    const redirectChain = [];
    const visited = new Set();
    let current = url;
    let attempts = 0;

    const fail = (code, message, extra = {}) => ({
        ok: false,
        requestedUrl: url,
        finalUrl: extra.finalUrl ?? null,
        status: extra.status ?? null,
        headers: extra.headers ?? {},
        contentType: null,
        body: null,
        redirectChain,
        responseTimeMs: Date.now() - start,
        attempts,
        error: { code, message }
    });

    for (;;) {
        if (visited.has(current)) {
            return fail("EREDIRECTLOOP", `Redirect loop detected at ${current}`, { finalUrl: current });
        }
        visited.add(current);

        let response;
        let lastError = null;

        for (let attempt = 0; attempt <= cfg.retries; attempt++) {
            attempts++;
            try {
                response = await requestOnce(current, { ...cfg, method });
                lastError = null;
                if (RETRYABLE_STATUSES.has(response.status) && attempt < cfg.retries) {
                    await sleep(cfg.retryDelayMs * 2 ** attempt);
                    continue;
                }
                break;
            } catch (err) {
                lastError = err;
                // Do not retry problems that will not change on a retry.
                if (["EINVALIDURL", "EPROTOCOL", "ETOOLARGE"].includes(err.code)) break;
                if (attempt < cfg.retries) await sleep(cfg.retryDelayMs * 2 ** attempt);
            }
        }

        if (lastError) {
            return fail(lastError.code || "ENETWORK", lastError.message, { finalUrl: current });
        }

        const { status, headers } = response;
        const location = headers.location;

        if (REDIRECT_STATUSES.has(status) && location) {
            let next;
            try {
                // Location may be relative; resolve it against the current URL.
                next = new URL(location, current);
                next.hash = "";
                next = next.href;
            } catch {
                redirectChain.push({ url: current, status, location });
                return fail("EBADLOCATION", `Invalid Location header: ${location}`, {
                    finalUrl: current, status, headers
                });
            }

            redirectChain.push({ url: current, status, location: next });

            if (redirectChain.length > cfg.maxRedirects) {
                return fail("ETOOMANYREDIRECTS", `Exceeded ${cfg.maxRedirects} redirects`, {
                    finalUrl: next
                });
            }

            current = next;
            continue;
        }

        const contentType = headers["content-type"] || null;
        return {
            ok: true,
            requestedUrl: url,
            finalUrl: current,
            status,
            headers,
            contentType,
            body: method === "HEAD" || cfg.headersOnly ? "" : decodeBody(response.body, contentType),
            redirectChain,
            responseTimeMs: Date.now() - start,
            attempts,
            error: null
        };
    }
}

module.exports = { fetchUrl, decodeBody, REDIRECT_STATUSES };
