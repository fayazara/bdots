import { createFileRoute } from "@tanstack/react-router"
import { z } from "zod"

/**
 * API route at `/api/hello`.
 *
 * In TanStack Start, API routes are file-based routes that define
 * `server.handlers` instead of (or alongside) a `component`. Handlers
 * receive a Web `Request` and return a Web `Response`.
 *
 * The file lives at `src/routes/api/hello.ts` so its URL is `/api/hello`.
 * Use `$` segments for params, e.g. `src/routes/api/hello.$id.ts`
 * → `/api/hello/:id`.
 */
const bodySchema = z.object({
  name: z.string().min(1).max(100),
})

export const Route = createFileRoute("/api/hello")({
  server: {
    handlers: {
      // GET /api/hello?name=... → greeting
      GET: ({ request }) => {
        const name = new URL(request.url).searchParams.get("name") ?? "world"
        return Response.json({ message: `Hello, ${name}!` })
      },

      // POST /api/hello → greeting
      // Body: { name: string }
      POST: async ({ request }) => {
        let body: unknown
        try {
          body = await request.json()
        } catch {
          return Response.json({ error: "Invalid JSON" }, { status: 400 })
        }

        const parsed = bodySchema.safeParse(body)
        if (!parsed.success) {
          return Response.json(
            { error: "Validation failed", issues: parsed.error.issues },
            { status: 400 }
          )
        }

        return Response.json(
          { message: `Hello, ${parsed.data.name}!` },
          { status: 201 }
        )
      },
    },
  },
})
