import { defineConfig } from "cf/config"

/**
 * Cloudflare project config, read by the `cf` CLI and the Cloudflare Vite
 * plugin. This replaces wrangler.jsonc.
 *
 * The template ships with NO bindings on purpose, so a fresh project never
 * provisions a database or bucket it doesn't use. Add them to `worker.env`
 * when the project needs them (see AGENTS.md → "Adding a binding"):
 *
 *   import { bindings, defineConfig } from "cf/config"
 *
 *   env: {
 *     DB: bindings.d1({ name: "my-app-db", id: "<DATABASE_ID>" }),
 *     STORAGE: bindings.r2({ name: "my-app-storage" }),
 *   },
 */
export default defineConfig({
  worker: {
    name: "tanstack-start-workers-template",
    compatibilityDate: "2026-09-01",
    compatibilityFlags: ["nodejs_compat"],
    entrypoint: "@tanstack/react-start/server-entry",
    observability: {
      enabled: true,
    },
    env: {},
  },
})
