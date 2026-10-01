import { ClientOnly, Outlet, createFileRoute } from "@tanstack/react-router"
import { Sidebar } from "@/components/sidebar"
import { SlideShell } from "@/components/slide-shell"
import { LiveHubProvider, StaticHubProvider } from "@/lib/hub-context"
import { LayoutProvider, useLayout } from "@/lib/layout-context"
import { getHubSnapshot } from "@/lib/server-fns"

export const Route = createFileRoute("/_app")({
  loader: () => getHubSnapshot(),
  // The sidebar is live over a WebSocket; the loader only seeds first paint.
  staleTime: Infinity,
  component: AppLayout,
})

function Shell() {
  const { sidebarOpen } = useLayout()
  return (
    <div className="flex h-full">
      <SlideShell open={sidebarOpen} side="left">
        <Sidebar />
      </SlideShell>
      <main className="flex min-w-0 flex-1">
        <Outlet />
      </main>
    </div>
  )
}

function AppLayout() {
  const { viewer, hub, sidebarOpen } = Route.useLoaderData()
  return (
    <LayoutProvider initialSidebarOpen={sidebarOpen}>
      {/* WebSockets only exist in the browser. The server (and the first
          client render) show the loader's snapshot; the live provider takes
          over after hydration. */}
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
    </LayoutProvider>
  )
}
