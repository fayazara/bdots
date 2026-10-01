import { createServerFn } from "@tanstack/react-start"
import { getRequest } from "@tanstack/react-start/server"
import { getAgentByName } from "agents"
import { env } from "cloudflare:workers"
import { DEMO_USER_ID, userIdFromRequest } from "@/lib/auth"
import { SIDEBAR_COOKIE } from "@/lib/layout-context"
import { botInstanceName } from "@/lib/types"
import type { BotState, HubState } from "@/lib/types"
import type { BotAgent } from "@/agents/bot-agent"
import type { UserHub } from "@/agents/user-hub"

export interface Viewer {
  id: string
  label: string
  avatarUrl?: string
}

// TODO: temporary, hardcoded for screenshots. Replace with the signed-in
// user's profile once there is real auth.
const DEMO_VIEWER = {
  label: "Fayaz Ahmed",
  avatarUrl: "https://github.com/fayazara.png",
}

function viewerFromRequest(request: Request): Viewer {
  const id = userIdFromRequest(request)
  const email = request.headers.get("Cf-Access-Authenticated-User-Email")
  if (id === DEMO_USER_ID) return { id, ...DEMO_VIEWER }
  return { id, label: email ?? id }
}

/**
 * Sidebar state for the first paint. After hydration the browser takes over
 * with a WebSocket to the same UserHub.
 */
export const getHubSnapshot = createServerFn().handler(
  async (): Promise<{
    viewer: Viewer
    hub: HubState
    sidebarOpen: boolean
  }> => {
    const request = getRequest()
    const viewer = viewerFromRequest(request)
    const cookie = request.headers.get("Cookie") ?? ""
    const sidebarOpen = !cookie.includes(`${SIDEBAR_COOKIE}=closed`)
    const hub = await getAgentByName(
      env.UserHub as unknown as DurableObjectNamespace<UserHub>,
      viewer.id
    )
    return { viewer, hub: await hub.snapshot(), sidebarOpen }
  }
)

export interface BotSnapshot {
  state: BotState
  /** `UIMessage[]` as JSON: message parts hold `unknown` tool payloads. */
  messagesJson: string
}

/** A bot's state and chat history for the first paint. */
export const getBotSnapshot = createServerFn()
  .validator((botId: string) => botId)
  .handler(async ({ data: botId }): Promise<BotSnapshot | null> => {
    const viewer = viewerFromRequest(getRequest())
    const hub = await getAgentByName(
      env.UserHub as unknown as DurableObjectNamespace<UserHub>,
      viewer.id
    )
    const { bots } = await hub.snapshot()
    // Looking up an unknown name would create an empty Durable Object.
    if (!bots.some((b) => b.id === botId)) return null
    const bot = await getAgentByName(
      env.BotAgent as unknown as DurableObjectNamespace<BotAgent>,
      botInstanceName(viewer.id, botId)
    )
    const { state, messages } = await bot.snapshot()
    return { state, messagesJson: JSON.stringify(messages) }
  })
