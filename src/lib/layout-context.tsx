import { createContext, useCallback, useContext, useState } from "react"

export const SIDEBAR_COOKIE = "bdots-sidebar"

interface LayoutContextValue {
  sidebarOpen: boolean
  toggleSidebar: () => void
}

const LayoutContext = createContext<LayoutContextValue | null>(null)

export function useLayout() {
  const value = useContext(LayoutContext)
  if (!value) throw new Error("useLayout must be used inside LayoutProvider")
  return value
}

/**
 * App chrome state. The sidebar preference lives in a cookie so the server
 * renders it in the right position and nothing slides on page load.
 */
export function LayoutProvider({
  initialSidebarOpen,
  children,
}: {
  initialSidebarOpen: boolean
  children: React.ReactNode
}) {
  const [sidebarOpen, setSidebarOpen] = useState(initialSidebarOpen)

  const toggleSidebar = useCallback(() => {
    setSidebarOpen((open) => {
      const next = !open
      document.cookie = `${SIDEBAR_COOKIE}=${next ? "open" : "closed"}; path=/; max-age=31536000; samesite=lax`
      return next
    })
  }, [])

  return (
    <LayoutContext.Provider value={{ sidebarOpen, toggleSidebar }}>
      {children}
    </LayoutContext.Provider>
  )
}
