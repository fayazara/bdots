import { useCallback, useEffect, useState } from "react"
import { Badge } from "@cloudflare/kumo/components/badge"
import { Button } from "@cloudflare/kumo/components/button"
import { Dialog } from "@cloudflare/kumo/components/dialog"
import { Loader } from "@cloudflare/kumo/components/loader"
import { ArrowClockwiseIcon, ComputerIcon } from "@/components/icons"
import type { ToolCall } from "@/lib/message-parts"

export interface LiveTab {
  targetId: string
  url: string
  pageUrl?: string
  title?: string
}

export type GetLiveView = () => Promise<LiveTab[]>

// Picks up new tabs and page titles. Live View URLs are valid for about
// five minutes, so a newly seen tab always gets a fresh one.
const LIVE_VIEW_REFRESH_MS = 60 * 1000

/**
 * Fetch Live View tabs. A tab that is already open keeps its URL, so the
 * stream is not torn down and reloaded every time the bot takes a step;
 * Live View follows navigation inside the tab by itself. `force` swaps in
 * fresh URLs, for when a stream dropped.
 */
export function useLiveView(getLiveView: GetLiveView | undefined, on: boolean) {
  const [tabs, setTabs] = useState<LiveTab[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(
    async (force = false) => {
      if (!getLiveView) return
      try {
        const next = await getLiveView()
        setTabs((prev) =>
          next.map((tab) => {
            const open = prev?.find((p) => p.targetId === tab.targetId)
            return open && !force ? { ...tab, url: open.url } : tab
          })
        )
        setError(null)
      } catch (err) {
        setTabs([])
        setError(err instanceof Error ? err.message : "Could not reach browser")
      }
    },
    [getLiveView]
  )

  useEffect(() => {
    if (!on) return
    void refresh()
    const timer = setInterval(() => void refresh(), LIVE_VIEW_REFRESH_MS)
    return () => clearInterval(timer)
  }, [on, refresh])

  return { tabs, error, refresh }
}

interface LiveViewFrameProps {
  tab: LiveTab
  /** Preview frames ignore input; the take-over modal passes `true`. */
  interactive?: boolean
  className?: string
}

export function LiveViewFrame({
  tab,
  interactive = false,
  className = "",
}: LiveViewFrameProps) {
  return (
    <iframe
      src={tab.url}
      title={tab.title || tab.pageUrl || "Bot browser"}
      allow="clipboard-read; clipboard-write"
      tabIndex={interactive ? 0 : -1}
      className={`w-full border-0 bg-white ${
        interactive ? "" : "pointer-events-none"
      } ${className}`}
    />
  )
}

type CardStatus = "working" | "action_needed" | "done" | "skipped" | "failed"

/** `carriedOn`: the reply goes on after this card, so a failure was not the end. */
function cardStatus(calls: ToolCall[], carriedOn: boolean): CardStatus {
  if (calls.some((c) => c.state === "waiting")) return "action_needed"
  if (calls.some((c) => c.state === "running")) return "working"
  const last = calls.at(-1)
  if (last?.state === "error" || last?.state === "denied") {
    return carriedOn ? "skipped" : "failed"
  }
  return "done"
}

function pageLabel(tab: LiveTab | undefined) {
  if (tab?.title) return tab.title
  if (!tab?.pageUrl || tab.pageUrl === "about:blank") return ""
  try {
    const url = new URL(tab.pageUrl)
    return `${url.host}${url.pathname === "/" ? "" : url.pathname}`
  } catch {
    return tab.pageUrl
  }
}

/** One line for the card: where the bot is and how far it got. */
function describe(status: CardStatus, steps: number, tab?: LiveTab) {
  const where = pageLabel(tab)
  const count = `${steps} ${steps === 1 ? "step" : "steps"}`
  switch (status) {
    case "working":
    case "action_needed":
      return where ? `Working on ${where}` : "Opening the browser…"
    case "skipped":
      return `A browser step failed, so the bot tried another way · ${count}`
    case "failed":
      return `The last browser step failed · ${count}`
    case "done":
      return where
        ? `Used the browser on ${where} · ${count}`
        : `Used the browser · ${count}`
  }
}

function StatusChip({ status }: { status: CardStatus }) {
  switch (status) {
    case "working":
      return (
        <Badge variant="neutral" icon={<Loader size="sm" />}>
          Working
        </Badge>
      )
    case "action_needed":
      return <Badge variant="orange">Action needed</Badge>
    case "skipped":
      return <Badge variant="neutral">Skipped</Badge>
    case "failed":
      return <Badge variant="red">Stopped</Badge>
    case "done":
      return (
        <Badge variant="success" appearance="dot">
          Done
        </Badge>
      )
  }
}

interface ComputerCardProps {
  calls: ToolCall[]
  /** Only the most recent card in a thread shows the live browser. */
  latest: boolean
  /** More of the reply follows this card. */
  carriedOn?: boolean
  getLiveView?: GetLiveView
  onApproval?: (approvalId: string, approved: boolean, reason?: string) => void
}

/** Inline card for browser work: status chip, live preview, take over. */
export function ComputerCard({
  calls,
  latest,
  carriedOn = false,
  getLiveView,
  onApproval,
}: ComputerCardProps) {
  const status = cardStatus(calls, carriedOn)
  const handoff = calls.findLast((c) => c.name === "request_handoff")
  const waiting = calls.find((c) => c.state === "waiting")
  const showPreview = latest && status !== "failed" && status !== "skipped"
  const { tabs, refresh } = useLiveView(getLiveView, showPreview)
  const [takingOver, setTakingOver] = useState(false)
  // The newest tab is the one the bot is working in.
  const tab = tabs?.at(-1)
  const instructions =
    typeof handoff?.input.instructions === "string" &&
    (status === "action_needed" || calls.at(-1) === handoff)
      ? handoff.input.instructions
      : describe(status, calls.length, tab)

  // Pick up the page the bot just navigated to.
  useEffect(() => {
    if (showPreview) void refresh()
  }, [calls.length, status, showPreview, refresh])

  function respond(approved: boolean) {
    if (waiting?.approvalId) {
      onApproval?.(
        waiting.approvalId,
        approved,
        approved ? undefined : "The user could not complete this step."
      )
    }
    setTakingOver(false)
  }

  return (
    <div className="w-full max-w-[640px] rounded-3xl bg-kumo-tint p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[15px] font-semibold text-kumo-default">
          Computer
        </span>
        <StatusChip status={status} />
      </div>
      <p className="mt-1 text-[15px] text-kumo-default">{instructions}</p>

      {/* A finished card only keeps its preview while the browser is still
          open; otherwise it collapses to its header. */}
      {showPreview && (status !== "done" || tab) ? (
        <div className="mt-3 overflow-hidden rounded-lg bg-kumo-recessed outline outline-1 -outline-offset-1 outline-black/[0.06]">
          {tab ? (
            <button
              type="button"
              aria-label="Watch the browser"
              onClick={() => setTakingOver(true)}
              className="block w-full cursor-zoom-in"
            >
              <LiveViewFrame tab={tab} className="aspect-[16/10]" />
            </button>
          ) : (
            <div className="flex aspect-[16/10] flex-col items-center justify-center gap-2 text-sm text-kumo-subtle">
              {tabs === null ? (
                <Loader />
              ) : (
                <>
                  <ComputerIcon size={28} />
                  <span>
                    {status === "done"
                      ? "The browser session has closed."
                      : "Waiting for the browser…"}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<ArrowClockwiseIcon />}
                    onClick={() => void refresh(true)}
                  >
                    Refresh
                  </Button>
                </>
              )}
            </div>
          )}
        </div>
      ) : null}

      {status === "action_needed" && onApproval ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            variant="primary"
            className="btn-ink rounded-full"
            onClick={() => setTakingOver(true)}
          >
            Take over
          </Button>
          <Button
            variant="outline"
            className="rounded-full"
            onClick={() => respond(true)}
          >
            I'm done
          </Button>
        </div>
      ) : null}

      <Dialog.Root open={takingOver} onOpenChange={setTakingOver}>
        <Dialog
          size="xl"
          className="flex h-[90vh] w-[94vw]! max-w-[1500px]! min-w-0! flex-col gap-3 p-3"
        >
          <div className="flex items-center justify-between gap-4 rounded-2xl bg-kumo-warning-tint px-4 py-2.5">
            <Dialog.Title className="min-w-0 flex-1 text-[15px] font-medium text-kumo-default">
              {instructions}
            </Dialog.Title>
            <div className="flex shrink-0 items-center gap-2">
              {status === "action_needed" ? (
                <>
                  <Button variant="ghost" onClick={() => respond(false)}>
                    I couldn't
                  </Button>
                  <Button
                    variant="primary"
                    className="btn-ink rounded-full"
                    onClick={() => respond(true)}
                  >
                    I'm done, continue
                  </Button>
                </>
              ) : (
                <Button
                  variant="outline"
                  className="rounded-full"
                  onClick={() => setTakingOver(false)}
                >
                  Close
                </Button>
              )}
            </div>
          </div>
          <Dialog.Description className="sr-only">
            {status === "action_needed"
              ? "You are controlling the bot's browser. Anything you type goes straight to the page and is not shown to the bot."
              : "A live view of the bot's browser. It is view only while the bot works."}
          </Dialog.Description>
          <div className="min-h-0 flex-1 overflow-hidden rounded-2xl border border-kumo-line bg-kumo-recessed">
            {tab ? (
              <LiveViewFrame
                tab={tab}
                interactive={status === "action_needed"}
                className="h-full"
              />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-kumo-subtle">
                <span>The browser isn't reachable right now.</span>
                <Button
                  size="sm"
                  icon={<ArrowClockwiseIcon />}
                  onClick={() => void refresh(true)}
                >
                  Try again
                </Button>
              </div>
            )}
          </div>
        </Dialog>
      </Dialog.Root>
    </div>
  )
}
