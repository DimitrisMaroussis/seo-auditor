/*
 * `npm run desktop` launcher. Starts Electron on this project with
 * ELECTRON_RUN_AS_NODE removed: editors such as VS Code set it for the
 * processes they start, and with it Electron runs as plain Node with no window.
 */
const { spawn } = require("child_process");
const path = require("path");
const electron = require("electron"); // in Node, this is the path to the Electron binary

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electron, [path.join(__dirname, "..")], { stdio: "inherit", env });
child.on("exit", code => process.exit(code ?? 0));
