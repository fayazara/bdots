/**
 * Who is making this request.
 *
 * bdots is single-tenant for now: put the Worker behind Cloudflare Access
 * and each Access identity gets its own UserHub. Without Access (local dev,
 * or an unprotected deploy) everyone is the same `demo` user.
 *
 * TODO before any public deploy: verify `Cf-Access-Jwt-Assertion` against
 * the team's JWKS instead of trusting the email header, which is only
 * trustworthy when Access is the sole way to reach the Worker.
 */
export const DEMO_USER_ID = "demo"

export function userIdFromRequest(request: Request): string {
  const email = request.headers.get("Cf-Access-Authenticated-User-Email")
  if (!email) return DEMO_USER_ID
  return email.toLowerCase().replace(/[^a-z0-9]+/g, "-")
}
