/**
 * Grouped list, the shape every settings-like surface uses: a small title, a
 * rounded card of rows split by hairlines, and at most one short hint below.
 */
export function Group({
  title,
  hint,
  action,
  children,
}: {
  title: string
  hint?: React.ReactNode
  /** Small control beside the title, e.g. a refresh button. */
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="space-y-2">
      <div className="flex min-h-6 items-center justify-between gap-2 px-1.5">
        <h3 className="text-sm font-medium text-kumo-default">{title}</h3>
        {action}
      </div>
      <ul className="overflow-hidden rounded-2xl bg-kumo-base outline outline-1 -outline-offset-1 outline-black/[0.06]">
        {children}
      </ul>
      {hint ? (
        <p className="px-1.5 text-xs text-pretty text-kumo-subtle">{hint}</p>
      ) : null}
    </section>
  )
}

/** One row: what it is on the left, its control on the right. */
export function Row({
  label,
  detail,
  icon,
  children,
  className = "",
}: {
  label?: React.ReactNode
  detail?: React.ReactNode
  /** Leading icon or avatar, 28px wide. */
  icon?: React.ReactNode
  children?: React.ReactNode
  className?: string
}) {
  return (
    <li
      className={`flex min-h-14 items-center gap-4 border-t border-kumo-line py-3 pr-3 pl-4 first:border-t-0 ${className}`}
    >
      {icon ? (
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-(--fill-hover) text-kumo-subtle">
          {icon}
        </span>
      ) : null}
      {label !== undefined || detail !== undefined ? (
        <span className="min-w-0 flex-1">
          {label !== undefined ? (
            <span className="block truncate text-sm text-kumo-default">
              {label}
            </span>
          ) : null}
          {detail !== undefined ? (
            <span className="mt-0.5 block max-w-[75%] text-xs text-pretty text-kumo-subtle">
              {detail}
            </span>
          ) : null}
        </span>
      ) : null}
      {children}
    </li>
  )
}

/** Placeholder row for an empty group. */
export function EmptyRow({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex min-h-14 items-center px-4 text-sm text-kumo-subtle">
      {children}
    </li>
  )
}
