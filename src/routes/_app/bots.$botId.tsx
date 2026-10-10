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
import {
  GearSixIcon,
  ComputerIcon,
  SidebarSimpleIcon,
} from "@/components/icons"
import { BotAvatar } from "@/components/bot-avatar"
import { Composer } from "@/components/composer"
import { ComputerPanel } from "@/components/computer-panel"
import { SettingsPanel } from "@/components/settings-panel"
import { SidePanel } from "@/components/side-panel"
import { SlideShell, useLatchedWhileClosing } from "@/components/slide-shell"
import { Thread } from "@/components/thread"
import { BotContext } from "@/lib/bot-context"
import { useHub } from "@/lib/hub-context"
import { useLayout } from "@/lib/layout-context"
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
          className="icon-btn"
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
  const panel = computerOpen ? "computer" : settingsOpen ? "settings" : null
  // Keep the closing panel's content on screen while it slides away.
  const shownPanel = useLatchedWhileClosing(panel, panel !== null)
  const { sidebarOpen, toggleSidebar } = useLayout()
  const context = useMemo(
    () => ({ botId, state, agent }),
    [botId, state, agent]
  )

  return (
    <BotContext.Provider value={context}>
      <section className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="col-header relative justify-between">
          <Tooltip
            content={sidebarOpen ? "Hide bots" : "Show bots"}
            render={
              <button
                type="button"
                onClick={toggleSidebar}
                aria-label={sidebarOpen ? "Hide bots" : "Show bots"}
                aria-pressed={!sidebarOpen}
                className="icon-btn"
              >
                <SidebarSimpleIcon size={20} />
              </button>
            }
          />
          {/* The bot's name floats in the middle, like a window title. */}
          <div className="absolute left-1/2 flex h-9 max-w-[50%] -translate-x-1/2 items-center gap-2 rounded-full bg-kumo-base pr-4 pl-1.5 shadow-[0_0_0_1px_var(--color-kumo-line),0_1px_2px_oklch(0_0_0/0.04),0_2px_8px_oklch(0_0_0/0.04)]">
            <BotAvatar avatar={state.avatar} status={state.status} size={30} />
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
              <ComputerIcon size={20} />
            </PanelLink>
          </div>
        </header>
        {children}
      </section>
      <SlideShell open={panel !== null} side="right">
        {shownPanel === "computer" ? (
          <ComputerPanel />
        ) : shownPanel === "settings" ? (
          <SidePanel title="Settings">
            <SettingsPanel />
          </SidePanel>
        ) : null}
      </SlideShell>
      {/* Panel routes only exist for their URLs; the panels render above. */}
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

  // Quiet hours and the bot's sense of "today" follow the user's clock.
  const timezone = state.proactive?.timezone
  const connected = agent.state !== undefined
  useEffect(() => {
    if (!connected) return
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (zone && zone !== timezone) void agent.stub.setTimezone(zone)
  }, [agent, connected, timezone])

  const getLiveView = useCallback(() => agent.stub.getLiveView(), [agent])
  const readFile = useCallback(
    (path: string) => agent.stub.readFileData(path),
    [agent]
  )

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
        readFile={readFile}
        onApproval={onApproval}
      />
      {chat.error ? (
        <p
          role="alert"
          className="mx-auto w-full max-w-[820px] px-6 pb-2 text-sm text-kumo-danger"
        >
          {chat.error.message ||
            "Something went wrong. Try sending that again."}
        </p>
      ) : null}
      <Composer
        botName={state.name}
        busy={busy}
        onSend={(text) =>
          void chat.sendMessage({ text, metadata: { at: Date.now() } })
        }
        onStop={() => void chat.stop()}
        onAttach={onAttach}
      />
    </BotLayout>
  )
}
