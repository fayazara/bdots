---
name: new-db-table
description: >
  Setting up the database (Cloudflare D1 + Drizzle ORM) for the first time,
  adding a table, modifying the schema, or creating a new model/entity in
  this TanStack Start + Cloudflare Workers project. Use this skill whenever
  the user asks to add a database, persist data, add a table, create a
  model, define a new entity, add columns, change the schema, or anything
  involving `src/db/`. Also trigger when the user says things like "I need a
  users table", "add a posts model", "store X in the database", "add a field
  to...", or "set up the DB". This template ships WITHOUT a database, so the
  skill starts with one-time setup. It covers the D1 binding, Drizzle column
  types for SQLite/D1, the migration workflow (generate with drizzle-kit,
  apply with the `cf` CLI), Zod schema derivation with drizzle-zod, and
  common pitfalls like using Postgres types on D1.
---

# Skill: Database — D1 + Drizzle

`drizzle-orm`, `drizzle-zod` and `drizzle-kit` are already installed, and
`drizzle.config.ts` already points at `src/db/schema.ts` → `./drizzle`.
What does **not** exist until you create it: the D1 database, the `DB`
binding, and `src/db/`.

If `src/db/index.ts` already exists, skip to "Add a table".

## One-time setup

### 1. Create the database and bind it

Needs credentials — if `cf auth whoami` fails, ask the user to run
`cf auth login`.

```bash
cf d1 create --name <app-name>-db
```

Copy `result.uuid` from the JSON output into `cloudflare.config.ts`:

```ts
import { bindings, defineConfig } from "cf/config"

export default defineConfig({
  worker: {
    // ...
    env: {
      DB: bindings.d1({ name: "<app-name>-db", id: "<DATABASE_ID>" }),
    },
  },
})
```

The `id` is required: `cf d1 migrations apply` only accepts a database UUID,
and a binding without one makes `cf deploy` provision a new empty database.

### 2. Create the Drizzle client

```ts
// src/db/index.ts
import { drizzle } from "drizzle-orm/d1"
import { env } from "cloudflare:workers"
import * as schema from "./schema"

/**
 * Drizzle client bound to the `DB` D1 binding (see cloudflare.config.ts).
 * Server-only: never import this from a client component.
 */
export const db = drizzle(env.DB, { schema })

export { schema }
```

### 3. Add migration scripts to `package.json`

Substitute the real database ID:

```json
{
  "scripts": {
    "predev": "pnpm db:migrate",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "cf d1 migrations apply <DATABASE_ID> --local --persist-to .cloudflare/state --dir drizzle",
    "db:migrate:prod": "cf d1 migrations apply <DATABASE_ID> --dir drizzle"
  }
}
```

- `--persist-to .cloudflare/state` is what makes `--local` write to the
  database the dev server reads. Without it, migrations land in a global
  directory and the app sees no tables.
- `--dir drizzle` matches `out` in `drizzle.config.ts` (`cf` defaults to
  `./migrations`).
- `predev` keeps local D1 in sync every time `pnpm dev` starts.
- `db:migrate:prod` has no `--local`, so it changes the **remote** database.
  Confirm with the user before running it.

Then continue with "Add a table".

## Add a table

### 1. Define it in `src/db/schema.ts`

All tables live in this one file. Use Drizzle's SQLite column builders:

```ts
import { sql } from "drizzle-orm"
import { int, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { createInsertSchema, createSelectSchema } from "drizzle-zod"
import type { z } from "zod"

export const posts = sqliteTable("posts", {
  id: int("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  body: text("body").notNull(),
  authorId: int("author_id").notNull(),
  publishedAt: int("published_at", { mode: "timestamp" }),
  createdAt: int("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
})
```

Common column patterns for D1 (SQLite):

- **Primary key**: `int("id").primaryKey({ autoIncrement: true })`
- **Text**: `text("name").notNull()`
- **Nullable text**: `text("bio")` (nullable by default)
- **Integer**: `int("count").notNull().default(0)`
- **Timestamp**: `int("created_at", { mode: "timestamp" }).notNull().default(sql\`(unixepoch())\`)`
- **Boolean (as int)**: `int("is_active", { mode: "boolean" }).notNull().default(true)`
- **Real/Float**: `real("price").notNull()`
- **JSON stored as text**: `text("metadata", { mode: "json" })`

### 2. Export types and Zod schemas

Always export these alongside the table:

```ts
// Inferred types
export type Post = typeof posts.$inferSelect
export type NewPost = typeof posts.$inferInsert

// Zod schemas for validation
export const selectPostSchema = createSelectSchema(posts)
export const insertPostSchema = createInsertSchema(posts, {
  title: (s) => s.min(1).max(200),
  body: (s) => s.min(1).max(50000),
}).pick({ title: true, body: true, authorId: true })

export type InsertPostInput = z.infer<typeof insertPostSchema>
```

The `.pick()` call is important — it restricts which fields the insert
schema accepts. Don't let callers set `id`, `createdAt`, or other
server-managed fields.

### 3. Generate and apply the migration

```bash
pnpm db:generate   # writes SQL to ./drizzle/
pnpm db:migrate    # applies to LOCAL D1
```

Check it landed:

```bash
cf d1 raw <DATABASE_ID> --local --persist-to .cloudflare/state \
  --sql "select name from sqlite_master where type = 'table'"
```

(`cf d1 query` has no local mode — use `cf d1 raw` locally.)

For production, only when the user asks for it:

```bash
pnpm db:migrate:prod   # applies to REMOTE D1
```

Commit the generated files in `./drizzle/` — they are the source of truth
for the schema history.

### 4. Use the table

From a server function or API route:

```ts
import { desc, eq } from "drizzle-orm"
import { db } from "@/db"
import { posts } from "@/db/schema"

// Select all
const allPosts = await db.select().from(posts).all()

// Select with filter
const userPosts = await db
  .select()
  .from(posts)
  .where(eq(posts.authorId, userId))
  .orderBy(desc(posts.createdAt))
  .all()

// Insert
const [created] = await db
  .insert(posts)
  .values({ title: "Hello", body: "World", authorId: 1 })
  .returning()

// Update
await db.update(posts).set({ title: "Updated" }).where(eq(posts.id, postId))

// Delete
await db.delete(posts).where(eq(posts.id, postId))
```

A typical API route on top of a table:

```ts
// src/routes/api/posts.ts  →  /api/posts
import { createFileRoute } from "@tanstack/react-router"
import { desc } from "drizzle-orm"
import { db } from "@/db"
import { insertPostSchema, posts } from "@/db/schema"

export const Route = createFileRoute("/api/posts")({
  server: {
    handlers: {
      GET: async () => {
        const rows = await db
          .select()
          .from(posts)
          .orderBy(desc(posts.createdAt))
          .all()
        return Response.json(rows)
      },

      POST: async ({ request }) => {
        let body: unknown
        try {
          body = await request.json()
        } catch {
          return Response.json({ error: "Invalid JSON" }, { status: 400 })
        }

        const parsed = insertPostSchema.safeParse(body)
        if (!parsed.success) {
          return Response.json(
            { error: "Validation failed", issues: parsed.error.issues },
            { status: 400 }
          )
        }

        const [created] = await db
          .insert(posts)
          .values(parsed.data)
          .returning()
        return Response.json(created, { status: 201 })
      },
    },
  },
})
```

## Common mistakes to avoid

- **Wrong**: Using `varchar` or `serial` — those are Postgres. D1 is
  SQLite. Use `text` and `int` with `autoIncrement`.
- **Wrong**: Forgetting `{ mode: "timestamp" }` on integer timestamp
  columns — without it, Drizzle treats them as plain numbers.
- **Wrong**: Running `drizzle-kit push` or `drizzle-kit migrate` — generate
  with drizzle-kit, apply with `cf d1 migrations apply`.
- **Wrong**: Running `wrangler d1 …`. This project has no Wrangler config.
- **Wrong**: Passing the database name or binding name to `cf d1 …`. It
  takes the database UUID.
- **Wrong**: `--local` without `--persist-to .cloudflare/state`. The dev
  server will not see the result.
- **Wrong**: Editing migration files by hand after they've been applied.
  Generate a new migration instead.
- **Wrong**: Importing `db` from a client component. It uses
  `cloudflare:workers`, which is server-only.
