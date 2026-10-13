import { createFileRoute } from "@tanstack/react-router"

// The computer panel is rendered by the bot layout so it can slide in and out;
// this route only gives it a URL.
export const Route = createFileRoute("/_app/bots/$botId/computer")({
  component: () => null,
})
