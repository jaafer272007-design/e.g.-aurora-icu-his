/* Code Status resolution — ONE resolver for every surface (the governed-
   vocabulary SAFETY FIX). A resuscitation instruction renders in exactly
   three honest states:
   - 'set'    — a governed vocabulary value (selected, never typed)
   - 'legacy' — preserved pre-vocabulary free text, UNVERIFIED until a
                clinician re-confirms it (never dropped, never guessed)
   - 'none'   — NOT RECORDED, an explicit unmistakable state — never a
                blank that could read as "Full Code", never a default
   Every screen that shows code status (bed card, Mission Control, nurse
   worklist, Orders patient bar, print documents) resolves through this
   function so the three states cannot drift apart. */

export interface CodeStatusView {
  kind: 'set' | 'legacy' | 'none'
  /** display text: the governed label, the legacy text, or 'Not recorded' */
  label: string
  /** true when the value styles as a full-resuscitation status (display
   *  hint only — derived from the governed CODE when present, never from
   *  string prefixes of free text) */
  full: boolean
}

export function resolveCodeStatus(p: {
  codeStatus: string
  codeStatusCode?: string | null
  codeStatusLegacy?: boolean
}): CodeStatusView {
  if (p.codeStatusCode) {
    return { kind: 'set', label: p.codeStatus, full: p.codeStatusCode === 'full_code' }
  }
  if (p.codeStatus.trim().length > 0) {
    /* a value without a governed code is preserved free text — LEGACY /
       UNVERIFIED until a clinician re-confirms it into the vocabulary
       (the mock demo records carry codes, so this state only appears on
       genuinely un-migrated data) */
    return { kind: 'legacy', label: p.codeStatus, full: false }
  }
  return { kind: 'none', label: 'Not recorded', full: false }
}
