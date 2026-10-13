import { useEffect, useMemo, useRef, useState } from "react"
import { useHydrated } from "@tanstack/react-router"
import Markdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { Button } from "@cloudflare/kumo/components/button"
import {
  AppWindowIcon,
  ClockIcon,
  CrawlIcon,
  EnvelopeSimpleIcon,
  WebhooksLogoIcon,
} from "@/components/icons"
import { BotAvatar } from "@/components/bot-avatar"
import { CaptureCard } from "@/components/capture-card"
import { CodeBlock } from "@/components/code-block"
import { ComputerCard } from "@/components/computer-card"
import { ShimmerText } from "@/components/shimmer-text"
import { WorkGroup } from "@/components/work-group"
import { RoutineSummary } from "@/components/routine-summary"
import {
  describeCall,
  isQuietReply,
  messageText,
  metaOf,
  originOf,
  stripOriginHeader,
  toBlocks,
  toTurn,
} from "@/lib/message-parts"
import { NO_UPDATE } from "@/lib/types"
import type { UIMessage } from "ai"
import type { ReadFileData } from "@/components/capture-card"
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
  /** For links into the bot's settings (routine cards). */
  botId?: string
  getLiveView?: GetLiveView
  /** Loads screenshots and PDFs the bot saved. Absent before hydration. */
  readFile?: ReadFileData
  onApproval?: OnApproval
}

/** Hostname of an absolute http(s) link, for its favicon. */
function linkHost(href: string | undefined) {
  if (!href || !/^https?:\/\//i.test(href)) return null
  try {
    return new URL(href).hostname
  } catch {
    return null
  }
}

function Favicon({ host }: { host: string }) {
  const [failed, setFailed] = useState(false)
  if (failed) return null
  return (
    <img
      src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=32`}
      alt=""
      aria-hidden="true"
      loading="lazy"
      onError={() => setFailed(true)}
      className="mr-1 inline-block size-[1em] rounded-[3px] align-[-0.125em]"
    />
  )
}

const PROSE = [
  "bubble-prose text-[15px] leading-[1.65] text-pretty",
  "[&_p]:my-3 [&_ul]:my-3 [&_ol]:my-3",
  "[&_strong]:font-semibold",
  "[&_h1]:mt-5 [&_h1]:mb-2 [&_h1]:text-[17px] [&_h1]:font-semibold",
  "[&_h2]:mt-5 [&_h2]:mb-2 [&_h2]:text-base [&_h2]:font-semibold",
  "[&_h3]:mt-4 [&_h3]:mb-1.5 [&_h3]:font-semibold",
  "[&_ol]:list-decimal [&_ol]:pl-6 [&_ul]:list-disc [&_ul]:pl-5",
  "[&_li]:my-1.5 [&_li]:pl-1 [&_li]:marker:text-kumo-subtle",
  "[&_hr]:my-5 [&_hr]:border-kumo-line",
  "[&_blockquote]:border-l-2 [&_blockquote]:border-kumo-line [&_blockquote]:pl-3 [&_blockquote]:text-kumo-subtle",
  "[&_code]:rounded-md [&_code]:bg-(--fill-hover) [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[13px]",
  "[&_pre_code]:rounded-none [&_pre_code]:bg-transparent [&_pre_code]:p-0",
].join(" ")

function Prose({ text }: { text: string }) {
  return (
    <div className={PROSE}>
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ node: _node, href, children, ...props }) => {
            const host = linkHost(href)
            return (
              <a
                {...props}
                href={href}
                target="_blank"
                rel="noreferrer noopener"
                className="font-medium text-kumo-link decoration-1 underline-offset-2 hover:underline"
              >
                {host ? <Favicon host={host} /> : null}
                {children}
              </a>
            )
          },
          table: ({ node: _node, ...props }) => (
            <div className="-mx-1 my-3 overflow-x-auto">
              <table
                {...props}
                className="w-full border-collapse text-sm tabular-nums"
              />
            </div>
          ),
          th: ({ node: _node, style, ...props }) => (
            <th
              {...props}
              style={style}
              className="border-b border-kumo-line px-3 pt-1 pb-2 text-left align-bottom text-[13px] font-medium whitespace-nowrap text-kumo-subtle"
            />
          ),
          td: ({ node: _node, style, ...props }) => (
            <td
              {...props}
              style={style}
              className="border-b border-kumo-line px-3 py-2.5 align-top [tr:last-child>&]:border-b-0"
            />
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

function SystemEvent({ children }: { children: React.ReactNode }) {
  return <p className="py-1 text-center text-sm text-kumo-subtle">{children}</p>
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
  live,
  startedAt,
  durationMs,
  botId,
  latestComputerKey,
  getLiveView,
  readFile,
  onApproval,
}: {
  blocks: Block[]
  /** This reply is still being written. */
  live: boolean
  startedAt?: number
  durationMs?: number
  botId?: string
  latestComputerKey: string | undefined
  getLiveView?: GetLiveView
  readFile?: ReadFileData
  onApproval?: OnApproval
}) {
  const { work, shown } = toTurn(blocks)
  return (
    <>
      {work.length ? (
        <WorkGroup
          work={work}
          live={live}
          startedAt={startedAt}
          durationMs={durationMs}
          renderNote={(text) => (
            <div className="[&_.bubble-prose_p]:my-1.5">
              <Prose text={text} />
            </div>
          )}
        />
      ) : null}
      {shown.map((block) => {
        switch (block.kind) {
          case "text":
            return (
              <div
                key={block.key}
                className="w-fit max-w-[85%] rounded-[22px] bg-kumo-tint px-[18px] py-3 text-kumo-default has-[table]:w-full has-[table]:max-w-full"
              >
                <Prose text={block.text} />
              </div>
            )
          case "routine":
            return (
              <RoutineSummary
                key={block.key}
                routine={block.routine}
                updated={block.updated}
                botId={botId}
              />
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
            return null
          case "capture":
            return (
              <CaptureCard
                key={block.key}
                capture={block.capture}
                readFile={readFile}
              />
            )
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
            <BotAvatar avatar={origin.avatar ?? "blue-rectangle"} size={16} />
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
    origin?.kind === "app" ||
    origin?.kind === "crawl"
  ) {
    const [Icon, label] =
      origin.kind === "routine"
        ? [ClockIcon, `Routine · ${origin.name}`]
        : origin.kind === "email"
          ? [EnvelopeSimpleIcon, `Email from ${origin.name}`]
          : origin.kind === "app"
            ? [AppWindowIcon, `Changes in ${origin.name}`]
            : origin.kind === "crawl"
              ? [CrawlIcon, `Crawl finished · ${origin.name}`]
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
    <div className="ml-auto w-fit max-w-[75%] rounded-[22px] bg-kumo-contrast px-[18px] py-3 text-[15px] leading-[1.65] text-pretty whitespace-pre-wrap text-kumo-inverse">
      {text}
    </div>
  )
}

interface Row {
  message: UIMessage
  blocks: Block[]
  /** When the turn started, for time dividers. Older messages have none. */
  at?: number
  durationMs?: number
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
  botId,
  getLiveView,
  readFile,
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
      rows.push({
        message,
        blocks,
        at: meta.at ?? turnAt,
        durationMs: meta.durationMs,
      })
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

  const lastRow = rendered.at(-1)
  const lastBlocks = lastRow?.blocks ?? []
  const replying = busy && lastRow?.message.role === "assistant"
  // Once the reply has text or work to show, it carries its own progress.
  const showsProgress =
    replying &&
    lastBlocks.some(
      (b) => b.kind === "text" || b.kind === "steps" || b.kind === "computer"
    )
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
      <div className="mx-auto flex max-w-[820px] flex-col gap-5 px-6 pt-2 pb-8">
        {rendered.map(({ message, blocks, at, durationMs }, index) => (
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
                live={replying && index === rendered.length - 1}
                startedAt={at}
                durationMs={durationMs}
                botId={botId}
                latestComputerKey={latestComputerKey}
                getLiveView={getLiveView}
                readFile={readFile}
                onApproval={onApproval}
              />
            )}
          </div>
        ))}
        {busy && !showsProgress && !waitingOnUser ? (
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
