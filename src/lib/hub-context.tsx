import { createContext, useContext, useMemo } from "react"
import { useAgent } from "agents/react"
import type { ReactNode } from "react"
import type { BotSummary, Connection, HubState } from "@/lib/types"
import type { Viewer } from "@/lib/server-fns"
import type { UserHub } from "@/agents/user-hub"

export interface NewConnection {
  name: string
  url: string
  headers?: Record<string, string>
}

interface HubContextValue {
  viewer: Viewer
  state: HubState
  /** False during SSR and until the WebSocket has delivered state. */
  live: boolean
  createBot: () => Promise<BotSummary>
  deleteBot: (botId: string) => Promise<void>
  markRead: (botId: string) => void
  addConnection: (input: NewConnection) => Promise<Connection>
  removeConnection: (connectionId: string) => Promise<void>
  refreshConnections: () => void
  reconnect: (connectionId: string) => Promise<void>
}

const HubContext = createContext<HubContextValue | null>(null)

export function useHub() {
  const value = useContext(HubContext)
  if (!value) throw new Error("useHub must be used inside a HubProvider")
  return value
}

interface ProviderProps {
  viewer: Viewer
  initial: HubState
  children: ReactNode
}

function notConnected(): never {
  throw new Error("Not connected yet")
}

/** Server render and pre-hydration: loader data, no socket. */
export function StaticHubProvider({
  viewer,
  initial,
  children,
}: ProviderProps) {
  const value = useMemo<HubContextValue>(
    () => ({
      viewer,
      state: initial,
      live: false,
      createBot: notConnected,
      deleteBot: notConnected,
      markRead: () => {},
      addConnection: notConnected,
      removeConnection: notConnected,
      refreshConnections: () => {},
      reconnect: notConnected,
    }),
    [viewer, initial]
  )
  return <HubContext.Provider value={value}>{children}</HubContext.Provider>
}

/** Browser only: a WebSocket to the user's UserHub keeps the sidebar live. */
export function LiveHubProvider({ viewer, initial, children }: ProviderProps) {
  const agent = useAgent<UserHub, HubState>({
    agent: "user-hub",
    name: viewer.id,
  })
  const state = agent.state ?? initial

  const value = useMemo<HubContextValue>(
    () => ({
      viewer,
      state,
      live: agent.state !== undefined,
      createBot: () => agent.stub.createBot(),
      deleteBot: (botId) => agent.stub.deleteBot(botId),
      markRead: (botId) => void agent.stub.markRead(botId),
      addConnection: (input) => agent.stub.addConnection(input),
      removeConnection: (id) => agent.stub.removeConnection(id),
      refreshConnections: () => void agent.stub.refreshConnections(),
      reconnect: (id) => agent.stub.reconnect(id),
    }),
    [viewer, state, agent]
  )
  return <HubContext.Provider value={value}>{children}</HubContext.Provider>
}
