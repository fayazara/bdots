import { useState } from "react"
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router"
import { Button } from "@cloudflare/kumo/components/button"
import { PlusIcon } from "@phosphor-icons/react"
import { BotAvatar } from "@/components/bot-avatar"
import { useHub } from "@/lib/hub-context"
import { getHubSnapshot } from "@/lib/server-fns"

export const Route = createFileRoute("/_app/")({
  // Land on the most recently active bot when there is one.
  beforeLoad: async () => {
    const { hub } = await getHubSnapshot()
    const latest = hub.bots.toSorted((a, b) => b.updatedAt - a.updatedAt)[0]
    if (latest) {
      throw redirect({ to: "/bots/$botId", params: { botId: latest.id } })
    }
  },
  component: Onboarding,
})

function Onboarding() {
  const hub = useHub()
  const navigate = useNavigate()
  const [creating, setCreating] = useState(false)

  async function createBot() {
    setCreating(true)
    try {
      const bot = await hub.createBot()
      await navigate({ to: "/bots/$botId", params: { botId: bot.id } })
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="reveal flex flex-1 flex-col items-center justify-center gap-6 rounded-2xl bg-kumo-base px-6 text-center shadow-xs ring ring-kumo-line">
      <div
        className="flex items-end gap-2"
        style={{ "--i": 0 } as React.CSSProperties}
      >
        <BotAvatar avatar="clover" size={56} interactive />
        <BotAvatar avatar="blob" size={80} interactive />
        <BotAvatar avatar="star" size={56} interactive />
      </div>
      <div
        className="max-w-md space-y-2"
        style={{ "--i": 1 } as React.CSSProperties}
      >
        <h1 className="text-2xl font-semibold tracking-tight text-kumo-default">
          Create your first bot
        </h1>
        <p className="text-[15px] text-kumo-subtle">
          A bot is a teammate with its own computer and browser. Tell it what
          the job is and it names itself, remembers how you like things done,
          and keeps working while you're away.
        </p>
      </div>
      <Button
        style={{ "--i": 2 } as React.CSSProperties}
        variant="primary"
        size="lg"
        className="btn-ink"
        icon={<PlusIcon />}
        onClick={createBot}
        loading={creating}
        disabled={!hub.live}
      >
        New bot
      </Button>
    </div>
  )
}
