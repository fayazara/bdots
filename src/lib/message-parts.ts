import type { UIMessage } from "ai"
import type { MessageOrigin } from "@/lib/types"

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

const COMPUTER_TOOLS = new Set(["browser_execute", "request_handoff"])

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

export function originOf(message: UIMessage): MessageOrigin | undefined {
  const metadata = message.metadata as { origin?: MessageOrigin } | undefined
  return metadata?.origin
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
      return `Scraped ${str("url")}`
    case "message_bot":
      return `Messaged ${str("to")}`
    case "schedule_routine":
      return `Scheduled "${str("name")}"`
    case "list_routines":
      return "Checked routines"
    case "cancel_routine":
      return "Cancelled a routine"
    case "search_context":
      return "Searched memory"
    default:
      return mcpLabel(call.name)
  }
}
