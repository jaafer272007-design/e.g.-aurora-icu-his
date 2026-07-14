import { useEffect } from 'react'

/* Persistent patient context — the cross-section "current patient".
   The user picks a patient once and the selection FOLLOWS them through the
   nav sidebar (Orders → Labs → Observations → …) instead of resetting to
   the first patient on every section switch.

   Disciplines (per the recorded assessment):
   - The URL route param stays the SOURCE OF TRUTH — deep links, bookmarks
     and print links are untouched. This module is only the NAVIGATION
     DEFAULT the sidebar and the bare-path fallbacks read.
   - Tab-scoped sessionStorage (the session-store discipline): two tabs are
     two independent patient contexts, deliberately.
   - Cleared on sign-out (src/lib/session.ts) so a role switch in the same
     tab never inherits the previous user's patient context.
   - HONEST FALLBACK: a screen only uses the remembered patient when that
     patient is in ITS OWN list; otherwise it falls back to its normal
     default (locked not-found discipline — never silently show a different
     patient as if it were the remembered one). A remembered patient who is
     no longer resolvable renders the screen's explicit not-found state
     (never a redirect to another record) with the patient rail one click
     away; the next pick overwrites the memory. */

const KEY = 'aurora.lastPatient'

export function rememberPatient(patientId: string): void {
  try { sessionStorage.setItem(KEY, patientId) } catch { /* storage unavailable — context simply doesn't persist */ }
}

export function lastPatientId(): string | null {
  try { return sessionStorage.getItem(KEY) } catch { return null }
}

export function clearLastPatient(): void {
  try { sessionStorage.removeItem(KEY) } catch { /* nothing to clear */ }
}

/** the bare-path default for a screen: the remembered patient IF this
 *  screen's own list contains them, else the screen's normal first-patient
 *  default (never a patient the screen doesn't list) */
export function defaultPatientId(patients: { patientId: string }[]): string | undefined {
  const remembered = lastPatientId()
  if (remembered && patients.some(p => p.patientId === remembered)) return remembered
  return patients[0]?.patientId
}

/** record the route's patient as the cross-section context — only once the
 *  screen's own list confirms the id resolves (a mistyped deep-link id is
 *  never remembered) */
export function useRememberPatient(
  patientId: string,
  patients: { patientId: string }[] | null | undefined,
): void {
  useEffect(() => {
    if (patientId && patients?.some(p => p.patientId === patientId)) rememberPatient(patientId)
  }, [patientId, patients])
}
