import { useRef, useState } from "react"
import { Button } from "@cloudflare/kumo/components/button"
import { DropdownMenu } from "@cloudflare/kumo/components/dropdown"
import { Loader } from "@cloudflare/kumo/components/loader"
import {
  ArrowUpIcon,
  ChalkboardTeacherIcon,
  PaperclipIcon,
  PlusIcon,
  StopIcon,
  XIcon,
} from "@/components/icons"

const TEACH_PROMPT = "I want to show you how to "

interface ComposerProps {
  botName: string
  disabled?: boolean
  /** A turn is running: the send button becomes a stop button. */
  busy: boolean
  onSend: (text: string) => void
  onStop: () => void
  /** Saves a file to the bot's inbox and returns its workspace path. */
  onAttach?: (file: File) => Promise<string>
}

export function Composer({
  botName,
  disabled = false,
  busy,
  onSend,
  onStop,
  onAttach,
}: ComposerProps) {
  const [text, setText] = useState("")
  const [attached, setAttached] = useState<string[]>([])
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const textarea = useRef<HTMLTextAreaElement>(null)

  const canSend = !disabled && !uploading && text.trim().length > 0
  const stopping = busy && !text.trim()

  function submit() {
    if (!canSend) return
    const files = attached.length
      ? `\n\nAttached files: ${attached.join(", ")}`
      : ""
    onSend(text.trim() + files)
    setText("")
    setAttached([])
    if (textarea.current) textarea.current.style.height = "auto"
  }

  async function attach(files: FileList | null) {
    if (!files || !onAttach) return
    setUploading(true)
    setError(null)
    try {
      for (const file of files) {
        const path = await onAttach(file)
        setAttached((prev) => [...prev, path])
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed")
    } finally {
      setUploading(false)
      if (fileInput.current) fileInput.current.value = ""
    }
  }

  return (
    <div className="mx-auto w-full max-w-[820px] px-6 pb-4">
      {error ? (
        <p role="alert" className="mb-2 px-1.5 text-sm text-kumo-danger">
          {error}
        </p>
      ) : null}
      {attached.length > 0 ? (
        <ul className="mb-2 flex flex-wrap gap-2 px-1.5">
          {attached.map((path) => (
            <li
              key={path}
              className="flex items-center gap-1.5 rounded-full bg-(--fill-hover) py-1 pr-1 pl-3 text-xs text-kumo-default"
            >
              <PaperclipIcon size={12} />
              {path.split("/").at(-1)}
              <button
                type="button"
                aria-label={`Remove ${path.split("/").at(-1)}`}
                onClick={() =>
                  setAttached((prev) => prev.filter((p) => p !== path))
                }
                className="rounded-full p-0.5 outline-none hover:bg-(--fill-active) focus-visible:ring-2 focus-visible:ring-kumo-focus"
              >
                <XIcon size={12} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <form
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
        // 36px buttons and a one-line textarea sit 6px inside a 48px pill
        // (24px radius = 18px + 6px). It is 16px off the bottom, so its centre
        // lines up with the sidebar footer. Extra lines grow upwards.
        className="flex items-end gap-2 rounded-3xl bg-kumo-base p-1.5 shadow-[0_0_0_1px_var(--color-kumo-line),0_1px_2px_oklch(0_0_0/0.04),0_4px_12px_oklch(0_0_0/0.04)] focus-within:ring-2 focus-within:ring-kumo-focus"
      >
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          onChange={(e) => void attach(e.target.files)}
        />
        <DropdownMenu>
          <DropdownMenu.Trigger
            disabled={disabled}
            render={(props) => (
              <button
                {...props}
                type="button"
                aria-label="More"
                disabled={disabled || uploading}
                className="icon-btn is-filled"
              >
                {uploading ? <Loader size="sm" /> : <PlusIcon size={18} />}
              </button>
            )}
          />
          <DropdownMenu.Content side="top" align="start">
            <DropdownMenu.Item
              icon={<PaperclipIcon />}
              disabled={!onAttach}
              onClick={() => fileInput.current?.click()}
            >
              Attach a file
            </DropdownMenu.Item>
            <DropdownMenu.Item
              icon={<ChalkboardTeacherIcon />}
              onClick={() => {
                setText(TEACH_PROMPT)
                // After the menu closes and returns focus to its trigger.
                requestAnimationFrame(() => {
                  const el = textarea.current
                  if (!el) return
                  el.focus()
                  el.setSelectionRange(el.value.length, el.value.length)
                })
              }}
            >
              Teach a task
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu>
        <textarea
          ref={textarea}
          rows={1}
          value={text}
          disabled={disabled}
          placeholder={`Message ${botName}`}
          aria-label={`Message ${botName}`}
          onChange={(e) => {
            setText(e.target.value)
            e.target.style.height = "auto"
            e.target.style.height = `${Math.min(e.target.scrollHeight, 200)}px`
          }}
          onKeyDown={(e) => {
            if (
              e.key === "Enter" &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing
            ) {
              e.preventDefault()
              submit()
            }
          }}
          className="max-h-[200px] flex-1 resize-none bg-transparent px-1.5 py-1.5 text-[15px] leading-6 text-kumo-default outline-none placeholder:text-kumo-placeholder"
        />
        {/* One button that swaps between send and stop, so the icon can
            cross-fade instead of the whole control popping. */}
        <Button
          type={stopping ? "button" : "submit"}
          variant="primary"
          shape="circle"
          className="btn-ink"
          aria-label={stopping ? "Stop" : "Send"}
          disabled={!stopping && !canSend}
          onClick={stopping ? onStop : undefined}
          icon={
            <span className="t-icon-swap" data-state={stopping ? "b" : "a"}>
              <ArrowUpIcon className="t-icon" data-icon="a" />
              <StopIcon className="t-icon" data-icon="b" />
            </span>
          }
        />
      </form>
    </div>
  )
}
