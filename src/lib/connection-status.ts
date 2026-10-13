import type { Connection } from "@/lib/types"

/** One-line, human status for a connection. */
export function connectionStatus(connection: Connection) {
  switch (connection.status) {
    case "ready":
      return `Connected · ${connection.tools} ${connection.tools === 1 ? "tool" : "tools"}`
    case "authenticating":
      return "Needs you to sign in"
    case "connecting":
    case "discovering":
      return "Connecting…"
    default:
      return connection.error ?? "Not connected"
  }
}
