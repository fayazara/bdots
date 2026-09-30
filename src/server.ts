import handler from "@tanstack/react-start/server-entry"
import { routeAgentRequest } from "agents"
import { userIdFromRequest } from "@/lib/auth"

// Durable Objects and the classes their runtimes load by name.
export { BotAgent, WorkspaceServiceProxy } from "./agents/bot-agent"
export { UserHub } from "./agents/user-hub"
// Backs `browser_execute`: a durable Code Mode runtime in a DO facet.
export { CodemodeRuntime } from "agents/browser"

/** `/agents/<agent>/<instance>/...` → the instance name, URL-decoded. */
function agentInstance(pathname: string) {
  const [, prefix, agent, instance] = pathname.split("/")
  if (prefix !== "agents" || !agent || !instance) return null
  return { agent, instance: decodeURIComponent(instance) }
}

/** A user may only reach their own hub and their own bots. */
function ownsInstance(userId: string, agent: string, instance: string) {
  if (agent === "user-hub") return instance === userId
  if (agent === "bot-agent") return instance.startsWith(`${userId}:`)
  return false
}

export default {
  async fetch(request, env) {
    const target = agentInstance(new URL(request.url).pathname)
    if (target) {
      const userId = userIdFromRequest(request)
      if (!ownsInstance(userId, target.agent, target.instance)) {
        return new Response("Forbidden", { status: 403 })
      }
      // Agent WebSockets and agent HTTP (MCP OAuth callbacks).
      const response = await routeAgentRequest(request, env)
      if (response) return response
    }
    return handler.fetch(request)
  },
} satisfies ExportedHandler<Env>
