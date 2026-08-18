#!/usr/bin/env node
/*
  AURORA — the §3.2 required-fields gate.

  WHAT IT PROTECTS, AND WHY A COMMENT WAS NOT ENOUGH.

  docs/design/inpatient-reception.md §3.2 marks five admission fields REQUIRED:
  Type of Admission, Department, Service, Admitting Doctor, and the admission
  date/time. The server does NOT enforce that — the owner's ruling (c),
  recorded in the design's Amendments and in 02's Known Feature Gaps. The
  reason is not laziness: production seeds NO departments (#199, deliberately),
  so shipping the columns required would make admission IMPOSSIBLE on the next
  update of a live install until somebody configured one — while /healthz still
  answered 200, so the health check passes and the updater does NOT roll back.
  A live-site outage delivered by an update, in the one failure mode the
  rollback machinery cannot catch.

  THE CONSEQUENCE is that src/pages/Reception/Reception.tsx's `formOk` gate is
  the ONLY place §3.2's required-ness is enforced anywhere in the product.
  Reception.tsx says so, at length, directly above the gate.

  A COMMENT IS ARGUED; THIS IS ENFORCED. That distinction is the one this
  project keeps making — "the ICU form still requires them client-side" was
  rejected as an argument for weakening a server rule precisely because a form
  is not a guarantee. The same standard applies to the form itself: a refactor
  that "simplifies" `formOk` would silently delete five required fields from
  the product, pass tsc, pass vite build, render fine, and be discovered by a
  hospital with an admission record that has no department on it.

  THE RULE: the expression assigned to `formOk` must reference the state behind
  all five §3.2 required fields. It may add conditions (it already adds
  identity, the referrer XOR, the blocked state and the RBAC atom); it may not
  drop one.

  RENAMING A FIELD FAILS THIS GATE. That is intended, not a defect: the rename
  is the moment to confirm the requirement is still meant, and updating the
  list below is the confirmation. A gate nobody ever has to look at is a gate
  nobody remembers is there.

  TEETH: run against a tree with any one of the five removed from `formOk` and
  it fails, naming the field. Verified that way before being committed, by
  deleting each of the five in turn — not by a synthetic string.

  Usage:  node scripts/reception-required-fields-gate.mjs
  Exit 0 = all five enforced, 1 = one is missing (or the scan found nothing to
  scan, which is a failure: a gate that reads no file cannot fail).
*/
import { readFileSync } from 'node:fs'

const FILE = 'src/pages/Reception/Reception.tsx'

/* field label (design §3.2) → the state identifier the form binds it to */
const REQUIRED = [
  ['Type of Admission', 'typeCode'],
  ['Department', 'deptCode'],
  ['Service', 'svcCode'],
  ['Admitting Doctor', 'doctorId'],
  ['Admission date/time', 'admittedAt'],
]

/* Comments are stripped before matching, for the same reason the vocab gate
   strips them: this file deliberately EXPLAINS the requirement in prose above
   the gate, naming the fields. Matching prose would let the enforcement be
   deleted while the explanation of it kept the gate green — the precise
   false-green shape both gates exist to prevent. */
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

let src
try {
  src = readFileSync(FILE, 'utf8')
} catch {
  console.log(`FAIL - ${FILE} is missing. The reception screen is the only enforcement of`)
  console.log('       design §3.2; if the screen is gone, so is the requirement.')
  process.exit(1)
}

const code = stripComments(src)

/* VACUITY GUARDS — a gate that scanned an empty or unrecognisable file must
   fail, never pass quietly. */
if (code.length < 2000) {
  console.log(`FAIL - ${FILE} is ${code.length} bytes of code; that is not the reception screen.`)
  process.exit(1)
}

/* The gate expression: from `const formOk =` to the end of that statement.
   Bounded by the next top-level `\n  ` + a statement keyword so a multi-line
   expression is captured whole (the real one spans three lines). */
const start = code.indexOf('const formOk')
if (start < 0) {
  console.log(`FAIL - no \`const formOk\` in ${FILE}.`)
  console.log('       The submit gate is the enforcement of design §3.2\'s five required')
  console.log('       fields. If it was renamed, rename it in this gate too — that edit is')
  console.log('       the confirmation that the requirement is still meant.')
  process.exit(1)
}
const rest = code.slice(start)
const end = rest.search(/\n\s*(?:const|let|function|return|\/\*|async)\b/)
const expr = end < 0 ? rest : rest.slice(0, end)

const missing = REQUIRED.filter(([, ident]) => !new RegExp(`\\b${ident}\\b`).test(expr))

if (missing.length > 0) {
  console.log('FAIL - the reception submit gate no longer requires every §3.2 field.')
  console.log('       THE SERVER DOES NOT ENFORCE THESE (the owner\'s ruling (c) — required')
  console.log('       columns would be a live-site outage delivered by an update). This form')
  console.log('       is the only place the requirement exists in the product, so removing a')
  console.log('       field here removes it from Aurora.')
  for (const [label, ident] of missing) console.log(`         missing: ${label}  (state \`${ident}\`)`)
  console.log('       If the requirement was genuinely lifted, that is a design decision:')
  console.log('       amend docs/design/inpatient-reception.md and this list together.')
  process.exit(1)
}

/* The gate must also still GATE something — an enforced expression wired to no
   button enforces nothing. */
if (!/disabled=\{!formOk/.test(code)) {
  console.log('FAIL - `formOk` is computed but the submit button is not disabled by it.')
  console.log(`       Found no \`disabled={!formOk\` in ${FILE}, so the five required fields`)
  console.log('       are checked and then ignored.')
  process.exit(1)
}

console.log(`confirmed: ${FILE} — all ${REQUIRED.length} of design §3.2's required fields are enforced by the submit gate`)
process.exit(0)
