import { createRequire } from "node:module";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// The auditor is CommonJS in the parent folder; its API runs audits and serves
// saved reports from ../reports. Mounting it here means `npm run dev` starts
// the dashboard and the API together.
const require = createRequire(import.meta.url);
const { createApi } = require("../src/api.js");

function auditApi(): Plugin {
  return {
    name: "seo-audit-api",
    configureServer(server) {
      server.middlewares.use(createApi());
    },
    configurePreviewServer(server) {
      server.middlewares.use(createApi());
    }
  };
}

export default defineConfig({
  plugins: [react(), auditApi()]
});
