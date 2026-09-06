#!/usr/bin/env node
/*
  AURORA — the ICU-edition structural gate (owner's decision, 2026-09-06).

  WHAT IT PROTECTS. The hospital exe ships "only the ICU". The module-2
  screens built into this app in 2026-08 — Inpatient Reception (/reception),
  the awaiting-bed worklist (/awaiting-bed), the four reception vocabularies
  in Configuration (Admission Types, Departments, Services, Sources of
  Admission) and the Admissions screen's pointer to Reception — exist only
  where the SERVER reports the FULL edition on /healthz (`edition`, from
  AURORA_EDITION, server/Core/Shared/Edition.cs). The default is icu (an
  older install updated in place must stay ICU-only); the hospital installer
  writes icu explicitly; staging (render.yaml) and the appliance set full.
  Wards is deliberately NOT gated: the bed registry refuses a bed whose area
  is not a configured ward, so it is ICU configuration. The facts a
  well-meaning refactor would quietly undo:

    1. Edition.cs maps exactly: "full" → full, everything else → icu; and
       Program.cs reports it on /healthz as `edition`.
    2. lib/edition.ts: unreachable → icu; field absent → full (a server from
       before editions IS the full app); "full" → full; any other value → icu;
       initial state pending (no API → full).
    3. EnvironmentGate feeds BOTH outcomes of its /healthz fetch to the store.
    4. NavSidebar: the reception AND awaiting items carry `when: edition ===
       'full'` (the `when` filter itself is pinned by ai-section-gate.mjs).
    5. App.tsx: /reception and /awaiting-bed are wrapped in RequireFullEdition
       INSIDE their unchanged permission gates (admissions.create, beds.assign).
    6. RequireFullEdition redirects on 'icu' and renders nothing on 'pending'.
    7. Configuration: the four reception tenants are gated on fullEdition;
       Wards is NOT; the four fetches are gated too.
    8. Admissions: the Reception pointer is gated on edition === 'full'.
    9. The installer writes AURORA_EDITION=icu inside the AURORA-ENV-KEYS
       region (so build.ps1 sees it) and build.ps1 lists it as OPTIONAL (so
       the updater does not warn on older installs where absence is correct).
   10. render.yaml and appliance/docker-compose.yml set full.

  🔴 WHAT THIS GATE DOES NOT PROVE. It reads SOURCE (comments stripped) and
  proves the wiring is PRESENT, not that it FIRES. The behavioural proof for
  this PR was a session-local rendered pass of the built bundle against a
  stub API answering edition icu, then full, then no field (recorded in 02).

  TEETH: measured before commit — each pinned fact was broken in turn in a
  scratch copy and the gate failed naming it; the unmodified control passed.

  Usage:  node scripts/edition-gate.mjs      Exit 0 = pinned, 1 = not.
*/
import { readFileSync } from 'node:fs'

function stripComments(src) {
  let out = ''
  let inBlock = false, inLine = false, inStr = false, quote = ''
  for (let i = 0; i < src.length; i++) {
    const c = src[i], next = src[i + 1]
    if (inBlock) { if (c === '*' && next === '/') { inBlock = false; i++ } out += c === '\n' ? '\n' : ' '; continue }
    if (inLine) { if (c === '\n') { inLine = false; out += '\n' } else out += ' '; continue }
    if (inStr) {
      if (c === '\\') { out += '  '; i++; continue }
      if (c === quote) inStr = false
      out += c; continue
    }
    if (c === '/' && next === '*') { inBlock = true; out += '  '; i++; continue }
    if (c === '/' && next === '/') { inLine = true; out += '  '; i++; continue }
    if (c === '"' || c === "'" || c === '`') { inStr = true; quote = c; out += c; continue }
    out += c
  }
  return out
}
/* PowerShell and YAML files use hash comments (no block comments) — read
   them raw but drop whole-line comments so prose cannot satisfy a pin */
function readHashCommented(file, minBytes, what) {
  let src
  try { src = readFileSync(file, 'utf8') } catch { console.log(`FAIL - ${file} is missing — ${what}.`); process.exit(1) }
  const code = src.split('\n').filter(l => !/^\s*#/.test(l)).join('\n')
  if (code.length < minBytes) { console.log(`FAIL - ${file} is ${code.length} bytes of code; that is not ${what}.`); process.exit(1) }
  return code
}
function read(file, minBytes, what) {
  let src
  try { src = readFileSync(file, 'utf8') } catch { console.log(`FAIL - ${file} is missing — ${what}.`); process.exit(1) }
  const code = stripComments(src)
  if (code.length < minBytes) { console.log(`FAIL - ${file} is ${code.length} bytes of code; that is not ${what}.`); process.exit(1) }
  return code
}

const failures = []
const pin = (ok, msg) => { if (!ok) failures.push(msg) }

/* 1 — the server maps exactly and reports it */
const edition = read('server/Core/Shared/Edition.cs', 300, 'the edition setting')
pin(/Name\s*=\s*Raw\s*==\s*"full"\s*\?\s*"full"\s*:\s*"icu"/.test(edition),
  'Edition.cs no longer maps exactly (Raw == "full" ? "full" : "icu") — the default must be icu and "full" the only word that widens the app')
pin(/GetEnvironmentVariable\("AURORA_EDITION"\)/.test(edition), 'Edition.cs no longer reads AURORA_EDITION')
const program = read('server/Program.cs', 5000, 'the server bootstrap')
const healthzAt = program.indexOf('MapGet("/healthz"')
const healthzLine = healthzAt >= 0 ? program.slice(healthzAt, program.indexOf('\n', healthzAt)) : ''
pin(/edition\s*=\s*Edition\.Name/.test(healthzLine), 'Program.cs /healthz no longer reports edition = Edition.Name — the frontend has nothing to decide the module-2 screens on')

/* 2 — the store */
const store = read('src/lib/edition.ts', 500, 'the edition store')
pin(/apiHealthUrl\(\)\s*===\s*null\s*\?\s*'full'\s*:\s*'pending'/.test(store), "edition.ts initial state is no longer (no API → 'full', else 'pending') — an ICU install must never flash the module-2 items before /healthz answers")
pin(/if\s*\(\s*health\s*===\s*null\s*\|\|\s*typeof health\s*!==\s*'object'\s*\)\s*\{\s*set\('icu'\)/.test(store), "edition.ts no longer reads an unreachable server as 'icu' (show less, not more)")
pin(/if\s*\(\s*v\s*===\s*undefined\s*\)\s*\{\s*set\('full'\)/.test(store), "edition.ts no longer reads an ABSENT edition field as 'full' — a server from before editions is the full app")
pin(/set\(\s*v\s*===\s*'full'\s*\?\s*'full'\s*:\s*'icu'\s*\)/.test(store), "edition.ts no longer maps exactly (v === 'full' ? 'full' : 'icu') — any other value must read icu")

/* 3 — one fetch, both outcomes */
const gate = read('src/components/EnvironmentChrome.tsx', 2000, 'the environment gate')
pin((gate.match(/recordEdition\(/g) || []).length >= 2, 'EnvironmentChrome.tsx calls recordEdition fewer than twice — both the answered and the failed /healthz path must feed the edition store')
pin(/recordEdition\(null\)/.test(gate), 'EnvironmentChrome.tsx no longer records an unreachable /healthz as null for the edition')

/* 4 — nav */
const nav = read('src/components/NavSidebar.tsx', 3000, 'the primary navigation')
pin(/key:\s*'reception'[^\n]*when:\s*edition\s*===\s*'full'/.test(nav), "NavSidebar.tsx Reception item lost `when: edition === 'full'` — every admissions.create holder on an ICU install gets Reception back")
pin(/key:\s*'awaiting'[^\n]*when:\s*edition\s*===\s*'full'/.test(nav), "NavSidebar.tsx Awaiting Bed item lost `when: edition === 'full'`")
pin(/useEdition\(\)/.test(nav), 'NavSidebar.tsx no longer reads useEdition()')

/* 5 — routes, inside their permission gates */
const app = read('src/App.tsx', 2000, 'the route table')
pin(/<Route path="\/reception" element=\{<RequireSession permission="admissions\.create"><RequireFullEdition><Reception \/><\/RequireFullEdition><\/RequireSession>\}/.test(app),
  'App.tsx /reception is not RequireSession(admissions.create) > RequireFullEdition > Reception')
pin(/<Route path="\/awaiting-bed" element=\{<RequireSession permission="beds\.assign"><RequireFullEdition><AwaitingBed \/><\/RequireFullEdition><\/RequireSession>\}/.test(app),
  'App.tsx /awaiting-bed is not RequireSession(beds.assign) > RequireFullEdition > AwaitingBed')

/* 6 — the guard */
const guard = read('src/components/RequireFullEdition.tsx', 300, 'the edition route guard')
pin(/if\s*\(\s*edition\s*===\s*'pending'\s*\)\s*return null/.test(guard), "RequireFullEdition.tsx no longer renders null on 'pending'")
const icuAt = guard.indexOf("edition === 'icu'")
pin(icuAt >= 0 && /<Navigate to=/.test(guard.slice(icuAt, icuAt + 300)), "RequireFullEdition.tsx no longer redirects (<Navigate) on 'icu' — a bookmarked /reception on an ICU install would render the screen")
pin(!/return children/.test(guard.slice(0, icuAt >= 0 ? icuAt : 0)), "RequireFullEdition.tsx returns children BEFORE the 'icu' check — the guard is bypassed")

/* 7 — Configuration tenants */
const cfg = read('src/pages/Configuration/Configuration.tsx', 5000, 'the Configuration area')
pin(/const fullEdition\s*=\s*edition\s*===\s*'full'/.test(cfg), "Configuration.tsx lost `const fullEdition = edition === 'full'`")
for (const id of ['admissiontypes', 'departments', 'services', 'admissionsources']) {
  pin(new RegExp(`id:\\s*'${id}'[^\\n]*allowed:\\s*fullEdition\\s*&&`).test(cfg), `Configuration.tsx tenant '${id}' is no longer gated on fullEdition — it would show on the ICU edition`)
}
pin(/id:\s*'wards'[^\n]*allowed:\s*can\('hospital\.configure'\)\s*\}/.test(cfg), "Configuration.tsx 'wards' tenant must stay UNGATED (the bed registry depends on it) — it is no longer `allowed: can('hospital.configure')` alone")
pin(/if\s*\(\s*fullEdition\s*&&\s*can\('hospital\.configure'\)\s*\)\s*\{\s*getAdmissionTypes\(\)/.test(cfg), 'Configuration.tsx still fetches the four reception vocabularies on the ICU edition (the fetch block lost its fullEdition gate)')

/* 8 — Admissions pointer */
const adm = read('src/pages/Admissions/Admissions.tsx', 3000, 'the Admissions screen')
pin(/canCreateAdmission\s*&&\s*edition\s*===\s*'full'\s*&&\s*\(/.test(adm), "Admissions.tsx Reception pointer is no longer gated on edition === 'full' — an ICU install would offer a dead link")

/* 9 — the installer writes it, build.ps1 treats it as optional */
readHashCommented('installer/aurora-provision.ps1', 5000, 'the provisioner')   // existence + size sanity
const provRaw = readFileSync('installer/aurora-provision.ps1', 'utf8')
const rawB = provRaw.indexOf('# AURORA-ENV-KEYS-BEGIN'), rawE = provRaw.indexOf('# AURORA-ENV-KEYS-END')
pin(rawB >= 0 && rawE > rawB && /\$lines \+= 'AURORA_EDITION=icu'/.test(provRaw.slice(rawB, rawE)),
  "aurora-provision.ps1 no longer writes $lines += 'AURORA_EDITION=icu' inside the AURORA-ENV-KEYS region — the hospital install would not record its edition")
const build = readHashCommented('installer/build.ps1', 5000, 'the build script')
const optAt = build.indexOf('$optionalEnvKeys = @(')
pin(optAt >= 0 && /'AURORA_EDITION'/.test(build.slice(optAt, build.indexOf(')', optAt) + 1)),
  "build.ps1 $optionalEnvKeys no longer lists 'AURORA_EDITION' — the updater would warn on every older install where absence is correct")

/* 10 — staging and the appliance are the full edition */
const render = readHashCommented('render.yaml', 500, 'the Render blueprint')
pin(/- key: AURORA_EDITION\s*\n\s*value: full/.test(render), 'render.yaml no longer sets AURORA_EDITION=full — staging would hide the module-2 screens the validator tests')
const compose = readHashCommented('appliance/docker-compose.yml', 500, 'the appliance compose file')
pin(/AURORA_EDITION:\s*\$\{AURORA_EDITION:-full\}/.test(compose), 'appliance/docker-compose.yml no longer defaults AURORA_EDITION to full')

if (failures.length > 0) {
  console.log('FAIL - the ICU-edition wiring is no longer intact:')
  for (const f of failures) console.log(`         ${f}`)
  console.log('       If any of this changed deliberately, it is a product decision (2026-09-06,')
  console.log('       01_ARCHITECTURE.md editions addition): Edition.cs, the store, the nav, the')
  console.log('       routes, Configuration, Admissions, the installer and this gate move together.')
  process.exit(1)
}
console.log('confirmed: /healthz reports edition (default icu); the module-2 screens — Reception, Awaiting Bed, the four reception vocabularies, the Admissions pointer — exist only on the full edition; Wards stays; the installer writes icu, build.ps1 treats it as optional, staging and the appliance set full (SOURCE check: this does not render the screens)')
process.exit(0)
