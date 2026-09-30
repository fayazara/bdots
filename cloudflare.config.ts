import { bindings, defineConfig, exports } from "cf/config"

const WORKER_NAME = "bdots"

/**
 * Cloudflare project config, read by the `cf` CLI and the Cloudflare Vite
 * plugin. This replaces wrangler.jsonc.
 *
 * One Worker serves everything: TanStack Start SSR, the agent WebSockets
 * (`/agents/*`), and the Durable Objects behind them. See `src/server.ts`.
 */
export default defineConfig({
  worker: {
    name: WORKER_NAME,
    compatibilityDate: "2026-09-01",
    // `experimental` is required by the @cloudflare/computer worker-shell
    // backend (just-bash in a Dynamic Worker).
    compatibilityFlags: ["nodejs_compat", "experimental"],
    // Custom entry (not "@tanstack/react-start/server-entry") so the Worker
    // can export Durable Object classes and route /agents/* first.
    entrypoint: "./src/server.ts",
    observability: {
      enabled: true,
    },
    exports: {
      // One per user: bot directory, connections, cross-bot routing.
      UserHub: exports.durableObject({ storage: "sqlite" }),
      // One per bot: chat, memory, routines, computer, browser.
      BotAgent: exports.durableObject({ storage: "sqlite" }),
    },
    env: {
      // Workers AI + AI Gateway for all model traffic. Neither this nor
      // Browser Run has a local simulator, so dev proxies to the account.
      AI: bindings.ai({ dev: { remote: true } }),
      // Browser Run: Quick Actions, Chromium sessions, Live View.
      BROWSER: bindings.browser({ dev: { remote: true } }),
      // Dynamic Workers: the bot's shell and sandboxed browser code.
      LOADER: bindings.workerLoader(),
      UserHub: bindings.durableObject({
        worker: WORKER_NAME,
        exportName: "UserHub",
      }),
      BotAgent: bindings.durableObject({
        worker: WORKER_NAME,
        exportName: "BotAgent",
      }),
      // Main chat model. A "@cf/..." id hits Workers AI; a
      // "<provider>/<model>" slug is routed through AI Gateway.
      MODEL: bindings.text("@cf/deepseek-ai/deepseek-v4-flash-0731"),
      // Optional AI Gateway id. When set, Workers AI calls go through it
      // too (logs, caching, spend limits).
      AI_GATEWAY_ID: bindings.text(""),
    },
  },
})
