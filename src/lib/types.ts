/**
 * Types shared by the Durable Objects and the React client. Keep this file
 * free of server-only imports (`cloudflare:workers`, agent classes).
 */

import type { BotAvatarType } from "bot-avatars"

export type BotStatus = "idle" | "thinking" | "working" | "action_needed"

/**
 * Avatar bodies from `bot-avatars`, in the order new bots receive them. Each
 * has its own colour. Listed here (rather than imported) so the Durable
 * Objects do not bundle the canvas renderer.
 */
export const BOT_AVATARS = [
  "circle",
  "blob",
  "clover",
  "star",
  "flower",
  "ghost",
  "drop",
  "hexagon",
  "cat",
  "cloud",
  "pebble",
  "triangle",
  "square",
  "pill",
  "droid",
  "alien",
  "mech",
  "puddle",
] as const satisfies readonly BotAvatarType[]
export type BotAvatarKind = (typeof BOT_AVATARS)[number]

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
}

/** A tool from a connection, as the UserHub describes it to bots. */
export interface AppTool {
  connectionId: string
  connectionName: string
  name: string
  description: string
  /** JSON Schema for the tool's arguments. */
  inputSchema: Record<string, unknown>
}

export interface AppCatalog {
  apps: Pick<Connection, "name" | "status" | "tools">[]
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
}

/** Metadata on a user-role message that did not come from the human. */
export interface MessageOrigin {
  kind: "bot" | "routine"
  /** Bot or routine name. */
  name: string
  avatar?: BotAvatarKind
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
