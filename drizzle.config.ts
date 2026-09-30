import { defineConfig } from "drizzle-kit"

/**
 * Drizzle Kit only *generates* SQL migrations (`pnpm db:generate`).
 * Migrations are *applied* by the cf CLI:
 *
 *   cf d1 migrations apply <DATABASE_ID> --dir drizzle [--local --persist-to .cloudflare/state]
 *
 * `src/db/schema.ts` does not exist until the project adds a database —
 * see AGENTS.md → "Database — D1 + Drizzle".
 */
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
})
