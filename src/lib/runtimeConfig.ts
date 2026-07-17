/* Runtime API configuration (appliance Phase 1) — the ONE reader of
   window.AURORA_RUNTIME_CONFIG, set by /runtime-config.js: a classic
   script tag in index.html that executes during HTML parsing, BEFORE
   this module bundle runs — no blocking round-trip after render, no
   race. The mechanism replaces the build-time VITE_API_BASE_URL bake
   (the reason one build could not run everywhere).

   FAIL LOUDLY, NEVER GUESS: when the config is missing or malformed in
   a non-production bundle, main.tsx refuses to mount the app and says
   why. A silent fallback could point a frontend at the wrong origin —
   in a hospital, at the wrong hospital's API.

   PRODUCTION IS SAME-ORIGIN BY CONSTRUCTION (§11 step 3, unchanged):
   a production bundle ignores the config value entirely — the artifact
   carries no hostname to point at a wrong environment. */

export interface RuntimeConfig {
  /** '' = same-origin (relative /api) · absolute URL = cross-origin
   *  (Pages → Render) · null = no API at all (the mock demo) */
  apiBaseUrl: string | null
}

const isProduction = import.meta.env.VITE_APP_ENV === 'production'

const raw: unknown = (window as unknown as { AURORA_RUNTIME_CONFIG?: unknown }).AURORA_RUNTIME_CONFIG

/** non-null = the app must NOT start (rendered verbatim by main.tsx) */
export const runtimeConfigError: string | null = (() => {
  if (isProduction) return null // same-origin by construction — no config consulted
  if (raw === undefined)
    return 'runtime-config.js did not load (missing or failed /runtime-config.js next to the bundle). ' +
      'Refusing to guess an API origin — this deployment must declare one.'
  if (typeof raw !== 'object' || raw === null)
    return 'window.AURORA_RUNTIME_CONFIG is not an object — runtime-config.js is malformed.'
  const v = (raw as { apiBaseUrl?: unknown }).apiBaseUrl
  if (v !== null && typeof v !== 'string')
    return 'AURORA_RUNTIME_CONFIG.apiBaseUrl must be a string ("" = same-origin; an absolute URL = ' +
      'cross-origin) or null (mock demo) — runtime-config.js is malformed.'
  return null
})()

/** the resolved base: '' same-origin · absolute URL · null = mock demo.
 *  Only meaningful when runtimeConfigError is null (main.tsx gates). */
export const runtimeApiBase: string | null = (() => {
  if (isProduction) return ''
  if (runtimeConfigError !== null) return null // unreachable behind the gate; never a guess
  const v = (raw as { apiBaseUrl: string | null }).apiBaseUrl
  return v === null ? null : v.replace(/\/+$/, '')
})()
