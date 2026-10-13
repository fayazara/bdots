# bdots

AI teammates with their own computer and browser, built on Cloudflare. The
full spec is in [`product.md`](./product.md).

You create several bots (Chief, Sales Outbound, Inbox Manager…). Each one is
its own Durable Object with its own chat history, memory, routines, a durable
file system with a shell, and a browser it can hand to you when it needs a
login.

> [!NOTE]
> `@cloudflare/computer`, `@cloudflare/think`, the `cf` CLI and the Cloudflare
> Vite plugin 2.0 are all preview or beta. Expect things to move.

## What works today

- Multiple bots per user, with a live sidebar (status, preview, unread)
- Chat with streaming, resumable turns and a bot that names itself from its
  first task
- A computer per bot: files under `/workspace` plus a shell that runs in a
  Dynamic Worker (no container)
- Browser tools: stateless page reads, and a persistent Chromium session
  with Live View
- Hand-off: the bot asks you to sign in, you take over its browser, then it
  continues in the same session
- Rules per bot (allow / ask first / block) with approval cards in the thread
- Routines (cron or one-off), memory the bot maintains, bot-to-bot messages
- Connections: add [Executor Cloud](https://executor.sh), a self-hosted
  Executor, or any MCP server. You sign in once and every bot can use it

Not built yet: Jev classification, inbound email and webhooks, Kitesurf,
the container backend, R2 screenshots, group threads, login vault.

## Setup

```bash
npm i -g cf          # once per machine
pnpm install
npx wrangler login   # once: the dev server needs it for Workers AI and Browser Run
pnpm dev             # http://localhost:3000
```

Workers AI and Browser Run have no local simulator, so `pnpm dev` talks to
your Cloudflare account for those two bindings. Everything else (Durable
Objects, the bots' files and shell) runs locally under `.cloudflare/state/`.

If your login can see more than one account, pick one:

```bash
CLOUDFLARE_ACCOUNT_ID=<id> pnpm dev
```

To deploy:

```bash
cf auth login        # once
pnpm run deploy
```

Without Cloudflare Access in front of the Worker, every visitor is the same
`demo` user. Put it behind Access before sharing a deployment. See
`src/lib/auth.ts`. Add a bypass policy for `/api/hooks/*` and `/apps/*`:
both authenticate with a token in the URL.

## Apps

A bot can build small web apps from its own data, like a trip itinerary, a
tracker or a dashboard. Ask it to build one. Each app:

- is a folder in the bot's computer (`/workspace/apps/<slug>/`) with
  `index.html`, static files, and an optional `server.js` that runs in a
  Dynamic Worker with no internet access
- reads and writes collections stored in the bot's SQLite through
  `window.bdots` (served at `./_bdots.js`), and updates live over a
  WebSocket (`AppLive` Durable Object)
- is served at `/apps/<user>/<bot>/<slug>/<token>/` in a CSP sandbox, so its
  code can't reach the bdots UI
- can be shared from Computer → Apps with revocable links (edit or view
  only). When someone edits through a link, the bot gets a background turn
  telling it who changed what

## Configuration

Set in `cloudflare.config.ts`:

| Variable        | Purpose                                                                                               |
| --------------- | ----------------------------------------------------------------------------------------------------- |
| `MODEL`         | Chat model. A `@cf/...` id uses Workers AI; a `<provider>/<model>` slug is routed through AI Gateway. |
| `AI_GATEWAY_ID` | Optional. When set, Workers AI calls also go through that AI Gateway (logs, caching, spend limits).   |

## Scripts

| script      | what it does                                               |
| ----------- | ---------------------------------------------------------- |
| `dev`       | `cf dev` — Vite dev server on workerd, port 3000           |
| `build`     | `cf build` — production build into `.cloudflare/output/`   |
| `deploy`    | `cf deploy` — build, upload and deploy (`pnpm run deploy`) |
| `typecheck` | Regenerate binding types, then `tsc`                       |
| `format`    | Prettier                                                   |

## Project layout

```
src/
  server.ts              # Worker entry: routes /agents/*, exports the Durable Objects
  agents/
    user-hub.ts          # one per user: bot directory, connections, bot-to-bot relay
    bot-agent.ts         # one per bot: Think agent, tools, rules, routines, computer, browser
    prompt.ts            # system prompt
    app-store.ts         # apps, share links and app data (bot SQLite)
    apps-runtime.ts      # serves /apps/*, AppLive (realtime), env.BOT for server.js
  routes/
    _app.tsx             # sidebar layout
    _app/bots.$botId.tsx # thread, with computer and settings side panels
    _app/connections.tsx
  components/            # thread, Computer card, take-over dialog, panels
  lib/                   # shared types, server functions, contexts
cloudflare.config.ts     # Worker config + bindings (read by cf)
AGENTS.md                # read this if you're an AI agent
```
