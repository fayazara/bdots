import { useEffect, useState } from "react"

// Matches --panel-close-dur in styles.css.
const CLOSE_MS = 350

/**
 * Keeps the last children rendered while a panel slides shut, so the close
 * animates the content that was there rather than an empty box.
 */
export function useLatchedWhileClosing<T>(value: T | null, open: boolean) {
  const [latched, setLatched] = useState(value)

  useEffect(() => {
    if (open && value !== null) {
      setLatched(value)
      return
    }
    const timer = setTimeout(() => setLatched(null), CLOSE_MS)
    return () => clearTimeout(timer)
  }, [open, value])

  return open && value !== null ? value : latched
}

interface SlideShellProps {
  open: boolean
  side: "left" | "right"
  className?: string
  children: React.ReactNode
}

/**
 * A sidebar or side panel that slides in and out. The shell's width animates
 * so neighbouring content resizes with it; the content slides, fades and
 * un-blurs. See `.slide-shell` in styles.css.
 */
export function SlideShell({
  open,
  side,
  className,
  children,
}: SlideShellProps) {
  return (
    <div
      className="slide-shell"
      data-open={open}
      data-side={side}
      // Keep a closed panel out of the tab order and the accessibility tree.
      inert={!open}
    >
      <div className={`slide-content ${className ?? ""}`}>{children}</div>
    </div>
  )
}
