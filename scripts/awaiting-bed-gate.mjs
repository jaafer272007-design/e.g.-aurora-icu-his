#!/usr/bin/env node
/*
  AURORA — the Ward A2 awaiting-bed structural gate.

  WHAT IT PROTECTS. Ward design §3.1 is a PARTITION, enforced server-side
  from both directions (Ward PR A1): a BEDLESS encounter is assignment's to
  bed and transfer's to refuse; a BEDDED one is the reverse. The awaiting-bed
  screen (Ward PR A2) is the client of the assignment half, and the two
  client-side facts this gate pins are exactly the ones a well-meaning
  refactor would quietly undo:

    1. the awaiting-bed screen's action calls the ASSIGNMENT wrapper — never
       the transfer one. Rewiring it to transferEncounter would compile,
       render, and then 409 on every real use ("nothing to transfer from"),
       because the server enforces the partition regardless of the client.
    2. the list reads `bedless: true` — the A1 server filter whose MEANING
       is "open encounters with no bed assigned", both halves. Recomputing
       bedlessness client-side over an unfiltered read would silently
       reintroduce exactly the class of drift (closed day-case episodes on
       a worklist) the server filter exists to prevent.

  It also pins three smaller structural facts from the same PR: the API
  wrapper targets /assign-bed; the /awaiting-bed route is gated on
  beds.assign (design §6 — the two profiles that can act on a row); and the
  shared BedChip keeps its EXPLICIT bedless rendering (ward.md A5 — the
  one-fix-covers-ten-call-sites site), with the printed layout keeping its
  words ("awaiting bed") where a blank on paper would be ambiguous.

  🔴 WHAT THIS GATE DOES NOT PROVE. It reads SOURCE (comments stripped). It
  proves the wiring is PRESENT, not that it FIRES: nothing here renders the
  screen, clicks Assign, or awaits a server response. The behavioural proof
  for this PR was produced by a session-local rendered pass against the real
  built bundle (recorded in 02 with its evidence); the absence of a committed
  browser driver is a recorded gap (see the §3.2 gate's header), not a claim
  this gate quietly absorbs.

  TEETH: measured before commit, not asserted — each pinned fact was broken
  in turn in the working tree (action rewired to transferEncounter, the
  bedless filter dropped, the route atom widened, the BedChip empty branch
  removed) and the gate failed naming it.

  Usage:  node scripts/awaiting-bed-gate.mjs      Exit 0 = pinned, 1 = not.
*/
import { readFileSync } from 'node:fs'

/* same comment-stripper as the §3.2 gate, for the same reason: this repo
   EXPLAINS its rules in prose beside the code, and prose must never keep a
   gate green after the enforcement it describes is gone */
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

/* 1+2 — the screen: assignment wired, transfer absent, bedless read */
const screen = read('src/pages/AwaitingBed/AwaitingBed.tsx', 2000, 'the awaiting-bed screen')
pin(/\bassignBed\(/.test(screen),
  'AwaitingBed.tsx no longer calls assignBed( — the awaiting-bed action must be the A1 assignment endpoint')
pin(!/\btransferEncounter\b/.test(screen),
  'AwaitingBed.tsx references transferEncounter — assignment is NOT a transfer (design §3.1); the server will 409 every use')
pin(/bedless:\s*true/.test(screen),
  'AwaitingBed.tsx no longer reads { bedless: true } — the list must use the A1 server filter, never a client-side recomputation')

/* 3 — the wrapper targets the assignment path */
const api = read('src/lib/api/index.ts', 20000, 'the API layer')
const fnStart = api.indexOf('function assignBed')
pin(fnStart >= 0 && api.slice(fnStart, fnStart + 400).includes('/assign-bed'),
  'lib/api assignBed() no longer posts to /assign-bed')

/* 4 — the route is gated on the design-§6 atom */
const app = read('src/App.tsx', 2000, 'the route table')
pin(/path="\/awaiting-bed"[\s\S]{0,200}?permission="beds\.assign"/.test(app),
  'App.tsx: /awaiting-bed is not gated on beds.assign (design §6 — the two profiles that can act on a row)')

/* 5 — the shared bedless rendering and the printed words */
const tag = read('src/components/Tag.tsx', 500, 'the shared chips')
pin(/bedId === ''/.test(tag),
  "Tag.tsx BedChip lost its explicit bedless branch (bedId === '') — ~ten call sites regress to an empty chip at once (ward.md A5)")
const layout = read('src/pages/PrintCenter/PrintLayout.tsx', 500, 'the print layout')
pin(/bedId \|\| 'awaiting bed'/.test(layout),
  "PrintLayout.tsx no longer prints 'awaiting bed' in words — a blank bed field on paper is ambiguous (ward.md A5)")

if (failures.length > 0) {
  console.log('FAIL - the Ward A2 structural wiring is no longer intact:')
  for (const f of failures) console.log(`         ${f}`)
  console.log('       If any of this changed deliberately, it is a design change: ward.md')
  console.log('       §3.1/§6/A5 and this gate move together.')
  process.exit(1)
}

console.log('confirmed: awaiting-bed calls assignBed (never transfer) over the bedless=true read; /awaiting-bed costs beds.assign; BedChip + print layout keep their explicit bedless renderings (SOURCE check: this does not exercise the screen)')
process.exit(0)
