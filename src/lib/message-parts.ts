import type { UIMessage } from "ai"
import { NO_UPDATE } from "@/lib/types"
import type { MessageMeta, MessageOrigin, Routine } from "@/lib/types"

export type ToolCallState = "running" | "waiting" | "done" | "error" | "denied"

/** A tool part, normalized across static (`tool-<name>`) and dynamic tools. */
export interface ToolCall {
  id: string
  name: string
  state: ToolCallState
  input: Record<string, unknown>
  output: unknown
  errorText?: string
  /** Present while the call is waiting for the user to approve it. */
  approvalId?: string
}

export type Block =
  | { kind: "text"; key: string; text: string }
  | { kind: "event"; key: string; label: string }
  | { kind: "computer"; key: string; calls: ToolCall[] }
  | { kind: "steps"; key: string; calls: ToolCall[] }
  | { kind: "approval"; key: string; call: ToolCall }
  | { kind: "capture"; key: string; call: ToolCall; capture: Capture }
  | { kind: "routine"; key: string; routine: Routine; updated: boolean }

/** Something the bot did on the way to its reply: folded under "Worked for". */
export type WorkItem =
  | { kind: "note"; key: string; text: string }
  | { kind: "step"; key: string; call: ToolCall }

/** A reply split into the work behind it and what the user should see. */
export interface TurnView {
  work: WorkItem[]
  /** The reply, cards and events, in order. */
  shown: Block[]
}

/**
 * The last text block, when nothing but events follows it, is the reply.
 * Any other text is narration ("Let me check…") and joins the steps in the
 * work group. Hidden bookkeeping calls (mark_reported) leave no block, so
 * narration before them still counts as narration.
 */
export function toTurn(blocks: Block[]): TurnView {
  const lastText = blocks.findLastIndex((b) => b.kind === "text")
  const lastTool = blocks.findLastIndex(
    (b) => b.kind !== "text" && b.kind !== "event"
  )
  const reply = lastText > lastTool ? lastText : -1
  const hasWork = lastTool !== -1
  const work: WorkItem[] = []
  const shown: Block[] = []
  blocks.forEach((block, index) => {
    if (block.kind === "text" && hasWork && index !== reply) {
      work.push({ kind: "note", key: block.key, text: block.text })
    } else if (block.kind === "steps") {
      for (const call of block.calls) {
        work.push({ kind: "step", key: call.id, call })
      }
    } else {
      shown.push(block)
    }
  })
  return { work, shown }
}

function routineOf(call: ToolCall): Routine | null {
  const out = call.output as { scheduled?: Routine; updated?: Routine } | null
  const routine = out?.scheduled ?? out?.updated
  return routine && typeof routine.id === "string" ? routine : null
}

/** A screenshot or PDF a tool saved to the bot's files. */
export interface Capture {
  path: string
  mediaType: string
}

const COMPUTER_TOOLS = new Set(["browser_execute", "request_handoff"])
const CAPTURE_TOOLS = new Set(["browser_screenshot", "browser_pdf"])

function captureOf(call: ToolCall): Capture | null {
  const out = call.output as { saved?: unknown; mediaType?: unknown } | null
  if (typeof out?.saved !== "string" || typeof out.mediaType !== "string") {
    return null
  }
  return { path: out.saved, mediaType: out.mediaType }
}

type Part = UIMessage["parts"][number]

const PART_STATE: Record<string, ToolCallState> = {
  "input-streaming": "running",
  "input-available": "running",
  "approval-requested": "waiting",
  "approval-responded": "running",
  "output-available": "done",
  "output-error": "error",
  "output-denied": "denied",
}

function toToolCall(part: Part): ToolCall | null {
  const p = part as {
    type: string
    toolName?: string
    toolCallId?: string
    state?: string
    input?: unknown
    output?: unknown
    errorText?: string
    approval?: { id: string }
  }
  const name =
    p.type === "dynamic-tool"
      ? p.toolName
      : p.type.startsWith("tool-")
        ? p.type.slice("tool-".length)
        : undefined
  if (!name || !p.toolCallId) return null
  const state = PART_STATE[p.state ?? ""] ?? "running"
  return {
    id: p.toolCallId,
    name,
    state,
    input:
      p.input && typeof p.input === "object"
        ? (p.input as Record<string, unknown>)
        : {},
    output: p.output,
    errorText: p.errorText,
    approvalId: state === "waiting" ? p.approval?.id : undefined,
  }
}

/** Turn an assistant message's parts into the blocks the thread renders. */
export function toBlocks(message: UIMessage): Block[] {
  const blocks: Block[] = []
  message.parts.forEach((part, index) => {
    const key = `${message.id}:${index}`
    if (part.type === "text") {
      if (part.text.trim()) blocks.push({ kind: "text", key, text: part.text })
      return
    }
    const call = toToolCall(part)
    if (!call) return

    if (call.name === "set_name") {
      if (call.state === "done") {
        blocks.push({
          kind: "event",
          key,
          label: `Renamed to ${String(call.input.name ?? "")}`,
        })
      }
      return
    }
    if (call.name === "set_context") {
      if (call.state === "done") {
        blocks.push({ kind: "event", key, label: "Updated memory" })
      }
      return
    }
    if (call.name === "track_item" || call.name === "resolve_item") {
      if (call.state === "done") {
        const verb = call.name === "track_item" ? "Keeping an eye on" : "Closed"
        const what =
          call.name === "track_item"
            ? String(call.input.title ?? "")
            : String(call.input.outcome ?? "")
        blocks.push({ kind: "event", key, label: `${verb}: ${what}` })
      }
      return
    }
    if (call.name === "save_skill") {
      if (call.state === "done") {
        blocks.push({
          kind: "event",
          key,
          label: `Learned a skill: ${String(call.input.name ?? "")}`,
        })
      }
      return
    }
    // Bookkeeping the user does not need to see.
    if (call.name === "mark_reported" || call.name === "was_reported") return

    if (
      (call.name === "schedule_routine" || call.name === "update_routine") &&
      call.state === "done"
    ) {
      const routine = routineOf(call)
      if (routine) {
        blocks.push({
          kind: "routine",
          key,
          routine,
          updated: call.name === "update_routine",
        })
        return
      }
    }

    if (CAPTURE_TOOLS.has(call.name) && call.state === "done") {
      const capture = captureOf(call)
      if (capture) {
        blocks.push({ kind: "capture", key, call, capture })
        return
      }
    }

    const last = blocks.at(-1)
    if (COMPUTER_TOOLS.has(call.name)) {
      if (last?.kind === "computer") last.calls.push(call)
      else blocks.push({ kind: "computer", key, calls: [call] })
      return
    }
    if (call.state === "waiting") {
      blocks.push({ kind: "approval", key, call })
      return
    }
    if (last?.kind === "steps") last.calls.push(call)
    else blocks.push({ kind: "steps", key, calls: [call] })
  })
  return blocks
}

export function messageText(message: UIMessage) {
  return message.parts
    .filter((p) => p.type === "text")
    .map((p) => p.text)
    .join("\n")
}

export function metaOf(message: UIMessage): MessageMeta {
  return (message.metadata ?? {}) as MessageMeta
}

export function originOf(message: UIMessage): MessageOrigin | undefined {
  return metaOf(message).origin
}

/** A background reply that chose to say nothing (it is pruned soon after). */
export function isQuietReply(message: UIMessage) {
  const texts = message.parts.filter((p) => p.type === "text" && p.text.trim())
  const last = texts.at(-1)
  if (last?.type !== "text") return false
  const text = last.text.trim()
  return text.startsWith(NO_UPDATE) || text.endsWith(NO_UPDATE)
}

/** Bot and routine messages carry a bracketed first line meant for the model. */
export function stripOriginHeader(text: string) {
  return text.replace(/^\[[^\]]+\]\n/, "")
}

function mcpLabel(name: string) {
  // MCP tools are named `tool_<serverId>_<tool>`.
  const match = /^tool_[^_]+_(.+)$/.exec(name)
  return (match ? match[1] : name).replace(/_/g, " ")
}

/** One-line description of a tool call for the step list. */
export function describeCall(call: ToolCall): string {
  const { input } = call
  const str = (key: string) =>
    typeof input[key] === "string" ? (input[key] as string) : ""
  switch (call.name) {
    case "read":
      return `Read ${str("path")}`
    case "ls":
      return `Listed ${str("path") || "/workspace"}`
    case "find":
      return `Searched files for ${str("pattern")}`
    case "grep":
      return `Searched for "${str("pattern")}"`
    case "write":
      return `Wrote ${str("path")}`
    case "edit":
      return `Edited ${str("path")}`
    case "delete":
      return `Deleted ${str("path")}`
    case "exec":
      return `Ran ${str("command")}`
    case "browser_markdown":
      return `Read ${str("url")}`
    case "browser_extract":
      return `Extracted data from ${str("url")}`
    case "browser_links":
      return `Listed links on ${str("url")}`
    case "browser_scrape":
      return `Scraped ${str("url") || "a page"}`
    case "browser_screenshot":
      return `Took a screenshot of ${str("url") || "a page"}`
    case "browser_pdf":
      return `Saved ${str("url") || "a page"} as PDF`
    case "browser_crawl":
      return `Started crawling ${str("url")}`
    case "message_bot":
      return `Messaged ${str("to")}`
    case "schedule_routine":
      return `Scheduled "${str("name")}"`
    case "update_routine":
      return "Updated a routine"
    case "list_routines":
      return "Checked routines"
    case "cancel_routine":
      return "Cancelled a routine"
    case "search_context":
      return "Searched memory"
    case "update_item":
      return "Updated an open item"
    case "start_teaching":
      return "Started watching"
    case "finish_teaching":
      return "Stopped watching"
    case "save_app":
      return `Published app "${str("name")}"`
    case "list_apps":
      return "Checked apps"
    case "delete_app":
      return `Deleted app ${str("slug")}`
    case "app_data_list":
      return `Read ${str("slug")}/${str("collection")}`
    case "app_data_put":
      return `Updated ${str("slug")}/${str("collection")}`
    case "app_data_delete":
      return `Removed from ${str("slug")}/${str("collection")}`
    default:
      return mcpLabel(call.name)
  }
}
