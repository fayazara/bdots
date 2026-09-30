import { useCallback, useEffect, useRef, useState } from "react"
import { FileTree, useFileTree } from "@pierre/trees/react"
import { Button } from "@cloudflare/kumo/components/button"
import { Empty } from "@cloudflare/kumo/components/empty"
import { Loader } from "@cloudflare/kumo/components/loader"
import { Tabs } from "@cloudflare/kumo/components/tabs"
import {
  ArrowClockwiseIcon,
  CheckIcon,
  GlobeIcon,
  PowerIcon,
  WarningIcon,
} from "@phosphor-icons/react"
import { LiveViewFrame, useLiveView } from "@/components/computer-card"
import { useBot } from "@/lib/bot-context"
import type { BotConnection } from "@/lib/bot-context"
import type { ActivityEntry } from "@/lib/types"

type Pane = "browser" | "terminal" | "files" | "activity"

const PANES: { value: Pane; label: string }[] = [
  { value: "browser", label: "Browser" },
  { value: "terminal", label: "Terminal" },
  { value: "files", label: "Files" },
  { value: "activity", label: "Activity" },
]

function BrowserPane({ agent }: { agent: BotConnection }) {
  const getLiveView = useCallback(() => agent.stub.getLiveView(), [agent])
  const { tabs, error, refresh } = useLiveView(getLiveView, true)
  const [index, setIndex] = useState(0)
  const [closing, setClosing] = useState(false)
  const tab = tabs?.[Math.min(index, tabs.length - 1)]

  async function close() {
    setClosing(true)
    try {
      await agent.stub.closeBrowser()
      await refresh()
    } finally {
      setClosing(false)
    }
  }

  if (tabs === null) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader />
      </div>
    )
  }
  if (!tab) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <Empty
          icon={<GlobeIcon size={40} className="text-kumo-inactive" />}
          title="The browser is asleep"
          description={
            error ??
            "A Chromium session starts when the bot needs to sign in or click through a site, and closes after a few idle minutes."
          }
          contents={
            <Button
              icon={<ArrowClockwiseIcon />}
              onClick={() => void refresh()}
            >
              Check again
            </Button>
          }
        />
      </div>
    )
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
      <div className="flex items-center gap-2">
        <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
          {tabs.map((t, i) => (
            <button
              key={t.url}
              type="button"
              onClick={() => setIndex(i)}
              aria-pressed={t === tab}
              className={`max-w-56 truncate rounded-lg px-3 py-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-kumo-focus ${
                t === tab
                  ? "bg-kumo-fill text-kumo-default"
                  : "text-kumo-subtle hover:bg-kumo-tint"
              }`}
            >
              {t.title || t.pageUrl || "New tab"}
            </button>
          ))}
        </div>
        <Button
          size="sm"
          variant="ghost"
          shape="square"
          icon={<ArrowClockwiseIcon />}
          aria-label="Refresh live view"
          onClick={() => void refresh()}
        />
        <Button
          size="sm"
          variant="ghost"
          shape="square"
          icon={<PowerIcon />}
          aria-label="Close browser session"
          loading={closing}
          onClick={() => void close()}
        />
      </div>
      <p className="truncate text-xs text-kumo-subtle">{tab.pageUrl}</p>
      <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-kumo-line">
        <LiveViewFrame tab={tab} interactive className="h-full" />
      </div>
    </div>
  )
}

interface TerminalLine {
  id: number
  command: string
  output: string
  exitCode: number | null
}

function TerminalPane({ agent }: { agent: BotConnection }) {
  const [lines, setLines] = useState<TerminalLine[]>([])
  const [command, setCommand] = useState("")
  const [running, setRunning] = useState(false)
  const nextId = useRef(0)
  const end = useRef<HTMLDivElement>(null)

  // Seed with the bot's own recent shell commands.
  useEffect(() => {
    let cancelled = false
    void agent.stub.getActivity(200).then((entries) => {
      if (cancelled) return
      const history = entries
        .filter((e) => e.tool === "exec" || e.tool === "terminal")
        .reverse()
        .map((e) => ({
          id: nextId.current++,
          command: e.summary,
          output: e.tool === "exec" ? "" : e.detail,
          exitCode: e.ok ? 0 : 1,
        }))
      setLines((current) => [...history, ...current])
    })
    return () => {
      cancelled = true
    }
  }, [agent])

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" })
  }, [lines])

  async function run() {
    const cmd = command.trim()
    if (!cmd || running) return
    const id = nextId.current++
    setCommand("")
    setRunning(true)
    setLines((l) => [...l, { id, command: cmd, output: "", exitCode: null }])
    let output: string
    let exitCode: number
    try {
      const result = await agent.stub.runCommand(cmd)
      output = [result.stdout, result.stderr].filter(Boolean).join("\n")
      exitCode = result.exitCode
    } catch (err) {
      output = err instanceof Error ? err.message : "Command failed"
      exitCode = 1
    }
    setLines((l) =>
      l.map((line) => (line.id === id ? { ...line, output, exitCode } : line))
    )
    setRunning(false)
  }

  return (
    <div className="mx-4 mb-3 flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl bg-kumo-contrast font-mono text-[13px] text-kumo-inverse">
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {lines.length === 0 ? (
          <p className="opacity-60">
            A shell in the bot's computer. Files are under /workspace.
          </p>
        ) : null}
        {lines.map((line) => (
          <div key={line.id} className="mb-3">
            <p className="break-all">
              <span className="opacity-50">$ </span>
              {line.command}
            </p>
            {line.output ? (
              <pre className="mt-1 break-words whitespace-pre-wrap opacity-80">
                {line.output}
              </pre>
            ) : null}
            {line.exitCode !== null && line.exitCode !== 0 ? (
              <p className="mt-1 opacity-60">exit {line.exitCode}</p>
            ) : null}
          </div>
        ))}
        <div ref={end} />
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void run()
        }}
        className="flex items-center gap-2 border-t border-white/15 px-4 py-3"
      >
        <span className="opacity-50">$</span>
        <input
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          placeholder="ls /workspace"
          aria-label="Shell command"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          className="flex-1 bg-transparent outline-none placeholder:opacity-40"
        />
        {running ? <Loader size="sm" /> : null}
      </form>
    </div>
  )
}

// Trees renders inside a shadow root and is themed through CSS variables.
// Kumo tokens use light-dark(); pin the scheme so the tree follows the app
// rather than the OS setting.
const TREE_STYLE = {
  colorScheme: "light",
  "--trees-bg-override": "transparent",
  "--trees-fg-override": "var(--text-color-kumo-default)",
  "--trees-fg-muted-override": "var(--text-color-kumo-subtle)",
  "--trees-bg-muted-override": "var(--color-kumo-tint)",
  "--trees-selected-bg-override": "var(--color-kumo-fill)",
  "--trees-selected-fg-override": "var(--text-color-kumo-default)",
  "--trees-border-color-override": "var(--color-kumo-line)",
  "--trees-focus-ring-color-override": "var(--color-kumo-focus)",
  "--trees-input-bg-override": "var(--color-kumo-base)",
  "--trees-font-family-override": "inherit",
  "--trees-font-size-override": "13px",
} as React.CSSProperties

const WORKSPACE_ROOT = "/workspace"

function FilesPane({ agent }: { agent: BotConnection }) {
  const [loaded, setLoaded] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [preview, setPreview] = useState<{
    content: string
    truncated: boolean
  } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const select = useCallback(
    async (path: string) => {
      setSelected(path)
      setPreview(null)
      setError(null)
      try {
        setPreview(await agent.stub.readFileText(`${WORKSPACE_ROOT}/${path}`))
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not read file")
      }
    },
    [agent]
  )

  // The model is created once; the latest handler is read through a ref.
  const onSelect = useRef(select)
  onSelect.current = select

  const { model } = useFileTree({
    paths: [],
    search: true,
    fileTreeSearchMode: "hide-non-matches",
    initialExpansion: 1,
    onSelectionChange: (paths) => {
      const path = paths.at(-1)
      // Directories end with "/": selecting one just expands it.
      if (path && !path.endsWith("/")) void onSelect.current(path)
    },
  })

  const refresh = useCallback(async () => {
    try {
      model.resetPaths(await agent.stub.listWorkspace())
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not list files")
    } finally {
      setLoaded(true)
    }
  }, [agent, model])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex w-60 shrink-0 flex-col border-r border-kumo-line">
        <div className="flex items-center justify-between py-1 pr-2 pl-4">
          <span className="text-xs font-medium text-kumo-subtle">
            {WORKSPACE_ROOT}
          </span>
          <Button
            size="xs"
            variant="ghost"
            shape="square"
            icon={<ArrowClockwiseIcon />}
            aria-label="Refresh files"
            onClick={() => void refresh()}
          />
        </div>
        {loaded ? null : (
          <div className="flex justify-center py-6">
            <Loader size="sm" />
          </div>
        )}
        <FileTree model={model} className="min-h-0 flex-1" style={TREE_STYLE} />
      </div>
      <div className="min-w-0 flex-1 overflow-auto">
        {selected === null ? (
          <p className="p-6 text-sm text-kumo-subtle">
            Pick a file to preview it. Drafts, downloads and finished work all
            live here.
          </p>
        ) : error ? (
          <p role="alert" className="p-6 text-sm text-kumo-danger">
            {error}
          </p>
        ) : preview === null ? (
          <div className="flex justify-center py-10">
            <Loader size="sm" />
          </div>
        ) : (
          <>
            <p className="sticky top-0 border-b border-kumo-line bg-kumo-canvas px-4 py-2 text-xs text-kumo-subtle">
              {WORKSPACE_ROOT}/{selected}
              {preview.truncated ? " · truncated" : ""}
            </p>
            <pre className="p-4 font-mono text-[13px] break-words whitespace-pre-wrap text-kumo-default">
              {preview.content || "(empty file)"}
            </pre>
          </>
        )}
      </div>
    </div>
  )
}

function ActivityPane({ agent }: { agent: BotConnection }) {
  const [entries, setEntries] = useState<
    (ActivityEntry & { detail: string })[] | null
  >(null)
  const [open, setOpen] = useState<number | null>(null)

  const load = useCallback(async () => {
    setEntries(await agent.stub.getActivity(200))
  }, [agent])

  useEffect(() => {
    void load()
  }, [load])

  if (entries === null) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader />
      </div>
    )
  }
  if (entries.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <Empty
          title="Nothing yet"
          description="Every tool call this bot makes is logged here."
        />
      </div>
    )
  }
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="flex justify-end px-3 pt-2">
        <Button
          size="xs"
          variant="ghost"
          icon={<ArrowClockwiseIcon />}
          onClick={() => void load()}
        >
          Refresh
        </Button>
      </div>
      <ul className="divide-y divide-kumo-line">
        {entries.map((entry) => (
          <li key={entry.id}>
            <button
              type="button"
              onClick={() => setOpen(open === entry.id ? null : entry.id)}
              aria-expanded={open === entry.id}
              className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm outline-none hover:bg-kumo-tint focus-visible:ring-2 focus-visible:ring-kumo-focus focus-visible:ring-inset"
            >
              {entry.ok ? (
                <CheckIcon size={14} className="shrink-0 text-kumo-success" />
              ) : (
                <WarningIcon size={14} className="shrink-0 text-kumo-warning" />
              )}
              <span className="w-32 shrink-0 truncate font-mono text-xs text-kumo-default">
                {entry.tool}
              </span>
              <span className="min-w-0 flex-1 truncate text-kumo-subtle">
                {entry.summary}
              </span>
              <span className="shrink-0 text-xs text-kumo-subtle tabular-nums">
                {new Date(entry.at).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </button>
            {open === entry.id ? (
              <pre className="mx-4 mb-3 max-h-64 overflow-auto rounded-lg bg-kumo-fill p-3 font-mono text-xs break-words whitespace-pre-wrap text-kumo-default">
                {entry.detail || "(no output)"}
              </pre>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  )
}

/** The bot's computer: its browser, shell, files and an audit log. */
export function ComputerPanel() {
  const { agent } = useBot()
  const [pane, setPane] = useState<Pane>("browser")

  return (
    <>
      <div className="px-4 pb-3">
        <Tabs
          variant="segmented"
          size="sm"
          tabs={PANES}
          value={pane}
          onValueChange={(value) => setPane(value as Pane)}
        />
      </div>
      {agent === null ? (
        <div className="flex flex-1 items-center justify-center">
          <Loader />
        </div>
      ) : pane === "browser" ? (
        <BrowserPane agent={agent} />
      ) : pane === "terminal" ? (
        <TerminalPane agent={agent} />
      ) : pane === "files" ? (
        <FilesPane agent={agent} />
      ) : (
        <ActivityPane agent={agent} />
      )}
    </>
  )
}
