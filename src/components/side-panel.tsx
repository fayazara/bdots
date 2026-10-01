import { Link } from "@tanstack/react-router"
import { XIcon } from "@phosphor-icons/react"
import { useBot } from "@/lib/bot-context"

/**
 * Right-hand panel beside the thread (Computer, Settings). It sits on the page
 * canvas like the sidebar; only the chat is an elevated card.
 */
export function SidePanel({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  const { botId } = useBot()
  return (
    <aside aria-label={title} className="flex h-full flex-col">
      <div className="flex h-14 shrink-0 items-center justify-between px-5">
        <h2 className="text-[15px] font-medium text-kumo-default">{title}</h2>
        <Link
          to="/bots/$botId"
          params={{ botId }}
          aria-label={`Close ${title.toLowerCase()}`}
          className="flex size-8 items-center justify-center rounded-lg text-kumo-subtle outline-none hover:bg-kumo-tint hover:text-kumo-default focus-visible:ring-2 focus-visible:ring-kumo-focus"
        >
          <XIcon size={18} />
        </Link>
      </div>
      {children}
    </aside>
  )
}
