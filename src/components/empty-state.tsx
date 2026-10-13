/**
 * Quiet placeholder for an empty pane: a small icon, one line of title and a
 * short hint, with no card around it.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className = "",
}: {
  icon?: React.ReactNode
  title: string
  description?: React.ReactNode
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={`flex flex-col items-center gap-1.5 px-6 text-center ${className}`}
    >
      {icon ? <span className="mb-1.5 text-kumo-inactive">{icon}</span> : null}
      <p className="text-sm font-medium text-balance text-kumo-default">
        {title}
      </p>
      {description ? (
        <p className="max-w-xs text-[13px] text-pretty text-kumo-subtle">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  )
}
