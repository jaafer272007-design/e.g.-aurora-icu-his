#!/usr/bin/env node
/*
  AURORA — the no-AI-build structural gate (owner's decision, 2026-09-06).

  WHAT IT PROTECTS. A hospital install may not HAVE the AI Assistant: the
  installer writes AI_PROVIDER=none when the build carried no model (or the
  server has no GPU). Since 2026-09-06 such an install shows NO AI section —
  no "AI Assistant" nav entry, and the /ai routes redirect to the profile's
  landing view — instead of an entry whose screen answers with a 503. The
  decision is the SERVER's, reported at runtime on /healthz (`aiAssistant`),
  so one bundle serves both kinds of install and aurora-enable-ai.ps1 (flip
  AI_PROVIDER + restart) makes the section appear with no app update. The
  facts a well-meaning refactor would quietly undo:

    1. Program.cs derives /healthz `aiAssistant` from AiConfig.Provider ==
       "none" — the deliberate off switch, and ONLY that (a misconfigured
       provider stays visible so its error is seen, not hidden).
    2. lib/aiAvailability.ts shows the section ONLY on the literal "enabled"
       — an absent field, a "disabled", or an unreachable server all hide it.
    3. EnvironmentGate feeds BOTH outcomes of its /healthz fetch (answered,
       failed) to the store — the one fetch, two readers.
    4. NavSidebar's AI item carries `when: aiSection === 'shown'` and the
       filter honours `when` — a nav item hidden by permission alone would
       reappear for every ai.view holder on a no-AI install.
    5. App.tsx wraps BOTH /ai routes in RequireAiAssistant INSIDE the
       ai.view RequireSession — a bookmarked /ai on a no-AI install must not
       render the screen.
    6. RequireAiAssistant redirects on 'hidden' and renders nothing on
       'pending' — never the children.

  🔴 WHAT THIS GATE DOES NOT PROVE. It reads SOURCE (comments stripped) and
  proves the wiring is PRESENT, not that it FIRES: nothing here renders the
  sidebar against a stub /healthz. The behavioural proof for this PR was a
  session-local rendered pass against the built bundle with a stub API
  answering aiAssistant "disabled" and then "enabled" (recorded in 02).

  TEETH: measured before commit, not asserted — each pinned fact was broken
  in turn in a scratch copy (the healthz field removed; the store widened to
  show on any value; the nav `when` dropped; one /ai route unwrapped; the
  guard made to render its children on 'hidden') and the gate failed
  naming it.

  Usage:  node scripts/ai-section-gate.mjs      Exit 0 = pinned, 1 = not.
*/
import { readFileSync } from 'node:fs'

/* same comment-stripper as the other structural gates, for the same
   reason: this repo EXPLAINS its rules in prose beside the code, and prose
   must never keep a gate green after the enforcement it describes is gone */
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

/* 1 — the server reports the off switch, and only the off switch */
const program = read('server/Program.cs', 5000, 'the server bootstrap')
const healthz = program.indexOf('MapGet("/healthz"')
const healthzLine = healthz >= 0 ? program.slice(healthz, program.indexOf('\n', healthz)) : ''
pin(/aiAssistant\s*=\s*AiConfig\.Provider\s*==\s*"none"\s*\?\s*"disabled"\s*:\s*"enabled"/.test(healthzLine),
  'Program.cs /healthz no longer reports aiAssistant = AiConfig.Provider == "none" ? "disabled" : "enabled" — the frontend has nothing to decide the AI section on')

/* 2 — the store shows ONLY on the literal "enabled" */
const store = read('src/lib/aiAvailability.ts', 600, 'the AI-section store')
pin(/set\(\s*v\s*===\s*'enabled'\s*\?\s*'shown'\s*:\s*'hidden'\s*\)/.test(store),
  "aiAvailability.ts no longer maps exactly (v === 'enabled' ? 'shown' : 'hidden') — an absent field, a \"disabled\", or an unreachable server must all HIDE the section")
pin(/apiHealthUrl\(\)\s*===\s*null\s*\?\s*'shown'\s*:\s*'pending'/.test(store),
  "aiAvailability.ts initial state is no longer (no API → 'shown', else 'pending') — a no-AI install must never flash the section before /healthz answers")

/* 3 — the one healthz fetch feeds the store on BOTH outcomes */
const gate = read('src/components/EnvironmentChrome.tsx', 2000, 'the environment gate')
pin((gate.match(/recordAiAvailability\(/g) || []).length >= 2,
  'EnvironmentChrome.tsx calls recordAiAvailability fewer than twice — both the answered and the failed /healthz path must feed the AI-section store')
pin(/\.catch\(\s*\(\)\s*=>\s*\{\s*recordAiAvailability\(null\)/.test(gate),
  'EnvironmentChrome.tsx no longer records an unreachable /healthz as null — the AI section would stay pending (or flash) on a dead API')

/* 4 — the nav item is availability-gated, and the filter honours it */
const nav = read('src/components/NavSidebar.tsx', 3000, 'the primary navigation')
pin(/key:\s*'ai'[^\n]*when:\s*aiSection\s*===\s*'shown'/.test(nav),
  "NavSidebar.tsx AI item lost `when: aiSection === 'shown'` — every ai.view holder on a no-AI install gets an AI Assistant entry back")
pin(/it\.when\s*!==\s*false\s*&&/.test(nav),
  'NavSidebar.tsx filter no longer honours `it.when !== false` — the AI item would be shown by permission alone')
pin(/useAiSection\(\)/.test(nav),
  'NavSidebar.tsx no longer reads useAiSection() — the sidebar would not re-render when /healthz answers')

/* 5 — both /ai routes are inside the guard, inside the permission gate */
const app = read('src/App.tsx', 2000, 'the route table')
const aiRoutes = app.match(/<Route path="\/ai(?:\/:patientId)?"[^\n]*/g) || []
pin(aiRoutes.length === 2, `App.tsx has ${aiRoutes.length} /ai route(s), expected exactly 2 (/ai and /ai/:patientId)`)
for (const r of aiRoutes) {
  pin(/<RequireSession permission="ai\.view"><RequireAiAssistant><AiChat \/><\/RequireAiAssistant><\/RequireSession>/.test(r),
    `App.tsx route is not RequireSession(ai.view) > RequireAiAssistant > AiChat: ${r.trim().slice(0, 60)}…`)
}

/* 6 — the guard never renders its children on 'hidden' or 'pending' */
const guard = read('src/components/RequireAiAssistant.tsx', 400, 'the AI-section route guard')
pin(/if\s*\(\s*ai\s*===\s*'pending'\s*\)\s*return null/.test(guard),
  "RequireAiAssistant.tsx no longer renders null on 'pending' — it would guess before /healthz answers")
const hiddenAt = guard.indexOf("ai === 'hidden'")
pin(hiddenAt >= 0 && /<Navigate to=/.test(guard.slice(hiddenAt, hiddenAt + 300)),
  "RequireAiAssistant.tsx no longer redirects (<Navigate) on 'hidden' — a bookmarked /ai on a no-AI install would render the screen")
pin(!/return children/.test(guard.slice(0, hiddenAt >= 0 ? hiddenAt : 0)),
  "RequireAiAssistant.tsx returns children BEFORE the 'hidden' check — the guard is bypassed")

if (failures.length > 0) {
  console.log('FAIL - the no-AI-build AI-section wiring is no longer intact:')
  for (const f of failures) console.log(`         ${f}`)
  console.log('       If any of this changed deliberately, it is a product decision (2026-09-06,')
  console.log('       01_ARCHITECTURE.md AI section): the healthz field, the store, the nav,')
  console.log('       the routes and this gate move together.')
  process.exit(1)
}

console.log('confirmed: /healthz reports aiAssistant from AI_PROVIDER; the frontend shows the AI section ONLY on "enabled" (nav `when`, both /ai routes behind RequireAiAssistant, one healthz fetch feeding the store on both outcomes) (SOURCE check: this does not render the sidebar)')
process.exit(0)
