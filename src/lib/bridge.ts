/* ---- ICU Integration P1 — the Aurora/Bahmni session bridge (client) ----

   ONE hospital login. ICU never asks for a username or a password in
   P1: it exchanges the Aurora/Bahmni session the browser ALREADY holds
   for a short-lived, read-only ICU token.

   WHY THE PATH LOOKS LIKE THAT. OpenMRS runs at Tomcat context
   /openmrs, so its session cookie carries Path=/openmrs and a browser
   will NOT send it to /api/icu/*. The bridge is therefore published
   INSIDE the cookie's path. Moving this constant outside /openmrs
   silently breaks single sign-on: the request still reaches the server,
   the server still answers, and the answer is always 401 because the
   cookie never came along.

   THE HEADER IS THE CSRF DEFENCE. Bahmni sets no SameSite attribute and
   browser defaults differ (Chrome: Lax, Firefox: None), so SameSite
   cannot be relied on. A custom header cannot be attached by a
   cross-site form, image or script tag — it forces a CORS preflight
   that the server's origin checks then refuse.

   credentials: 'include' is what actually carries the hospital session;
   the cookie itself is HttpOnly and never readable from here. */

/** the PUBLIC bridge address — proxied to the ICU API's internal
 *  /api/icu/auth/bridge, exactly, with no extra path segment */
export const BRIDGE_PATH = '/openmrs/aurora-icu-bridge/session'

/** where a clinician goes when there is no usable hospital session */
export const AURORA_LOGIN_URL = '/aurora/'

/** the shared hospital session — ending it signs the clinician out of
 *  Aurora AND ICU, because there is only one session to end */
const OPENMRS_SESSION = '/openmrs/ws/rest/v1/session'

const BRIDGE_HEADER = 'X-Aurora-Bridge'
const TIMEOUT_MS = 8000

export interface BridgeSession {
  token: string
  name: string
  jobTitle: string
  readOnly: boolean
}

export type BridgeResult =
  /** a hospital session exists and maps to an ICU role */
  | { ok: true; session: BridgeSession }
  /** no usable hospital session — the clinician must sign in to Aurora */
  | { ok: false; kind: 'signed-out' }
  /** signed in, but this account has no ICU access (unmapped role) */
  | { ok: false; kind: 'no-access'; message: string }
  /** ICU or the hospital system could not answer — NOT a denial */
  | { ok: false; kind: 'unavailable'; message: string }

/** Exchange the current hospital session for an ICU token.
 *
 *  NEVER falls back to an ICU username/password login: there is no such
 *  path in P1, and inventing one here would recreate the second staff
 *  credential this whole phase exists to remove. Every failure resolves
 *  to one of the three refusals above. */
export async function bridgeSignIn(): Promise<BridgeResult> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(BRIDGE_PATH, {
      method: 'POST',
      /* the hospital session cookie rides here and nowhere else */
      credentials: 'include',
      headers: { [BRIDGE_HEADER]: '1' },
      cache: 'no-store',
      signal: ctrl.signal,
    })
    if (res.status === 401) return { ok: false, kind: 'signed-out' }
    if (res.status === 403) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null
      return {
        ok: false, kind: 'no-access',
        message: body?.error ?? 'Your hospital account does not have ICU access.',
      }
    }
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null
      return {
        ok: false, kind: 'unavailable',
        message: body?.error ?? `ICU could not start your session (HTTP ${res.status}).`,
      }
    }
    const body = (await res.json()) as Partial<BridgeSession>
    if (typeof body.token !== 'string' || !body.token
      || typeof body.name !== 'string' || !body.name
      || typeof body.jobTitle !== 'string' || !body.jobTitle) {
      /* a malformed 200 is UNAVAILABLE, never a silent partial session
         (the fail-closed rule used throughout the ICU API layer) */
      return { ok: false, kind: 'unavailable', message: 'ICU returned an unreadable session and refused to continue.' }
    }
    return {
      ok: true,
      session: { token: body.token, name: body.name, jobTitle: body.jobTitle, readOnly: body.readOnly !== false },
    }
  } catch {
    return { ok: false, kind: 'unavailable', message: 'ICU could not be reached to start your session.' }
  } finally {
    clearTimeout(timer)
  }
}

/** End the SHARED hospital session. ICU sign-out is Aurora sign-out —
 *  there is one session, so ending it here ends it everywhere. Best
 *  effort by design: if the call fails the caller still clears local ICU
 *  state and leaves for Aurora, because a stuck ICU tab holding a token
 *  is the worse outcome. */
export async function endSharedSession(): Promise<void> {
  try {
    await fetch(OPENMRS_SESSION, { method: 'DELETE', credentials: 'include', cache: 'no-store' })
  } catch {
    /* nothing to report — the local clear and redirect happen regardless */
  }
}
