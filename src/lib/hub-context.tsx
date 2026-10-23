import { createContext, useContext, useMemo } from "react"
import { useAgent } from "agents/react"
import type { ReactNode } from "react"
import type {
  BotSummary,
  Connection,
  HubState,
  PushSubscriptionData,
} from "@/lib/types"
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
  push: PushApi | null
  /** Memory all bots read. Null until the hub WebSocket is up. */
  sharedMemory: SharedMemoryApi | null
}

export interface MemoryRevision {
  id: number
  at: number
  source: string
}

export interface SharedMemoryApi {
  get: () => Promise<{ content: string; revisions: MemoryRevision[] }>
  set: (content: string) => Promise<void>
  restore: (revisionId: number) => Promise<void>
}

/** Web Push via the UserHub. Null until the hub WebSocket is up. */
export interface PushApi {
  publicKey: () => Promise<string | null>
  subscribe: (subscription: PushSubscriptionData) => Promise<void>
  unsubscribe: (endpoint: string) => Promise<void>
  isSubscribed: (endpoint: string) => Promise<boolean>
  test: () => Promise<{ sent: number }>
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
      push: null,
      sharedMemory: null,
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
      push:
        agent.state !== undefined
          ? {
              publicKey: () => agent.stub.pushPublicKey(),
              subscribe: (subscription) =>
                agent.stub.subscribePush(subscription),
              unsubscribe: (endpoint) => agent.stub.unsubscribePush(endpoint),
              isSubscribed: (endpoint) => agent.stub.isPushSubscribed(endpoint),
              test: () => agent.stub.testPush(),
            }
          : null,
      sharedMemory:
        agent.state !== undefined
          ? {
              get: () => agent.stub.getSharedMemory(),
              set: (content) => agent.stub.setSharedMemory(content),
              restore: (id) => agent.stub.restoreSharedMemory(id),
            }
          : null,
    }),
    [viewer, state, agent]
  )
  return <HubContext.Provider value={value}>{children}</HubContext.Provider>
}
