import { HeadContent, Scripts, createRootRoute } from "@tanstack/react-router"
import { TooltipProvider } from "@cloudflare/kumo/components/tooltip"
import { IconContext } from "@phosphor-icons/react"
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
        <div className="isolate h-svh p-1.5">
          {/* Phosphor's regular weight reads too thin at our sizes. */}
          <IconContext.Provider
            value={{
              color: "currentColor",
              size: "1em",
              weight: "bold",
              mirrored: false,
            }}
          >
            <TooltipProvider>{children}</TooltipProvider>
          </IconContext.Provider>
        </div>
        <Scripts />
      </body>
    </html>
  )
}
