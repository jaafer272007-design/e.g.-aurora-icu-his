/// <reference types="vite/client" />

/* §11 step 3 — the two build-time inputs (merged into vite/client's
   ImportMetaEnv by interface declaration merging):
   - VITE_APP_ENV: the bundle's compiled-in environment identity
     (development | staging | production). Drives the mock-layer
     dead-code elimination, the staging banner, and the runtime
     environment cross-check. Unset = development.
   - VITE_API_BASE_URL: the ABSOLUTE API base for dev/staging
     (cross-origin: Pages -> Render). IGNORED in production builds —
     production is same-origin with a relative base by construction. */
interface ImportMetaEnv {
  readonly VITE_APP_ENV?: string
  readonly VITE_API_BASE_URL?: string
}
