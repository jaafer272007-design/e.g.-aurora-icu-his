#!/usr/bin/env node
/* ICU Integration P1 — the source-level structural gate.
 *
 * The ICU repository's test discipline is source gates in CI plus
 * deployed end-to-end suites (there is no unit-test harness here), so
 * this pins the P1 facts a future edit could silently undo. RUNTIME
 * behaviour — token acceptance, the read-only refusal, match staying
 * non-creating — is proven separately against a live production-identity
 * stack; this file guards the WIRING those proofs depend on.
 *
 * TEETH, measured before commit by breaking each pinned fact in turn:
 *   1  drop `app.UseP1ReadOnlyGate()` from Program.cs
 *   2  move the gate above `app.UseAuthentication()`
 *   3  widen Allows() to permit any POST
 *   4  loosen the /match exemption to StartsWith
 *   5  delete the CSRF header check in BridgeApi
 *   6  give IcuRoleMap a non-empty built-in default
 *   7  drop the Rbac.ProfileOf validation from the role map
 *   8  re-introduce an ICU password field in Login.tsx
 *   9  write to IcuPatientCorrelations anywhere in P1
 * Each fails this script with the named reason.
 */
import { readFileSync } from 'node:fs'

const fail = []
const raw = p => readFileSync(p, 'utf8')
/* COMMENTS ARE NOT CODE. Every check below runs against comment-stripped
   source, because the first version of this gate passed when
   `app.UseP1ReadOnlyGate()` was commented OUT — the substring was still
   there, in a comment. Measured, not assumed. */
const read = p => raw(p)
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/^[ \t]*\/\/.*$/gm, ' ')
  .replace(/([^:])\/\/.*$/gm, '$1')
const need = (ok, msg) => { if (!ok) fail.push(msg) }

const program = read('server/Program.cs')
const readonlyGate = read('server/Core/Identity/P1ReadOnly.cs')
const bridge = read('server/Core/Identity/BridgeApi.cs')
const roleMap = read('server/Core/Identity/IcuRoleMap.cs')
const login = read('src/pages/Login/Login.tsx')
const bridgeClient = read('src/lib/bridge.ts')

/* --- 1/2: the read-only gate runs, and runs in the right place ------- */
need(program.includes('app.UseP1ReadOnlyGate()'),
  'Program.cs no longer installs the P1 read-only gate — a bridge token could write')
{
  const auth = program.indexOf('app.UseAuthentication()')
  const gate = program.indexOf('app.UseP1ReadOnlyGate()')
  need(auth >= 0 && gate > auth,
    'the P1 read-only gate must run AFTER UseAuthentication() — before it, ctx.User carries no claims and the gate silently allows everything')
}

/* --- 3/4: the gate's rule is method-based, with ONE exact exemption --- */
/* the rule is PINNED EXACTLY, not sampled. The first version asserted
   only that IsGet(method) appeared, and passed with `true ||` prepended —
   i.e. with every write allowed. This is the security boundary; any edit
   to it should have to come here and be re-argued. */
{
  const body = (readonlyGate.match(/public static bool Allows\([^)]*\) =>([\s\S]*?);/) || [])[1] || ''
  const norm = body.replace(/\s+/g, ' ').trim()
  const expected =
    'HttpMethods.IsGet(method) || HttpMethods.IsHead(method) || HttpMethods.IsOptions(method) '
    + '|| (HttpMethods.IsPost(method) && path.Equals(MatchPath, StringComparison.OrdinalIgnoreCase))'
  need(norm === expected,
    'the P1 read-only rule changed. It must be exactly safe-methods OR the one exact-path match POST.\n'
    + `      expected: ${expected}\n      found:    ${norm || '(Allows not found)'}`)
}
need(!/path\.StartsWithSegments\(MatchPath/.test(readonlyGate),
  'the patients/match exemption must not be a prefix match')
need(readonlyGate.includes('"/api/icu/adt/patients/match"'),
  'the one read-only POST exemption is no longer /api/icu/adt/patients/match')

/* --- 5: the CSRF defence exists and does not lean on SameSite -------- */
need(bridge.includes('X-Aurora-Bridge'),
  'the bridge no longer requires its custom header — cross-site POSTs would be accepted')
need(bridge.includes('Sec-Fetch-Site') && bridge.includes('same-origin'),
  'the bridge no longer checks Sec-Fetch-Site for same-origin')
need(/Headers\.Origin/.test(bridge), 'the bridge no longer validates the Origin header')
need(bridge.includes('CacheControl = "no-store"'),
  'the bridge response must be Cache-Control: no-store — it carries a credential')

/* --- 6/7: deny by default, and every mapped title must be real ------- */
need(roleMap.includes('Rbac.ProfileOf(title) is null'),
  'the role map no longer validates titles against Rbac — a typo would authenticate then 403 on everything')
need(/_map = new\(StringComparer\.Ordinal\)/.test(roleMap),
  'the role map must START EMPTY — deny by default, including administrators')
need(roleMap.includes('ICU_BRIDGE_ALLOW_SYSADMIN_DEFAULT'),
  'the administrator default must stay opt-in')
{
  /* the only title this file may name without hospital approval */
  const titles = [...roleMap.matchAll(/Title\s*=\s*"([^"]+)"/g)].map(m => m[1])
  const clinical = titles.filter(t => t !== 'System Administrator')
  need(clinical.length === 0,
    `the role map hard-codes clinical title(s) ${clinical.join(', ')} — clinical mappings are hospital configuration, never shipped defaults`)
}
need(program.includes('IcuRoleMap.LoadAndValidate'),
  'Program.cs no longer validates the role map at boot')

/* --- 8: no ICU password login anywhere in the mounted workspace ------ */
/* the failure mode is a password INPUT or password STATE, not the word:
   the screen legitimately says "you will not be asked for a password" */
need(!/type=["']password["']/.test(login),
  'the ICU login screen has a password input again — P1 must never offer a second staff credential')
need(!/useState[^\n]*[Pp]assword/.test(login) && !/setPassword/.test(login),
  'the ICU login screen holds password state again')
need(!/<(input|form)\b/.test(login),
  'the ICU login screen renders a form/input again — the bridge bootstrap collects nothing from the clinician')
need(!/from '\.\.\/\.\.\/lib\/api'/.test(login) || !/\blogin\b/.test(login),
  'the ICU login screen calls the legacy ICU auth API again')
need(bridgeClient.includes("'/openmrs/aurora-icu-bridge/session'"),
  'the client bridge path left /openmrs — the OpenMRS session cookie is Path=/openmrs and would never be sent')

/* --- 9: P1 creates the correlation SCHEMA and writes nothing --------- */
{
  const srcFiles = ['server/Core/Adt/AdtApi.cs', 'server/Core/Identity/BridgeApi.cs',
                    'server/Core/Persistence/Seeder.cs']
  for (const f of srcFiles) {
    const s = read(f)
    need(!/IcuPatientCorrelations\.(Add|AddRange|Remove|Update)/.test(s),
      `${f} writes to IcuPatientCorrelations — P1 ships the schema EMPTY; correlating a patient is a later, staffed, audited action`)
  }
}

if (fail.length) {
  console.error('ICU P1 gate FAILED:\n' + fail.map(f => '  - ' + f).join('\n'))
  process.exit(1)
}
console.log('ICU P1 gate: all structural facts hold')
