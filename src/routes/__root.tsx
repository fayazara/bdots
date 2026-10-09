import { HeadContent, Scripts, createRootRoute } from "@tanstack/react-router"
import { TooltipProvider } from "@cloudflare/kumo/components/tooltip"
import appCss from "../styles.css?url"

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "bdots" },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body className="bg-kumo-canvas text-kumo-default antialiased">
        {/* `isolate` keeps Kumo's portalled popups above the app layout. */}
        <div className="isolate h-svh">
          <TooltipProvider>{children}</TooltipProvider>
        </div>
        <Scripts />
      </body>
    </html>
  )
}
