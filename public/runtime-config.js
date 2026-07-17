/* AURORA runtime configuration — the API base is resolved at RUNTIME,
   never baked into the bundle (appliance Phase 1). This shipped DEFAULT
   declares the same-origin topology: apiBaseUrl "" means the frontend
   calls the API at its own origin (relative /api) — the appliance, and
   Render serving its own frontend. A deployment that serves the bundle
   from a DIFFERENT origin than its API (GitHub Pages) overwrites this
   file at deploy time with the API's absolute URL — deployment
   configuration, not a rebuild: the bundle is identical.
   apiBaseUrl: null = the no-API mock demo (nothing to call).
   If this file is missing or fails to load, the app REFUSES to start
   (src/lib/runtimeConfig.ts) — it never silently guesses an API origin:
   a frontend quietly pointing at the wrong hospital's API is
   unthinkable. (Production bundles are same-origin BY CONSTRUCTION and
   ignore any override here — the artifact carries no hostname.) */
window.AURORA_RUNTIME_CONFIG = { apiBaseUrl: '' }
