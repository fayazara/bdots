---
name: add-binding
description: >
  Adding a new Cloudflare binding (KV, R2, D1, Queue, secret, or environment
  variable) to this TanStack Start + Cloudflare Workers project. Use this
  skill whenever the user asks to add a binding, connect a new Cloudflare
  service, wire up KV/R2/D1/Queues, add a secret, or set an environment
  variable. Also trigger when the user says things like "I need caching"
  (KV), "add file storage" or "uploads" (R2), "set up a queue", "add a
  secret for my API key", "I need a database", or "add an env var". This
  template ships with no bindings, so this skill is the path for the first
  one too. It covers creating the resource with the `cf` CLI, declaring it
  in `cloudflare.config.ts`, and reading it via
  `import { env } from "cloudflare:workers"`.
---

# Skill: Add a Cloudflare Binding

This project uses the **`cf` CLI** and **`cloudflare.config.ts`**. There is no
`wrangler.jsonc`. Do not create one and do not run `wrangler` commands.

If anything below does not match what `cf` does, check the current docs (see
"Cloudflare docs" in `AGENTS.md`) —
`https://developers.cloudflare.com/cf/projects/cloudflare-config/index.md`.

## Workflow

### 1. Create the resource

Resources that hold data must exist before you deploy, and the binding must
carry the resource's identifier. If you skip this, `cf deploy` silently
provisions a brand-new resource for every binding without an ID.

Creating a resource needs credentials. If `cf auth whoami` fails, ask the
user to run `cf auth login` (it opens a browser).

```bash
cf d1 create --name my-app-db                 # → result.uuid is the database ID
cf r2 buckets create --name my-app-storage    # buckets are identified by name
cf kv namespaces create --title my-app-cache  # → result.id is the namespace ID
```

Add `--dry-run` to any of these to preview the request without sending it.
For other products, find the command with
`cf cli search "create <resource type>"`.

Secrets and plain variables have no resource to create.

### 2. Declare it in `cloudflare.config.ts`

Bindings go in `worker.env`, built with the `bindings` helpers:

```ts
import { bindings, defineConfig } from "cf/config"

export default defineConfig({
  worker: {
    // ...
    env: {
      // D1 — always include the id
      DB: bindings.d1({ name: "my-app-db", id: "<DATABASE_ID>" }),

      // R2
      STORAGE: bindings.r2({ name: "my-app-storage" }),

      // KV
      CACHE: bindings.kv({ id: "<NAMESPACE_ID>" }),

      // Queue producer (type the message body)
      JOBS: bindings.queue<{ type: string }>({ name: "my-app-jobs" }),

      // Plain variable
      APP_ENV: bindings.text("production"),

      // JSON variable
      FEATURES: bindings.json({ search: true }),

      // Secret (value set outside this file)
      API_KEY: bindings.secret(),
    },
  },
})
```

Other builders exist for every product (`bindings.ai()`,
`bindings.vectorize()`, `bindings.hyperdrive()`, `bindings.worker()`,
`bindings.durableObject()`, …). Look up their options before using them.

A queue **consumer** is a trigger, not a binding:

```ts
import { triggers } from "cf/config"

triggers: [triggers.queue({ name: "my-app-jobs", maxBatchSize: 10 })],
```

### 3. Types

`Env` is inferred from `cloudflare.config.ts`, so `env.DB`, `env.STORAGE`
etc. are typed as soon as you save the config. If the editor has not caught
up, or on a fresh clone:

```bash
pnpm cf-typegen   # writes .cloudflare/types/index.d.ts (git-ignored)
```

### 4. Use the binding

Import `env` from `cloudflare:workers` in server-side code:

```ts
import { env } from "cloudflare:workers"
```

#### KV

```ts
await env.CACHE.put("user:123", JSON.stringify(userData), {
  expirationTtl: 3600, // seconds
})

const raw = await env.CACHE.get("user:123")
const data = raw ? JSON.parse(raw) : null

await env.CACHE.delete("user:123")

const list = await env.CACHE.list({ prefix: "user:" })
```

#### R2

```ts
// Upload
await env.STORAGE.put("photos/cat.jpg", fileBody, {
  httpMetadata: { contentType: "image/jpeg" },
})

// Download
const object = await env.STORAGE.get("photos/cat.jpg")
if (object) {
  const body = object.body // ReadableStream
  const contentType = object.httpMetadata?.contentType
}

// Delete
await env.STORAGE.delete("photos/cat.jpg")

// List
const listed = await env.STORAGE.list({ prefix: "photos/", limit: 100 })
```

A complete R2 API route (list, download, upload, delete):

```ts
// src/routes/api/files.ts  →  /api/files?key=photos/cat.jpg
import { createFileRoute } from "@tanstack/react-router"
import { env } from "cloudflare:workers"

export const Route = createFileRoute("/api/files")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url)
        const key = url.searchParams.get("key")

        if (!key) {
          const prefix = url.searchParams.get("prefix") ?? undefined
          const listed = await env.STORAGE.list({ prefix, limit: 100 })
          return Response.json({
            objects: listed.objects.map((o) => ({
              key: o.key,
              size: o.size,
              uploaded: o.uploaded,
            })),
            truncated: listed.truncated,
          })
        }

        const object = await env.STORAGE.get(key)
        if (!object) {
          return Response.json({ error: "Not found" }, { status: 404 })
        }
        return new Response(object.body, {
          headers: {
            "content-type":
              object.httpMetadata?.contentType ?? "application/octet-stream",
            etag: object.httpEtag,
          },
        })
      },

      PUT: async ({ request }) => {
        const key = new URL(request.url).searchParams.get("key")
        if (!key) {
          return Response.json(
            { error: "Missing ?key= parameter" },
            { status: 400 }
          )
        }
        const contentType = request.headers.get("content-type") ?? undefined
        const object = await env.STORAGE.put(key, request.body, {
          httpMetadata: contentType ? { contentType } : undefined,
        })
        return Response.json(
          { key: object.key, size: object.size, uploaded: object.uploaded },
          { status: 201 }
        )
      },

      DELETE: async ({ request }) => {
        const key = new URL(request.url).searchParams.get("key")
        if (!key) {
          return Response.json(
            { error: "Missing ?key= parameter" },
            { status: 400 }
          )
        }
        await env.STORAGE.delete(key)
        return new Response(null, { status: 204 })
      },
    },
  },
})
```

#### D1

Use Drizzle, not raw SQL — load the `new-db-table` skill, which sets up
`src/db` and migrations. Raw access, if you ever need it:

```ts
const { results } = await env.DB.prepare("SELECT * FROM users WHERE id = ?")
  .bind(userId)
  .all()
```

#### Queue

```ts
await env.JOBS.send({ type: "email" })

await env.JOBS.sendBatch([
  { body: { type: "email" } },
  { body: { type: "sms" } },
])
```

#### Secrets and variables

```ts
env.API_KEY // string
env.APP_ENV // "production"
```

- Local secret values go in `.dev.vars` (copy `.dev.vars.example`; it is
  git-ignored). `cf dev` warns when a declared secret is missing.
- Production secret values are uploaded with a deploy:
  `cf deploy --secrets-file <PATH>` (JSON or `.env` format).

### 5. Verify

```bash
pnpm typecheck
cf deploy --dry-run   # prints the bindings that would be deployed; uploads nothing
```

Then run `pnpm dev` and exercise the code. Local dev simulates every binding
on disk under `.cloudflare/state/` — no remote resource is read or written.
While the dev server runs you can inspect local data at
`http://localhost:3000/cdn-cgi/local/explorer/api`.

## Common mistakes to avoid

- **Wrong**: Adding a D1 or KV binding without an `id`. `cf deploy` will
  provision a new, empty resource and not tell the config about it.
- **Wrong**: Creating `wrangler.jsonc` or running `wrangler d1 create`,
  `wrangler r2 bucket create`, `wrangler types`, `wrangler deploy`.
- **Wrong**: Passing a database *name* to a `cf d1 …` command. `cf` takes IDs.
- **Wrong**: Importing `env` in a client component. `cloudflare:workers` is
  server-only.
- **Wrong**: Passing `env` as a function argument. Import it where needed.
- **Wrong**: Using `process.env` for bindings.
- **Wrong**: Putting secret values in `cloudflare.config.ts`. Declare with
  `bindings.secret()` and supply the value via `.dev.vars` / `--secrets-file`.
- **Wrong**: Adding bindings "just in case". Add only what the feature uses.
