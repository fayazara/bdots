/**
 * Types shared by the Durable Objects and the React client. Keep this file
 * free of server-only imports (`cloudflare:workers`, agent classes).
 */

import type { RobotHeadShape } from "robot-heads"

export type BotStatus = "idle" | "thinking" | "working" | "action_needed"

/**
 * `robot-heads` looks (a head shape and a shell colour), in the order new bots
 * receive them. Listed here (rather than imported) so the Durable Objects do
 * not bundle the canvas renderer.
 */
export const BOT_AVATAR_LOOKS = {
  "blue-rectangle": { shape: "rectangle", color: "#2b49a3" },
  "coral-circle": { shape: "circle", color: "#e0563f" },
  "green-hexagon": { shape: "hexagon", color: "#2f8f5b" },
  "violet-square": { shape: "square", color: "#6b46c1" },
  "amber-rectangle": { shape: "rectangle", color: "#d98a1c" },
  "teal-circle": { shape: "circle", color: "#1f8a99" },
  "pink-hexagon": { shape: "hexagon", color: "#d6457f" },
  "graphite-square": { shape: "square", color: "#3d4452" },
  "red-rectangle": { shape: "rectangle", color: "#b8323a" },
  "indigo-circle": { shape: "circle", color: "#3f3fb0" },
  "lime-hexagon": { shape: "hexagon", color: "#6e9a1f" },
  "sky-square": { shape: "square", color: "#2f86d6" },
} as const satisfies Record<string, { shape: RobotHeadShape; color: string }>

export type BotAvatarKind = keyof typeof BOT_AVATAR_LOOKS
export const BOT_AVATARS = Object.keys(BOT_AVATAR_LOOKS) as BotAvatarKind[]

/** One row of the sidebar. Owned by the UserHub, updated by each bot. */
export interface BotSummary {
  id: string
  name: string
  avatar: BotAvatarKind
  status: BotStatus
  /** Last message preview shown under the name. */
  preview: string
  updatedAt: number
  unread: boolean
}

/**
 * A user-level MCP connection (Executor or any MCP server). The UserHub holds
 * the one live connection and its credentials; every bot uses it.
 */
export interface Connection {
  id: string
  name: string
  url: string
  /** Header values stay on the server; the client only learns the names. */
  headerNames: string[]
  /** MCP client state: "ready", "authenticating", "connecting", "failed", … */
  status: string
  tools: number
  /** Present while the server is waiting for the user to sign in. */
  authUrl?: string
  error?: string
  /** The last tool call through this connection that failed, if the latest did. */
  lastFailure?: {
    at: number
    message: string
    kind: "auth" | "unreachable" | "tool"
  }
}

/** A tool from a connection, as the UserHub describes it to bots. */
export interface AppTool {
  connectionId: string
  connectionName: string
  name: string
  description: string
  /** JSON Schema for the tool's arguments. */
  inputSchema: Record<string, unknown>
  /** From the server's `readOnlyHint`, or guessed from the tool name. */
  readOnly: boolean
}

export interface AppCatalog {
  apps: Pick<Connection, "id" | "name" | "status" | "tools" | "error">[]
  tools: AppTool[]
}

export interface HubState {
  bots: BotSummary[]
  connections: Connection[]
}

export type RulePolicy = "allow" | "ask" | "block"

/** Action classes a rule applies to. Each maps to one or more tools. */
export const ACTION_CLASSES = [
  { id: "files", label: "Edit files", hint: "Write, edit and delete files" },
  { id: "shell", label: "Run commands", hint: "Shell in the bot's computer" },
  { id: "browse", label: "Read the web", hint: "Open and read public pages" },
  {
    id: "browser",
    label: "Drive the browser",
    hint: "Click, type and submit in a real browser",
  },
  {
    id: "apps",
    label: "Use connected apps",
    hint: "Call tools on your connections",
  },
  {
    id: "bots",
    label: "Message other bots",
    hint: "Delegate to or notify another bot",
  },
  {
    id: "routines",
    label: "Schedule routines",
    hint: "Create work that runs later",
  },
] as const
export type ActionClass = (typeof ACTION_CLASSES)[number]["id"]

export const DEFAULT_RULES: Record<ActionClass, RulePolicy> = {
  files: "allow",
  shell: "allow",
  browse: "allow",
  browser: "allow",
  apps: "ask",
  bots: "allow",
  routines: "allow",
}

export interface Routine {
  id: string
  name: string
  prompt: string
  /** Cron expression, or an ISO date for a one-off. */
  when: string
  kind: "cron" | "once"
  /** Only report what earlier runs did not, and stay quiet otherwise. */
  onlyNew?: boolean
  /** Check this first and only run when its output changed. */
  watch?: RoutineWatch
}

/** A cheap check a routine runs before waking the model. */
export type RoutineWatch = { url: string } | { command: string }

/** How a bot works on its own between conversations. */
export interface ProactiveSettings {
  /** Regular check-ins: look at apps and open items, speak only if useful. */
  enabled: boolean
  everyHours: number
  /** "HH:mm" in `timezone`. No check-ins or push notifications in between. */
  quietStart: string
  quietEnd: string
  /** IANA zone, set from the user's browser. */
  timezone: string
  /** Upper bound on unprompted messages per day. */
  maxPerDay: number
  /**
   * Let background work call app tools that are not known to be read-only
   * (e.g. Executor's code-running `execute`) when the apps rule is "Ask
   * first". Off by default: nobody is there to approve.
   */
  appsInBackground: boolean
}

export const CHECK_IN_HOURS = [1, 2, 3, 4, 6, 8, 12, 24] as const

export const DEFAULT_PROACTIVE: ProactiveSettings = {
  enabled: true,
  everyHours: 3,
  quietStart: "22:00",
  quietEnd: "08:00",
  timezone: "UTC",
  maxPerDay: 6,
  appsInBackground: false,
}

/** Something the bot is keeping an eye on until it is resolved. */
export interface OpenItem {
  id: string
  title: string
  /** Latest state, in the bot's words. */
  note: string
  sourceUrl?: string
  createdAt: number
  updatedAt: number
  /** When the bot wants to look again, if it said. */
  checkAfter?: number
  status: "open" | "resolved"
}

/** A workflow the bot learned, saved under /workspace/skills. */
export interface Skill {
  slug: string
  name: string
  description: string
}

/**
 * A small web app the bot built from its own data. Files live under
 * /workspace/apps/<slug>; data lives in the bot's SQLite as collections.
 */
export interface BotAppSummary {
  slug: string
  name: string
  description: string
  /** Bumped on every save, so open copies reload and caches turn over. */
  version: number
  updatedAt: number
}

/** A link that opens an app. The token in the URL is the only credential. */
export interface AppLink {
  token: string
  /** Who it is for, e.g. "Sarah". The owner's own link is "You". */
  label: string
  mode: "edit" | "view"
  owner: boolean
  createdAt: number
  /** Path on this host, ending in "/". */
  path: string
}

export interface BotAppDetail extends BotAppSummary {
  hasServer: boolean
  links: AppLink[]
  collections: { name: string; count: number }[]
}

/** URL path of an app, as served by `src/agents/apps-runtime.ts`. */
export function appPath(
  userId: string,
  botId: string,
  slug: string,
  token: string
) {
  return `/apps/${encodeURIComponent(userId)}/${botId}/${slug}/${token}/`
}

/** Synced to every client connected to a bot. */
export interface BotState {
  name: string
  avatar: BotAvatarKind
  /** What the bot is for, in the user's words. Editable in settings. */
  role: string
  status: BotStatus
  rules: Record<ActionClass, RulePolicy>
  routines: Routine[]
  proactive: ProactiveSettings
  skills: Skill[]
  apps: BotAppSummary[]
  /** Last time the bot finished background work, for the settings panel. */
  lastCheckIn?: number
}

/**
 * Metadata on a user-role message that did not come from the human.
 * "check-in", "email" and "webhook" turns run in the background: the
 * thread hides the trigger and shows only what the bot chose to say.
 */
export interface MessageOrigin {
  kind: "bot" | "routine" | "check-in" | "email" | "webhook" | "app" | "crawl"
  /** Bot or routine name, email sender, webhook source, app name, or crawled host. */
  name: string
  avatar?: BotAvatarKind
}

/** Fields this app stamps on `UIMessage.metadata`. */
export interface MessageMeta {
  origin?: MessageOrigin
  /** Unix ms. */
  at?: number
  /** Part of a turn the user did not start. */
  background?: boolean
  /** On a finished reply: how long the bot worked on it. */
  durationMs?: number
  /** Bot-to-bot messages: how many bots this chain has passed through. */
  hops?: number
  /** On the trigger of a routine run: which run of which routine it is. */
  routine?: { id: string; runId: string; attempt: number }
}

/** One run of a routine, newest first in `getRoutineRuns()`. */
export interface RoutineRun {
  id: string
  routineId: string
  name: string
  /** Unix ms. */
  startedAt: number
  finishedAt: number | null
  status:
    | "running"
    | "reported"
    | "quiet"
    | "waiting"
    | "failed"
    | "retrying"
    | "skipped"
    | "stopped"
  attempt: number
  note: string
}

/** A background turn ends with exactly this when there is nothing to say. */
export const NO_UPDATE = "NO_UPDATE"

/** A browser's Web Push subscription, as `PushSubscription.toJSON()` gives it. */
export interface PushSubscriptionData {
  endpoint: string
  expirationTime: number | null
  keys: { p256dh: string; auth: string }
}

/** Where a bot can be reached from outside the app. */
export interface BotInbound {
  /** Null when no email domain is configured. */
  email: string | null
  webhookUrl: string
}

export interface ActivityEntry {
  id: number
  at: number
  tool: string
  summary: string
  ok: boolean
  durationMs: number
}

export const NEW_BOT_NAME = "New bot"

/** Durable Object instance name for a bot. */
export function botInstanceName(userId: string, botId: string) {
  return `${userId}:${botId}`
}

export type SecretScheme = "bearer" | "header" | "basic"

/** A credential a bot saved with request_secret. The value never leaves the bot. */
export interface SecretMeta {
  name: string
  origin: string
  scheme: SecretScheme
  /** For "header": the header to set. "bearer" and "basic" use Authorization. */
  header: string
  purpose: string
  createdAt: number
}
