import { Agent, callable, getAgentByName } from "agents"
import type { Connection as AgentConnection, ConnectionContext } from "agents"
import { BOT_AVATARS, NEW_BOT_NAME, botInstanceName } from "@/lib/types"
import type { BotSummary, Connection, HubState } from "@/lib/types"
import type { BotAgent } from "./bot-agent"

export interface ResolvedConnection {
  id: string
  name: string
  url: string
  headers: Record<string, string>
}

/**
 * One per user (instance name = user id). Owns the bot directory that powers
 * the sidebar, the user's connections, and routing between bots.
 *
 * `@callable()` methods are invoked by the browser over the agent
 * WebSocket. Plain public methods are Durable Object RPC, called by bots.
 */
export class UserHub extends Agent<Env, HubState> {
  initialState: HubState = { bots: [], connections: [] }

  onStart() {
    // Header values (tokens) are kept out of `state`, which is broadcast to
    // the browser.
    this.sql`CREATE TABLE IF NOT EXISTS connection_headers (
      connection_id TEXT PRIMARY KEY,
      headers TEXT NOT NULL
    )`
  }

  /** Remember the app's origin so bots can build MCP OAuth callback URLs. */
  onConnect(_connection: AgentConnection, ctx: ConnectionContext) {
    this.ctx.storage.kv.put("origin", new URL(ctx.request.url).origin)
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
      connectionIds: this.state.connections.map((c) => c.id),
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
    const connection: Connection = {
      id: crypto.randomUUID().slice(0, 8),
      name: input.name.trim() || url.hostname,
      url: url.toString(),
      headerNames: Object.keys(headers),
    }
    this.sql`INSERT INTO connection_headers (connection_id, headers)
      VALUES (${connection.id}, ${JSON.stringify(headers)})`
    // New connections are added to every bot's toolkit; narrow it per bot
    // in settings.
    this.setState({
      connections: [...this.state.connections, connection],
      bots: this.state.bots.map((b) => ({
        ...b,
        connectionIds: [...b.connectionIds, connection.id],
      })),
    })
    await this.syncBots(this.state.bots.map((b) => b.id))
    return connection
  }

  @callable()
  async removeConnection(connectionId: string) {
    this
      .sql`DELETE FROM connection_headers WHERE connection_id = ${connectionId}`
    const affected = this.state.bots
      .filter((b) => b.connectionIds.includes(connectionId))
      .map((b) => b.id)
    this.setState({
      connections: this.state.connections.filter((c) => c.id !== connectionId),
      bots: this.state.bots.map((b) => ({
        ...b,
        connectionIds: b.connectionIds.filter((id) => id !== connectionId),
      })),
    })
    await this.syncBots(affected)
  }

  @callable()
  async setBotConnections(botId: string, connectionIds: string[]) {
    const known = new Set(this.state.connections.map((c) => c.id))
    this.patchBot(botId, {
      connectionIds: connectionIds.filter((id) => known.has(id)),
    })
    await this.syncBots([botId])
  }

  private async syncBots(botIds: string[]) {
    await Promise.all(
      botIds.map(async (id) => {
        const bot = await this.bot(id)
        await bot.syncConnections(this.origin)
      })
    )
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

  async listBots(): Promise<BotSummary[]> {
    return this.state.bots
  }

  /** The connections in a bot's toolkit, with their secret headers. */
  async connectionsFor(botId: string): Promise<ResolvedConnection[]> {
    const bot = this.state.bots.find((b) => b.id === botId)
    if (!bot) return []
    const rows = this.sql<{ connection_id: string; headers: string }>`
      SELECT connection_id, headers FROM connection_headers`
    const headers = new Map(
      rows.map((r) => [
        r.connection_id,
        JSON.parse(r.headers) as Record<string, string>,
      ])
    )
    return this.state.connections
      .filter((c) => bot.connectionIds.includes(c.id))
      .map((c) => ({
        id: c.id,
        name: c.name,
        url: c.url,
        headers: headers.get(c.id) ?? {},
      }))
  }

  /** Deliver a message from one bot to another, matched by name or id. */
  async relayMessage(
    fromBotId: string,
    to: string,
    text: string
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
      text
    )
    return { delivered: true, to: target.name }
  }
}
