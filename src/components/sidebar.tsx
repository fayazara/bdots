import { useMemo, useState } from "react"
import {
  Link,
  useHydrated,
  useNavigate,
  useParams,
} from "@tanstack/react-router"
import { DropdownMenu } from "@cloudflare/kumo/components/dropdown"
import { Loader } from "@cloudflare/kumo/components/loader"
import { Tooltip } from "@cloudflare/kumo/components/tooltip"
import {
  BellIcon,
  BellRingingIcon,
  BellSlashIcon,
  GearSixIcon,
  MagnifyingGlassIcon,
  PlusIcon,
} from "@/components/icons"
import { BotAvatar } from "@/components/bot-avatar"
import { ShimmerText } from "@/components/thread"
import { useHub } from "@/lib/hub-context"
import { usePushNotifications } from "@/lib/push"
import type { BotSummary } from "@/lib/types"

const FOOTER_BUTTON = "icon-btn"

/** Lets bots reach this device when bdots is closed. */
function NotificationsButton() {
  const { status, busy, enable, disable, test } = usePushNotifications()
  if (status === "loading" || status === "unsupported") return null

  if (status !== "on") {
    const blocked = status === "denied"
    return (
      <Tooltip
        content={
          blocked
            ? "Notifications are blocked in your browser settings"
            : "Get notified when a bot needs you"
        }
        render={
          <button
            type="button"
            aria-label="Turn on notifications"
            disabled={blocked || busy}
            onClick={() => void enable()}
            className={FOOTER_BUTTON}
          >
            <BellSlashIcon size={18} />
          </button>
        }
      />
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenu.Trigger
        render={(props) => (
          <button
            {...props}
            type="button"
            aria-label="Notifications"
            className={FOOTER_BUTTON}
          >
            <BellIcon size={18} />
          </button>
        )}
      />
      <DropdownMenu.Content side="top" align="end">
        <DropdownMenu.Item icon={<BellRingingIcon />} onClick={() => void test()}>
          Send a test notification
        </DropdownMenu.Item>
        <DropdownMenu.Item icon={<BellSlashIcon />} onClick={() => void disable()}>
          Turn off on this device
        </DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu>
  )
}

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
      className={`pressable flex items-center gap-3 rounded-xl px-2.5 py-2 outline-none focus-visible:ring-2 focus-visible:ring-kumo-focus ${
        active ? "bg-(--fill-active)" : "hover:bg-(--fill-hover)"
      }`}
    >
      <span className="relative">
        <BotAvatar avatar={bot.avatar} status={bot.status} size={48} />
        {bot.unread && !active ? (
          <span
            className="unread-dot absolute -top-0.5 -right-0.5 size-3 rounded-full bg-kumo-danger ring-2 ring-kumo-canvas"
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
    <aside className="flex h-full w-full flex-col">
      <div className="col-header">
        {/* The 28px button sits 4px inside the 36px pill. */}
        <div className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-full bg-(--fill-hover) pr-1 pl-3 text-kumo-subtle focus-within:ring-2 focus-within:ring-kumo-focus">
          <MagnifyingGlassIcon size={16} className="shrink-0" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search"
            aria-label="Search bots"
            className="min-w-0 flex-1 bg-transparent text-sm text-kumo-default outline-none placeholder:text-kumo-placeholder"
          />
          <Tooltip
            content="New bot"
            render={
              <button
                type="button"
                aria-label="New bot"
                onClick={() => void createBot()}
                disabled={!hub.live || creating}
                className="icon-btn size-7! hover:bg-(--fill-active)!"
              >
                {creating ? <Loader size="sm" /> : <PlusIcon size={16} />}
              </button>
            }
          />
        </div>
      </div>

      <nav
        aria-label="Bots"
        className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-(--inset) pt-1"
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

      {/* Shares the composer's centre line; the avatar sits in a 48px slot so
          it centres under the bot avatars above. */}
      <div className="flex h-(--footer-h) shrink-0 items-center gap-3 pr-(--inset) pl-5">
        <span className="flex w-12 shrink-0 justify-center">
          {hub.viewer.avatarUrl ? (
            <img
              src={hub.viewer.avatarUrl}
              alt=""
              width={28}
              height={28}
              className="size-7 rounded-full bg-kumo-fill object-cover outline outline-1 -outline-offset-1 outline-black/10"
            />
          ) : (
            <span className="flex size-7 items-center justify-center rounded-full bg-kumo-fill text-[11px] font-medium text-kumo-subtle">
              {initials(hub.viewer.label)}
            </span>
          )}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-kumo-default">
          {hub.viewer.label}
        </span>
        <div className="flex items-center gap-1">
          <NotificationsButton />
          <Tooltip
            content="Connections"
            render={
              <Link
                to="/connections"
                aria-label="Connections"
                className="icon-btn"
              >
                <GearSixIcon size={20} />
              </Link>
            }
          />
        </div>
      </div>
    </aside>
  )
}
