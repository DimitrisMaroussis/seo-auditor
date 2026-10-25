"use strict";

const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

const FIXTURES = path.join(__dirname, "..", "fixtures");
const TLS = {
    key: fs.readFileSync(path.join(FIXTURES, "localhost-key.pem")),
    cert: fs.readFileSync(path.join(FIXTURES, "localhost-cert.pem"))
};

/**
 * Start a local server. `routes` maps a path (including query string) to
 * either a handler (req, res, server) or a { status, headers, body } object.
 * Returns { url, origin, hits, close }.
 */
async function startServer(routes, { secure = false } = {}) {
    const hits = new Map();
    const handler = (req, res) => {
        hits.set(req.url, (hits.get(req.url) || 0) + 1);
        const route = routes[req.url] ?? routes[req.url.split("?")[0]];
        if (!route) {
            res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
            res.end("<html><head><title>Not found</title></head><body>404</body></html>");
            return;
        }
        if (typeof route === "function") {
            route(req, res, api);
            return;
        }
        res.writeHead(route.status || 200, {
            "Content-Type": "text/html; charset=utf-8",
            ...(route.headers || {})
        });
        res.end(req.method === "HEAD" ? undefined : route.body || "");
    };

    const server = secure ? https.createServer(TLS, handler) : http.createServer(handler);
    const sockets = new Set();
    server.on("connection", (socket) => {
        sockets.add(socket);
        socket.on("close", () => sockets.delete(socket));
    });

    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address();
    const origin = `${secure ? "https" : "http"}://127.0.0.1:${port}`;

    const api = {
        origin,
        url: (p) => `${origin}${p}`,
        hits,
        close: () => new Promise(resolve => {
            sockets.forEach(s => s.destroy());
            server.close(() => resolve());
        })
    };
    return api;
}

const html = ({ head = "", body = "" } = {}) =>
    `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;

module.exports = { startServer, html, TLS_CA: TLS.cert };
