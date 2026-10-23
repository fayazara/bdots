/**
 * Credentials a bot uses without ever seeing them. The value is typed into a
 * masked card, stored in the bot's Durable Object, and only attached to
 * requests to the exact HTTPS origin it was saved for.
 */

import type { SecretMeta } from "@/lib/types"

export type { SecretMeta, SecretScheme } from "@/lib/types"

/** Longest response body handed back to the model, in characters. */
export const MAX_SECRET_RESPONSE_CHARS = 20_000
export const SECRET_REQUEST_TIMEOUT_MS = 30_000

/** `https://host[:port]`, or null for anything that is not plain HTTPS. */
export function httpsOrigin(value: string): string | null {
  try {
    const url = new URL(value)
    if (url.protocol !== "https:" || url.username || url.password) return null
    return url.origin
  } catch {
    return null
  }
}

/** A secret name the model can refer to: letters, digits, `_` and `-`. */
export function validSecretName(name: string) {
  return /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(name)
}

export function authHeader(meta: SecretMeta, value: string): [string, string] {
  switch (meta.scheme) {
    case "bearer":
      return ["Authorization", `Bearer ${value}`]
    case "basic":
      return ["Authorization", `Basic ${btoa(value)}`]
    case "header":
      return [meta.header, value]
  }
}

/** Remove every form of the secret a response could echo back. */
export function redact(text: string, value: string): string {
  if (value.length < 4) return text
  const forms = new Set([value, encodeURIComponent(value)])
  try {
    forms.add(btoa(value))
  } catch {
    // Not Latin-1: it cannot appear base64-encoded by btoa either.
  }
  let out = text
  for (const form of forms) out = out.split(form).join("[redacted]")
  return out
}
