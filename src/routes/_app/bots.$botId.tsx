import { Suspense, useCallback, useEffect, useMemo } from "react"
import {
  ClientOnly,
  Link,
  Outlet,
  createFileRoute,
  redirect,
  useMatchRoute,
} from "@tanstack/react-router"
import { useAgent } from "agents/react"
import { useAgentChat } from "@cloudflare/think/react"
import { Tooltip } from "@cloudflare/kumo/components/tooltip"
import { GearSixIcon, MonitorIcon } from "@phosphor-icons/react"
import { BotAvatar } from "@/components/bot-avatar"
import { Composer } from "@/components/composer"
import { Thread } from "@/components/thread"
import { BotContext } from "@/lib/bot-context"
import { useHub } from "@/lib/hub-context"
import { getBotSnapshot } from "@/lib/server-fns"
import { botInstanceName } from "@/lib/types"
import type { UIMessage } from "ai"
import type { BotAgent } from "@/agents/bot-agent"
import type { OnApproval } from "@/components/thread"
import type { BotState } from "@/lib/types"

export const Route = createFileRoute("/_app/bots/$botId")({
  loader: async ({ params }) => {
    const snapshot = await getBotSnapshot({ data: params.botId })
    if (!snapshot) throw redirect({ to: "/" })
    return snapshot
  },
  // Chat is live over a WebSocket; refetching history on every navigation
  // would only race it.
  staleTime: Infinity,
  component: BotRoute,
})

function BotRoute() {
  const { botId } = Route.useParams()
  const snapshot = Route.useLoaderData()
  const messages = useMemo(
    () => JSON.parse(snapshot.messagesJson) as UIMessage[],
    [snapshot.messagesJson]
  )
  const fallback = (
    <BotLayout botId={botId} state={snapshot.state} agent={null}>
      <Thread bot={snapshot.state} messages={messages} busy={false} />
      <Composer
        botName={snapshot.state.name}
        disabled
        busy={false}
        onSend={() => {}}
        onStop={() => {}}
      />
    </BotLayout>
  )
  return (
    <ClientOnly fallback={fallback}>
      <Suspense fallback={fallback}>
        {/* Remount per bot so each gets its own socket and chat state. */}
        <LiveBot key={botId} botId={botId} initialState={snapshot.state} />
      </Suspense>
    </ClientOnly>
  )
}

function PanelLink({
  to,
  label,
  active,
  botId,
  children,
}: {
  to: "/bots/$botId/computer" | "/bots/$botId/settings"
  label: string
  active: boolean
  botId: string
  children: React.ReactNode
}) {
  return (
    <Tooltip
      content={active ? `Close ${label.toLowerCase()}` : label}
      render={
        <Link
          to={active ? "/bots/$botId" : to}
          params={{ botId }}
          aria-label={label}
          aria-pressed={active}
          className={`flex size-9 items-center justify-center rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-kumo-focus ${
            active
              ? "bg-kumo-fill text-kumo-default"
              : "text-kumo-subtle hover:bg-kumo-tint hover:text-kumo-default"
          }`}
        >
          {children}
        </Link>
      }
    />
  )
}

function BotLayout({
  botId,
  state,
  agent,
  children,
}: {
  botId: string
  state: BotState
  agent: ReturnType<typeof useAgent<BotAgent, BotState>> | null
  children: React.ReactNode
}) {
  const matchRoute = useMatchRoute()
  const computerOpen = !!matchRoute({ to: "/bots/$botId/computer" })
  const settingsOpen = !!matchRoute({ to: "/bots/$botId/settings" })
  const context = useMemo(
    () => ({ botId, state, agent }),
    [botId, state, agent]
  )

  return (
    <BotContext.Provider value={context}>
      <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl bg-kumo-base shadow-xs ring ring-kumo-line">
        <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-kumo-line px-5">
          <div className="flex min-w-0 items-center gap-2.5">
            <BotAvatar avatar={state.avatar} status={state.status} size={26} />
            <h1 className="truncate text-[15px] font-medium text-kumo-default">
              {state.name}
            </h1>
          </div>
          <div className="flex items-center gap-1">
            <PanelLink
              to="/bots/$botId/settings"
              label="Settings"
              active={settingsOpen}
              botId={botId}
            >
              <GearSixIcon size={20} />
            </PanelLink>
            <PanelLink
              to="/bots/$botId/computer"
              label="Computer"
              active={computerOpen}
              botId={botId}
            >
              <MonitorIcon size={20} />
            </PanelLink>
          </div>
        </header>
        {children}
      </section>
      <Outlet />
    </BotContext.Provider>
  )
}

function LiveBot({
  botId,
  initialState,
}: {
  botId: string
  initialState: BotState
}) {
  const hub = useHub()
  const agent = useAgent<BotAgent, BotState>({
    agent: "bot-agent",
    name: botInstanceName(hub.viewer.id, botId),
  })
  const state = agent.state ?? initialState
  const chat = useAgentChat({ agent })
  const busy = chat.status === "submitted" || chat.status === "streaming"

  // Opening a thread clears its unread dot, including for replies that land
  // while it is open.
  const unread = hub.state.bots.find((b) => b.id === botId)?.unread
  const { markRead } = hub
  useEffect(() => {
    if (unread) markRead(botId)
  }, [unread, botId, markRead])

  const getLiveView = useCallback(() => agent.stub.getLiveView(), [agent])

  const onApproval = useCallback<OnApproval>(
    (id, approved, reason) => {
      void chat.addToolApprovalResponse({ id, approved, reason })
    },
    [chat]
  )

  const onAttach = useCallback(
    async (file: File) => {
      const bytes = new Uint8Array(await file.arrayBuffer())
      let binary = ""
      for (const byte of bytes) binary += String.fromCharCode(byte)
      const { path } = await agent.stub.uploadFile(file.name, btoa(binary))
      return path
    },
    [agent]
  )

  return (
    <BotLayout botId={botId} state={state} agent={agent}>
      <Thread
        bot={state}
        messages={chat.messages}
        busy={busy}
        getLiveView={getLiveView}
        onApproval={onApproval}
      />
      {chat.error ? (
        <p
          role="alert"
          className="mx-auto w-full max-w-[860px] px-8 pb-2 text-sm text-kumo-danger"
        >
          {chat.error.message ||
            "Something went wrong. Try sending that again."}
        </p>
      ) : null}
      <Composer
        botName={state.name}
        busy={busy}
        onSend={(text) => void chat.sendMessage({ text })}
        onStop={() => void chat.stop()}
        onAttach={onAttach}
      />
    </BotLayout>
  )
}
