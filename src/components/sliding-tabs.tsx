import { useLayoutEffect, useRef } from "react"

interface SlidingTabsProps<T extends string> {
  tabs: { value: T; label: string }[]
  value: T
  onValueChange: (value: T) => void
  className?: string
}

/** Segmented control whose active pill slides between tabs (transitions.dev). */
export function SlidingTabs<T extends string>({
  tabs,
  value,
  onValueChange,
  className,
}: SlidingTabsProps<T>) {
  const bar = useRef<HTMLDivElement>(null)
  const pill = useRef<HTMLSpanElement>(null)
  const placed = useRef(false)

  useLayoutEffect(() => {
    const barEl = bar.current
    const pillEl = pill.current
    if (!barEl || !pillEl) return

    function moveTo(animate: boolean) {
      const tab = barEl!.querySelector<HTMLElement>('[aria-selected="true"]')
      if (!tab || !pillEl) return
      if (!animate) {
        const prev = pillEl.style.transition
        pillEl.style.transition = "none"
        pillEl.style.transform = `translateX(${tab.offsetLeft}px)`
        pillEl.style.width = `${tab.offsetWidth}px`
        void pillEl.offsetWidth
        pillEl.style.transition = prev
      } else {
        pillEl.style.transform = `translateX(${tab.offsetLeft}px)`
        pillEl.style.width = `${tab.offsetWidth}px`
      }
    }

    // Snap on first paint, slide on every change after that.
    moveTo(placed.current)
    placed.current = true

    const observer = new ResizeObserver(() => moveTo(false))
    observer.observe(barEl)
    return () => observer.disconnect()
  }, [value])

  function onKeyDown(e: React.KeyboardEvent, index: number) {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0
    if (!step) return
    e.preventDefault()
    const next = tabs[(index + step + tabs.length) % tabs.length]
    onValueChange(next.value)
    bar.current
      ?.querySelector<HTMLElement>(`[data-value="${next.value}"]`)
      ?.focus()
  }

  return (
    <div ref={bar} role="tablist" className={`t-tabs ${className ?? ""}`}>
      <span ref={pill} className="t-tabs-pill" aria-hidden="true" />
      {tabs.map((tab, i) => (
        <button
          key={tab.value}
          type="button"
          role="tab"
          data-value={tab.value}
          aria-selected={tab.value === value}
          tabIndex={tab.value === value ? 0 : -1}
          className="t-tab"
          onClick={() => onValueChange(tab.value)}
          onKeyDown={(e) => onKeyDown(e, i)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}
