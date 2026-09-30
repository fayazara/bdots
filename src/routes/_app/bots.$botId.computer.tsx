import { createFileRoute } from "@tanstack/react-router"
import { ComputerPanel } from "@/components/computer-panel"
import { SidePanel } from "@/components/side-panel"
import { useBot } from "@/lib/bot-context"

export const Route = createFileRoute("/_app/bots/$botId/computer")({
  component: ComputerRoute,
})

function ComputerRoute() {
  const { state } = useBot()
  return (
    <SidePanel title={`${state.name}'s computer`}>
      <ComputerPanel />
    </SidePanel>
  )
}
