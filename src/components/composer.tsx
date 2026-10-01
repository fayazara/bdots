import { useRef, useState } from "react"
import { Button } from "@cloudflare/kumo/components/button"
import {
  ArrowUpIcon,
  PaperclipIcon,
  PlusIcon,
  StopIcon,
  XIcon,
} from "@phosphor-icons/react"

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
    <div className="mx-auto w-full max-w-[860px] px-6 pb-4">
      {error ? (
        <p role="alert" className="mb-2 px-2 text-sm text-kumo-danger">
          {error}
        </p>
      ) : null}
      {attached.length > 0 ? (
        <ul className="mb-2 flex flex-wrap gap-2 px-1">
          {attached.map((path) => (
            <li
              key={path}
              className="flex items-center gap-1.5 rounded-full bg-kumo-fill py-1 pr-1.5 pl-3 text-xs text-kumo-default"
            >
              <PaperclipIcon size={12} />
              {path.split("/").at(-1)}
              <button
                type="button"
                aria-label={`Remove ${path.split("/").at(-1)}`}
                onClick={() =>
                  setAttached((prev) => prev.filter((p) => p !== path))
                }
                className="rounded-full p-0.5 outline-none hover:bg-kumo-tint focus-visible:ring-2 focus-visible:ring-kumo-focus"
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
        // The buttons and a one-line textarea are both 36px tall, so the 4px
        // padding is even on every side; extra lines grow upwards.
        className="flex items-end gap-2 rounded-3xl border border-kumo-line bg-kumo-base p-1 shadow-xs focus-within:ring-2 focus-within:ring-kumo-focus"
      >
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          onChange={(e) => void attach(e.target.files)}
        />
        <Button
          type="button"
          variant="secondary"
          shape="circle"
          icon={<PlusIcon />}
          aria-label="Attach a file"
          loading={uploading}
          disabled={disabled || !onAttach}
          onClick={() => fileInput.current?.click()}
        />
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
          className="max-h-[200px] flex-1 resize-none bg-transparent px-1 py-1.5 text-[15px] leading-6 text-kumo-default outline-none placeholder:text-kumo-placeholder"
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
              <StopIcon className="t-icon" data-icon="b" weight="fill" />
            </span>
          }
        />
      </form>
    </div>
  )
}
