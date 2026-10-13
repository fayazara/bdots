import { useCallback, useEffect, useRef, useState } from "react"
import { useHub } from "@/lib/hub-context"
import type { PushSubscriptionData } from "@/lib/types"

export type PushStatus =
  /** SSR, or still finding out. */
  | "loading"
  /** The browser has no Push API, or the deployment has no VAPID keys. */
  | "unsupported"
  | "denied"
  | "off"
  | "on"

function base64UrlToBytes(value: string) {
  const padded = value + "=".repeat((4 - (value.length % 4)) % 4)
  const binary = atob(padded.replace(/-/g, "+").replace(/_/g, "/"))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function toData(subscription: PushSubscription): PushSubscriptionData {
  const json = subscription.toJSON()
  return {
    endpoint: subscription.endpoint,
    expirationTime: json.expirationTime ?? null,
    keys: {
      p256dh: json.keys?.p256dh ?? "",
      auth: json.keys?.auth ?? "",
    },
  }
}

function browserSupportsPush() {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  )
}

/** Bot notifications on this device: register `/sw.js` and subscribe. */
export function usePushNotifications() {
  const hub = useHub()
  const push = useRef(hub.push)
  push.current = hub.push
  const ready = hub.push !== null
  const [status, setStatus] = useState<PushStatus>("loading")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!ready) return
    if (!browserSupportsPush()) {
      setStatus("unsupported")
      return
    }
    let cancelled = false
    void (async () => {
      const key = await push.current?.publicKey()
      if (cancelled) return
      if (!key) return setStatus("unsupported")
      if (Notification.permission === "denied") return setStatus("denied")
      const registration = await navigator.serviceWorker.register("/sw.js")
      const existing = await registration.pushManager.getSubscription()
      const known = existing
        ? await push.current?.isSubscribed(existing.endpoint)
        : false
      if (!cancelled) setStatus(existing && known ? "on" : "off")
    })().catch((err: unknown) => {
      console.error("Push setup failed", err)
      if (!cancelled) setStatus("unsupported")
    })
    return () => {
      cancelled = true
    }
  }, [ready])

  const enable = useCallback(async () => {
    const api = push.current
    if (!api) return
    setBusy(true)
    try {
      const permission = await Notification.requestPermission()
      if (permission !== "granted") {
        setStatus(permission === "denied" ? "denied" : "off")
        return
      }
      const key = await api.publicKey()
      if (!key) return setStatus("unsupported")
      const registration = await navigator.serviceWorker.ready
      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: base64UrlToBytes(key),
        }))
      await api.subscribe(toData(subscription))
      setStatus("on")
    } finally {
      setBusy(false)
    }
  }, [])

  const disable = useCallback(async () => {
    const api = push.current
    if (!api) return
    setBusy(true)
    try {
      const registration = await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.getSubscription()
      if (subscription) {
        await api.unsubscribe(subscription.endpoint)
        await subscription.unsubscribe()
      }
      setStatus("off")
    } finally {
      setBusy(false)
    }
  }, [])

  const test = useCallback(async () => {
    await push.current?.test()
  }, [])

  return { status, busy, enable, disable, test }
}
