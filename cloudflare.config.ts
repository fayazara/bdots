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
      // One per app a bot built: live updates to everyone who has it open.
      AppLive: exports.durableObject({ storage: "sqlite" }),
    },
    env: {
      // Workers AI + AI Gateway for all model traffic. Neither this nor
      // Browser Run has a local simulator, so dev proxies to the account.
      AI: bindings.ai({ dev: { remote: true } }),
      // Browser Run: Quick Actions, Chromium sessions, Live View.
      BROWSER: bindings.browser({ dev: { remote: true } }),
      // Engine Quick Actions try first for page reads and extraction:
      // "kitesurf" (cheaper, falls back to Chromium when a page does not
      // render) or "chromium". Screenshots and PDFs always use Chromium.
      QUICK_ACTION_ENGINE: bindings.text("kitesurf"),
      // Optional: turns on the browser_crawl tool. /crawl is REST-only, so
      // it needs the account id here and an API token with "Browser
      // Rendering - Edit" in .dev.vars / the deploy secrets file.
      BROWSER_RUN_ACCOUNT_ID: bindings.text(""),
      BROWSER_RUN_API_TOKEN: bindings.secret(),
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
      AppLive: bindings.durableObject({
        worker: WORKER_NAME,
        exportName: "AppLive",
      }),
      // Main chat model. A "@cf/..." id hits Workers AI; a
      // "<provider>/<model>" slug is routed through AI Gateway.
      // Agentic browser work needs a strong model: a small one tends to loop
      // on a failing approach instead of switching or asking. For example
      // "anthropic/claude-sonnet-5-5" or "openai/<model>" (AI Gateway with
      // Unified Billing or stored provider keys).
      MODEL: bindings.text("@cf/deepseek-ai/deepseek-v4.1-flash-1017"),
      // Optional model for background turns (routines, check-ins, email).
      // Empty uses MODEL. Lets a cheap model run scheduled work while chat
      // uses a strong one.
      BACKGROUND_MODEL: bindings.text(""),
      // Optional AI Gateway id. When set, Workers AI calls go through it
      // too (logs, caching, spend limits).
      AI_GATEWAY_ID: bindings.text(""),
      // Domain with Email Routing that forwards to this Worker (catch-all
      // or one rule per bot). Each bot gets <user>.<bot>@EMAIL_DOMAIN.
      // Empty turns inbound email off.
      EMAIL_DOMAIN: bindings.text(""),
      // Web Push. Generate a pair with `npx web-push generate-vapid-keys`
      // and put both keys in .dev.vars / the deploy secrets file. Push
      // notifications stay off until they are set.
      VAPID_PUBLIC_KEY: bindings.secret(),
      VAPID_PRIVATE_KEY: bindings.secret(),
      VAPID_SUBJECT: bindings.text("mailto:bots@example.com"),
    },
  },
})
