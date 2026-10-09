import { useEffect, useMemo, useRef, useState } from "react"
import { useHydrated } from "@tanstack/react-router"
import Markdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { Button } from "@cloudflare/kumo/components/button"
import { Loader } from "@cloudflare/kumo/components/loader"
import {
  AppWindowIcon,
  CaretDownIcon,
  CaretRightIcon,
  CheckIcon,
  ClockIcon,
  EnvelopeSimpleIcon,
  WarningIcon,
  WebhooksLogoIcon,
} from "@/components/icons"
import { BotAvatar } from "@/components/bot-avatar"
import { CodeBlock } from "@/components/code-block"
import { ComputerCard } from "@/components/computer-card"
import {
  describeCall,
  isQuietReply,
  messageText,
  metaOf,
  originOf,
  stripOriginHeader,
  toBlocks,
} from "@/lib/message-parts"
import { NO_UPDATE } from "@/lib/types"
import type { UIMessage } from "ai"
import type { GetLiveView } from "@/components/computer-card"
import type { Block, ToolCall } from "@/lib/message-parts"
import type { BotState } from "@/lib/types"

export type OnApproval = (
  approvalId: string,
  approved: boolean,
  reason?: string
) => void

interface ThreadProps {
  bot: Pick<BotState, "name" | "avatar" | "status">
  messages: UIMessage[]
  /** A turn is in flight (submitted or streaming). */
  busy: boolean
  getLiveView?: GetLiveView
  onApproval?: OnApproval
}

function Prose({ text }: { text: string }) {
  return (
    <div className="bubble-prose space-y-3 text-[15px] leading-6 text-pretty [&_a]:text-kumo-link [&_a]:underline [&_code]:rounded [&_code]:bg-kumo-fill [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[13px] [&_h1]:text-base [&_h1]:font-semibold [&_h2]:text-[15px] [&_h2]:font-semibold [&_h3]:font-semibold [&_li]:my-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_pre_code]:rounded-none [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_table]:text-sm [&_td]:border-t [&_td]:border-kumo-line [&_td]:px-2 [&_td]:py-1 [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_ul]:list-disc [&_ul]:pl-5">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ node: _node, ...props }) => (
            <a {...props} target="_blank" rel="noreferrer noopener" />
          ),
          // Fenced blocks get highlighted; inline `code` stays a small chip.
          pre: ({ children }) => <>{children}</>,
          code: ({ node: _node, className, children, ...props }) => {
            const text = String(children ?? "")
            const lang = /language-([\w-]+)/.exec(className ?? "")?.[1]
            if (!lang && !text.includes("\n"))
              return <code {...props}>{children}</code>
            return (
              <CodeBlock
                code={text.replace(/\n$/, "")}
                lang={lang}
                className="rounded-2xl bg-(--fill-hover) px-4 py-3"
              />
            )
          },
        }}
      >
        {text}
      </Markdown>
    </div>
  )
}

/** Muted text with a highlight sweeping across it while work is running. */
export function ShimmerText({
  text,
  className = "",
}: {
  text: string
  className?: string
}) {
  return (
    <span
      className={`t-shimmer text-kumo-subtle ${className}`}
      data-text={text}
    >
      {text}
    </span>
  )
}

function SystemEvent({ children }: { children: React.ReactNode }) {
  return <p className="py-1 text-center text-sm text-kumo-subtle">{children}</p>
}

function StepIcon({ state }: { state: ToolCall["state"] }) {
  if (state === "running") return <Loader size="sm" />
  if (state === "done") return <CheckIcon size={14} />
  return <WarningIcon size={14} className="text-kumo-warning" />
}

/** Compact list of the file, shell, API and read-only web calls in a turn. */
function Steps({ calls }: { calls: ToolCall[] }) {
  const [open, setOpen] = useState(false)
  const running = calls.some((c) => c.state === "running")
  const current = calls.findLast((c) => c.state === "running") ?? calls.at(-1)
  if (!current) return null

  if (calls.length === 1) {
    return (
      <div className="flex items-center gap-2 px-1 text-sm text-kumo-subtle">
        <StepIcon state={current.state} />
        <span className="truncate">{describeCall(current)}</span>
      </div>
    )
  }
  return (
    <div className="text-sm text-kumo-subtle">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex max-w-full items-center gap-2 rounded-lg px-1 py-0.5 outline-none hover:text-kumo-default focus-visible:ring-2 focus-visible:ring-kumo-focus"
      >
        {running ? (
          <Loader size="sm" />
        ) : open ? (
          <CaretDownIcon size={14} />
        ) : (
          <CaretRightIcon size={14} />
        )}
        <span className="truncate">
          {running ? describeCall(current) : `${calls.length} steps`}
        </span>
      </button>
      {open ? (
        <ul className="mt-1 space-y-1 pl-1">
          {calls.map((call) => (
            <li key={call.id} className="flex items-center gap-2">
              <StepIcon state={call.state} />
              <span className="truncate">{describeCall(call)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

function ApprovalCard({
  call,
  onApproval,
}: {
  call: ToolCall
  onApproval?: OnApproval
}) {
  const details = JSON.stringify(call.input, null, 2)
  return (
    <div className="w-full max-w-[640px] rounded-3xl bg-kumo-tint p-4">
      <p className="text-[15px] font-semibold text-kumo-default">
        Approval needed
      </p>
      <p className="mt-1 text-[15px] text-kumo-default">{describeCall(call)}</p>
      {details !== "{}" ? (
        <CodeBlock
          code={details}
          lang="json"
          className="mt-3 max-h-60 rounded-2xl bg-kumo-base p-3"
        />
      ) : null}
      {onApproval && call.approvalId ? (
        <div className="mt-3 flex gap-2">
          <Button
            variant="primary"
            className="btn-ink rounded-full"
            onClick={() => onApproval(call.approvalId!, true)}
          >
            Approve
          </Button>
          <Button
            variant="outline"
            className="rounded-full"
            onClick={() =>
              onApproval(call.approvalId!, false, "The user said no.")
            }
          >
            Reject
          </Button>
        </div>
      ) : null}
    </div>
  )
}

function AssistantMessage({
  blocks,
  latestComputerKey,
  getLiveView,
  onApproval,
}: {
  blocks: Block[]
  latestComputerKey: string | undefined
  getLiveView?: GetLiveView
  onApproval?: OnApproval
}) {
  return (
    <>
      {blocks.map((block) => {
        switch (block.kind) {
          case "text":
            return (
              <div
                key={block.key}
                className="w-fit max-w-[85%] rounded-[20px] bg-kumo-tint px-4 py-2.5 text-kumo-default"
              >
                <Prose text={block.text} />
              </div>
            )
          case "event":
            return <SystemEvent key={block.key}>{block.label}</SystemEvent>
          case "computer":
            return (
              <ComputerCard
                key={block.key}
                calls={block.calls}
                latest={block.key === latestComputerKey}
                getLiveView={getLiveView}
                onApproval={onApproval}
              />
            )
          case "steps":
            return <Steps key={block.key} calls={block.calls} />
          case "approval":
            return (
              <ApprovalCard
                key={block.key}
                call={block.call}
                onApproval={onApproval}
              />
            )
        }
      })}
    </>
  )
}

function UserMessage({ message }: { message: UIMessage }) {
  const origin = originOf(message)
  const text = messageText(message)

  if (origin?.kind === "bot") {
    return (
      <>
        <SystemEvent>
          Message from{" "}
          <span className="inline-flex items-center gap-1.5 align-middle font-medium text-kumo-default">
            <BotAvatar avatar={origin.avatar ?? "circle"} size={16} />
            {origin.name}
          </span>
        </SystemEvent>
        <div className="w-fit max-w-[85%] rounded-[20px] border border-kumo-line px-4 py-2.5 text-kumo-default">
          <Prose text={stripOriginHeader(text)} />
        </div>
      </>
    )
  }
  if (
    origin?.kind === "routine" ||
    origin?.kind === "email" ||
    origin?.kind === "webhook" ||
    origin?.kind === "app"
  ) {
    const [Icon, label] =
      origin.kind === "routine"
        ? [ClockIcon, `Routine · ${origin.name}`]
        : origin.kind === "email"
          ? [EnvelopeSimpleIcon, `Email from ${origin.name}`]
          : origin.kind === "app"
            ? [AppWindowIcon, `Changes in ${origin.name}`]
            : [WebhooksLogoIcon, `Webhook · ${origin.name}`]
    return (
      <SystemEvent>
        <span className="inline-flex max-w-full items-center gap-1.5 align-middle">
          <Icon size={14} className="shrink-0" />
          <span className="truncate">{label}</span>
        </span>
      </SystemEvent>
    )
  }
  // Check-ins are invisible: only what the bot chose to say shows up.
  if (origin?.kind === "check-in") return null
  return (
    <div className="ml-auto w-fit max-w-[75%] rounded-[20px] bg-kumo-contrast px-4 py-2.5 text-[15px] leading-6 text-pretty whitespace-pre-wrap text-kumo-inverse">
      {text}
    </div>
  )
}

interface Row {
  message: UIMessage
  blocks: Block[]
  /** When the turn started, for time dividers. Older messages have none. */
  at?: number
}

function isQuietPrefix(message: UIMessage) {
  const text = messageText(message).trim()
  return text.length > 0 && NO_UPDATE.startsWith(text)
}

const MOMENT_GAP_MS = 30 * 60_000

function startsNewMoment(at: number, previous: number | undefined) {
  if (previous === undefined) return true
  return (
    at - previous > MOMENT_GAP_MS ||
    new Date(at).toDateString() !== new Date(previous).toDateString()
  )
}

function TimeDivider({ at }: { at: number }) {
  const date = new Date(at)
  const today = new Date().toDateString() === date.toDateString()
  const label = today
    ? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : date.toLocaleString([], {
        day: "numeric",
        month: "short",
        hour: "numeric",
        minute: "2-digit",
      })
  return (
    <p className="pt-3 text-center text-xs text-kumo-subtle tabular-nums">
      <time dateTime={date.toISOString()}>{label}</time>
    </p>
  )
}

export function Thread({
  bot,
  messages,
  busy,
  getLiveView,
  onApproval,
}: ThreadProps) {
  const scroller = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)
  // Messages already present on first render are history: only messages
  // that arrive afterwards get the entrance animation.
  const history = useRef<Set<string> | null>(null)
  history.current ??= new Set(messages.map((m) => m.id))
  const isNew = (id: string) => !history.current?.has(id)

  const hydrated = useHydrated()
  const rendered = useMemo(() => {
    const rows: Row[] = []
    let background = false
    let turnAt: number | undefined
    for (const message of messages) {
      const meta = metaOf(message)
      if (message.role === "user") {
        background = meta.background === true
        turnAt = meta.at
        if (meta.origin?.kind === "check-in") continue
        rows.push({ message, blocks: [], at: meta.at })
        continue
      }
      // A background reply of NO_UPDATE (or its first streamed characters)
      // means the bot decided to stay quiet.
      if (background && (isQuietReply(message) || isQuietPrefix(message))) {
        continue
      }
      let blocks = toBlocks(message)
      if (background) {
        // Only the bot's final message counts in background work; drop any
        // narration it wrote between tool calls.
        const last = blocks.findLast((b) => b.kind === "text")
        blocks = blocks.filter((b) => b.kind !== "text" || b === last)
      }
      rows.push({ message, blocks, at: meta.at ?? turnAt })
    }
    return rows
  }, [messages])
  const latestComputerKey = useMemo(
    () =>
      rendered.flatMap((r) => r.blocks).findLast((b) => b.kind === "computer")
        ?.key,
    [rendered]
  )

  // Follow new content unless the user has scrolled up to read.
  useEffect(() => {
    const el = scroller.current
    if (el && pinned.current) el.scrollTop = el.scrollHeight
  }, [rendered, busy])

  const lastBlocks = rendered.at(-1)?.blocks ?? []
  const streamingText =
    busy &&
    rendered.at(-1)?.message.role === "assistant" &&
    lastBlocks.at(-1)?.kind === "text"
  const waitingOnUser = bot.status === "action_needed"

  return (
    <div
      ref={scroller}
      onScroll={(e) => {
        const el = e.currentTarget
        pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
      }}
      className="min-h-0 flex-1 overflow-y-auto"
    >
      <div className="mx-auto flex max-w-[820px] flex-col gap-3 px-6 pt-2 pb-6">
        {rendered.map(({ message, blocks, at }, index) => (
          <div
            key={message.id}
            className={`flex flex-col gap-3 ${isNew(message.id) ? "msg-enter" : ""}`}
            data-from={message.role === "user" ? "user" : "bot"}
          >
            {/* Time zone and locale are the viewer's, so only after hydration. */}
            {hydrated && at && startsNewMoment(at, rendered[index - 1]?.at) ? (
              <TimeDivider at={at} />
            ) : null}
            {message.role === "user" ? (
              <UserMessage message={message} />
            ) : (
              <AssistantMessage
                blocks={blocks}
                latestComputerKey={latestComputerKey}
                getLiveView={getLiveView}
                onApproval={onApproval}
              />
            )}
          </div>
        ))}
        {busy && !streamingText && !waitingOnUser ? (
          <div
            className="msg-enter flex items-center gap-2.5 pl-1"
            data-from="bot"
            role="status"
            aria-live="polite"
          >
            <BotAvatar avatar={bot.avatar} size={32} status="thinking" />
            <ShimmerText
              text={bot.status === "working" ? "Working" : "Thinking"}
              className="text-[15px]"
            />
          </div>
        ) : null}
      </div>
    </div>
  )
}
