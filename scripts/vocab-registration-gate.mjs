#!/usr/bin/env node
/*
  AURORA — the tenant-registration gate.

  WHAT IT FORBIDS, AND WHY IT EXISTS.

  server/Core/MasterData/VocabApi.cs maps every configurable vocabulary through
  ONE shared mapper, MapVocab(app, path, atom, noun, prefix, list, resolve,
  snapshot). Until 2026-08-09 the CREATE half of that mapper did not take a
  delegate like its three siblings — it switched on the `path` STRING and ended:

      _ => db.Shifts.Add(new ShiftRow { ... })

  So registering a NEW tenant without also editing that switch did not fail.
  It did something worse: every POST to the new vocabulary silently inserted a
  ShiftRow. Wrong table, right-looking 200, an entry that then appears in the
  shift picker and nowhere else. No exception, no test failure, no log line.

  That is the same false-green class this repo keeps finding the expensive way:
  a check that cannot fail, a default that cannot be seen. The fix is to make
  the row factory a REQUIRED parameter, so omitting it is a compile error
  rather than a silent write. This gate is the belt to that braces: it fails
  if the fallback shape ever comes back, in VocabApi.cs or anywhere else.

  THE RULE: no `_ => db.<Table>.Add(` anywhere in server/. A switch arm that
  picks a concrete table by default is guessing which table the caller meant,
  and guessing wrong is invisible.

  A legitimate factory names its table explicitly at its own registration site
  (`db.Shifts.Add(...)` inside the shifts factory is fine and expected) — it is
  only the DEFAULT ARM that is forbidden, because that is the one nobody chose.

  TEETH: this gate was written BEFORE the fix and run against the unfixed tree,
  where it failed on VocabApi.cs:183 — the real historical line, not a synthetic
  one. Re-run it against any commit before the fix and it fails again.

  Usage:  node scripts/vocab-registration-gate.mjs
  Exit 0 = clean, 1 = a forbidden fallback exists (or the scan found nothing to
  scan, which is treated as a failure — a gate that reads no files is a gate
  that cannot fail).
*/
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = 'server'
/* `_ =>` followed by a write to a concrete DbSet. Tolerates any spacing and
   any table name; deliberately does NOT tolerate a named arm, because naming
   the tenant IS the act of choosing. */
const FORBIDDEN = /_\s*=>\s*db\.[A-Za-z_][A-Za-z0-9_]*\.Add\s*\(/

function* csFiles(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) {
      /* generated EF artefacts are not hand-written registrations */
      if (entry === 'Migrations' || entry === 'bin' || entry === 'obj') continue
      yield* csFiles(path)
    } else if (entry.endsWith('.cs')) {
      yield path
    }
  }
}

/* COMMENTS ARE SKIPPED, INCLUDING /* ... *\/ BLOCKS, and that is load-bearing
   rather than a convenience. This codebase deliberately QUOTES the defect it
   removed, right above the fix — VocabApi.cs's own header now contains the
   literal `_ => db.Shifts.Add(new ShiftRow ...)` to explain what used to happen.
   A line-prefix check (`//` or `*`) is not enough: the repo's block comments are
   plain prose with no leading asterisk, so the first run of this gate after the
   fix flagged its own documentation. The same tension is already settled the
   same way in installer/test-update-exitcodes.ps1, whose psql lint skips comment
   lines "because the file deliberately quotes the old broken invocation".
   Silencing the prose instead would trade an explanation for a green. */
const offenders = []
let scanned = 0
let mapVocabCallSites = 0

function stripComments(src) {
  let out = ''
  let inBlock = false
  let inLine = false
  let inString = false
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    const next = src[i + 1]
    if (inBlock) {
      if (c === '*' && next === '/') { inBlock = false; i++ }
      out += c === '\n' ? '\n' : ' '
      continue
    }
    if (inLine) {
      if (c === '\n') { inLine = false; out += '\n' } else { out += ' ' }
      continue
    }
    if (inString) {
      if (c === '\\') { out += '  '; i++; continue }
      if (c === '"') inString = false
      out += c
      continue
    }
    if (c === '/' && next === '*') { inBlock = true; out += '  '; i++; continue }
    if (c === '/' && next === '/') { inLine = true; out += '  '; i++; continue }
    if (c === '"') { inString = true; out += c; continue }
    out += c
  }
  return out
}

for (const file of csFiles(ROOT)) {
  scanned++
  const raw = readFileSync(file, 'utf8')
  /* MapVocab references are counted on the RAW text (the definition and the
     call sites are code, and counting them is only a vacuity guard). The
     forbidden shape is matched on comment-stripped code only. */
  raw.split('\n').forEach(line => { if (/\bMapVocab\s*\(/.test(line)) mapVocabCallSites++ })
  stripComments(raw).split('\n').forEach((line, i) => {
    if (FORBIDDEN.test(line)) offenders.push(`${file}:${i + 1}: ${line.trim()}`)
  })
}

/* VACUITY GUARDS. A gate that silently scanned nothing looks identical to a
   gate that passed — the exact failure this file exists to prevent, so it must
   not commit it itself. */
let vacuous = false
if (scanned < 20) {
  console.log(`FAIL - only ${scanned} .cs file(s) scanned under ${ROOT}/; the scan is not reaching the server`)
  vacuous = true
}
if (mapVocabCallSites < 4) {
  /* 1 definition + at least 3 registrations */
  console.log(`FAIL - found ${mapVocabCallSites} MapVocab reference(s); expected the definition plus >=3 tenants. The mapper moved or was renamed and this gate is no longer looking at it.`)
  vacuous = true
}

if (offenders.length > 0) {
  console.log('FAIL - a tenant-create path falls back to a concrete table by default.')
  console.log('       A vocabulary registered without its own row factory would write to')
  console.log('       THAT table instead, returning 200 and corrupting a different list.')
  for (const o of offenders) console.log(`         ${o}`)
  console.log('       Fix: give the mapper a REQUIRED row-factory parameter so omitting')
  console.log('       one is a compile error, and delete the default arm.')
  process.exit(1)
}
if (vacuous) process.exit(1)

console.log(`confirmed: ${scanned} server .cs files scanned, ${mapVocabCallSites} MapVocab references, no default-arm table writes`)
process.exit(0)
