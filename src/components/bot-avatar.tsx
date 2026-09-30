import { BotAvatar as BotAvatarCanvas } from "bot-avatars"
import type { BotAvatarKind, BotStatus } from "@/lib/types"

interface BotAvatarProps {
  avatar: BotAvatarKind
  size?: number
  status?: BotStatus
  /** Follow the pointer and hop on click. Off for small inline avatars. */
  interactive?: boolean
  className?: string
}

/** A bot's face. It hops and spins while the bot is thinking or working. */
export function BotAvatar({
  avatar,
  size = 44,
  status = "idle",
  interactive = false,
  className,
}: BotAvatarProps) {
  const busy = status === "thinking" || status === "working"
  return (
    <BotAvatarCanvas
      type={avatar}
      size={size}
      state={busy ? "working" : "default"}
      interactive={interactive}
      // Decorative: the bot's name and status are always in text beside it.
      aria-hidden="true"
      className={className}
      style={{ flexShrink: 0 }}
    />
  )
}
