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
