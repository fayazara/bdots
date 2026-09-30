import { createFileRoute } from "@tanstack/react-router"
import { createServerFn } from "@tanstack/react-start"
import { useState } from "react"
import { Button } from "@cloudflare/kumo/components/button"

/**
 * Server function example.
 *
 * `createServerFn` is a typed RPC between client and server, called as
 * `getServerInfo()` from anywhere (loader, event handler, effect). It runs
 * on the Worker.
 *
 * Prefer server functions for:
 *  - data this app's own UI consumes
 *  - end-to-end typed payloads (no hand-written fetch)
 *
 * Prefer API routes (see src/routes/api/hello.ts) for:
 *  - external/3rd-party HTTP callers (curl, mobile, webhooks)
 *  - things that need a stable URL + verb
 */
const getServerInfo = createServerFn().handler(() => {
  return {
    // "Cloudflare-Workers" when running on workerd (dev and production).
    runtime: navigator.userAgent,
    renderedAt: new Date().toISOString(),
  }
})

export const Route = createFileRoute("/")({
  loader: () => getServerInfo(),
  component: App,
})

function App() {
  const data = Route.useLoaderData()
  const [isPending, setIsPending] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function callApi() {
    setIsPending(true)
    setError(null)
    try {
      const res = await fetch("/api/hello", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "TanStack Start" }),
      })
      const body = (await res.json().catch(() => null)) as {
        message?: string
        error?: string
      } | null
      if (!res.ok) {
        throw new Error(body?.error ?? `Request failed: ${res.status}`)
      }
      setMessage(body?.message ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error")
    } finally {
      setIsPending(false)
    }
  }

  return (
    <div className="flex min-h-svh p-6">
      <div className="flex max-w-md min-w-0 flex-col gap-4 text-sm leading-loose">
        <div>
          <h1 className="font-medium">TanStack Start + Cloudflare Workers</h1>
          <p>
            Rendered on <span className="font-medium">{data.runtime}</span> at{" "}
            {data.renderedAt}.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <p className="font-medium">Try it:</p>
          <pre className="rounded bg-gray-100 p-2 text-xs dark:bg-gray-800 dark:text-white">
            {`# read
curl http://localhost:3000/api/hello?name=you

# write
curl -X POST http://localhost:3000/api/hello \\
  -H 'content-type: application/json' \\
  -d '{"name":"you"}'`}
          </pre>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              onClick={callApi}
              disabled={isPending}
              loading={isPending}
            >
              {isPending ? "Calling..." : "Call the API route"}
            </Button>
          </div>
          {message ? <p className="text-xs">{message}</p> : null}
          {error ? <p className="text-xs text-red-600">{error}</p> : null}
        </div>

        <p className="text-xs text-gray-500">
          No database or storage is provisioned yet. Ask your agent to add D1,
          R2 or KV when you need it — AGENTS.md has the steps.
        </p>
      </div>
    </div>
  )
}
