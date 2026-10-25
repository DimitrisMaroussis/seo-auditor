/*
 * Desktop app: an Electron window around the same API and dashboard that
 * `npm run dev` serves. The main process starts a local server bound to
 * 127.0.0.1 on a free port; it answers /api/* with createApi() and serves the
 * built dashboard (dashboard/dist) for everything else.
 *
 * Reports and the Google API key live in the app's data folder when installed
 * (%APPDATA%/SEO Auditor). Run from the project folder (`npm run desktop`),
 * the app uses the project's reports/ and .google-api-key, like the dev server.
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const { app, BrowserWindow, Menu, shell } = require("electron");
const { createApi } = require("../src/api");

const ROOT = path.join(__dirname, "..");
const DIST = path.join(ROOT, "dashboard", "dist");
const DATA = app.isPackaged ? app.getPath("userData") : ROOT;
const REPORTS_DIR = path.join(DATA, "reports");
const KEY_FILE = path.join(DATA, ".google-api-key");

const TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".woff2": "font/woff2"
};

/** Serve a file from dashboard/dist; unknown paths get index.html (the dashboard routes by hash). */
function serveStatic(req, res) {
    const { pathname } = new URL(req.url, "http://localhost");
    let file = path.normalize(path.join(DIST, decodeURIComponent(pathname)));
    if (file !== DIST && !file.startsWith(DIST + path.sep)) {
        res.writeHead(403).end();
        return;
    }
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, "index.html");
    fs.readFile(file, (err, body) => {
        if (err) {
            res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" })
                .end("The dashboard is not built. Run npm run desktop, which builds it first.");
            return;
        }
        res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" }).end(body);
    });
}

function startServer() {
    const api = createApi({ reportsDir: REPORTS_DIR, vitals: { keyFile: KEY_FILE } });
    const server = http.createServer((req, res) => api(req, res, () => serveStatic(req, res)));
    return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${server.address().port}/`));
    });
}

function createWindow(url) {
    const win = new BrowserWindow({
        width: 1360,
        height: 900,
        minWidth: 400,
        minHeight: 500,
        title: "SEO Auditor",
        // The installed .exe carries its own icon; this covers `npm run desktop`.
        icon: app.isPackaged ? undefined : path.join(ROOT, "build", "icon.png"),
        backgroundColor: "#faf7f9",
        autoHideMenuBar: true,
        webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
    });

    // Links to audited sites and Google tools open in the default browser, not inside the app.
    const isApp = target => target.startsWith(url);
    win.webContents.setWindowOpenHandler(({ url: target }) => {
        if (/^https?:/.test(target)) shell.openExternal(target);
        return { action: "deny" };
    });
    win.webContents.on("will-navigate", (event, target) => {
        if (!isApp(target)) {
            event.preventDefault();
            if (/^https?:/.test(target)) shell.openExternal(target);
        }
    });

    win.loadURL(url);
}

// One window at a time: a second launch focuses the running app.
if (!app.requestSingleInstanceLock()) {
    app.quit();
} else {
    let appUrl = null;

    app.on("second-instance", () => {
        const [win] = BrowserWindow.getAllWindows();
        if (win) {
            if (win.isMinimized()) win.restore();
            win.focus();
        }
    });

    app.whenReady().then(async () => {
        Menu.setApplicationMenu(null);
        fs.mkdirSync(REPORTS_DIR, { recursive: true });
        appUrl = await startServer();
        console.log(`SEO Auditor serving ${appUrl} (reports in ${REPORTS_DIR})`);
        createWindow(appUrl);

        app.on("activate", () => {
            if (BrowserWindow.getAllWindows().length === 0) createWindow(appUrl);
        });
    });

    app.on("window-all-closed", () => {
        if (process.platform !== "darwin") app.quit();
    });
}
