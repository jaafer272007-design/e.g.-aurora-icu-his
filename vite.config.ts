import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

/* ENVIRONMENT IDENTITY ALLOW-LIST (environment-separation PR-2).
   VITE_APP_ENV is the bundle's COMPILED-IN identity: ~95 guards in
   src/lib/api/index.ts key on `!== 'production'`, so an unknown or
   misspelled value silently compiles a NON-PRODUCTION bundle — mock
   layer IN, demo fallbacks LIVE, banner ON — with nothing refusing
   anywhere. The server refuses an unknown APP_ENV at boot
   (server/Core/Shared/AppEnv.cs — `Known`, the source of truth this
   list MIRRORS; ci.yml asserts the two stay equal); this is the build
   half of the same rule, at the one chokepoint every build entry point
   passes through (npm run dev/build, ci.yml, deploy-pages,
   release-production, server/Dockerfile, installer/build.ps1, the
   appliance) — no per-entry-point duplicate gates.
   UNSET stays allowed: it is the documented local-development default
   (src/lib/env.ts falls back to 'development'; 01_ARCHITECTURE.md's
   §11-step-3 residual). SET-BUT-EMPTY is not unset — env.ts's `??`
   would keep '' as the identity — so it refuses like any unknown. */
const KNOWN_APP_ENVS = ['development', 'staging', 'production']

// tsconfig.node.json compiles ONLY this file and carries no @types/node;
// this is the minimal ambient shape the gate needs (no new dependency)
declare const process: { env: Record<string, string | undefined>; cwd(): string }

export default defineConfig(({ mode }) => {
  // process env wins over .env files, matching Vite's own precedence for
  // import.meta.env; loadEnv covers the (gitignored) .env-file source
  const appEnv =
    process.env.VITE_APP_ENV ?? loadEnv(mode, process.cwd(), 'VITE_').VITE_APP_ENV
  // indexOf, not includes: tsconfig.node.json's lib predates ES2016
  if (appEnv !== undefined && KNOWN_APP_ENVS.indexOf(appEnv) === -1) {
    throw new Error(
      `UNKNOWN ENVIRONMENT IDENTITY: VITE_APP_ENV is '${appEnv}'${appEnv === '' ? ' (set but empty)' : ''} — ` +
        `not one of: ${KNOWN_APP_ENVS.join(' | ')} (the server's allow-list, server/Core/Shared/AppEnv.cs). ` +
        `An unknown value would silently compile a non-production bundle (mock layer in, banner on). ` +
        `Unset VITE_APP_ENV for a local development build, or set a known value.`,
    )
  }
  return {
    plugins: [react()],
  }
})
