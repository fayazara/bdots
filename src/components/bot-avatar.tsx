import { RobotHead } from "robot-heads"
import type { RobotHeadState } from "robot-heads"
import { BOT_AVATARS, BOT_AVATAR_LOOKS } from "@/lib/types"
import type { BotAvatarKind, BotStatus } from "@/lib/types"

interface BotAvatarProps {
  avatar: BotAvatarKind
  size?: number
  status?: BotStatus
  /** Follow the pointer and hop on click. Off for small inline avatars. */
  interactive?: boolean
  className?: string
}

const STATE_FOR_STATUS: Record<BotStatus, RobotHeadState> = {
  idle: "idle",
  thinking: "thinking",
  working: "working",
  action_needed: "listening",
}

function hash(value: string) {
  let h = 0
  for (let i = 0; i < value.length; i++) h = (h * 31 + value.charCodeAt(i)) | 0
  return Math.abs(h)
}

/** A bot's face. Its LED screen and motion follow the bot's status. */
export function BotAvatar({
  avatar,
  size = 44,
  status = "idle",
  interactive = false,
  className,
}: BotAvatarProps) {
  const h = hash(avatar)
  // Bots created before robot-heads stored other avatar names; give them a
  // stable look instead.
  const look =
    (
      BOT_AVATAR_LOOKS as Partial<
        Record<string, (typeof BOT_AVATAR_LOOKS)[BotAvatarKind]>
      >
    )[avatar] ?? BOT_AVATAR_LOOKS[BOT_AVATARS[h % BOT_AVATARS.length]]
  return (
    <RobotHead
      shape={look.shape}
      color={look.color}
      state={STATE_FOR_STATUS[status]}
      size={size}
      interactive={interactive}
      floorShadow={size >= 56}
      antenna={false}
      seed={(h % 1000) / 1000}
      // Decorative: the bot's name and status are always in text beside it.
      aria-hidden="true"
      className={className}
      style={{ flexShrink: 0 }}
    />
  )
}
