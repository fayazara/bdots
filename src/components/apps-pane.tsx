import { useCallback, useEffect, useRef, useState } from "react"
import { Badge } from "@cloudflare/kumo/components/badge"
import { Button } from "@cloudflare/kumo/components/button"
import { ClipboardText } from "@cloudflare/kumo/components/clipboard-text"
import { Input } from "@cloudflare/kumo/components/input"
import { Loader } from "@cloudflare/kumo/components/loader"
import { Select } from "@cloudflare/kumo/components/select"
import {
  AppWindowIcon,
  ArrowLeftIcon,
  ArrowSquareOutIcon,
  TrashIcon,
  XIcon,
} from "@/components/icons"
import { EmptyState } from "@/components/empty-state"
import { useBot } from "@/lib/bot-context"
import type { BotConnection } from "@/lib/bot-context"
import type { AppLink, BotAppDetail } from "@/lib/types"

const MODE_LABELS: Record<AppLink["mode"], string> = {
  edit: "Can edit",
  view: "View only",
}

function absolute(path: string) {
  return typeof window === "undefined"
    ? path
    : `${window.location.origin}${path}`
}

function formatAgo(at: number) {
  const minutes = Math.round((Date.now() - at) / 60_000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return new Date(at).toLocaleDateString([], { day: "numeric", month: "short" })
}

/** Apps the bot built: preview, open, share by link, revoke, delete. */
export function AppsPane({ agent }: { agent: BotConnection }) {
  const { state } = useBot()
  const [apps, setApps] = useState<BotAppDetail[] | null>(null)
  const [selected, setSelected] = useState<string | null>(null)

  const load = useCallback(async () => {
    setApps(await agent.stub.getApps())
  }, [agent])

  // state.apps changes whenever the bot publishes, so this stays current.
  useEffect(() => {
    void load()
  }, [load, state.apps])

  if (apps === null) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader />
      </div>
    )
  }

  const app = apps.find((a) => a.slug === selected)
  if (app) {
    return (
      <AppDetail
        agent={agent}
        app={app}
        onBack={() => setSelected(null)}
        onChanged={load}
      />
    )
  }

  if (apps.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center pb-16">
        <EmptyState
          icon={<AppWindowIcon size={24} />}
          title="No apps yet"
          description={`Ask ${state.name} to build one, like a page for your next trip.`}
        />
      </div>
    )
  }

  return (
    <ul className="grid min-h-0 flex-1 auto-rows-min grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-x-4 gap-y-5 overflow-y-auto px-4 pt-2 pb-4">
      {apps.map((a) => {
        const owner = a.links.find((l) => l.owner)
        const shared = a.links.length - 1
        return (
          <li key={a.slug}>
            <button
              type="button"
              onClick={() => setSelected(a.slug)}
              className="group pressable flex w-full flex-col gap-2.5 rounded-xl text-left outline-none focus-visible:ring-2 focus-visible:ring-kumo-focus focus-visible:ring-offset-4 focus-visible:ring-offset-kumo-canvas"
            >
              <AppThumbnail app={a} path={owner?.path} />
              <span className="min-w-0 px-0.5">
                <span className="block truncate text-sm font-medium text-kumo-default">
                  {a.name}
                </span>
                <span className="block truncate text-xs text-kumo-subtle tabular-nums">
                  {formatAgo(a.updatedAt)}
                  {shared > 0 ? ` · shared with ${shared}` : ""}
                </span>
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

// Apps are laid out at a small-laptop width, then scaled down to fit the
// card. Most apps are a centred column, so wider makes the content tiny.
const THUMB_WIDTH = 880
const THUMB_HEIGHT = 550

/** A live, non-interactive render of the app, scaled to the card. */
function AppThumbnail({ app, path }: { app: BotAppDetail; path?: string }) {
  const [scale, setScale] = useState(0)
  const [loaded, setLoaded] = useState(false)
  const frame = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = frame.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setScale(entry.contentRect.width / THUMB_WIDTH)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <div
      ref={frame}
      className="relative aspect-[16/10] w-full overflow-hidden rounded-xl bg-kumo-recessed shadow-[0_1px_2px_oklch(0_0_0/0.04),0_2px_8px_oklch(0_0_0/0.04)] outline outline-1 -outline-offset-1 outline-black/[0.06] transition-shadow duration-150 ease-out group-hover:shadow-[0_1px_2px_oklch(0_0_0/0.06),0_6px_16px_oklch(0_0_0/0.08)]"
    >
      <span
        aria-hidden
        className={`absolute inset-0 flex items-center justify-center text-kumo-inactive transition-opacity duration-150 ease-out ${
          loaded ? "opacity-0" : "opacity-100"
        }`}
      >
        <AppWindowIcon size={24} />
      </span>
      {path && scale > 0 ? (
        <iframe
          key={app.version}
          src={path}
          title=""
          aria-hidden
          tabIndex={-1}
          loading="lazy"
          sandbox="allow-scripts"
          onLoad={() => setLoaded(true)}
          style={{
            width: THUMB_WIDTH,
            height: THUMB_HEIGHT,
            transform: `scale(${scale})`,
          }}
          className={`pointer-events-none absolute top-0 left-0 origin-top-left border-0 bg-white transition-opacity duration-150 ease-out ${
            loaded ? "opacity-100" : "opacity-0"
          }`}
        />
      ) : null}
    </div>
  )
}

function AppDetail({
  agent,
  app,
  onBack,
  onChanged,
}: {
  agent: BotConnection
  app: BotAppDetail
  onBack: () => void
  onChanged: () => Promise<void>
}) {
  const owner = app.links.find((l) => l.owner)
  const shared = app.links.filter((l) => !l.owner)
  const [label, setLabel] = useState("")
  const [mode, setMode] = useState<AppLink["mode"]>("edit")
  const [creating, setCreating] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  async function share() {
    setCreating(true)
    try {
      await agent.stub.createAppLink(app.slug, label, mode)
      setLabel("")
      await onChanged()
    } finally {
      setCreating(false)
    }
  }

  async function revoke(token: string) {
    await agent.stub.revokeAppLink(token)
    await onChanged()
  }

  async function remove() {
    setDeleting(true)
    try {
      await agent.stub.deleteApp(app.slug)
      onBack()
      await onChanged()
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="flex items-center gap-1 pt-1 pr-4 pb-2 pl-2">
        <button
          type="button"
          aria-label="All apps"
          onClick={onBack}
          className="icon-btn size-8!"
        >
          <ArrowLeftIcon size={16} />
        </button>
        <h3 className="min-w-0 flex-1 truncate text-sm font-medium text-kumo-default">
          {app.name}
        </h3>
        {owner ? (
          <Button
            size="sm"
            variant="secondary"
            icon={<ArrowSquareOutIcon />}
            onClick={() => window.open(owner.path, "_blank", "noopener")}
          >
            Open
          </Button>
        ) : null}
      </div>

      {owner ? (
        <div className="mx-4 aspect-[16/10] shrink-0 overflow-hidden rounded-xl bg-white outline outline-1 -outline-offset-1 outline-black/[0.06]">
          <iframe
            key={app.version}
            title={`${app.name} preview`}
            src={owner.path}
            sandbox="allow-scripts allow-forms allow-popups allow-modals"
            className="size-full"
          />
        </div>
      ) : null}

      <div className="space-y-5 p-4">
        {app.collections.length > 0 ? (
          <p className="text-xs text-kumo-subtle">
            Data:{" "}
            {app.collections.map((c) => `${c.name} (${c.count})`).join(", ")}
          </p>
        ) : null}

        {owner ? (
          <div className="space-y-1.5">
            <p className="text-sm text-kumo-default">Your link</p>
            <ClipboardText text={absolute(owner.path)} />
            <p className="text-xs text-kumo-subtle">
              Anyone with a link can open the app, no login needed. Treat links
              like passwords.
            </p>
          </div>
        ) : null}

        <div className="space-y-2">
          <p className="text-sm text-kumo-default">Shared with</p>
          {shared.length === 0 ? (
            <p className="text-xs text-kumo-subtle">Nobody yet.</p>
          ) : (
            <ul className="space-y-3">
              {shared.map((link) => (
                <li key={link.token} className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm text-kumo-default">
                      {link.label}
                    </span>
                    <Badge
                      variant={link.mode === "edit" ? "primary" : "secondary"}
                    >
                      {MODE_LABELS[link.mode]}
                    </Badge>
                    <Button
                      size="xs"
                      variant="ghost"
                      shape="square"
                      icon={<XIcon />}
                      aria-label={`Revoke ${link.label}'s link`}
                      onClick={() => void revoke(link.token)}
                    />
                  </div>
                  <ClipboardText text={absolute(link.path)} />
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-end gap-2 pt-1">
            <Input
              label="New link for"
              size="sm"
              placeholder="e.g. Sarah"
              value={label}
              maxLength={40}
              onChange={(e) => setLabel(e.target.value)}
              className="min-w-0 flex-1"
            />
            <Select
              aria-label="Access"
              size="sm"
              className="w-28 shrink-0"
              value={mode}
              items={MODE_LABELS}
              onValueChange={(value) =>
                value && setMode(value as AppLink["mode"])
              }
            />
            <Button
              size="sm"
              loading={creating}
              disabled={!label.trim()}
              onClick={() => void share()}
            >
              Share
            </Button>
          </div>
          <p className="text-xs text-kumo-subtle">
            When someone edits through their link, the bot sees it under that
            name and can react.
          </p>
        </div>

        <div className="pt-2">
          {confirmDelete ? (
            <div className="flex items-center gap-2">
              <span className="flex-1 text-sm text-kumo-default">
                Delete the app, its data and all links?
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setConfirmDelete(false)}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                variant="destructive"
                loading={deleting}
                onClick={() => void remove()}
              >
                Delete
              </Button>
            </div>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              icon={<TrashIcon />}
              onClick={() => setConfirmDelete(true)}
            >
              Delete app
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
