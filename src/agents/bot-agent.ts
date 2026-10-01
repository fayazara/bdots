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
  ToolCallContext,
  ToolCallDecision,
  ToolCallResultContext,
  TurnConfig,
  TurnContext,
} from "@cloudflare/think"
import { createBrowserRuntime } from "@cloudflare/think/tools/browser"
import type { BrowserRuntime } from "@cloudflare/think/tools/browser"
import { callable, getAgentByName } from "agents"
import type { ContextConfig } from "agents/context"
import { jsonSchema, tool } from "ai"
import type { JSONSchema7, ToolSet, UIMessage } from "ai"
import { createWorkersAI } from "workers-ai-provider"
import { z } from "zod"
import { DEFAULT_RULES, NEW_BOT_NAME } from "@/lib/types"
import type {
  ActionClass,
  AppCatalog,
  ActivityEntry,
  BotAvatarKind,
  BotState,
  BotStatus,
  MessageOrigin,
  Routine,
  RulePolicy,
} from "@/lib/types"
import { GREETING, SOUL, turnContext } from "./prompt"
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
}

const MAX_PREVIEW = 140
const MAX_FILE_PREVIEW_BYTES = 200_000
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024
const WORKSPACE_ROOT = "/workspace"
const MAX_TREE_ENTRIES = 5000

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
      ;[others, catalog] = await Promise.all([
        hub.listBots().then((bots) => bots.filter((b) => b.id !== this.botId)),
        hub.appCatalog(),
      ])
    } catch (err) {
      console.error("Loading bots or apps failed", err)
    }
    this.#appTools = this.buildAppTools(catalog)
    this.#appToolNames = new Set(Object.keys(this.#appTools))
    return {
      instructions: `${ctx.system}\n\n${turnContext(this.state, others, catalog.apps)}`,
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

  /** Wrap the hub's catalog as AI SDK tools that call back through the hub. */
  private buildAppTools(catalog: AppCatalog): ToolSet {
    const tools: ToolSet = {}
    for (const t of catalog.tools) {
      tools[appToolName(t.connectionId, t.name)] = tool({
        description: `[${t.connectionName}] ${t.description}`.trim(),
        inputSchema: jsonSchema(
          (t.inputSchema as JSONSchema7) ?? { type: "object" }
        ),
        needsApproval: async () => this.state.rules.apps === "ask",
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
      const cls = TOOL_CLASS[name]
      if (!cls) continue
      tools[name] = {
        ...def,
        needsApproval: async () => this.state.rules[cls] === "ask",
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
    }
  }

  override beforeToolCall(ctx: ToolCallContext): ToolCallDecision | void {
    if (this.policyFor(ctx.toolName) === "block") {
      return {
        action: "block",
        reason:
          "The user has blocked this kind of action for you. Tell them what you wanted to do instead of retrying.",
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

  override async onChatResponse(result: ChatResponseResult) {
    const waiting = result.message.parts.some(
      (p) => "state" in p && p.state === "approval-requested"
    )
    const status: BotStatus = waiting ? "action_needed" : "idle"
    this.setState({ ...this.state, status })
    const preview = clip(textOf(result.message), MAX_PREVIEW)
    await this.report({
      status,
      unread: true,
      ...(preview ? { preview } : {}),
    })
  }

  override onChatError(error: unknown) {
    void this.setStatus("idle")
    return error
  }

  // ── Messages that do not come from the human ────────────────────────

  private async submitAs(origin: MessageOrigin, text: string, key?: string) {
    await this.runTurn({
      mode: "submit",
      idempotencyKey: key,
      input: {
        id: crypto.randomUUID(),
        role: "user",
        parts: [{ type: "text", text }],
        metadata: { origin },
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
      `[Scheduled routine: ${payload.name}]\n${payload.prompt}\n\nThe user is not watching. Stay read-only unless these instructions say otherwise, and finish with a short report.`
    )
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
