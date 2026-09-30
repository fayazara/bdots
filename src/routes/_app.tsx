import { ClientOnly, Outlet, createFileRoute } from "@tanstack/react-router"
import { Sidebar } from "@/components/sidebar"
import { LiveHubProvider, StaticHubProvider } from "@/lib/hub-context"
import { getHubSnapshot } from "@/lib/server-fns"

export const Route = createFileRoute("/_app")({
  loader: () => getHubSnapshot(),
  // The sidebar is live over a WebSocket; the loader only seeds first paint.
  staleTime: Infinity,
  component: AppLayout,
})

function Shell() {
  return (
    <div className="flex h-full">
      <Sidebar />
      <main className="flex min-w-0 flex-1">
        <Outlet />
      </main>
    </div>
  )
}

function AppLayout() {
  const { viewer, hub } = Route.useLoaderData()
  return (
    // WebSockets only exist in the browser. The server (and the first client
    // render) show the loader's snapshot; the live provider takes over after
    // hydration.
    <ClientOnly
      fallback={
        <StaticHubProvider viewer={viewer} initial={hub}>
          <Shell />
        </StaticHubProvider>
      }
    >
      <LiveHubProvider viewer={viewer} initial={hub}>
        <Shell />
      </LiveHubProvider>
    </ClientOnly>
  )
}
