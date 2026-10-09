import { Workspace, WorkspaceServiceProxy } from "@cloudflare/computer"
import type {
  DurableObjectStorageLike,
  ThinkWorkspaceCompatibility,
  WorkspaceStub,
} from "@cloudflare/computer"
import { WorkerShellBackend } from "@cloudflare/computer/backends/worker-shell"
import curl from "@cloudflare/computer/shell/curl"
import jq from "@cloudflare/computer/shell/jq"
import { createAITools } from "@cloudflare/computer/tools"
import { Think } from "@cloudflare/think"
import type {
  ChatResponseResult,
  ThinkIntervalSchedule,
  ThinkScheduledTasks,
  ToolCallContext,
  ToolCallDecision,
  ToolCallResultContext,
  TurnConfig,
  TurnContext,
} from "@cloudflare/think"
import { createBrowserRuntime } from "@cloudflare/think/tools/browser"
import type { BrowserRuntime } from "@cloudflare/think/tools/browser"
import { exports } from "cloudflare:workers"
import { callable, getAgentByName } from "agents"
import type { ContextConfig } from "agents/context"
import { isAutoReplyEmail } from "agents/email"
import type { AgentEmail } from "agents/email"
import { jsonSchema, tool } from "ai"
import type { JSONSchema7, ToolSet, UIMessage } from "ai"
import PostalMime from "postal-mime"
import { createWorkersAI } from "workers-ai-provider"
import { z } from "zod"
import {
  DEFAULT_PROACTIVE,
  DEFAULT_RULES,
  NEW_BOT_NAME,
  NO_UPDATE,
  appPath,
} from "@/lib/types"
import type {
  ActionClass,
  AppCatalog,
  AppLink,
  ActivityEntry,
  BotAppDetail,
  BotAvatarKind,
  BotInbound,
  BotState,
  BotStatus,
  MessageMeta,
  MessageOrigin,
  OpenItem,
  ProactiveSettings,
  Routine,
  RulePolicy,
  Skill,
} from "@/lib/types"
import {
  APPS_ROOT,
  AppDataError,
  AppStore,
  assertCollection,
  isAppSlug,
} from "./app-store"
import type { AppItem } from "./app-store"
import { MIME_TYPES, appLiveName } from "./apps-runtime"
import type {
  AppCaller,
  AppDataOp,
  AppLive,
  AppLiveMessage,
} from "./apps-runtime"
import {
  GREETING,
  SOUL,
  appEventPrompt,
  checkInPrompt,
  emailPrompt,
  routinePrompt,
  turnContext,
  webhookPrompt,
} from "./prompt"
import type { ReportedEntry } from "./prompt"
import { finishTeachingCode, startTeachingCode } from "./teach"
import type { TeachRecording, TeachSession } from "./teach"
import type { UserHub } from "./user-hub"

// The worker-shell backend hands this class to its Dynamic Worker as a
// loopback binding (via `ctx.exports`), so it must be exported by the Worker
// entry. `src/server.ts` re-exports it from here.
export { WorkspaceServiceProxy }

const WORKSPACE_DIRS = [
  "inbox",
  "drafts",
  "artifacts",
  "downloads",
  "scratch",
  "skills",
  "apps",
] as const

/** Which rule governs each built-in tool. Tools not listed are always allowed. */
const TOOL_CLASS: Record<string, ActionClass> = {
  write: "files",
  edit: "files",
  delete: "files",
  exec: "shell",
  browser_markdown: "browse",
  browser_extract: "browse",
  browser_links: "browse",
  browser_scrape: "browse",
  browser_execute: "browser",
  message_bot: "bots",
  schedule_routine: "routines",
  start_teaching: "browser",
  finish_teaching: "browser",
  save_skill: "files",
  save_app: "files",
  delete_app: "files",
}

const MAX_PREVIEW = 140
/** A foreground turn longer than this gets a push when it finishes. */
const LONG_TURN_MS = 90_000
const MAX_OPEN_ITEMS_IN_PROMPT = 25
const MAX_REPORTED_IN_PROMPT = 40
const MAX_INBOUND_CHARS = 8000
const MAX_WEBHOOK_BYTES = 256 * 1024
const DAY_MS = 86_400_000
const MAX_FILE_PREVIEW_BYTES = 200_000
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024
const WORKSPACE_ROOT = "/workspace"
const MAX_TREE_ENTRIES = 5000
/** App edits are batched into one background turn this long after the first. */
const APP_EVENT_DELAY_S = 30
const MAX_APP_EVENTS = 30
const MAX_APP_FILE_BYTES = 512 * 1024
/** Files in an app folder that are never served to the browser. */
const PRIVATE_APP_FILES = new Set(["server.js", "app.json"])

/**
 * Main module of an app's Dynamic Worker. The binding arrives per request
 * as entrypoint props; this puts it on `env.BOT` for the app's server.js.
 */
const APP_SERVER_MAIN = "__bdots_main.js"
const APP_SERVER_WRAPPER = `import app from "./server.js";
export default {
  fetch(request, env, ctx) {
    const handler = app && (app.fetch || (app.default && app.default.fetch));
    if (typeof handler !== "function") {
      return new Response("server.js must export default { fetch }", { status: 500 });
    }
    return handler.call(app, request, { ...env, BOT: ctx.props.BOT }, ctx);
  },
};
`

/** A safe path inside an app folder, or null. */
function appFilePath(path: string) {
  const parts = path.replace(/^\/+/, "").split("/")
  if (
    parts.some((p) => p === "" || p === "." || p === ".." || p.startsWith("."))
  )
    return null
  return parts.join("/")
}

function stripMeta(item: AppItem) {
  const { updatedAt: _a, updatedBy: _b, ...rest } = item
  return rest
}

interface RoutinePayload {
  id: string
  name: string
  prompt: string
  kind: Routine["kind"]
}

function textOf(message: UIMessage | undefined) {
  if (!message) return ""
  return (
    message.parts
      .filter((p) => p.type === "text")
      .map((p) => p.text)
      .join(" ")
      // Previews are plain text: drop Markdown emphasis and code marks.
      .replace(/[`*_#>]+/g, "")
      .replace(/(^|\s)[-•]\s+/g, "$1")
      .replace(/\s+/g, " ")
      .trim()
  )
}

function clip(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

function metaOf(message: UIMessage | undefined): MessageMeta {
  return (message?.metadata ?? {}) as MessageMeta
}

/** The model may narrate before its tools run; the final text part decides. */
function finalText(message: UIMessage) {
  const parts = message.parts.filter((p) => p.type === "text" && p.text.trim())
  const last = parts.at(-1)
  return last?.type === "text" ? last.text : ""
}

/** Models sometimes explain themselves before or after the token; it wins. */
function isNoUpdate(text: string) {
  const t = text.trim()
  return t.startsWith(NO_UPDATE) || t.endsWith(NO_UPDATE)
}

function minutesOf(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number)
  return (h || 0) * 60 + (m || 0)
}

/** Whether `now` falls inside the quiet window, which may wrap midnight. */
function inQuietHours(p: ProactiveSettings, now = new Date()) {
  let local: string
  try {
    local = now.toLocaleTimeString("en-GB", {
      timeZone: p.timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
  } catch {
    local = now.toISOString().slice(11, 16)
  }
  const t = minutesOf(local)
  const start = minutesOf(p.quietStart)
  const end = minutesOf(p.quietEnd)
  if (start === end) return false
  return start < end ? t >= start && t < end : t >= start || t < end
}

function slugify(text: string, max = 48) {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, max) || "untitled"
  )
}

function fileStamp(at = Date.now()) {
  return new Date(at).toISOString().replace(/[:.]/g, "-").slice(0, 19)
}

function htmlToText(html: string) {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h\d)>/gi, "\n")
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, "$2 ($1)")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
}

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

interface OpenItemRow {
  id: string
  title: string
  note: string
  source_url: string | null
  created_at: number
  updated_at: number
  check_after: number | null
  status: "open" | "resolved"
}

function toOpenItem(r: OpenItemRow): OpenItem {
  return {
    id: r.id,
    title: r.title,
    note: r.note,
    ...(r.source_url ? { sourceUrl: r.source_url } : {}),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    ...(r.check_after ? { checkAfter: r.check_after } : {}),
    status: r.status,
  }
}

/**
 * Model-facing name for a connection's tool: `tool_<connection>_<tool>`,
 * limited to the characters and length tool names allow.
 */
function appToolName(connectionId: string, name: string) {
  return `tool_c${connectionId}_${name.replace(/[^a-zA-Z0-9_-]/g, "_")}`.slice(
    0,
    64
  )
}

/** MCP results carry text in `content`; an `isError` result becomes a throw. */
function unwrapToolResult(result: unknown) {
  const r = result as {
    content?: { type: string; text?: string }[]
    structuredContent?: unknown
    isError?: boolean
  }
  if (r?.isError) {
    const text = r.content?.map((c) => c.text ?? "").join("\n")
    throw new Error(text || "The app returned an error.")
  }
  return r?.structuredContent ?? r?.content ?? result
}

/**
 * One per bot (instance name = `<userId>:<botId>`). A Think agent with its
 * own chat history, memory, routines, computer (files + shell) and browser.
 */
export class BotAgent extends Think<Env, BotState> {
  initialState: BotState = {
    name: NEW_BOT_NAME,
    avatar: "circle",
    role: "",
    status: "idle",
    rules: DEFAULT_RULES,
    routines: [],
    proactive: DEFAULT_PROACTIVE,
    skills: [],
    apps: [],
  }

  /** `exec` from @cloudflare/computer replaces Think's built-in bash tool. */
  override workspaceBash = false
  override maxSteps = 40

  /** Tools from the user's connections, refreshed from the hub each turn. */
  #appTools: ToolSet = {}
  #appToolNames = new Set<string>()

  /**
   * The bot's computer: a durable filesystem in this Durable Object's SQLite
   * plus a shell that runs in a Dynamic Worker (no container).
   */
  override workspace = new Workspace({
    storage: this.ctx.storage as unknown as DurableObjectStorageLike,
    backends: [
      new WorkerShellBackend({
        id: "shell",
        loader: this.env.LOADER,
        workspace: { binding: "BotAgent", id: this.ctx.id.toString() },
        ctx: this.ctx,
        commands: [curl, jq],
      }),
    ],
    useThink: true,
  }) as Workspace & ThinkWorkspaceCompatibility

  #browser?: BrowserRuntime
  /** App tools a background turn may call without anyone approving. */
  #readOnlyAppTools = new Set<string>()
  #turnStartedAt = 0
  #appStore?: AppStore
  /** The user's bdots origin, from the hub each turn. Empty until known. */
  #origin = ""

  /** Apps this bot built, their links and their data. */
  private get apps(): AppStore {
    this.#appStore ??= new AppStore(this.ctx.storage.sql, (slug, token) =>
      appPath(this.userId, this.botId, slug, token)
    )
    return this.#appStore
  }

  /** The Dynamic Worker shell reaches the workspace through this method. */
  async __getWorkspaceStub(): Promise<WorkspaceStub> {
    await this.workspace.ready()
    return this.workspace.stub()
  }

  // ── Identity ────────────────────────────────────────────────────────

  private get userId() {
    return this.name.slice(0, this.name.lastIndexOf(":"))
  }

  private get botId() {
    return this.name.slice(this.name.lastIndexOf(":") + 1)
  }

  private hub() {
    // The binding is declared by Worker name in cloudflare.config.ts, so its
    // generated type does not carry the class.
    return getAgentByName(
      this.env.UserHub as unknown as DurableObjectNamespace<UserHub>,
      this.userId
    )
  }

  /** Best-effort: the sidebar is a cache, a failed report must not fail a turn. */
  private async report(patch: Parameters<UserHub["reportBot"]>[1]) {
    try {
      const hub = await this.hub()
      await hub.reportBot(this.botId, patch)
    } catch (err) {
      console.error("reportBot failed", err)
    }
  }

  private async setStatus(status: BotStatus) {
    if (this.state.status === status) return
    this.setState({ ...this.state, status })
    await this.report({ status })
  }

  /** Push to the user's devices, unless it is their quiet time. */
  private async notify(body: string) {
    if (!body || inQuietHours(this.state.proactive)) return
    try {
      const hub = await this.hub()
      await hub.notifyUser(this.botId, clip(body, 180))
    } catch (err) {
      console.error("notifyUser failed", err)
    }
  }

  // ── Lifecycle ───────────────────────────────────────────────────────

  async onStart() {
    this.sql`CREATE TABLE IF NOT EXISTS activity (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at INTEGER NOT NULL,
      tool TEXT NOT NULL,
      summary TEXT NOT NULL,
      detail TEXT,
      ok INTEGER NOT NULL,
      duration_ms INTEGER NOT NULL
    )`
    this.sql`CREATE TABLE IF NOT EXISTS open_items (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      source_url TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      check_after INTEGER,
      status TEXT NOT NULL DEFAULT 'open'
    )`
    // What the bot already told the user, so background turns do not repeat.
    this.sql`CREATE TABLE IF NOT EXISTS reported (
      key TEXT PRIMARY KEY,
      note TEXT NOT NULL DEFAULT '',
      at INTEGER NOT NULL
    )`
    // One row per unprompted message, for the daily cap.
    this.sql`CREATE TABLE IF NOT EXISTS proactive_log (
      at INTEGER NOT NULL
    )`
    this.apps.init()
    // Bots created before proactive work, skills or apps existed.
    if (!this.state.proactive || !this.state.skills || !this.state.apps) {
      this.setState({
        ...this.state,
        proactive: { ...DEFAULT_PROACTIVE, ...this.state.proactive },
        skills: this.state.skills ?? [],
        apps: this.apps.list(),
      })
      await this.internal_reconcileScheduledTasks()
    }
    // Connections used to be registered on each bot; they live on the
    // UserHub now. Drop any leftovers so stale tokens are not kept here.
    for (const id of Object.keys(this.getMcpServers().servers)) {
      await this.removeMcpServer(id)
    }
    // A turn cannot survive the isolate going away mid-status, so anything
    // other than a pending approval is stale on a fresh start.
    if (this.state.status === "thinking" || this.state.status === "working") {
      this.setState({ ...this.state, status: "idle" })
    }
  }

  /** Called once by the UserHub right after the bot is created. */
  async setup(avatar: BotAvatarKind) {
    this.setState({ ...this.state, avatar })
    await Promise.all(
      WORKSPACE_DIRS.map((dir) =>
        this.workspace.fs.mkdir(`/workspace/${dir}`, { recursive: true })
      )
    )
    await this.addMessages([
      {
        id: crypto.randomUUID(),
        role: "assistant",
        parts: [{ type: "text", text: GREETING }],
      },
    ])
    await this.report({ preview: GREETING })
    // Browser sessions that outlive their idle window are reclaimed here.
    await this.scheduleEvery(30 * 60, "sweepBrowser")
  }

  // ── Working on its own ──────────────────────────────────────────────

  override getDefaultTimezone() {
    return this.state?.proactive?.timezone || "UTC"
  }

  /** The check-in loop. Re-read after settings change (reconcile). */
  override getScheduledTasks(): ThinkScheduledTasks {
    const p = this.state?.proactive
    if (!p?.enabled) return {}
    return {
      "check-in": {
        schedule: `every ${p.everyHours} hours` as ThinkIntervalSchedule,
        handler: async ({ idempotencyKey }) => {
          await this.checkIn({ key: idempotencyKey })
        },
      },
    }
  }

  private proactiveToday() {
    return (
      this.sql<{ n: number }>`SELECT COUNT(*) AS n FROM proactive_log
        WHERE at > ${Date.now() - DAY_MS}`[0]?.n ?? 0
    )
  }

  private openItems(limit = MAX_OPEN_ITEMS_IN_PROMPT): OpenItem[] {
    return this.sql<OpenItemRow>`SELECT * FROM open_items WHERE status = 'open'
      ORDER BY COALESCE(check_after, updated_at) ASC LIMIT ${limit}`.map(
      toOpenItem
    )
  }

  private recentlyReported(): ReportedEntry[] {
    return this.sql<ReportedEntry>`SELECT key, note, at FROM reported
      ORDER BY at DESC LIMIT ${MAX_REPORTED_IN_PROMPT}`
  }

  /**
   * Wake up, look around, and say something only if it is worth it.
   * Skipped in quiet hours, past the daily cap, while a turn is running, and
   * for a bot that has no job yet.
   */
  private async checkIn(options: { key?: string; force?: boolean } = {}) {
    const p = this.state.proactive
    if (!options.force) {
      if (!p.enabled || inQuietHours(p)) return
      if (this.proactiveToday() >= p.maxPerDay) return
      if (this.state.status !== "idle") return
      const hasJob =
        this.state.role.trim() !== "" || this.state.name !== NEW_BOT_NAME
      if (!hasJob && this.openItems(1).length === 0) return
    }
    await this.submitAs(
      { kind: "check-in", name: "Check-in" },
      checkInPrompt({
        lastCheckIn: this.state.lastCheckIn,
        reported: this.recentlyReported(),
        timeZone: p.timezone,
      }),
      { background: true, key: options.key }
    )
  }

  /** Background turns run without the user: see `decide()` and the prompt. */
  private isBackgroundTurn() {
    // The turn's trigger is the latest user message, and approval
    // continuations keep answering it, so its flag covers the whole turn.
    return (
      metaOf(this.messages.findLast((m) => m.role === "user")).background ===
      true
    )
  }

  private inbound(): BotInbound {
    const domain = this.env.EMAIL_DOMAIN?.trim()
    return {
      email: domain ? `${this.userId}.${this.botId}@${domain}` : null,
      webhookUrl: `/api/hooks/${encodeURIComponent(this.userId)}/${this.botId}/${this.webhookToken()}`,
    }
  }

  private webhookToken() {
    let token = this.ctx.storage.kv.get<string>("webhook_token")
    if (!token) {
      token = crypto.randomUUID().replace(/-/g, "")
      this.ctx.storage.kv.put("webhook_token", token)
    }
    return token
  }

  // ── Model and prompt ────────────────────────────────────────────────

  override getModel() {
    const model = this.env.MODEL
    // Workers AI ids go through the binding directly unless an AI Gateway is
    // configured; "<provider>/<model>" slugs are always routed via AI Gateway.
    if (model.startsWith("@cf/") && this.env.AI_GATEWAY_ID) {
      return createWorkersAI({
        binding: this.env.AI,
        gateway: { id: this.env.AI_GATEWAY_ID },
      })(model)
    }
    return model
  }

  override configureContext(): ContextConfig[] {
    return [
      { label: "soul", provider: { get: async () => SOUL } },
      {
        label: "memory",
        description:
          "Durable facts about the user: preferences, people, how they want work done, things to ignore.",
        maxTokens: 2000,
      },
    ]
  }

  override async beforeTurn(ctx: TurnContext): Promise<TurnConfig> {
    await this.setStatus("thinking")
    let others: Awaited<ReturnType<UserHub["listBots"]>> = []
    let catalog: AppCatalog = { apps: [], tools: [] }
    try {
      const hub = await this.hub()
      let origin: string | null
      ;[others, catalog, origin] = await Promise.all([
        hub.listBots().then((bots) => bots.filter((b) => b.id !== this.botId)),
        hub.appCatalog(),
        hub.appOrigin(),
      ])
      this.#origin = origin ?? ""
    } catch (err) {
      console.error("Loading bots or apps failed", err)
    }
    this.#turnStartedAt = Date.now()
    this.#appTools = this.buildAppTools(catalog)
    this.#appToolNames = new Set(Object.keys(this.#appTools))
    this.#readOnlyAppTools = new Set(
      catalog.tools
        .filter((t) => t.readOnly)
        .map((t) => appToolName(t.connectionId, t.name))
    )
    const context = turnContext(this.state, others, catalog.apps, {
      openItems: this.openItems(),
      inbound: this.inbound(),
      builtApps: this.apps.list().map((app) => ({
        ...app,
        path: `${this.#origin}${this.apps.ownerLink(app.slug).path}`,
        collections: this.apps.collections(app.slug),
      })),
    })
    return {
      instructions: `${ctx.system}\n\n${context}`,
      tools: this.#appTools,
    }
  }

  // ── Tools ───────────────────────────────────────────────────────────

  private get browser(): BrowserRuntime {
    // One persistent Chromium session per bot ("reuse"), so a login done
    // during a hand-off is still there on the next call.
    this.#browser ??= createBrowserRuntime({
      ctx: this.ctx,
      browser: this.env.BROWSER,
      loader: this.env.LOADER,
      session: { mode: "reuse", key: "main" },
      quickActions: { maxChars: 30_000 },
    })
    return this.#browser
  }

  private policyFor(toolName: string): RulePolicy {
    const cls = this.#appToolNames.has(toolName) ? "apps" : TOOL_CLASS[toolName]
    return cls ? this.state.rules[cls] : "allow"
  }

  /**
   * The user's rule for this call, adjusted for background turns: nobody is
   * there to approve, so "ask" becomes "block", while read-only app tools
   * run so the bot can look around (dots-style proactive research).
   */
  private decide(toolName: string): RulePolicy {
    const policy = this.policyFor(toolName)
    if (policy === "block" || !this.isBackgroundTurn()) return policy
    if (this.#readOnlyAppTools.has(toolName)) return "allow"
    if (
      this.#appToolNames.has(toolName) &&
      this.state.proactive.appsInBackground === true
    ) {
      return "allow"
    }
    return policy === "ask" ? "block" : "allow"
  }

  /** Wrap the hub's catalog as AI SDK tools that call back through the hub. */
  private buildAppTools(catalog: AppCatalog): ToolSet {
    const tools: ToolSet = {}
    for (const t of catalog.tools) {
      tools[appToolName(t.connectionId, t.name)] = tool({
        description: `[${t.connectionName}] ${t.description}`.trim(),
        inputSchema: jsonSchema(
          (t.inputSchema as JSONSchema7) ?? { type: "object" }
        ),
        needsApproval: async () =>
          this.decide(appToolName(t.connectionId, t.name)) === "ask",
        execute: async (args) => {
          const hub = await this.hub()
          const result = await hub.callAppTool(
            t.connectionId,
            t.name,
            (args ?? {}) as Record<string, unknown>
          )
          return unwrapToolResult(result)
        },
      })
    }
    return tools
  }

  override getTools(): ToolSet {
    const tools: ToolSet = {
      ...createAITools({
        workspace: this.workspace,
        shell: {
          defaultBackend: "shell",
          backends: {
            shell: {
              description:
                "just-bash in a Dynamic Worker. Starts instantly. Has cat, ls, grep, sed, awk, jq, sort, head, tail, find, curl and git. Cannot run npm, node, python or other binaries.",
            },
          },
        },
      }),
      ...this.browser.tools,
      // Last turn's catalog; beforeTurn swaps in a fresh one.
      ...this.#appTools,
      ...this.botTools(),
    }

    // Apply the user's rules: "ask" pauses the call for an approval card.
    // "block" is enforced in beforeToolCall.
    for (const [name, def] of Object.entries(tools)) {
      if (def.needsApproval !== undefined) continue
      if (!TOOL_CLASS[name]) continue
      tools[name] = {
        ...def,
        needsApproval: async () => this.decide(name) === "ask",
      }
    }
    return tools
  }

  private botTools(): ToolSet {
    return {
      set_name: tool({
        description:
          "Give yourself a name that describes your job, 1-3 words in Title Case. Call once, when the user first tells you what you are for.",
        inputSchema: z.object({ name: z.string().min(2).max(40) }),
        execute: async ({ name }) => {
          await this.rename(name.trim())
          return { renamedTo: name.trim() }
        },
      }),

      request_handoff: tool({
        description:
          "Hand your browser to the user so they can do something you cannot: sign in, pass MFA, or solve a CAPTCHA. Open the right page with browser_execute first. This pauses until the user says they are done.",
        inputSchema: z.object({
          instructions: z
            .string()
            .describe(
              "One sentence telling the user what to do and why, e.g. 'Sign in to Salesforce so I can see the accounts you own.'"
            ),
        }),
        // The approval card is the hand-off: "I'm done" approves it.
        needsApproval: true,
        execute: async () => ({
          status: "user_finished",
          next: "The user says they are done. Inspect the page with browser_execute to confirm before continuing.",
        }),
      }),

      message_bot: tool({
        description:
          "Send a message to another of the user's bots, to delegate work or pass on something it needs. It replies in its own thread.",
        inputSchema: z.object({
          to: z.string().describe("The other bot's name"),
          message: z.string(),
        }),
        execute: async ({ to, message }) => {
          const hub = await this.hub()
          return hub.relayMessage(this.botId, to, message)
        },
      }),

      schedule_routine: tool({
        description:
          "Schedule work for later. Use `cron` (5-field, UTC) for something recurring, or `at` (ISO 8601 date-time) for a one-off. When it fires you receive `prompt` as a new task.",
        inputSchema: z.object({
          name: z.string().describe("Short label, e.g. 'Morning inbox digest'"),
          prompt: z
            .string()
            .describe("Self-contained instructions for your future self"),
          cron: z.string().optional(),
          at: z.string().optional(),
        }),
        execute: async ({ name, prompt, cron, at }) => {
          if (!cron === !at) {
            return { error: "Provide exactly one of `cron` or `at`." }
          }
          const routine = await this.addRoutine({
            name,
            prompt,
            when: (cron ?? at)!,
            kind: cron ? "cron" : "once",
          })
          return { scheduled: routine }
        },
      }),

      list_routines: tool({
        description: "List your scheduled routines.",
        inputSchema: z.object({}),
        execute: async () => ({ routines: this.state.routines }),
      }),

      cancel_routine: tool({
        description: "Cancel a scheduled routine by id.",
        inputSchema: z.object({ id: z.string() }),
        execute: async ({ id }) => ({
          cancelled: await this.removeRoutine(id),
        }),
      }),

      track_item: tool({
        description:
          "Start keeping an eye on something for the user: a reply you are waiting for, a receipt you have not found yet, a deadline, a problem to re-check. It shows in your open items on every turn until you resolve it.",
        inputSchema: z.object({
          title: z
            .string()
            .max(120)
            .describe(
              "Short, specific, e.g. 'Airport → hotel receipt, Sep 21'"
            ),
          note: z
            .string()
            .max(600)
            .optional()
            .describe("Current state and what you are waiting for"),
          sourceUrl: z.string().url().optional(),
          checkAfter: z
            .string()
            .optional()
            .describe(
              "ISO 8601 date-time to look again, if there is a natural one"
            ),
        }),
        execute: async ({ title, note, sourceUrl, checkAfter }) => {
          const id = crypto.randomUUID().slice(0, 6)
          const now = Date.now()
          const after = checkAfter ? Date.parse(checkAfter) : NaN
          this.sql`INSERT INTO open_items
            (id, title, note, source_url, created_at, updated_at, check_after, status)
            VALUES (${id}, ${title}, ${note ?? ""}, ${sourceUrl ?? null}, ${now},
                    ${now}, ${Number.isNaN(after) ? null : after}, 'open')`
          return { tracking: id }
        },
      }),

      update_item: tool({
        description: "Record what changed on one of your open items.",
        inputSchema: z.object({
          id: z.string(),
          note: z.string().max(600),
          sourceUrl: z.string().url().optional(),
          checkAfter: z.string().optional(),
        }),
        execute: async ({ id, note, sourceUrl, checkAfter }) => {
          const after = checkAfter ? Date.parse(checkAfter) : NaN
          const rows = this.sql<{ id: string }>`UPDATE open_items
            SET note = ${note},
                source_url = COALESCE(${sourceUrl ?? null}, source_url),
                check_after = ${Number.isNaN(after) ? null : after},
                updated_at = ${Date.now()}
            WHERE id = ${id} RETURNING id`
          return rows.length ? { updated: id } : { error: `No open item ${id}` }
        },
      }),

      resolve_item: tool({
        description:
          "Close an open item because it is done, answered, or no longer matters.",
        inputSchema: z.object({
          id: z.string(),
          outcome: z.string().max(400).describe("What happened, in one line"),
        }),
        execute: async ({ id, outcome }) => {
          const rows = this.sql<{ id: string }>`UPDATE open_items
            SET status = 'resolved', note = ${outcome}, updated_at = ${Date.now()}
            WHERE id = ${id} RETURNING id`
          // Resolved items are kept a while for the settings panel, then dropped.
          this.sql`DELETE FROM open_items
            WHERE status = 'resolved' AND updated_at < ${Date.now() - 14 * DAY_MS}`
          return rows.length
            ? { resolved: id }
            : { error: `No open item ${id}` }
        },
      }),

      mark_reported: tool({
        description:
          "Remember that you told the user about these things, so future check-ins do not repeat them. Use stable keys: an email or thread id, an order number, a URL.",
        inputSchema: z.object({
          items: z
            .array(
              z.object({
                key: z.string().max(300),
                note: z.string().max(200).optional(),
              })
            )
            .min(1)
            .max(20),
        }),
        execute: async ({ items }) => {
          const now = Date.now()
          for (const item of items) {
            this.sql`INSERT OR REPLACE INTO reported (key, note, at)
              VALUES (${item.key}, ${item.note ?? ""}, ${now})`
          }
          this.sql`DELETE FROM reported WHERE at < ${now - 60 * DAY_MS}`
          return { remembered: items.length }
        },
      }),

      was_reported: tool({
        description:
          "Check whether you already told the user about these keys (looks back 60 days).",
        inputSchema: z.object({ keys: z.array(z.string()).min(1).max(50) }),
        execute: async ({ keys }) => {
          const placeholders = keys.map(() => "?").join(",")
          const rows = this.ctx.storage.sql
            .exec<{ key: string; at: number }>(
              `SELECT key, at FROM reported WHERE key IN (${placeholders})`,
              ...keys
            )
            .toArray()
          const seen = new Map(rows.map((r) => [r.key, r.at]))
          return Object.fromEntries(
            keys.map((k) => [
              k,
              seen.has(k) ? new Date(seen.get(k)!).toISOString() : false,
            ])
          )
        },
      }),

      start_teaching: tool({
        description:
          "Start recording the user doing a task in your browser, so you can learn it. Opens `startUrl` in your tab. Follow with request_handoff, then finish_teaching.",
        inputSchema: z.object({
          task: z.string().describe("What the user is about to show you"),
          startUrl: z
            .string()
            .url()
            .optional()
            .describe(
              "Where the task begins. Omit to start from the current page."
            ),
        }),
        execute: async ({ task, startUrl }) => {
          const run = await this.browser.runtime.execute({
            code: startTeachingCode(startUrl),
          })
          if (run.status !== "completed") {
            return {
              error:
                run.status === "error"
                  ? run.error
                  : "The browser is waiting on something else.",
            }
          }
          const result = run.result as {
            targetId: string
            startIndex: number
            url?: string
          }
          const session: TeachSession = {
            targetId: result.targetId,
            startIndex: result.startIndex,
            task,
            startedAt: Date.now(),
          }
          this.ctx.storage.kv.put("teach_session", session)
          return {
            recording: true,
            url: result.url,
            next: "Call request_handoff asking the user to do the task in your browser and press I'm done when finished.",
          }
        },
      }),

      finish_teaching: tool({
        description:
          "Stop recording and get what the user did: pages visited, clicks, and values typed (secrets hidden).",
        inputSchema: z.object({}),
        execute: async () => {
          const session = this.ctx.storage.kv.get<TeachSession>("teach_session")
          if (!session)
            return {
              error: "Nothing is being recorded. Call start_teaching first.",
            }
          const run = await this.browser.runtime.execute({
            code: finishTeachingCode(session),
          })
          this.ctx.storage.kv.delete("teach_session")
          if (run.status !== "completed") {
            return {
              error:
                run.status === "error" ? run.error : "The browser is busy.",
            }
          }
          const recording = run.result as TeachRecording
          const path = `/workspace/scratch/teach-${fileStamp(session.startedAt)}.json`
          await this.workspace.fs.writeFile(
            path,
            JSON.stringify({ task: session.task, ...recording }, null, 2)
          )
          return {
            task: session.task,
            pages: recording.pages,
            events: recording.events.slice(-150).map((e) => ({
              t: e.t,
              url: e.url,
              ...(e.title ? { title: e.title } : {}),
              ...(e.value !== undefined ? { value: e.value } : {}),
              ...(e.el ? { el: e.el } : {}),
            })),
            finalUrl: recording.finalUrl,
            savedTo: path,
            note: recording.recycled
              ? "The browser was restarted while the user worked, so this only covers the tab open now. Use it, and ask the user to describe any steps that are missing."
              : recording.events.length === 0
                ? "No clicks were captured (the page may block scripts). Use the pages list and ask the user to fill in the steps."
                : undefined,
          }
        },
      }),

      save_skill: tool({
        description:
          "Save a workflow you learned as a skill under /workspace/skills, so you (and scheduled routines) can follow it later. Saving with an existing name replaces it.",
        inputSchema: z.object({
          name: z
            .string()
            .min(2)
            .max(60)
            .describe("e.g. 'Weekly expense report'"),
          description: z
            .string()
            .max(240)
            .describe("When to use it, in one sentence"),
          steps: z
            .string()
            .describe(
              "Markdown: numbered steps with URLs, where things are on each page, what to type or pick, and how to check it worked"
            ),
        }),
        execute: async ({ name, description, steps }) => {
          const slug = slugify(name)
          const path = `/workspace/skills/${slug}.md`
          const body = `---\nname: ${JSON.stringify(name)}\ndescription: ${JSON.stringify(description)}\n---\n\n# ${name}\n\n${steps.trim()}\n`
          await this.workspace.fs.mkdir("/workspace/skills", {
            recursive: true,
          })
          await this.workspace.fs.writeFile(path, body)
          const skill: Skill = { slug, name, description }
          this.setState({
            ...this.state,
            skills: [
              ...this.state.skills.filter((s) => s.slug !== slug),
              skill,
            ],
          })
          return { saved: path }
        },
      }),

      save_app: tool({
        description: `Build or update a small web app for the user, served from their bdots host. Writes \`files\` to ${APPS_ROOT}/<slug>/, checks the app and publishes it; open copies reload. To publish files you already wrote or edited there yourself, omit \`files\`. See "Building apps".`,
        inputSchema: z.object({
          slug: z
            .string()
            .describe(
              "Folder and URL name, e.g. 'tokyo-trip'. Lowercase, digits, '-'"
            ),
          name: z.string().min(1).max(60).describe("Title, e.g. 'Tokyo trip'"),
          description: z.string().max(240).describe("What it is, in one line"),
          files: z
            .record(z.string(), z.string())
            .optional()
            .describe(
              "Path (relative to the app folder) → the complete file content, never a placeholder. The app needs index.html; server.js is optional. Omit to publish what is already in the folder."
            ),
        }),
        execute: async ({ slug, name, description, files }) =>
          this.publishApp({ slug, name, description, files }),
      }),

      list_apps: tool({
        description:
          "List the apps you built, with their links, collections and item counts.",
        inputSchema: z.object({}),
        execute: async () => ({ apps: this.appDetails() }),
      }),

      delete_app: tool({
        description:
          "Delete an app: its files, its data and every link to it. Only when the user asks.",
        inputSchema: z.object({ slug: z.string() }),
        execute: async ({ slug }) => {
          if (!this.apps.get(slug)) return { error: `No app "${slug}"` }
          await this.removeApp(slug)
          return { deleted: slug }
        },
      }),

      app_data_list: tool({
        description:
          "Read the items in one of an app's collections. Items people changed in the app show updatedBy with their link label.",
        inputSchema: z.object({ slug: z.string(), collection: z.string() }),
        execute: async ({ slug, collection }) => {
          if (!this.apps.get(slug)) return { error: `No app "${slug}"` }
          return { items: this.apps.items(slug, collection) }
        },
      }),

      app_data_put: tool({
        description:
          "Add or update items in an app's collection. The app shows changes live. An item with an existing id is replaced, or with merge: true only the given fields change. Without an id a new one is made.",
        inputSchema: z.object({
          slug: z.string(),
          collection: z
            .string()
            .describe("e.g. 'flights', 'todos'. Lowercase, digits, '-', '_'"),
          items: z
            .array(z.record(z.string(), z.unknown()))
            .min(1)
            .max(100)
            .describe("JSON objects; give each a stable id when you can"),
          merge: z.boolean().optional(),
        }),
        execute: async ({ slug, collection, items, merge }) => {
          if (!this.apps.get(slug)) return { error: `No app "${slug}"` }
          const saved: string[] = []
          for (const item of items) {
            saved.push(
              this.apps.put(slug, collection, item, "bot", { merge }).id
            )
          }
          await this.broadcastApp(slug, { type: "change", collection })
          return { saved }
        },
      }),

      app_data_delete: tool({
        description: "Remove items from an app's collection by id.",
        inputSchema: z.object({
          slug: z.string(),
          collection: z.string(),
          ids: z.array(z.string()).min(1).max(100),
        }),
        execute: async ({ slug, collection, ids }) => {
          if (!this.apps.get(slug)) return { error: `No app "${slug}"` }
          const removed = this.apps.remove(slug, collection, ids)
          await this.broadcastApp(slug, { type: "change", collection })
          return { removed }
        },
      }),
    }
  }

  // ── Apps ────────────────────────────────────────────────────────────

  private appDetails(): BotAppDetail[] {
    return this.apps.list().map((app) => ({
      ...app,
      hasServer: this.apps.get(app.slug)?.hasServer ?? false,
      links: this.apps.links(app.slug),
      collections: this.apps.collections(app.slug),
    }))
  }

  private syncAppsState() {
    this.setState({ ...this.state, apps: this.apps.list() })
  }

  private appLive(slug: string) {
    // Declared by Worker name in cloudflare.config.ts, so untyped.
    const ns = this.env.AppLive as unknown as DurableObjectNamespace<AppLive>
    return ns.getByName(appLiveName(this.userId, this.botId, slug))
  }

  /** Best-effort: a viewer missing one event catches up on its next change. */
  private async broadcastApp(slug: string, message: AppLiveMessage) {
    try {
      await this.appLive(slug).broadcast(message)
    } catch (err) {
      console.error("App broadcast failed", err)
    }
  }

  private async publishApp(input: {
    slug: string
    name: string
    description: string
    files?: Record<string, string>
  }) {
    const slug = input.slug.trim().toLowerCase()
    if (!isAppSlug(slug)) {
      return {
        error: "slug must be lowercase letters, digits and '-', up to 48",
      }
    }
    const dir = `${APPS_ROOT}/${slug}`
    await this.workspace.fs.mkdir(dir, { recursive: true })
    for (const [rawPath, content] of Object.entries(input.files ?? {})) {
      const path = appFilePath(rawPath)
      if (!path) return { error: `Bad file path: ${rawPath}` }
      if (content.length > MAX_APP_FILE_BYTES) {
        return { error: `${rawPath} is over 512 KB` }
      }
      const full = `${dir}/${path}`
      // Models sometimes pass a stub after writing the real file themselves.
      const existing = await this.fileSize(full)
      if (existing > 200 && content.length < Math.min(200, existing / 4)) {
        return {
          error: `${path} already has ${existing} bytes and you passed ${content.length}. Leave it out of files to keep what you wrote, or pass the full content.`,
        }
      }
      await this.workspace.fs.mkdir(full.slice(0, full.lastIndexOf("/")), {
        recursive: true,
      })
      await this.workspace.fs.writeFile(full, content)
    }
    if (!(await this.fileExists(`${dir}/index.html`))) {
      return { error: `${dir}/index.html is missing` }
    }
    const hasServer = await this.fileExists(`${dir}/server.js`)
    const previous = this.apps.get(slug)
    if (hasServer) {
      // Load the new code once before publishing, so a syntax error is
      // reported here instead of to whoever opens the app.
      const problem = await this.checkAppServer(
        slug,
        (previous?.version ?? 0) + 1
      )
      if (problem) return { error: `server.js failed to load: ${problem}` }
    }
    await this.workspace.fs.writeFile(
      `${dir}/app.json`,
      JSON.stringify(
        { name: input.name, description: input.description },
        null,
        2
      )
    )
    const app = this.apps.save({
      slug,
      name: input.name.trim(),
      description: input.description.trim(),
      hasServer,
    })
    this.syncAppsState()
    await this.broadcastApp(slug, { type: "reload", version: app.version })
    return {
      published: slug,
      version: app.version,
      link: `${this.#origin}${this.apps.ownerLink(slug).path}`,
      note: "Give the user this link as is. It is private to them; they can share the app from the Apps tab in your computer panel. Your browser may not reach this host, so do not try to open it.",
    }
  }

  private async removeApp(slug: string) {
    try {
      await this.workspace.fs.rm(`${APPS_ROOT}/${slug}`, { recursive: true })
    } catch {
      // Files already gone.
    }
    this.apps.delete(slug)
    this.syncAppsState()
    try {
      await this.appLive(slug).disconnect()
    } catch (err) {
      console.error("Closing app viewers failed", err)
    }
  }

  private async fileSize(path: string) {
    try {
      const stat = await this.workspace.fs.stat(path)
      return stat.isFile ? stat.size : 0
    } catch {
      return 0
    }
  }

  private async fileExists(path: string) {
    try {
      return (await this.workspace.fs.stat(path)).isFile
    } catch {
      return false
    }
  }

  /** server.js plus anything under server/, as Dynamic Worker modules. */
  private async appModules(slug: string) {
    const dir = `${APPS_ROOT}/${slug}`
    const modules: Record<string, string> = {
      "server.js": await this.workspace.fs.readFile(`${dir}/server.js`, "utf8"),
    }
    let extra: { path: string; type: string }[] = []
    try {
      extra = await this.workspace.fs.find(`${dir}/server`, "**/*.js", {
        limit: 100,
      })
    } catch {
      // No server/ folder.
    }
    for (const entry of extra) {
      if (entry.type !== "file") continue
      const relative = entry.path.slice(dir.length + 1)
      modules[relative] = await this.workspace.fs.readFile(entry.path, "utf8")
    }
    return modules
  }

  /**
   * The app's server.js in a Dynamic Worker, cached per version. The
   * returned fetcher hands it `env.BOT`, scoped to this app and to the
   * link the request came in on.
   */
  private appServer(slug: string, version: number, caller: AppCaller) {
    const worker = this.env.LOADER.get(
      `app:${this.name}:${slug}:${version}`,
      async () => ({
        compatibilityDate: "2026-09-01",
        mainModule: APP_SERVER_MAIN,
        modules: {
          ...(await this.appModules(slug)),
          [APP_SERVER_MAIN]: APP_SERVER_WRAPPER,
        },
        // No internet: app code only talks to its own data, through env.BOT.
        globalOutbound: null,
      })
    )
    const BOT = (
      exports as unknown as {
        AppBinding: (options: { props: unknown }) => Fetcher
      }
    ).AppBinding({
      props: { userId: this.userId, botId: this.botId, slug, caller },
    })
    return worker.getEntrypoint(undefined, { props: { BOT } })
  }

  /** Load new server code once, so errors reach the bot, not the viewer. */
  private async checkAppServer(slug: string, version: number) {
    try {
      const server = this.appServer(slug, version, {
        label: "bdots check",
        mode: "view",
      })
      await server.fetch("https://app.invalid/__bdots_check")
      return null
    } catch (err) {
      return err instanceof Error ? err.message : String(err)
    }
  }

  /** Queue an edit someone made in an app; the bot hears about it in a batch. */
  private async queueAppEvent(slug: string, line: string) {
    const key = `app_events:${slug}`
    const events = this.ctx.storage.kv.get<string[]>(key) ?? []
    events.push(line)
    this.ctx.storage.kv.put(key, events.slice(-MAX_APP_EVENTS))
    if (events.length === 1) {
      await this.schedule(APP_EVENT_DELAY_S, "flushAppEvents", { slug })
    }
  }

  /** Schedule callback: tell the bot what people did in one of its apps. */
  async flushAppEvents(payload: { slug: string }) {
    const key = `app_events:${payload.slug}`
    const queued = this.ctx.storage.kv.get<string[]>(key) ?? []
    this.ctx.storage.kv.delete(key)
    const app = this.apps.get(payload.slug)
    if (!app) return
    // Errors from copies still running code the bot has since replaced.
    const events = queued.filter((line) => {
      const match = /^PAGE ERROR \(v(\d+)/.exec(line)
      return !match || Number(match[1]) >= app.version
    })
    if (events.length === 0) return
    // The current contents of what changed, so the bot does not guess.
    const changed = new Set<string>()
    for (const line of events) {
      const match = / (?:added|changed|removed) ([a-z0-9][a-z0-9_-]*)\//.exec(
        line
      )
      if (match) changed.add(match[1])
    }
    const current = [...changed].map((collection) => ({
      collection,
      items: clip(
        JSON.stringify(this.apps.items(app.slug, collection).map(stripMeta)),
        3000
      ),
    }))
    await this.submitAs(
      { kind: "app", name: app.name },
      appEventPrompt({ name: app.name, slug: app.slug, events, current }),
      { background: true }
    )
  }

  /** Durable Object RPC from the Worker: the link behind an app URL. */
  async appLink(slug: string, token: string): Promise<AppLink | null> {
    return this.apps.findLink(slug, token)
  }

  /** Durable Object RPC from the Worker: one request to an app. */
  async serveApp(
    slug: string,
    token: string,
    path: string,
    request: Request
  ): Promise<Response> {
    const link = this.apps.findLink(slug, token)
    const app = link ? this.apps.get(slug) : null
    if (!link || !app) return new Response("Not found", { status: 404 })
    const caller: AppCaller = { label: link.label, mode: link.mode }

    if (
      path === "_data" ||
      path.startsWith("_data/") ||
      path === "_tell" ||
      path === "_error"
    ) {
      return this.serveAppData(slug, caller, path, request)
    }
    if (path.startsWith("_")) return new Response("Not found", { status: 404 })

    const file = await this.readAppFile(slug, path)
    if (file) return file
    if (app.hasServer) {
      // server.js sees paths relative to the app, e.g. "/api/todos".
      const url = new URL(request.url)
      url.pathname = `/${path}`
      try {
        return await this.appServer(slug, app.version, caller).fetch(
          new Request(url, request)
        )
      } catch (err) {
        console.error("App server failed", err)
        return new Response("The app's server crashed", { status: 500 })
      }
    }
    return new Response("Not found", { status: 404 })
  }

  private async readAppFile(
    slug: string,
    path: string
  ): Promise<Response | null> {
    let relative =
      path === "" || path.endsWith("/") ? `${path}index.html` : path
    const clean = appFilePath(relative)
    if (!clean || PRIVATE_APP_FILES.has(clean) || clean.startsWith("server/")) {
      return null
    }
    relative = clean
    const full = `${APPS_ROOT}/${slug}/${relative}`
    let isFile = false
    let isDir = false
    try {
      const stat = await this.workspace.fs.stat(full)
      isFile = stat.isFile
      isDir = stat.isDirectory
    } catch {
      return null
    }
    if (isDir) return this.readAppFile(slug, `${relative}/`)
    if (!isFile) return null
    const ext = relative.slice(relative.lastIndexOf(".") + 1).toLowerCase()
    const type = MIME_TYPES[ext] ?? "application/octet-stream"
    if (type.startsWith("text/html")) {
      // Stamp the version, so errors from stale copies can be told apart.
      const html = await this.workspace.fs.readFile(full, "utf8")
      const version = this.apps.get(slug)?.version ?? 0
      const meta = `<meta name="bdots-version" content="${version}">`
      const stamped = /<head[^>]*>/i.test(html)
        ? html.replace(/<head[^>]*>/i, (head) => `${head}${meta}`)
        : html
      return new Response(stamped, { headers: { "Content-Type": type } })
    }
    const body = await this.workspace.fs.readFile(full)
    return new Response(body, {
      headers: {
        "Content-Type": MIME_TYPES[ext] ?? "application/octet-stream",
      },
    })
  }

  private async serveAppData(
    slug: string,
    caller: AppCaller,
    path: string,
    request: Request
  ): Promise<Response> {
    const [, collection, id] = path.split("/")
    const method = request.method
    let body: Record<string, unknown> = {}
    if (method === "POST" || method === "PUT" || method === "PATCH") {
      const text = await request.text()
      if (text.length > 64 * 1024) {
        return Response.json({ error: "Body too large" }, { status: 413 })
      }
      try {
        body = text ? (JSON.parse(text) as Record<string, unknown>) : {}
      } catch {
        return Response.json({ error: "Body must be JSON" }, { status: 400 })
      }
    }
    let op: AppDataOp | null = null
    if (path === "_tell") {
      if (method === "POST") op = { op: "tell", text: String(body.text ?? "") }
    } else if (path === "_error") {
      if (method === "POST") {
        op = {
          op: "error",
          message: String(body.message ?? ""),
          stack: typeof body.stack === "string" ? body.stack : undefined,
          source: typeof body.source === "string" ? body.source : undefined,
          version: Number.isInteger(body.version)
            ? (body.version as number)
            : undefined,
        }
      }
    } else if (!collection) {
      if (method === "GET") op = { op: "info" }
    } else if (!id) {
      if (method === "GET") op = { op: "list", collection }
      if (method === "POST") op = { op: "put", collection, item: body }
    } else {
      if (method === "GET") op = { op: "get", collection, id }
      if (method === "PUT")
        op = { op: "put", collection, item: { ...body, id } }
      if (method === "PATCH") {
        op = { op: "put", collection, item: { ...body, id }, merge: true }
      }
      if (method === "DELETE") op = { op: "remove", collection, id }
    }
    if (!op) {
      return Response.json({ error: "Method not allowed" }, { status: 405 })
    }
    const result = await this.appData(slug, caller, op)
    if ("error" in result) {
      return Response.json({ error: result.error }, { status: result.status })
    }
    const key = op.op === "list" ? "items" : op.op === "info" ? "app" : "item"
    return Response.json(
      op.op === "info" ? result.value : { [key]: result.value },
      { headers: { "Cache-Control": "no-store" } }
    )
  }

  /**
   * Durable Object RPC: what an app (its page or its server.js) does with
   * its data. Edits wake the bot so it can react ("dog sitter booked").
   */
  async appData(
    slug: string,
    caller: AppCaller,
    op: AppDataOp
  ): Promise<{ value: unknown } | { error: string; status: number }> {
    const app = this.apps.get(slug)
    if (!app) return { error: "Not found", status: 404 }
    const writes = op.op === "put" || op.op === "remove" || op.op === "tell"
    if (writes && caller.mode !== "edit") {
      return { error: "This link is view-only", status: 403 }
    }
    const by = `link:${caller.label}`
    try {
      switch (op.op) {
        case "info":
          return {
            value: {
              app: { name: app.name, description: app.description },
              collections: this.apps.collections(slug),
              caller,
            },
          }
        case "list":
          return { value: this.apps.items(slug, op.collection) }
        case "get": {
          assertCollection(op.collection)
          const item = this.apps.item(slug, op.collection, op.id)
          return item ? { value: item } : { error: "Not found", status: 404 }
        }
        case "put": {
          const before = op.item.id
            ? this.apps.item(slug, op.collection, String(op.item.id))
            : null
          const item = this.apps.put(slug, op.collection, op.item, by, {
            merge: op.merge,
          })
          await this.broadcastApp(slug, {
            type: "change",
            collection: op.collection,
            id: item.id,
          })
          await this.queueAppEvent(
            slug,
            `${caller.label} ${before ? "changed" : "added"} ${op.collection}/${item.id}: ${clip(JSON.stringify(stripMeta(item)), 400)}`
          )
          return { value: item }
        }
        case "remove": {
          const removed = this.apps.remove(slug, op.collection, [op.id])
          if (removed) {
            await this.broadcastApp(slug, {
              type: "change",
              collection: op.collection,
            })
            await this.queueAppEvent(
              slug,
              `${caller.label} removed ${op.collection}/${op.id}`
            )
          }
          return { value: { removed } }
        }
        case "error": {
          // Once per message per version: every viewer hits the same bug.
          const message = clip(op.message.trim(), 500)
          const key = `app_errors:${slug}`
          const seen = this.ctx.storage.kv.get<{
            version: number
            messages: string[]
          }>(key)
          const messages = seen?.version === app.version ? seen.messages : []
          if (!message || messages.includes(message) || messages.length >= 5) {
            return { value: { reported: false } }
          }
          this.ctx.storage.kv.put(key, {
            version: app.version,
            messages: [...messages, message],
          })
          // A copy opened before the last publish is running old code.
          const version = op.version ?? app.version
          if (version < app.version) return { value: { reported: false } }
          const where = op.source ? ` in ${clip(op.source, 80)}` : ""
          const stack = op.stack ? `\n  ${clip(op.stack, 800)}` : ""
          await this.queueAppEvent(
            slug,
            `PAGE ERROR (v${version}, seen by ${caller.label})${where}: ${message}${stack}`
          )
          return { value: { reported: true } }
        }
        case "tell": {
          const text = op.text.trim()
          if (!text) return { error: "text is required", status: 400 }
          await this.queueAppEvent(
            slug,
            `${caller.label} wrote: ${clip(text, 1000)}`
          )
          return { value: { sent: true } }
        }
      }
    } catch (err) {
      if (err instanceof AppDataError) {
        return { error: err.message, status: err.status }
      }
      throw err
    }
  }

  override beforeToolCall(ctx: ToolCallContext): ToolCallDecision | void {
    if (this.decide(ctx.toolName) === "block") {
      return {
        action: "block",
        reason:
          this.policyFor(ctx.toolName) === "block"
            ? "The user has blocked this kind of action for you. Tell them what you wanted to do instead of retrying."
            : "This is background work and this action needs the user's approval, which they cannot give right now. Do not retry. If it matters, tell them what you would do.",
      }
    }
    if (ctx.toolName !== "set_name" && ctx.toolName !== "set_context") {
      void this.setStatus("working")
    }
  }

  override afterToolCall(ctx: ToolCallResultContext) {
    const input = (ctx.input ?? {}) as Record<string, unknown>
    const summary = clip(
      String(
        input.command ??
          input.url ??
          input.path ??
          input.instructions ??
          input.to ??
          input.name ??
          input.code ??
          JSON.stringify(input)
      ).replace(/\s+/g, " "),
      200
    )
    const result = ctx.success ? ctx.output : ctx.error
    const detail = clip(
      typeof result === "string" ? result : JSON.stringify(result ?? null),
      4000
    )
    this.sql`INSERT INTO activity (at, tool, summary, detail, ok, duration_ms)
      VALUES (${Date.now()}, ${ctx.toolName}, ${summary}, ${detail},
              ${ctx.success ? 1 : 0}, ${Math.round(ctx.durationMs)})`
    this
      .sql`DELETE FROM activity WHERE id <= (SELECT MAX(id) FROM activity) - 500`
  }

  /** The user-role message that started the turn `message` answers. */
  private triggerOf(message: UIMessage): UIMessage | undefined {
    const messages = this.messages
    let index = messages.findIndex((m) => m.id === message.id)
    if (index === -1) index = messages.length
    for (let i = index - 1; i >= 0; i--) {
      if (messages[i].role === "user") return messages[i]
    }
    return undefined
  }

  override async onChatResponse(result: ChatResponseResult) {
    const trigger = this.triggerOf(result.message)
    const background = metaOf(trigger).background === true
    const waiting = result.message.parts.some(
      (p) => "state" in p && p.state === "approval-requested"
    )
    const text = textOf(result.message)
    const status: BotStatus = waiting ? "action_needed" : "idle"
    this.setState({
      ...this.state,
      status,
      ...(background ? { lastCheckIn: Date.now() } : {}),
    })

    // Nothing worth saying: drop the turn so it neither shows up nor
    // fills the context. Deleting re-parents anything that came after.
    if (
      background &&
      !waiting &&
      result.status === "completed" &&
      (!text || isNoUpdate(finalText(result.message)))
    ) {
      await this.report({ status })
      if (trigger) {
        await this.schedule(1, "pruneMessages", {
          ids: [trigger.id, result.message.id],
        })
      }
      return
    }

    const final = background ? finalText(result.message) : ""
    const preview = clip(
      final
        ? textOf({ ...result.message, parts: [{ type: "text", text: final }] })
        : text,
      MAX_PREVIEW
    )
    await this.report({
      status,
      unread: true,
      ...(preview ? { preview } : {}),
    })
    if (background && !waiting && text) {
      this.sql`INSERT INTO proactive_log (at) VALUES (${Date.now()})`
      this.sql`DELETE FROM proactive_log WHERE at < ${Date.now() - 7 * DAY_MS}`
    }

    // Reach the user when they are probably not looking: anything the bot
    // found on its own, anything blocked on them, and long jobs finishing.
    const longTurn =
      this.#turnStartedAt > 0 && Date.now() - this.#turnStartedAt > LONG_TURN_MS
    if (waiting) {
      await this.notify(
        preview ? `Needs your OK: ${preview}` : "Needs your OK to continue"
      )
    } else if ((background || longTurn) && preview) {
      await this.notify(preview)
    }
  }

  /** Schedule callback: remove a background turn that had nothing to say. */
  async pruneMessages(payload: { ids: string[] }) {
    await this.session.deleteMessages(payload.ids)
  }

  override onChatError(error: unknown) {
    void this.setStatus("idle")
    return error
  }

  // ── Messages that do not come from the human ────────────────────────

  private async submitAs(
    origin: MessageOrigin,
    text: string,
    options: { background?: boolean; key?: string } = {}
  ) {
    const metadata: MessageMeta = {
      origin,
      at: Date.now(),
      ...(options.background ? { background: true } : {}),
    }
    await this.runTurn({
      mode: "submit",
      idempotencyKey: options.key,
      input: {
        id: crypto.randomUUID(),
        role: "user",
        parts: [{ type: "text", text }],
        metadata,
      },
    })
  }

  /** Durable Object RPC from the UserHub: another bot is talking to this one. */
  async receiveBotMessage(origin: MessageOrigin, text: string) {
    await this.submitAs(
      origin,
      `[Message from the ${origin.name} bot]\n${text}`
    )
  }

  /** Schedule callback. */
  async runRoutine(payload: RoutinePayload) {
    if (payload.kind === "once") {
      this.setState({
        ...this.state,
        routines: this.state.routines.filter((r) => r.id !== payload.id),
      })
    }
    await this.submitAs(
      { kind: "routine", name: payload.name },
      routinePrompt(payload.name, payload.prompt),
      { background: true }
    )
  }

  /** Inbound mail to <user>.<bot>@EMAIL_DOMAIN, routed in `src/server.ts`. */
  async onEmail(email: AgentEmail) {
    const parsed = await PostalMime.parse(await email.getRaw())
    if (isAutoReplyEmail(parsed.headers)) return
    const from = parsed.from?.address ?? email.from
    const sender = parsed.from?.name ? `${parsed.from.name} <${from}>` : from
    const subject = parsed.subject?.trim() || "(no subject)"
    const body = (parsed.text ?? htmlToText(parsed.html ?? "")).trim()
    const stamp = fileStamp()
    const dir = `/workspace/inbox/email/${stamp}-${slugify(subject, 40)}`
    await this.workspace.fs.mkdir(dir, { recursive: true })
    const path = `${dir}/message.md`
    await this.workspace.fs.writeFile(
      path,
      `From: ${sender}\nTo: ${email.to}\nSubject: ${subject}\nDate: ${parsed.date ?? new Date().toISOString()}\n\n${body}\n`
    )
    const attachments: string[] = []
    for (const file of parsed.attachments.slice(0, 10)) {
      const name = (file.filename ?? "attachment").replace(/[^\w.\- ]+/g, "_")
      const content =
        typeof file.content === "string"
          ? file.content
          : new Uint8Array(file.content)
      await this.workspace.fs.writeFile(`${dir}/${name}`, content)
      attachments.push(`${dir}/${name}`)
    }
    await this.submitAs(
      { kind: "email", name: sender },
      emailPrompt({
        from: sender,
        subject,
        date: parsed.date,
        path,
        body: clip(body, MAX_INBOUND_CHARS),
        attachments,
      }),
      { background: true, key: parsed.messageId }
    )
  }

  /** Durable Object RPC from `/api/hooks/...`. False means a bad token. */
  async receiveWebhook(
    token: string,
    event: { source: string; contentType: string; body: string }
  ): Promise<boolean> {
    if (!timingSafeEqual(token, this.webhookToken())) return false
    const body = event.body.slice(0, MAX_WEBHOOK_BYTES)
    let pretty = body
    if (event.contentType.includes("json")) {
      try {
        pretty = JSON.stringify(JSON.parse(body), null, 2)
      } catch {
        // Not valid JSON after all: keep the raw text.
      }
    }
    const path = `/workspace/inbox/webhooks/${fileStamp()}-${slugify(event.source, 30)}.txt`
    await this.workspace.fs.mkdir("/workspace/inbox/webhooks", {
      recursive: true,
    })
    await this.workspace.fs.writeFile(path, pretty)
    await this.submitAs(
      { kind: "webhook", name: event.source },
      webhookPrompt({
        source: event.source,
        path,
        body: clip(pretty, MAX_INBOUND_CHARS),
      }),
      { background: true }
    )
    return true
  }

  /** Schedule callback. */
  async sweepBrowser() {
    await this.browser.connector.sweep()
    await this.browser.runtime.expirePaused()
  }

  private async rename(name: string) {
    this.setState({ ...this.state, name })
    await this.report({ name })
  }

  private async addRoutine(input: Omit<Routine, "id">): Promise<Routine> {
    const id = crypto.randomUUID().slice(0, 8)
    const payload: RoutinePayload = {
      id,
      name: input.name,
      prompt: input.prompt,
      kind: input.kind,
    }
    const when = input.kind === "cron" ? input.when : new Date(input.when)
    if (when instanceof Date && Number.isNaN(when.getTime())) {
      throw new Error(`Invalid date: ${input.when}`)
    }
    await this.schedule(when, "runRoutine", payload)
    const routine: Routine = { id, ...input }
    this.setState({
      ...this.state,
      routines: [...this.state.routines, routine],
    })
    return routine
  }

  private async removeRoutine(id: string) {
    const schedules = this.getSchedules<RoutinePayload>()
    const match = schedules.find(
      (s) => s.callback === "runRoutine" && s.payload.id === id
    )
    if (match) await this.cancelSchedule(match.id)
    const had = this.state.routines.some((r) => r.id === id)
    this.setState({
      ...this.state,
      routines: this.state.routines.filter((r) => r.id !== id),
    })
    return had
  }

  /** Durable Object RPC: state and history for the first server render. */
  async snapshot(): Promise<{ state: BotState; messages: UIMessage[] }> {
    return { state: this.state, messages: this.messages }
  }

  // ── Browser-facing (settings and the Computer panel) ────────────────

  @callable()
  async updateSettings(input: {
    name?: string
    role?: string
    rules?: Partial<Record<ActionClass, RulePolicy>>
  }) {
    const name = input.name?.trim()
    this.setState({
      ...this.state,
      ...(name ? { name } : {}),
      ...(input.role !== undefined ? { role: input.role.trim() } : {}),
      ...(input.rules
        ? { rules: { ...this.state.rules, ...input.rules } }
        : {}),
    })
    if (name) await this.report({ name })
  }

  @callable()
  async deleteRoutine(id: string) {
    return this.removeRoutine(id)
  }

  @callable()
  async updateProactive(patch: Partial<ProactiveSettings>) {
    const next: ProactiveSettings = { ...this.state.proactive }
    if (patch.enabled !== undefined) next.enabled = !!patch.enabled
    if (patch.appsInBackground !== undefined) {
      next.appsInBackground = !!patch.appsInBackground
    }
    if (patch.everyHours !== undefined) {
      next.everyHours = Math.min(24, Math.max(1, Math.round(patch.everyHours)))
    }
    for (const key of ["quietStart", "quietEnd"] as const) {
      const value = patch[key]
      if (value !== undefined && /^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
        next[key] = value
      }
    }
    if (patch.maxPerDay !== undefined) {
      next.maxPerDay = Math.min(50, Math.max(1, Math.round(patch.maxPerDay)))
    }
    if (patch.timezone !== undefined) {
      try {
        new Intl.DateTimeFormat("en", { timeZone: patch.timezone })
        next.timezone = patch.timezone
      } catch {
        throw new Error(`Unknown time zone: ${patch.timezone}`)
      }
    }
    this.setState({ ...this.state, proactive: next })
    await this.internal_reconcileScheduledTasks()
  }

  /** The browser reports its zone so quiet hours mean the user's night. */
  @callable()
  async setTimezone(timezone: string) {
    if (timezone && timezone !== this.state.proactive.timezone) {
      await this.updateProactive({ timezone })
    }
  }

  /** Run a check-in now, ignoring quiet hours and the daily cap. */
  @callable()
  async checkInNow() {
    await this.checkIn({ force: true })
  }

  @callable()
  async listOpenItems(): Promise<OpenItem[]> {
    return this.sql<OpenItemRow>`SELECT * FROM open_items
      ORDER BY status = 'resolved', updated_at DESC LIMIT 100`.map(toOpenItem)
  }

  /** The user dismisses an item the bot is tracking. */
  @callable()
  async dismissOpenItem(id: string) {
    this.sql`UPDATE open_items SET status = 'resolved',
      note = 'Dismissed by the user', updated_at = ${Date.now()}
      WHERE id = ${id}`
  }

  @callable()
  async getInbound(): Promise<BotInbound> {
    return this.inbound()
  }

  @callable()
  async rotateWebhookToken(): Promise<BotInbound> {
    this.ctx.storage.kv.delete("webhook_token")
    return this.inbound()
  }

  @callable()
  async deleteSkill(slug: string) {
    const skill = this.state.skills.find((s) => s.slug === slug)
    if (!skill) return
    try {
      await this.workspace.fs.rm(`/workspace/skills/${slug}.md`)
    } catch {
      // Already gone from the computer.
    }
    this.setState({
      ...this.state,
      skills: this.state.skills.filter((s) => s.slug !== slug),
    })
  }

  @callable()
  async getApps(): Promise<BotAppDetail[]> {
    return this.appDetails()
  }

  @callable()
  async createAppLink(
    slug: string,
    label: string,
    mode: AppLink["mode"]
  ): Promise<AppLink> {
    if (!this.apps.get(slug)) throw new Error(`No app "${slug}"`)
    const name = label.trim().slice(0, 40) || "Shared link"
    return this.apps.createLink(slug, name, mode === "view" ? "view" : "edit")
  }

  @callable()
  async revokeAppLink(token: string) {
    const revoked = this.apps.revokeLink(token)
    if (revoked) {
      try {
        await this.appLive(revoked.slug).disconnect(token)
      } catch (err) {
        console.error("Closing app viewers failed", err)
      }
    }
  }

  @callable()
  async deleteApp(slug: string) {
    await this.removeApp(slug)
  }

  @callable()
  async getMemory(): Promise<string> {
    return this.session.getContextBlock("memory")?.content ?? ""
  }

  @callable()
  async setMemory(content: string) {
    await this.session.replaceContextBlock("memory", content)
  }

  /** Live View URLs for the bot's browser tabs. Valid for about 5 minutes. */
  @callable()
  async getLiveView(): Promise<
    { url: string; pageUrl?: string; title?: string }[]
  > {
    const view = await this.browser.connector.liveView({ mode: "tab" })
    if (!view) return []
    return view.targets
      .filter((t) => t.type === undefined || t.type === "page")
      .map((t) => ({ url: t.url, pageUrl: t.pageUrl, title: t.title }))
  }

  @callable()
  async closeBrowser() {
    await this.browser.connector.closeSession()
  }

  /**
   * Every path under /workspace, relative to it, for the Files pane.
   * Directories end with "/" so empty ones still show up in the tree.
   */
  @callable()
  async listWorkspace(): Promise<string[]> {
    const entries = await this.workspace.fs.find(WORKSPACE_ROOT, "**", {
      limit: MAX_TREE_ENTRIES,
    })
    const prefix = `${WORKSPACE_ROOT}/`
    return entries
      .map((entry) => {
        const relative = entry.path.startsWith(prefix)
          ? entry.path.slice(prefix.length)
          : entry.path.replace(/^\/+/, "")
        return entry.type === "dir" ? `${relative}/` : relative
      })
      .filter((path) => path !== "" && path !== "/")
  }

  @callable()
  async readFileText(
    path: string
  ): Promise<{ content: string; truncated: boolean }> {
    const content = await this.workspace.fs.readFile(path, "utf8")
    return {
      content: content.slice(0, MAX_FILE_PREVIEW_BYTES),
      truncated: content.length > MAX_FILE_PREVIEW_BYTES,
    }
  }

  /** Save a file the user attached into the bot's inbox. */
  @callable()
  async uploadFile(name: string, base64: string): Promise<{ path: string }> {
    const safe = name.replace(/[^\w.\- ]+/g, "_").slice(0, 120) || "file"
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
    if (bytes.byteLength > MAX_UPLOAD_BYTES) {
      throw new Error("Attachments are limited to 5 MB")
    }
    const path = `/workspace/inbox/${safe}`
    await this.workspace.fs.mkdir("/workspace/inbox", { recursive: true })
    await this.workspace.fs.writeFile(path, bytes)
    return { path }
  }

  /** Run a command in the bot's shell from the Terminal pane. */
  @callable()
  async runCommand(command: string) {
    const started = Date.now()
    const run = await this.workspace.runtime.exec(command, {
      encoding: "utf8",
      cwd: "/workspace",
    })
    let result: Awaited<ReturnType<typeof run.result>>
    try {
      result = await run.result()
    } finally {
      // Exec handles hold an RPC stub that is not garbage-collected.
      run[Symbol.dispose]()
    }
    const { stdout, stderr, exitCode } = result
    const output = [stdout, stderr].filter(Boolean).join("\n")
    this.sql`INSERT INTO activity (at, tool, summary, detail, ok, duration_ms)
      VALUES (${started}, ${"terminal"}, ${clip(command, 200)},
              ${clip(output, 4000)}, ${exitCode === 0 ? 1 : 0},
              ${Date.now() - started})`
    return { stdout, stderr, exitCode }
  }

  @callable()
  async getActivity(
    limit = 100
  ): Promise<(ActivityEntry & { detail: string })[]> {
    const rows = this.sql<{
      id: number
      at: number
      tool: string
      summary: string
      detail: string | null
      ok: number
      duration_ms: number
    }>`SELECT * FROM activity ORDER BY id DESC LIMIT ${limit}`
    return rows.map((r) => ({
      id: r.id,
      at: r.at,
      tool: r.tool,
      summary: r.summary,
      detail: r.detail ?? "",
      ok: r.ok === 1,
      durationMs: r.duration_ms,
    }))
  }
}
