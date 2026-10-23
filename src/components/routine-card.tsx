import { useEffect, useMemo, useState } from "react"
import { useHydrated } from "@tanstack/react-router"
import { RowAction } from "@/components/group"
import { ClockIcon, TrashIcon } from "@/components/icons"
import { describeCron, nextRun, parseCron, runsBetween } from "@/lib/cron"
import type { Routine, RoutineRun } from "@/lib/types"

const WINDOW = 24 * 60 * 60_000

/** The current time, refreshed every 30 seconds. */
function useNow() {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])
  return now
}

function formatIn(ms: number) {
  const minutes = Math.max(1, Math.round(ms / 60_000))
  if (minutes < 60) return `in ${minutes} min`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `in ${hours}h`
  const days = Math.round(hours / 24)
  return `in ${days} ${days === 1 ? "day" : "days"}`
}

function formatTime(at: number, now: number) {
  const d = new Date(at)
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
  if (at - now < WINDOW && d.getDate() === new Date(now).getDate()) return time
  if (at - now < 2 * WINDOW) return `tomorrow ${time}`
  return `${d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })}, ${time}`
}

/** Every local 6-hour mark (12 AM, 6 AM, 12 PM, 6 PM) inside the window. */
function hourMarks(from: number) {
  const marks: number[] = []
  const d = new Date(from)
  d.setMinutes(0, 0, 0)
  d.setHours(Math.ceil((d.getHours() + 1) / 6) * 6)
  for (let t = d.getTime(); t < from + WINDOW; t += 6 * 60 * 60_000) {
    marks.push(t)
  }
  return marks
}

/** The next 24 hours as a strip, one tick per run. */
function Timeline({ runs, now }: { runs: number[]; now: number }) {
  const at = (t: number) => `${((t - now) / WINDOW) * 100}%`
  const marks = hourMarks(now).filter((t) => (t - now) / WINDOW > 0.08)
  return (
    <div>
      <p className="mb-1.5 flex justify-between text-[11px] text-kumo-subtle tabular-nums">
        <span>Next 24 hours</span>
        <span>
          {runs.length === 0
            ? "No runs"
            : `${runs.length} ${runs.length === 1 ? "run" : "runs"}`}
        </span>
      </p>
      <div aria-hidden="true" className="relative h-5 text-kumo-default">
        <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-kumo-line" />
        {marks.map((t) => (
          <span
            key={t}
            className="absolute top-1/2 h-2 w-px -translate-y-1/2 bg-kumo-line"
            style={{ left: at(t) }}
          />
        ))}
        {runs.map((t, i) => (
          <span
            key={t}
            className={`absolute top-1/2 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full ${
              i === 0 ? "h-4 bg-kumo-brand" : "h-2.5 bg-current opacity-30"
            }`}
            style={{ left: at(t) }}
          />
        ))}
      </div>
      <div
        aria-hidden="true"
        className="relative mt-1 h-4 text-[11px] text-kumo-subtle tabular-nums"
      >
        <span className="absolute left-0">Now</span>
        {marks.map((t) => (
          <span
            key={t}
            className="absolute -translate-x-1/2"
            style={{ left: at(t) }}
          >
            {new Date(t).toLocaleTimeString([], { hour: "numeric" })}
          </span>
        ))}
      </div>
    </div>
  )
}

/** One routine: when it runs, the next 24 hours at a glance, what it does. */
const RUN_LABEL: Record<RoutineRun["status"], string> = {
  running: "Running",
  reported: "Reported",
  quiet: "Nothing new",
  waiting: "Needs you",
  failed: "Failed",
  retrying: "Failed, retrying",
  skipped: "Skipped",
  stopped: "Stopped",
}

/** The last few runs: when, and how each ended. */
function RunHistory({ runs, now }: { runs: RoutineRun[]; now: number }) {
  if (runs.length === 0) return null
  return (
    <ul className="space-y-1 text-xs tabular-nums">
      {runs.slice(0, 5).map((run) => (
        <li
          key={run.id}
          className="flex items-baseline gap-2"
          title={run.note || undefined}
        >
          <span className="w-28 shrink-0 text-kumo-subtle">
            {formatTime(run.startedAt, now)}
          </span>
          <span
            className={
              run.status === "failed" || run.status === "retrying"
                ? "text-kumo-danger"
                : run.status === "reported"
                  ? "text-kumo-default"
                  : "text-kumo-subtle"
            }
          >
            {RUN_LABEL[run.status]}
          </span>
          {run.note && run.status !== "reported" ? (
            <span className="truncate text-kumo-subtle">· {run.note}</span>
          ) : null}
        </li>
      ))}
    </ul>
  )
}

export function RoutineCard({
  routine,
  onDelete,
  loadRuns,
}: {
  routine: Routine
  onDelete?: () => void
  /** Recent runs, newest first. Absent where history is not shown. */
  loadRuns?: () => Promise<RoutineRun[]>
}) {
  const [history, setHistory] = useState<RoutineRun[]>([])
  useEffect(() => {
    if (!loadRuns) return
    let cancelled = false
    void loadRuns().then((runs) => {
      if (!cancelled) setHistory(runs)
    })
    return () => {
      cancelled = true
    }
    // Reload when the routine changes; loadRuns is rebuilt each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routine.id, routine.prompt, routine.when])
  const hydrated = useHydrated()
  const now = useNow()
  const [expanded, setExpanded] = useState(false)

  const cron = useMemo(
    () => (routine.kind === "cron" ? parseCron(routine.when) : null),
    [routine.kind, routine.when]
  )
  const runs = useMemo(() => {
    if (routine.kind === "once") {
      const t = new Date(routine.when).getTime()
      return t >= now && t < now + WINDOW ? [t] : []
    }
    return cron ? runsBetween(cron, now, WINDOW) : []
  }, [cron, routine.kind, routine.when, now])
  const next =
    routine.kind === "once"
      ? new Date(routine.when).getTime()
      : (runs[0] ?? (cron ? nextRun(cron, now) : null))

  const schedule =
    routine.kind === "once"
      ? "Once"
      : ((cron && describeCron(cron)) ?? "Custom schedule")

  return (
    <li className="border-t border-kumo-line px-4 py-4 first:border-t-0">
      <div className="flex items-start gap-3">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-(--fill-hover) text-kumo-subtle">
          <ClockIcon size={14} />
        </span>
        <div className="min-w-0 flex-1 pt-0.5">
          <div className="flex items-center gap-2">
            <h4 className="truncate text-sm font-medium text-kumo-default">
              {routine.name}
            </h4>
            {routine.onlyNew ? (
              <span className="shrink-0 rounded-full bg-(--fill-hover) px-2 py-0.5 text-[11px] text-kumo-subtle">
                Only new
              </span>
            ) : null}
            {routine.watch ? (
              <span
                className="shrink-0 rounded-full bg-(--fill-hover) px-2 py-0.5 text-[11px] text-kumo-subtle"
                title={
                  "url" in routine.watch
                    ? routine.watch.url
                    : routine.watch.command
                }
              >
                Watches for changes
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 text-xs text-kumo-subtle tabular-nums">
            <span className="text-kumo-default">{schedule}</span>
            {routine.kind === "cron" && !describeCron(cron!) ? (
              <span className="font-mono"> ({routine.when})</span>
            ) : null}
            {hydrated && next !== null && next >= now ? (
              <>
                {" · next "}
                {formatTime(next, now)}, {formatIn(next - now)}
              </>
            ) : null}
          </p>
        </div>
        {onDelete ? (
          <RowAction
            label={`Delete routine ${routine.name}`}
            danger
            onClick={onDelete}
          >
            <TrashIcon size={16} />
          </RowAction>
        ) : null}
      </div>

      <div className="mt-3 space-y-3 pl-10">
        {hydrated ? (
          <Timeline runs={runs} now={now} />
        ) : (
          <div className="h-[62px]" />
        )}
        {hydrated ? <RunHistory runs={history} now={now} /> : null}
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="block w-full rounded-xl bg-(--fill-hover) px-3 py-2.5 text-left text-xs leading-5 text-pretty text-kumo-default outline-none hover:bg-(--fill-active) focus-visible:ring-2 focus-visible:ring-kumo-focus"
        >
          <span className={expanded ? undefined : "line-clamp-2"}>
            {routine.prompt}
          </span>
        </button>
      </div>
    </li>
  )
}
