import { createFileRoute } from "@tanstack/react-router"
import { SettingsPanel } from "@/components/settings-panel"
import { SidePanel } from "@/components/side-panel"

export const Route = createFileRoute("/_app/bots/$botId/settings")({
  component: SettingsRoute,
})

function SettingsRoute() {
  return (
    <SidePanel title="Settings">
      <SettingsPanel />
    </SidePanel>
  )
}
