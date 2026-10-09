import { useEffect, useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { Button } from "@cloudflare/kumo/components/button"
import { Input } from "@cloudflare/kumo/components/input"
import { SensitiveInput } from "@cloudflare/kumo/components/sensitive-input"
import { PlugsConnectedIcon, PlusIcon, TrashIcon } from "@/components/icons"
import { EmptyState } from "@/components/empty-state"
import { connectionStatus } from "@/lib/connection-status"
import { useHub } from "@/lib/hub-context"
import type { Connection } from "@/lib/types"

export const Route = createFileRoute("/_app/connections")({
  // Set by the sign-in callback when an app's OAuth flow fails.
  validateSearch: (search: Record<string, unknown>): { error?: string } =>
    typeof search.error === "string" ? { error: search.error } : {},
  component: Connections,
})

interface HeaderRow {
  key: number
  name: string
  value: string
}

// Executor on Cloudflare sits behind Access; bots sign in with a service token.
const EXECUTOR_HEADERS = ["CF-Access-Client-Id", "CF-Access-Client-Secret"]

let nextKey = 0
function emptyRow(name = ""): HeaderRow {
  return { key: nextKey++, name, value: "" }
}

function AddConnection() {
  const hub = useHub()
  const [name, setName] = useState("")
  const [url, setUrl] = useState("")
  const [headers, setHeaders] = useState<HeaderRow[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function update(key: number, patch: Partial<HeaderRow>) {
    setHeaders((rows) =>
      rows.map((row) => (row.key === key ? { ...row, ...patch } : row))
    )
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      new URL(url)
    } catch {
      setError("Enter the full URL of the MCP endpoint, starting with https://")
      return
    }
    const missing = headers.find((h) => h.name.trim() && !h.value)
    if (missing) {
      setError(`Add a value for ${missing.name}, or remove that header.`)
      return
    }
    setSaving(true)
    try {
      await hub.addConnection({
        name,
        url,
        headers: Object.fromEntries(
          headers
            .filter((h) => h.name.trim())
            .map((h) => [h.name.trim(), h.value])
        ),
      })
      setName("")
      setUrl("")
      setHeaders([])
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not add that connection."
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <form
      onSubmit={(e) => void submit(e)}
      className="space-y-4 rounded-2xl border border-kumo-line p-4"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-kumo-default">
          Add a connection
        </h2>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => {
            setName((n) => n || "Executor")
            setHeaders(EXECUTOR_HEADERS.map((h) => emptyRow(h)))
          }}
        >
          Use Executor preset
        </Button>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          label="Name"
          placeholder="Executor"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Input
          label="MCP endpoint"
          placeholder="https://executor.example.com/mcp"
          type="url"
          inputMode="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
      </div>

      {headers.length > 0 ? (
        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm font-medium text-kumo-default">
            Request headers
          </legend>
          {headers.map((row) => (
            <div key={row.key} className="flex items-center gap-2">
              <Input
                aria-label="Header name"
                placeholder="Authorization"
                className="w-64"
                value={row.name}
                onChange={(e) => update(row.key, { name: e.target.value })}
              />
              <SensitiveInput
                aria-label={`Value for ${row.name || "header"}`}
                className="flex-1"
                value={row.value}
                onChange={(e) => update(row.key, { value: e.target.value })}
              />
              <Button
                type="button"
                variant="ghost"
                shape="square"
                icon={<TrashIcon />}
                aria-label={`Remove ${row.name || "header"}`}
                onClick={() =>
                  setHeaders((rows) => rows.filter((r) => r.key !== row.key))
                }
              />
            </div>
          ))}
        </fieldset>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-kumo-danger">
          {error}
        </p>
      ) : null}

      <div className="flex items-center gap-2">
        <Button
          type="submit"
          variant="primary"
          className="btn-ink"
          loading={saving}
          disabled={!hub.live || !url.trim()}
        >
          Connect
        </Button>
        <Button
          type="button"
          variant="ghost"
          icon={<PlusIcon />}
          onClick={() => setHeaders((rows) => [...rows, emptyRow()])}
        >
          Add header
        </Button>
      </div>
    </form>
  )
}

function ConnectionRow({ connection }: { connection: Connection }) {
  const hub = useHub()
  const [removing, setRemoving] = useState(false)
  const needsSignIn = connection.status === "authenticating"

  const [retrying, setRetrying] = useState(false)
  const failed = ![
    "ready",
    "authenticating",
    "connecting",
    "discovering",
  ].includes(connection.status)

  async function retry() {
    setRetrying(true)
    try {
      await hub.reconnect(connection.id)
    } finally {
      setRetrying(false)
    }
  }

  async function remove() {
    setRemoving(true)
    try {
      await hub.removeConnection(connection.id)
    } finally {
      setRemoving(false)
    }
  }

  return (
    <li className="flex items-center gap-3 p-4">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-kumo-tint text-kumo-subtle">
        <PlugsConnectedIcon size={20} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-kumo-default">
          {connection.name}
        </p>
        <p className="truncate text-xs text-kumo-subtle">{connection.url}</p>
        <p
          className={`mt-0.5 truncate text-xs ${
            connection.status === "ready"
              ? "text-kumo-subtle"
              : "text-kumo-warning"
          }`}
        >
          {connectionStatus(connection)}
          {connection.headerNames.length > 0
            ? ` · sends ${connection.headerNames.join(", ")}`
            : ""}
        </p>
      </div>
      {needsSignIn && connection.authUrl ? (
        // One sign-in for the whole account; every bot uses the result.
        <a
          href={connection.authUrl}
          className="pressable inline-flex h-8 shrink-0 items-center rounded-lg bg-kumo-contrast px-3 text-sm font-medium text-kumo-inverse outline-none focus-visible:ring-2 focus-visible:ring-kumo-focus"
        >
          Sign in
        </a>
      ) : null}
      {failed ? (
        <Button
          variant="secondary"
          size="sm"
          loading={retrying}
          disabled={!hub.live}
          onClick={() => void retry()}
        >
          Try again
        </Button>
      ) : null}
      <Button
        variant="secondary-destructive"
        size="sm"
        loading={removing}
        disabled={!hub.live}
        onClick={() => void remove()}
      >
        Remove
      </Button>
    </li>
  )
}

function Connections() {
  const hub = useHub()
  const { error } = Route.useSearch()
  const { live, refreshConnections } = hub

  // Pick up a sign-in that just finished in this tab.
  useEffect(() => {
    if (live) refreshConnections()
  }, [live, refreshConnections])
  return (
    <div className="min-w-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-[720px] space-y-6 px-6 py-12">
        <header className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight text-kumo-default">
            Connections
          </h1>
          <p className="text-[15px] text-pretty text-kumo-subtle">
            Bots reach your apps through their APIs first and only open a
            browser when there is no API. Connect an{" "}
            <a
              href="https://executor.sh/docs/hosted/cloudflare"
              target="_blank"
              rel="noreferrer noopener"
              className="text-kumo-link underline"
            >
              Executor
            </a>{" "}
            gateway to give them Gmail, Calendar, Sheets and the rest with one
            endpoint, or add any MCP server directly. Tokens stay on the server
            and are never shown to a model.
          </p>
        </header>

        {error ? (
          <p
            role="alert"
            className="rounded-xl bg-kumo-danger-tint px-4 py-3 text-sm text-kumo-danger"
          >
            Sign-in didn't finish: {error}
          </p>
        ) : null}

        {hub.state.connections.length === 0 ? (
          <EmptyState
            className="py-8"
            icon={<PlugsConnectedIcon size={24} />}
            title="No connections yet"
            description="Add one below. Every bot can use every connection, and you only sign in once."
          />
        ) : (
          <ul className="divide-y divide-kumo-line rounded-2xl border border-kumo-line">
            {hub.state.connections.map((connection) => (
              <ConnectionRow key={connection.id} connection={connection} />
            ))}
          </ul>
        )}

        <AddConnection />
      </div>
    </div>
  )
}
