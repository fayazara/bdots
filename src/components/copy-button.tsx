import { useEffect, useState } from "react"
import { Tooltip } from "@cloudflare/kumo/components/tooltip"
import { CheckIcon, CopyIcon } from "@/components/icons"

/** Round copy button; the icon swaps to a check for a moment after copying. */
export function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(timer)
  }, [copied])

  async function copy() {
    await navigator.clipboard.writeText(text)
    setCopied(true)
  }

  return (
    <Tooltip
      content={copied ? "Copied" : "Copy"}
      render={
        <button
          type="button"
          aria-label={label}
          onClick={() => void copy()}
          className="icon-btn size-8!"
        >
          <span className="t-icon-swap" data-state={copied ? "b" : "a"}>
            <CopyIcon size={16} className="t-icon" data-icon="a" />
            <CheckIcon size={16} className="t-icon" data-icon="b" />
          </span>
        </button>
      }
    />
  )
}
