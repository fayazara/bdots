# TanStack Start + Cloudflare Workers Template

A minimal, agent-first starter for building full-stack apps on Cloudflare
Workers with TanStack Start and the [`cf` CLI](https://developers.cloudflare.com/cf/).

> [!NOTE]
> This is a highly opinionated starter kit made specifically for coding
> agents (Claude Code, opencode, Codex, …). `cf` and the Cloudflare Vite
> plugin 2.0 are both in beta, so expect things to move.

**Includes:**

- TanStack Start on Vite, deployed as a Cloudflare Worker
- `cloudflare.config.ts` — typed config for the `cf` CLI (no `wrangler.jsonc`)
- **Zero bindings by default** — no database or bucket is created until a
  project asks for one
- Drizzle ORM + Drizzle Kit + drizzle-zod installed, ready for D1
- Example **server function** (`/`) — typed RPC for UI data
- Example **API route** (`/api/hello`) — GET + POST with Zod validation
- Tailwind v4 + Kumo (`@cloudflare/kumo`) + Phosphor icons
- An `AGENTS.md` and skills that teach agents the patterns they get wrong

## Setup

```bash
npm i -g cf      # once per machine
pnpm install
pnpm dev         # http://localhost:3000
```

Nothing needs to be created on Cloudflare to run locally. To deploy:

```bash
cf auth login    # once
pnpm run deploy
```

Before the first deploy of a real project, rename `worker.name` in
`cloudflare.config.ts` and `name` in `package.json`.

## Adding a database, storage, or other bindings

The template ships without bindings on purpose. Ask your agent:

> add a D1 database with a `posts` table

> add an R2 bucket for file uploads

`AGENTS.md` and the skills in `.agents/skills/` give it the exact steps:
create the resource with `cf`, declare it in `cloudflare.config.ts`, set up
Drizzle, generate and apply migrations.

## Scripts

| script        | what it does                                              |
| ------------- | --------------------------------------------------------- |
| `dev`         | `cf dev` — Vite dev server on workerd, port 3000           |
| `build`       | `cf build` — production build into `.cloudflare/output/`   |
| `deploy`      | `cf deploy` — build, upload and deploy (`pnpm run deploy`) |
| `typecheck`   | Regenerate binding types, then `tsc`                       |
| `cf-typegen`  | `cf workers types` → `.cloudflare/types/index.d.ts`        |
| `db:generate` | Generate SQL migrations from `src/db/schema.ts`            |
| `format`      | Prettier                                                   |

## Project layout

```
src/
  routes/
    __root.tsx
    index.tsx          # server function example
    api/
      hello.ts         # API route (GET + POST)
cloudflare.config.ts   # Worker config + bindings (read by cf)
vite.config.ts         # plugins, dev port, source maps
drizzle.config.ts      # drizzle-kit config (used once a DB is added)
AGENTS.md              # read this if you're an AI agent
.agents/skills/        # step-by-step recipes for agents
```

## Cloudflare docs for agents

`AGENTS.md` tells agents to look Cloudflare things up rather than guess:
first through the [Cloudflare Docs MCP server](https://developers.cloudflare.com/agents/model-context-protocol/cloudflare/servers-for-cloudflare/)
if it is installed, otherwise by fetching Markdown from
`https://developers.cloudflare.com/`. To install the MCP server:

```json
{
  "mcpServers": {
    "cloudflare-docs": {
      "url": "https://docs.mcp.cloudflare.com/mcp"
    }
  }
}
```

## Why AGENTS.md?

TanStack Start, the Workers Vite plugin and the `cf` CLI all moved faster
than LLM training data. Without guidance, agents generate old APIs like
`createServerFileRoute`, mount a Hono app inside the Worker entry, write a
`wrangler.jsonc`, or pass `env` around as a parameter. `AGENTS.md` documents
what currently works so an agent gets the right pattern on the first try.
