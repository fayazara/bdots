// Receives push messages from bots and shows them as notifications, even
// when no bdots tab is open. Registered by src/lib/push.ts.

self.addEventListener("install", () => self.skipWaiting())
self.addEventListener("activate", (event) =>
  event.waitUntil(self.clients.claim())
)

self.addEventListener("push", (event) => {
  if (!event.data) return
  let data
  try {
    data = event.data.json()
  } catch {
    data = { title: "bdots", body: event.data.text() }
  }
  const url = new URL(data.url || "/", self.location.origin).href

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((windows) => {
        // The user is already looking at this thread.
        const watching = windows.some(
          (w) => w.focused && w.visibilityState === "visible" && w.url === url
        )
        if (watching) return
        return self.registration.showNotification(data.title || "bdots", {
          body: data.body || "",
          icon: "/favicon.ico",
          tag: data.tag,
          renotify: Boolean(data.tag),
          data: { url },
        })
      })
  )
})

self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || "/"
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((windows) => {
        const same = windows.find((w) => w.url === url && "focus" in w)
        if (same) return same.focus()
        const any = windows.find(
          (w) => w.url.startsWith(self.location.origin) && "navigate" in w
        )
        if (any) return any.navigate(url).then((w) => w && w.focus())
        return self.clients.openWindow(url)
      })
  )
})
