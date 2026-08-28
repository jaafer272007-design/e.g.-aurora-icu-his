/* ---- ICU Integration P1 — reading the read-only scope off a token ----

   ONLY FOR DISPLAY. The server enforces read-only on every request
   (server/Core/Identity/P1ReadOnly.cs); this reads the same claim so
   the UI can SAY SO. Nothing here is a permission check — a tampered
   token that dropped the claim would gain exactly nothing, because the
   server is the one that decides.

   The payload is decoded WITHOUT verifying the signature, deliberately:
   the browser has no key and must not pretend to. An unreadable token
   is treated as read-only, because in P1 that is the safe direction —
   showing the notice when it might not apply is harmless; hiding it
   when it does apply is not. */

export const READ_ONLY_SCOPE = 'p1-readonly'
const SCOPE_CLAIM = 'aurora_scope'

/** true when this token carries the P1 read-only scope (or cannot be
 *  read at all — see the header) */
export function isReadOnlyToken(token: string | null): boolean {
  if (!token) return false
  const payload = decodePayload(token)
  if (payload === null) return true
  const scope = (payload as Record<string, unknown>)[SCOPE_CLAIM]
  if (typeof scope === 'string') return scope === READ_ONLY_SCOPE
  if (Array.isArray(scope)) return scope.includes(READ_ONLY_SCOPE)
  return false
}

function decodePayload(token: string): unknown | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const pad = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
    return JSON.parse(decodeURIComponent(escape(atob(pad))))
  } catch {
    return null
  }
}
