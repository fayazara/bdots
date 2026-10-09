import { useCallback, useEffect, useState } from "react"
import { Badge } from "@cloudflare/kumo/components/badge"
import { Button } from "@cloudflare/kumo/components/button"
import { Dialog } from "@cloudflare/kumo/components/dialog"
import { Loader } from "@cloudflare/kumo/components/loader"
import { ArrowClockwiseIcon, MonitorIcon } from "@/components/icons"
import type { ToolCall } from "@/lib/message-parts"

export interface LiveTab {
  url: string
  pageUrl?: string
  title?: string
}

export type GetLiveView = () => Promise<LiveTab[]>

// Live View URLs are valid for about five minutes.
const LIVE_VIEW_REFRESH_MS = 4 * 60 * 1000

/** Fetch Live View tabs and keep their short-lived URLs fresh. */
export function useLiveView(getLiveView: GetLiveView | undefined, on: boolean) {
  const [tabs, setTabs] = useState<LiveTab[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!getLiveView) return
    try {
      setTabs(await getLiveView())
      setError(null)
    } catch (err) {
      setTabs([])
      setError(err instanceof Error ? err.message : "Could not reach browser")
    }
  }, [getLiveView])

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

type CardStatus = "working" | "action_needed" | "done" | "failed"

function cardStatus(calls: ToolCall[]): CardStatus {
  if (calls.some((c) => c.state === "waiting")) return "action_needed"
  if (calls.some((c) => c.state === "running")) return "working"
  const last = calls.at(-1)
  if (last?.state === "error" || last?.state === "denied") return "failed"
  return "done"
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
  getLiveView?: GetLiveView
  onApproval?: (approvalId: string, approved: boolean, reason?: string) => void
}

/** Inline card for browser work: status chip, live preview, take over. */
export function ComputerCard({
  calls,
  latest,
  getLiveView,
  onApproval,
}: ComputerCardProps) {
  const status = cardStatus(calls)
  const handoff = calls.findLast((c) => c.name === "request_handoff")
  const waiting = calls.find((c) => c.state === "waiting")
  const instructions =
    typeof handoff?.input.instructions === "string"
      ? handoff.input.instructions
      : status === "working"
        ? "Working in the browser."
        : "Browser work finished."

  const showPreview = latest && status !== "failed"
  const { tabs, refresh } = useLiveView(getLiveView, showPreview)
  const [takingOver, setTakingOver] = useState(false)
  const tab = tabs?.[0]

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
            <LiveViewFrame tab={tab} className="aspect-[16/10]" />
          ) : (
            <div className="flex aspect-[16/10] flex-col items-center justify-center gap-2 text-sm text-kumo-subtle">
              {tabs === null ? (
                <Loader />
              ) : (
                <>
                  <MonitorIcon size={28} />
                  <span>
                    {status === "done"
                      ? "The browser session has closed."
                      : "Waiting for the browser…"}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<ArrowClockwiseIcon />}
                    onClick={() => void refresh()}
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
            </div>
          </div>
          <Dialog.Description className="sr-only">
            You are controlling the bot's browser. Anything you type goes
            straight to the page and is not shown to the bot.
          </Dialog.Description>
          <div className="min-h-0 flex-1 overflow-hidden rounded-2xl border border-kumo-line bg-kumo-recessed">
            {tab ? (
              <LiveViewFrame tab={tab} interactive className="h-full" />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-kumo-subtle">
                <span>The browser isn't reachable right now.</span>
                <Button
                  size="sm"
                  icon={<ArrowClockwiseIcon />}
                  onClick={() => void refresh()}
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
