import { useEffect, useMemo, useRef, useState } from "react"
import Markdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { Button } from "@cloudflare/kumo/components/button"
import { Loader } from "@cloudflare/kumo/components/loader"
import {
  CaretDownIcon,
  CaretRightIcon,
  CheckIcon,
  ClockIcon,
  WarningIcon,
} from "@phosphor-icons/react"
import { BotAvatar } from "@/components/bot-avatar"
import { ComputerCard } from "@/components/computer-card"
import {
  describeCall,
  messageText,
  originOf,
  stripOriginHeader,
  toBlocks,
} from "@/lib/message-parts"
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
    <div className="bubble-prose space-y-3 text-[15px] leading-relaxed [&_a]:text-kumo-link [&_a]:underline [&_code]:rounded [&_code]:bg-kumo-fill [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[13px] [&_h1]:text-base [&_h1]:font-semibold [&_h2]:text-[15px] [&_h2]:font-semibold [&_h3]:font-semibold [&_li]:my-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_pre]:overflow-x-auto [&_pre]:rounded-xl [&_pre]:bg-kumo-fill [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_table]:text-sm [&_td]:border-t [&_td]:border-kumo-line [&_td]:px-2 [&_td]:py-1 [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_ul]:list-disc [&_ul]:pl-5">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ node: _node, ...props }) => (
            <a {...props} target="_blank" rel="noreferrer noopener" />
          ),
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

function StepIcon({ state }: { state: ToolCall["state"] }) {
  if (state === "running") return <Loader size="sm" />
  if (state === "done") return <CheckIcon size={14} weight="bold" />
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
    <div className="w-full max-w-[640px] rounded-3xl bg-kumo-tint p-5">
      <p className="text-[15px] font-semibold text-kumo-default">
        Approval needed
      </p>
      <p className="mt-1 text-[15px] text-kumo-default">{describeCall(call)}</p>
      {details !== "{}" ? (
        <pre className="mt-3 max-h-48 overflow-auto rounded-xl bg-kumo-fill p-3 text-xs text-kumo-default">
          {details}
        </pre>
      ) : null}
      {onApproval && call.approvalId ? (
        <div className="mt-4 flex gap-2">
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
                className="w-fit max-w-[85%] rounded-3xl bg-kumo-tint px-5 py-3.5 text-kumo-default"
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
        <div className="w-fit max-w-[85%] rounded-3xl border border-kumo-line px-5 py-3.5 text-kumo-default">
          <Prose text={stripOriginHeader(text)} />
        </div>
      </>
    )
  }
  if (origin?.kind === "routine") {
    return (
      <SystemEvent>
        <span className="inline-flex items-center gap-1.5 align-middle">
          <ClockIcon size={14} />
          Routine · {origin.name}
        </span>
      </SystemEvent>
    )
  }
  return (
    <div className="ml-auto w-fit max-w-[75%] rounded-3xl bg-kumo-contrast px-5 py-3.5 text-[15px] leading-relaxed whitespace-pre-wrap text-kumo-inverse">
      {text}
    </div>
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

  const rendered = useMemo(
    () =>
      messages.map((message) => ({
        message,
        blocks: message.role === "assistant" ? toBlocks(message) : [],
      })),
    [messages]
  )
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
      <div className="mx-auto flex max-w-[860px] flex-col gap-3 px-6 py-6">
        {rendered.map(({ message, blocks }) =>
          message.role === "user" ? (
            <UserMessage key={message.id} message={message} />
          ) : (
            <AssistantMessage
              key={message.id}
              blocks={blocks}
              latestComputerKey={latestComputerKey}
              getLiveView={getLiveView}
              onApproval={onApproval}
            />
          )
        )}
        {busy && !streamingText && !waitingOnUser ? (
          <div
            className="flex items-center gap-3 pt-1"
            role="status"
            aria-live="polite"
          >
            <BotAvatar avatar={bot.avatar} size={40} status="thinking" />
            <span className="text-[15px] text-kumo-subtle">
              {bot.status === "working" ? "Working" : "Thinking"}
            </span>
          </div>
        ) : null}
      </div>
    </div>
  )
}
