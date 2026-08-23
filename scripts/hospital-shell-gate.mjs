#!/usr/bin/env node
/*
  AURORA — the hospital-shell structural gate.

  WHAT IT PROTECTS. The Hospital Shell PR (hospital-shell.md §§1/3 + the
  owner's 2026-08-23 front-door amendment, recorded there as A3) made three
  guarantees a well-meaning refactor could quietly undo:

    1. THE AUTHORITY BOUNDARY (design §3): the "Bed Admission" nav row —
       the admit-into-an-ICU-bed screen — is VISIBLE only to adt.admit
       holders (Doctor / SeniorDoctor). The office Administrator holds
       admissions.create (Reception) and NOT adt.admit; widening the row's
       gate re-creates the two-adjacent-admission-entries defect the owner
       found, and hands the desk a row it cannot use. The ROUTE gate stays
       patients.view deliberately (honest read-only deep links) — the gate
       pins BOTH facts, because tightening the route would be a silent
       authority change in the other direction.
    2. THE OWNERSHIP GROUPING (design §1): rows sit under their owner —
       module screens under ICU, hospital-wide screens under Patient Flow /
       Patient Chart / Records / Administration — with Ward declared and
       EMPTY (renders nothing) and OR not declared at all. One flat list,
       or a row drifting across groups, is the "still an ICU application"
       finding coming back.
    3. THE FRONT DOOR (A3): the product identity is Aurora HIS (wordmark,
       login, browser title) and the default landing is the hospital Home
       for EVERY profile — never a module screen. The per-role ICU
       workspaces survive at their own routes.

  🔴 WHAT THIS GATE DOES NOT PROVE. It reads SOURCE (comments stripped).
  It proves the model, the gates and the wiring are PRESENT — not that a
  browser renders them: nothing here signs in, opens a sidebar, or measures
  a theme. The behavioural proof for this PR was produced by a
  session-local rendered pass against the real built bundle served by the
  real server (recorded in 02 with its evidence); the absence of a
  committed browser driver is a recorded gap (Known Feature Gaps in 02),
  not a claim this gate quietly absorbs.

  TEETH: measured before commit, not asserted — eight pinned facts were
  broken in turn in the working tree (the Bed Admission perm widened to
  patients.view, the row relabelled, Ward given a row, the Administrator
  profile granted adt.admit, the title reverted to AURORA ICU, the /home
  redirect repointed, Bed Admission's icon collapsed onto Reception's, and
  the empty-group filter neutralized) and the gate failed each time naming
  the break, with the file restored byte-identical after each.

  Usage:  node scripts/hospital-shell-gate.mjs      Exit 0 = pinned, 1 = not.
*/
import { readFileSync } from 'node:fs'

/* same comment-stripper as the §3.2 / awaiting-bed gates, for the same
   reason: this repo EXPLAINS its rules in prose beside the code, and prose
   must never keep a gate green after the enforcement it describes is gone.
   (Strings survive stripping — the wordmark and label pins depend on that.) */
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

function read(file, minBytes, what) {
  let src
  try { src = readFileSync(file, 'utf8') } catch {
    console.log(`FAIL - ${file} is missing — ${what}.`)
    process.exit(1)
  }
  const code = stripComments(src)
  if (code.length < minBytes) {
    console.log(`FAIL - ${file} is ${code.length} bytes of code; that is not ${what}.`)
    process.exit(1)
  }
  return code
}

const failures = []
const pin = (ok, msg) => { if (!ok) failures.push(msg) }

/* ---------- 1 · the product identity is Aurora HIS ---------- */
const html = readFileSync('index.html', 'utf8') // no JS comments to strip
pin(html.includes('<title>Aurora HIS</title>'),
  'index.html: the browser title is no longer exactly "Aurora HIS"')
pin(!html.includes('AURORA ICU'),
  'index.html: "AURORA ICU" is back in the shell — the product identity is Aurora HIS; ICU is a module')
for (const f of ['src/components/AppHeader.tsx', 'src/pages/Login/Login.tsx', 'src/pages/MissionControl/MissionControl.tsx']) {
  const code = read(f, 1500, 'a shell surface')
  pin(code.includes('AURORA HIS'),
    `${f}: the AURORA HIS wordmark is gone`)
  pin(!code.includes('AURORA ICU'),
    `${f}: "AURORA ICU" is back — the wordmark is the PRODUCT's (Aurora HIS); module identity belongs in subtitles`)
}

/* ---------- 2 · the ownership model (NavSidebar is the ONE source) ---------- */
const nav = read('src/components/NavSidebar.tsx', 4000, 'the grouped nav model')

/* group sequence — ownership order, Ward declared, OR absent */
const modelStart = nav.indexOf('NAV_GROUPS')
pin(modelStart >= 0, 'NavSidebar.tsx: the NAV_GROUPS ownership model is gone')
const model = modelStart >= 0 ? nav.slice(modelStart) : ''
/* GROUP labels sit alone on a 4-space-indented line; ROW labels ride
   inside one-line row literals after `key:` — the anchor keeps them apart */
const labels = [...model.matchAll(/\n {4}label:\s*(null|'[^']*')/g)].map(m => m[1])
const wantLabels = ['null', "'Patient Flow'", "'Ward'", "'ICU'", "'Patient Chart'", "'Records'", "'Administration'"]
pin(labels.length >= 7 && wantLabels.every((w, i) => labels[i] === w),
  `NavSidebar.tsx: the group sequence is no longer [Home(null) · Patient Flow · Ward · ICU · Patient Chart · Records · Administration] — got [${labels.join(' · ')}]`)
pin(!labels.includes("'OR'"),
  'NavSidebar.tsx: an OR group is declared — no OR implementation exists; an empty group is module advertising')
pin(/label:\s*'Ward',\s*ownership:\s*'module',\s*rows:\s*\[\s*\]/.test(model),
  'NavSidebar.tsx: the Ward group is no longer declared EMPTY — no standalone ward-owned nav screen exists (awaiting-bed is shared Patient Flow; the Wards vocabulary is Configuration)')

/* per-group membership, in order */
function groupSlice(label) {
  const i = model.indexOf(`label: '${label}'`)
  if (i < 0) return null
  const rest = model.slice(i)
  const nexts = wantLabels
    .map(w => w === 'null' ? -1 : rest.indexOf(`label: ${w}`, 10))
    .filter(x => x > 0)
  const end = nexts.length ? Math.min(...nexts) : rest.indexOf('\n]\n')
  return rest.slice(0, end > 0 ? end : undefined)
}
function keysOf(slice) {
  return slice ? [...slice.matchAll(/key:\s*'([a-z]+)'/g)].map(m => m[1]) : []
}
const expectRows = {
  'Patient Flow': ['reception', 'awaiting', 'discharges'],
  ICU: ['icuoverview', 'beds', 'admissions', 'statistics'],
  'Patient Chart': ['observations', 'orders', 'labs', 'labentry', 'timeline', 'ai', 'alerts'],
  Records: ['discharged', 'print'],
  Administration: ['adminhome', 'users', 'backup', 'formulary', 'labcatalog', 'ordersets', 'config', 'settings'],
}
for (const [g, want] of Object.entries(expectRows)) {
  const got = keysOf(groupSlice(g))
  pin(got.join(',') === want.join(','),
    `NavSidebar.tsx: the ${g} group's rows are no longer [${want.join(' · ')}] — got [${got.join(' · ')}] (GROUP BY OWNERSHIP, design §1.1)`)
}

/* ---------- 3 · the Bed Admission authority boundary (design §3) ---------- */
const icuSlice = groupSlice('ICU') ?? ''
const bedAdm = /key:\s*'admissions',\s*label:\s*'([^']*)',\s*icon:\s*<(\w+)[^>]*>,\s*to:\s*'\/admissions',\s*perm:\s*'([^']*)'/.exec(icuSlice)
pin(!!bedAdm, "NavSidebar.tsx: the Bed Admission row (key 'admissions') lost its expected shape in the ICU group")
if (bedAdm) {
  pin(bedAdm[1] === 'Bed Admission',
    `NavSidebar.tsx: the /admissions nav row is labelled '${bedAdm[1]}', not 'Bed Admission' — the by-BED discriminator vs Reception (design §3)`)
  pin(bedAdm[3] === 'adt.admit',
    `NavSidebar.tsx: Bed Admission's nav row is gated on '${bedAdm[3]}', not 'adt.admit' — the office Administrator (no adt.admit) would SEE an admission entry it cannot use: the exact duplicate-entries defect the owner found (design §3)`)
}
const reception = /key:\s*'reception',\s*label:\s*'([^']*)',\s*icon:\s*<(\w+)[^>]*>,\s*to:\s*'\/reception',\s*perm:\s*'([^']*)'/.exec(model)
pin(!!reception, 'NavSidebar.tsx: the Reception row lost its expected shape')
if (reception) {
  pin(reception[3] === 'admissions.create',
    `NavSidebar.tsx: Reception's nav row is gated on '${reception[3]}', not 'admissions.create'`)
  if (bedAdm) pin(reception[2] !== bedAdm[2],
    `NavSidebar.tsx: Reception and Bed Admission share the icon <${reception[2]}> — the same-icon adjacency was the owner's finding 3; the two entries must be visibly distinct`)
}

/* the shared visibility filter: empty groups render nothing, and Home
   consumes the SAME model (no second nav truth to drift) */
pin(/\.filter\(g => g\.rows\.length > 0\)/.test(nav),
  'NavSidebar.tsx: visibleGroupsFor no longer drops zero-visible-row groups — an empty Ward/OR header would render (design §1.2)')
const home = read('src/pages/Home/Home.tsx', 1200, 'the hospital Home')
pin(/visibleGroupsFor\(/.test(home),
  'Home.tsx: the hospital Home no longer renders from visibleGroupsFor — Home and the sidebar must share the ONE ownership model')

/* ---------- 4 · the RBAC conjunction the boundary rests on ---------- */
const session = read('src/lib/session.ts', 4000, 'the RBAC derivation')
const adminBlock = /(^|\n)\s{2}Administrator:\s*\[([^\]]*)\]/.exec(session)
pin(!!adminBlock, "session.ts: the office Administrator profile's permission set could not be found — the gate's anchor drifted; fix the gate, never delete the check")
if (adminBlock) {
  pin(!adminBlock[2].includes("'adt.admit'"),
    'session.ts: the office Administrator profile now holds adt.admit — Bed Admission would appear on the reception desk’s sidebar (the authority boundary this shell exists to keep)')
  pin(adminBlock[2].includes("'admissions.create'"),
    'session.ts: the office Administrator profile lost admissions.create — the desk would lose its Reception row')
}
const doctorBlock = /(^|\n)\s{2}Doctor:\s*\[([^\]]*)\]/.exec(session)
const seniorBlock = /SeniorDoctor:\s*\[([^\]]*)\]/.exec(session)
pin(!!doctorBlock && doctorBlock[2].includes("'adt.admit'"),
  'session.ts: the Doctor profile no longer holds adt.admit — Bed Admission would vanish for the profile that admits')
pin(!!seniorBlock && seniorBlock[1].includes("'adt.admit'"),
  'session.ts: the SeniorDoctor profile no longer holds adt.admit — Bed Admission would vanish for the profile that admits')

/* ---------- 5 · routes: settled authorities, the Home landing ---------- */
const app = read('src/App.tsx', 2000, 'the route table')
pin(/path="\/admissions"[\s\S]{0,120}?permission="patients\.view"/.test(app),
  'App.tsx: the /admissions ROUTE gate is no longer patients.view — Decision C (honest read-only deep links) says the route is NOT tightened when the nav row is')
pin(/path="\/reception"[\s\S]{0,120}?permission="admissions\.create"/.test(app),
  'App.tsx: the /reception route gate is no longer admissions.create')
pin(/path="\/home" element=\{<RequireSession><Home \/>/.test(app),
  'App.tsx: the /home route is gone or gained a permission — the hospital Home is session-only (a launch surface; every linked area keeps its own gate)')
pin(/session \? '\/home' : '\/login'/.test(app),
  "App.tsx: '/' no longer lands on the hospital Home — the default landing must be hospital-wide, never a module screen (A3)")
const login = read('src/pages/Login/Login.tsx', 3000, 'the login screen')
pin(/signIn\(name, jobTitle, token\)[\s\S]{0,400}?navigate\('\/home'\)/.test(login),
  "Login.tsx: sign-in no longer lands on '/home' — the post-login landing must be the hospital Home for every profile (A3)")

if (failures.length > 0) {
  console.log('FAIL - the hospital shell is no longer intact:')
  for (const f of failures) console.log(`         ${f}`)
  console.log('       If any of this changed deliberately, it is a design change:')
  console.log('       hospital-shell.md §§1/3 + A3 and this gate move together.')
  process.exit(1)
}

console.log('confirmed: Aurora HIS identity on all four shell surfaces; ownership groups [Patient Flow · Ward(empty) · ICU · Patient Chart · Records · Administration] with OR undeclared; Bed Admission labelled + adt.admit-gated with a distinct icon while /admissions stays patients.view; the office profile holds admissions.create and not adt.admit; / and sign-in land on /home (SOURCE check: this does not render the sidebar)')
process.exit(0)
