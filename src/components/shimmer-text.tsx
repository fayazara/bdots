/** Muted text with a highlight sweeping across it while work is running. */
export function ShimmerText({
  text,
  className = "",
}: {
  text: string
  className?: string
}) {
  return (
    <span
      className={`t-shimmer text-kumo-subtle ${className}`}
      data-text={text}
    >
      {text}
    </span>
  )
}
