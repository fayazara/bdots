import { createFileRoute } from "@tanstack/react-router"

// The settings panel is rendered by the bot layout so it can slide in and out;
// this route only gives it a URL.
export const Route = createFileRoute("/_app/bots/$botId/settings")({
  component: () => null,
})
