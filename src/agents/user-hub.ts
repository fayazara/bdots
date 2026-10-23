import { Agent, callable, getAgentByName } from "agents"
import type { Connection as AgentConnection, ConnectionContext } from "agents"
import webpush from "web-push"
import { BOT_AVATARS, NEW_BOT_NAME, botInstanceName } from "@/lib/types"
import type {
  AppCatalog,
  AppTool,
  BotSummary,
  Connection,
  HubState,
  PushSubscriptionData,
} from "@/lib/types"
import type { BotAgent } from "./bot-agent"
import { MAX_MEMORY_CHARS, appendFact } from "./memory"

const READ_VERBS =
  /(^|[_\-.])(get|list|search|read|fetch|find|query|lookup|describe|view|show|count)([_\-.]|$)/i
const WRITE_VERBS =
  /(^|[_\-.])(send|create|delete|remove|update|edit|post|write|set|move|archive|reply|forward|draft|cancel|pay|approve|invite|share|execute|run)([_\-.]|$)/i

/**
 * Background turns may only use read-only app tools. Servers that do not
 * annotate their tools get a conservative guess from the name.
 */
function looksReadOnly(name: string) {
  return READ_VERBS.test(name) && !WRITE_VERBS.test(name)
}

/** MCP server id for a connection; it namespaces the connection's tools. */
function serverId(connectionId: string) {
  return `c${connectionId}`
}

/**
 * One per user (instance name = user id). Owns the bot directory that powers
 * the sidebar, the user's connections, and routing between bots.
 *
 * Connections are MCP servers held here, once per user: one sign-in (OAuth
 * or headers) serves every bot. Bots read the tool catalog and call tools
 * through this hub over Durable Object RPC.
 *
 * `@callable()` methods are invoked by the browser over the agent
 * WebSocket. Plain public methods are Durable Object RPC, called by bots.
 */
export class UserHub extends Agent<Env, HubState> {
  initialState: HubState = { bots: [], connections: [] }

  async onStart() {
    // Push endpoints are capability URLs: keep them out of broadcast state.
    this.sql`CREATE TABLE IF NOT EXISTS push_subscriptions (
      endpoint TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`
    // Memory every bot of this user reads, with its edit history.
    this.sql`CREATE TABLE IF NOT EXISTS shared_memory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at INTEGER NOT NULL,
      source TEXT NOT NULL,
      content TEXT NOT NULL
    )`
    // After an MCP sign-in completes, send the user back to Connections.
    this.mcp.configureOAuthCallback({
      customHandler: (result) => {
        this.syncConnectionStatus()
        const query = result.authSuccess
          ? ""
          : `?error=${encodeURIComponent(result.authError)}`
        return new Response(null, {
          status: 302,
          headers: { Location: `/connections${query}` },
        })
      },
    })
    await this.restoreLegacyConnections()
  }

  /** Remember the app's origin to build MCP OAuth callback URLs. */
  onConnect(_connection: AgentConnection, ctx: ConnectionContext) {
    this.ctx.storage.kv.put("origin", new URL(ctx.request.url).origin)
    this.syncConnectionStatus()
  }

  private get userId() {
    return this.name
  }

  private get origin() {
    return this.ctx.storage.kv.get<string>("origin")
  }

  private bot(botId: string) {
    // The binding is declared by Worker name in cloudflare.config.ts, so its
    // generated type does not carry the class.
    return getAgentByName(
      this.env.BotAgent as unknown as DurableObjectNamespace<BotAgent>,
      botInstanceName(this.userId, botId)
    )
  }

  private patchBot(botId: string, patch: Partial<BotSummary>) {
    this.setState({
      ...this.state,
      bots: this.state.bots.map((b) =>
        b.id === botId ? { ...b, ...patch } : b
      ),
    })
  }

  // ── Browser-facing ──────────────────────────────────────────────────

  @callable()
  async createBot(): Promise<BotSummary> {
    // Each bot gets its own shape until the roster runs out.
    const taken = new Set(this.state.bots.map((b) => b.avatar))
    const avatar =
      BOT_AVATARS.find((a) => !taken.has(a)) ??
      BOT_AVATARS[this.state.bots.length % BOT_AVATARS.length]
    const summary: BotSummary = {
      id: crypto.randomUUID().slice(0, 8),
      name: NEW_BOT_NAME,
      avatar,
      status: "idle",
      preview: "",
      updatedAt: Date.now(),
      unread: false,
    }
    this.setState({ ...this.state, bots: [summary, ...this.state.bots] })

    const bot = await this.bot(summary.id)
    await bot.setup(summary.avatar)
    return summary
  }

  @callable()
  async deleteBot(botId: string) {
    const bot = await this.bot(botId)
    await bot.destroy()
    this.setState({
      ...this.state,
      bots: this.state.bots.filter((b) => b.id !== botId),
    })
  }

  @callable()
  markRead(botId: string) {
    if (this.state.bots.find((b) => b.id === botId)?.unread) {
      this.patchBot(botId, { unread: false })
    }
  }

  @callable()
  async addConnection(input: {
    name: string
    url: string
    headers?: Record<string, string>
  }): Promise<Connection> {
    const url = new URL(input.url)
    if (url.protocol !== "https:" && url.hostname !== "localhost") {
      throw new Error("Connection URL must use https")
    }
    const headers = input.headers ?? {}
    const id = crypto.randomUUID().slice(0, 8)
    const name = input.name.trim() || url.hostname
    // The MCP client persists the URL and headers itself; only header names
    // go into `state`, which is broadcast to the browser.
    await this.addMcpServer(name, url.toString(), {
      id: serverId(id),
      callbackHost: this.origin,
      transport: { headers },
    })
    const connection: Connection = {
      id,
      name,
      url: url.toString(),
      headerNames: Object.keys(headers),
      status: "connecting",
      tools: 0,
    }
    this.setState({
      ...this.state,
      connections: [...this.state.connections, connection],
    })
    this.syncConnectionStatus()
    return this.state.connections.find((c) => c.id === id) ?? connection
  }

  @callable()
  async removeConnection(connectionId: string) {
    if (this.getMcpServers().servers[serverId(connectionId)]) {
      await this.removeMcpServer(serverId(connectionId))
    }
    this.setState({
      ...this.state,
      connections: this.state.connections.filter((c) => c.id !== connectionId),
    })
  }

  /**
   * Re-read connection state, e.g. when the Connections page opens. Right
   * after a sign-in the MCP client finishes connecting in the background, so
   * wait for it before reporting.
   */
  @callable()
  async refreshConnections() {
    this.syncConnectionStatus()
    await this.mcp.waitForConnections({ timeout: 10_000 })
    this.syncConnectionStatus()
  }

  /** Retry a connection: a fresh sign-in link, or a new handshake. */
  @callable()
  async reconnect(connectionId: string) {
    const id = serverId(connectionId)
    const result = await this.mcp.connectToServer(id)
    if (result.state === "connected") await this.mcp.discoverIfConnected(id)
    this.syncConnectionStatus()
  }

  // ── Push notifications ──────────────────────────────────────────────

  /** Null when the deployment has no VAPID keys, so push is unavailable. */
  @callable()
  pushPublicKey(): string | null {
    return this.env.VAPID_PUBLIC_KEY && this.env.VAPID_PRIVATE_KEY
      ? this.env.VAPID_PUBLIC_KEY
      : null
  }

  @callable()
  subscribePush(subscription: PushSubscriptionData) {
    const url = new URL(subscription.endpoint)
    if (url.protocol !== "https:") throw new Error("Invalid push endpoint")
    if (!subscription.keys?.p256dh || !subscription.keys?.auth) {
      throw new Error("Push subscription is missing its keys")
    }
    this
      .sql`INSERT OR REPLACE INTO push_subscriptions (endpoint, data, created_at)
      VALUES (${subscription.endpoint}, ${JSON.stringify(subscription)}, ${Date.now()})`
  }

  @callable()
  unsubscribePush(endpoint: string) {
    this.sql`DELETE FROM push_subscriptions WHERE endpoint = ${endpoint}`
  }

  @callable()
  isPushSubscribed(endpoint: string): boolean {
    return (
      this.sql<{ n: number }>`SELECT COUNT(*) AS n FROM push_subscriptions
        WHERE endpoint = ${endpoint}`[0]?.n > 0
    )
  }

  /** Send a test notification to every device this user subscribed. */
  @callable()
  async testPush() {
    return this.push({
      title: "bdots",
      body: "Notifications are on. Your bots will reach you here.",
      tag: "test",
      url: "/",
    })
  }

  private async push(payload: {
    title: string
    body: string
    tag: string
    url: string
  }): Promise<{ sent: number }> {
    const publicKey = this.pushPublicKey()
    if (!publicKey) return { sent: 0 }
    const rows = this.sql<{ endpoint: string; data: string }>`
      SELECT endpoint, data FROM push_subscriptions`
    if (rows.length === 0) return { sent: 0 }
    webpush.setVapidDetails(
      this.env.VAPID_SUBJECT,
      publicKey,
      this.env.VAPID_PRIVATE_KEY
    )
    let sent = 0
    await Promise.all(
      rows.map(async (row) => {
        try {
          await webpush.sendNotification(
            JSON.parse(row.data) as PushSubscriptionData,
            JSON.stringify(payload),
            { TTL: 60 * 60 * 12 }
          )
          sent++
        } catch (err) {
          const status =
            err instanceof webpush.WebPushError ? err.statusCode : 0
          // The browser unsubscribed or the subscription expired.
          if (status === 404 || status === 410) {
            this
              .sql`DELETE FROM push_subscriptions WHERE endpoint = ${row.endpoint}`
          } else {
            console.error("Push failed", status, err)
          }
        }
      })
    )
    return { sent }
  }

  /** Copy live MCP client state (status, sign-in URL, tool count) into `state`. */
  private syncConnectionStatus() {
    const { servers, tools } = this.getMcpServers()
    const connections = this.state.connections.map((c) => {
      const server = servers[serverId(c.id)]
      const next: Connection = {
        id: c.id,
        name: c.name,
        url: c.url,
        headerNames: c.headerNames,
        status: server?.state ?? "failed",
        tools: tools.filter((t) => t.serverId === serverId(c.id)).length,
        ...(c.lastFailure ? { lastFailure: c.lastFailure } : {}),
        ...(server?.auth_url ? { authUrl: server.auth_url } : {}),
        ...(server?.error
          ? { error: server.error }
          : server
            ? {}
            : { error: "Not connected. Remove it and add it again." }),
      }
      return next
    })
    if (
      JSON.stringify(connections) !== JSON.stringify(this.state.connections)
    ) {
      this.setState({ ...this.state, connections })
    }
  }

  /**
   * Connections used to live on each bot, with header values in a table
   * here. Re-register any that the hub's MCP client does not know yet.
   */
  private async restoreLegacyConnections() {
    const legacy = this.sql<{ name: string }>`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name = 'connection_headers'`
    const rows = legacy.length
      ? this.sql<{ connection_id: string; headers: string }>`
          SELECT connection_id, headers FROM connection_headers`
      : []
    const headers = new Map(
      rows.map((r) => [
        r.connection_id,
        JSON.parse(r.headers) as Record<string, string>,
      ])
    )
    const known = this.getMcpServers().servers
    for (const c of this.state.connections) {
      if (known[serverId(c.id)]) continue
      try {
        await this.addMcpServer(c.name, c.url, {
          id: serverId(c.id),
          callbackHost: this.origin,
          transport: { headers: headers.get(c.id) ?? {} },
        })
      } catch (err) {
        console.error(`Restoring connection "${c.name}" failed`, err)
      }
    }
    if (legacy.length) this.sql`DROP TABLE connection_headers`
    // Older states also carried a per-bot toolkit; every bot now gets all.
    if (this.state.bots.some((b) => "connectionIds" in b)) {
      this.setState({
        ...this.state,
        bots: this.state.bots.map(
          ({
            connectionIds: _unused,
            ...b
          }: BotSummary & {
            connectionIds?: string[]
          }) => b
        ),
      })
    }
    this.syncConnectionStatus()
  }

  // ── Server-facing (Durable Object RPC) ──────────────────────────────

  /** State for the first server render, before the WebSocket connects. */
  async snapshot(): Promise<HubState> {
    return this.state
  }

  // ── Bot-facing (Durable Object RPC) ─────────────────────────────────

  /** A bot reports its own status, preview, or new name. */
  async reportBot(
    botId: string,
    patch: Partial<Pick<BotSummary, "name" | "status" | "preview" | "unread">>
  ) {
    const touched = patch.preview !== undefined || patch.name !== undefined
    this.patchBot(botId, {
      ...patch,
      ...(touched ? { updatedAt: Date.now() } : {}),
    })
  }

  // ── Shared memory ───────────────────────────────────────────────────

  /** Durable Object RPC: what every bot reads in its prompt. */
  async sharedMemory(): Promise<string> {
    return (
      this.sql<{
        content: string
      }>`SELECT content FROM shared_memory ORDER BY id DESC LIMIT 1`[0]
        ?.content ?? ""
    )
  }

  /** Durable Object RPC: a bot saves a fact for all of the user's bots. */
  async rememberShared(fact: string, botName: string) {
    const result = appendFact(await this.sharedMemory(), fact)
    if ("content" in result) this.saveShared(result.content, botName)
    return "content" in result
      ? { saved: true }
      : "duplicate" in result
        ? { saved: false, reason: "Already remembered." }
        : { saved: false, error: result.error }
  }

  @callable()
  async getSharedMemory() {
    return {
      content: await this.sharedMemory(),
      revisions: this.sql<{
        id: number
        at: number
        source: string
      }>`SELECT id, at, source
        FROM shared_memory ORDER BY id DESC LIMIT 20`,
    }
  }

  @callable()
  async setSharedMemory(content: string) {
    if (content.length > MAX_MEMORY_CHARS) {
      throw new Error(
        `Shared memory is limited to ${MAX_MEMORY_CHARS} characters.`
      )
    }
    if (content !== (await this.sharedMemory())) this.saveShared(content, "You")
  }

  @callable()
  async restoreSharedMemory(revisionId: number) {
    const row = this.sql<{
      content: string
    }>`SELECT content FROM shared_memory WHERE id = ${revisionId}`[0]
    if (row) this.saveShared(row.content, "You (restored)")
  }

  private saveShared(content: string, source: string) {
    this
      .sql`INSERT INTO shared_memory (at, source, content) VALUES (${Date.now()}, ${source}, ${content})`
    this
      .sql`DELETE FROM shared_memory WHERE id <= (SELECT MAX(id) FROM shared_memory) - 50`
  }

  async listBots(): Promise<BotSummary[]> {
    return this.state.bots
  }

  /** Inbound email and webhooks check this before waking a bot. */
  async hasBot(botId: string): Promise<boolean> {
    return this.state.bots.some((b) => b.id === botId)
  }

  /** A bot has something for the user: push it to their devices. */
  async notifyUser(botId: string, body: string) {
    const bot = this.state.bots.find((b) => b.id === botId)
    if (!bot) return { sent: 0 }
    return this.push({
      title: bot.name,
      body,
      // One notification per bot: a newer one replaces the older.
      tag: `bot-${botId}`,
      url: `/bots/${botId}`,
    })
  }

  /** Every connected tool, for a bot's next turn. */
  async appCatalog(): Promise<AppCatalog> {
    await this.mcp.waitForConnections({ timeout: 5000 })
    this.syncConnectionStatus()
    const names = new Map(
      this.state.connections.map((c) => [serverId(c.id), c] as const)
    )
    const tools: AppTool[] = []
    for (const t of this.mcp.listTools()) {
      const connection = names.get(t.serverId)
      if (!connection) continue
      tools.push({
        connectionId: connection.id,
        connectionName: connection.name,
        name: t.name,
        description: t.description ?? "",
        inputSchema: t.inputSchema as Record<string, unknown>,
        readOnly: t.annotations?.readOnlyHint ?? looksReadOnly(t.name),
      })
    }
    return {
      apps: this.state.connections.map((c) => ({
        id: c.id,
        name: c.name,
        status: c.status,
        tools: c.tools,
        ...(c.error ? { error: c.error } : {}),
      })),
      tools,
    }
  }

  /** Run a connection's tool on behalf of a bot. Credentials stay here. */
  async callAppTool(
    connectionId: string,
    name: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    if (!this.state.connections.some((c) => c.id === connectionId)) {
      throw new Error("That connection was removed.")
    }
    let result: unknown
    try {
      result = await this.mcp.callTool({
        serverId: serverId(connectionId),
        name,
        arguments: args,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const kind = classifyAppFailure(message)
      this.noteAppCall(connectionId, {
        at: Date.now(),
        message: message.slice(0, 300),
        kind,
      })
      const app =
        this.state.connections.find((c) => c.id === connectionId)?.name ??
        "This app"
      throw new Error(
        kind === "auth"
          ? `${app} rejected the request because its sign-in expired or was revoked. Tell the user to reconnect ${app} in Connections. Do not retry until they have.`
          : kind === "unreachable"
            ? `${app} could not be reached (${message.slice(0, 120)}). It may be down. Tell the user if it matters; do not retry more than once.`
            : message
      )
    }
    this.noteAppCall(connectionId, null)
    // Structured clone over RPC: keep the plain JSON parts of the result.
    return JSON.parse(JSON.stringify(result)) as unknown
  }

  /** Remember the latest failed call per connection, for the Connections page. */
  private noteAppCall(
    connectionId: string,
    failure: Connection["lastFailure"] | null
  ) {
    const current = this.state.connections.find((c) => c.id === connectionId)
    if (!current || (!failure && !current.lastFailure)) return
    this.setState({
      ...this.state,
      connections: this.state.connections.map((c) => {
        if (c.id !== connectionId) return c
        const { lastFailure: _, ...rest } = c
        return failure ? { ...rest, lastFailure: failure } : rest
      }),
    })
  }

  /** Where the user opens bdots, so bots can hand out full app links. */
  async appOrigin(): Promise<string | null> {
    return this.origin ?? null
  }

  /** Deliver a message from one bot to another, matched by name or id. */
  async relayMessage(
    fromBotId: string,
    to: string,
    text: string,
    delivery: { key?: string; hops?: number } = {}
  ): Promise<{ delivered: boolean; to?: string; error?: string }> {
    const from = this.state.bots.find((b) => b.id === fromBotId)
    const needle = to.trim().toLowerCase()
    const target = this.state.bots.find(
      (b) => b.id === needle || b.name.toLowerCase() === needle
    )
    if (!from) return { delivered: false, error: "Unknown sender" }
    if (!target) {
      const names = this.state.bots
        .filter((b) => b.id !== fromBotId)
        .map((b) => b.name)
      return {
        delivered: false,
        error: `No bot named "${to}". Available: ${names.join(", ") || "none"}`,
      }
    }
    if (target.id === fromBotId) {
      return { delivered: false, error: "A bot cannot message itself" }
    }
    const bot = await this.bot(target.id)
    await bot.receiveBotMessage(
      { kind: "bot", name: from.name, avatar: from.avatar },
      text,
      delivery
    )
    return { delivered: true, to: target.name }
  }
}

/** Sorts a failed app call: an expired sign-in, a server that is down, or the tool itself. */
function classifyAppFailure(message: string): "auth" | "unreachable" | "tool" {
  if (
    /\b(401|403)\b|unauthori[sz]ed|forbidden|invalid[_ ]token|token (has )?expired/i.test(
      message
    )
  ) {
    return "auth"
  }
  if (
    /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|fetch failed|network|timed? ?out|\b(502|503|504)\b|not connected/i.test(
      message
    )
  ) {
    return "unreachable"
  }
  return "tool"
}
