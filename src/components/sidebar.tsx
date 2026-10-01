import { useMemo, useState } from "react"
import {
  Link,
  useHydrated,
  useNavigate,
  useParams,
} from "@tanstack/react-router"
import { Button } from "@cloudflare/kumo/components/button"
import { Tooltip } from "@cloudflare/kumo/components/tooltip"
import {
  GearSixIcon,
  MagnifyingGlassIcon,
  PlusIcon,
} from "@phosphor-icons/react"
import { BotAvatar } from "@/components/bot-avatar"
import { ShimmerText } from "@/components/thread"
import { useHub } from "@/lib/hub-context"
import type { BotSummary } from "@/lib/types"

function formatWhen(timestamp: number, now = new Date()) {
  const date = new Date(timestamp)
  const startOfToday = new Date(now).setHours(0, 0, 0, 0)
  if (timestamp >= startOfToday) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  }
  if (timestamp >= startOfToday - 86_400_000) return "Yesterday"
  return date.toLocaleDateString([], { day: "numeric", month: "short" })
}

function previewFor(bot: BotSummary) {
  if (bot.status === "action_needed") return "Needs you to continue"
  return bot.preview || "No messages yet"
}

function initials(label: string) {
  const parts = label.split(/[\s@._-]+/).filter(Boolean)
  return (
    parts
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase())
      .join("") || "?"
  )
}

function BotRow({ bot, active }: { bot: BotSummary; active: boolean }) {
  // The server does not know the viewer's time zone or locale.
  const hydrated = useHydrated()
  return (
    <Link
      to="/bots/$botId"
      params={{ botId: bot.id }}
      className={`pressable flex items-center gap-3 rounded-xl px-2.5 py-2.5 outline-none focus-visible:ring-2 focus-visible:ring-kumo-focus ${
        active ? "bg-kumo-fill" : "hover:bg-kumo-tint"
      }`}
    >
      <span className="relative">
        <BotAvatar avatar={bot.avatar} status={bot.status} />
        {bot.unread && !active ? (
          <span
            className="unread-dot absolute -top-0.5 -right-0.5 size-3 rounded-full bg-kumo-danger ring-2 ring-kumo-base"
            aria-label="Unread"
          />
        ) : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className="truncate text-[15px] font-medium text-kumo-default">
            {bot.name}
          </span>
          <span className="shrink-0 text-xs text-kumo-subtle tabular-nums">
            {hydrated ? formatWhen(bot.updatedAt) : null}
          </span>
        </span>
        {bot.status === "thinking" || bot.status === "working" ? (
          <ShimmerText text="Typing…" className="block truncate text-sm" />
        ) : (
          <span
            className={`block truncate text-sm ${
              bot.status === "action_needed"
                ? "text-kumo-warning"
                : "text-kumo-subtle"
            }`}
          >
            {previewFor(bot)}
          </span>
        )}
      </span>
    </Link>
  )
}

export function Sidebar() {
  const hub = useHub()
  const navigate = useNavigate()
  const { botId } = useParams({ strict: false })
  const [query, setQuery] = useState("")
  const [creating, setCreating] = useState(false)

  const bots = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return hub.state.bots
    return hub.state.bots.filter(
      (b) =>
        b.name.toLowerCase().includes(needle) ||
        b.preview.toLowerCase().includes(needle)
    )
  }, [hub.state.bots, query])

  async function createBot() {
    setCreating(true)
    try {
      const bot = await hub.createBot()
      await navigate({ to: "/bots/$botId", params: { botId: bot.id } })
    } finally {
      setCreating(false)
    }
  }

  return (
    <aside className="flex h-full w-full flex-col pr-2 pl-1">
      <div className="flex items-center gap-1 pt-1 pb-2">
        <label className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg bg-kumo-fill px-3 text-kumo-subtle focus-within:ring-2 focus-within:ring-kumo-focus">
          <MagnifyingGlassIcon size={16} className="shrink-0" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search"
            aria-label="Search bots"
            className="w-full bg-transparent text-sm text-kumo-default outline-none placeholder:text-kumo-placeholder"
          />
        </label>
        <Tooltip
          content="New bot"
          render={
            <Button
              variant="ghost"
              shape="square"
              icon={<PlusIcon />}
              aria-label="New bot"
              onClick={createBot}
              loading={creating}
              disabled={!hub.live}
            />
          }
        />
      </div>

      <nav
        aria-label="Bots"
        className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto"
      >
        {bots.map((bot) => (
          <BotRow key={bot.id} bot={bot} active={bot.id === botId} />
        ))}
        {bots.length === 0 ? (
          <p className="px-2.5 py-6 text-sm text-kumo-subtle">
            {query ? "No bots match that search." : "No bots yet."}
          </p>
        ) : null}
      </nav>

      <div className="flex items-center gap-2 py-1.5 pl-2.5">
        {hub.viewer.avatarUrl ? (
          <img
            src={hub.viewer.avatarUrl}
            alt=""
            width={24}
            height={24}
            className="size-6 rounded-full bg-kumo-fill object-cover"
          />
        ) : (
          <span className="flex size-6 items-center justify-center rounded-full bg-kumo-fill text-[10px] font-medium text-kumo-subtle">
            {initials(hub.viewer.label)}
          </span>
        )}
        <span className="min-w-0 flex-1 truncate text-sm text-kumo-default">
          {hub.viewer.label}
        </span>
        <Tooltip
          content="Connections"
          render={
            <Link
              to="/connections"
              aria-label="Connections"
              className="flex size-8 items-center justify-center rounded-lg text-kumo-subtle outline-none hover:bg-kumo-tint hover:text-kumo-default focus-visible:ring-2 focus-visible:ring-kumo-focus"
            >
              <GearSixIcon size={18} />
            </Link>
          }
        />
      </div>
    </aside>
  )
}
