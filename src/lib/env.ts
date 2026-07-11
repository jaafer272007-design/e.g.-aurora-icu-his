/* §11 step 3 — the frontend's COMPILED-IN environment identity.
   VITE_APP_ENV is baked into the bundle at build time: deploy-pages.yml
   passes "staging" for the Pages site, the production build passes
   "production" (the release pipeline of §11 step 4), and a local dev
   build defaults to "development". Vite statically REPLACES
   import.meta.env.VITE_APP_ENV wherever it appears, which is what lets
   production bundles drop the mock layer and the staging banner as dead
   code (see src/lib/api/index.ts) — so DCE-critical guards use the
   inline expression, and this module only exports the identity for
   DISPLAY and comparison (the banner text, the runtime cross-check). */
export const APP_ENV: string = import.meta.env.VITE_APP_ENV ?? 'development'
