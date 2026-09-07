import { useSyncExternalStore } from 'react'
import { apiHealthUrl } from './api'

/* INSTALL EDITION (owner's decision, 2026-09-06 — the ICU-only build).
   Between 2026-08-17 and 08-23 the hospital-direction "module 2" screens
   were built INTO this ICU app: Inpatient Reception (/reception), the
   awaiting-bed worklist (/awaiting-bed) and four reception vocabularies in
   Configuration (Admission Types, Departments, Services, Sources of
   Admission). The hospital exe must ship "only the ICU", so those screens
   exist only on the FULL edition. The SERVER decides (AURORA_EDITION →
   /healthz `edition`, server/Core/Shared/Edition.cs); this store reads it at
   RUNTIME from the one /healthz fetch EnvironmentGate already makes — never
   baked into the bundle — so one bundle serves both editions, and a hospital
   turns the ward screens on later by one line in aurora.env + a service
   restart, with no app update. Same shape as lib/aiAvailability.ts.

   What is NOT gated on the edition: the Wards section of Configuration (the
   ICU bed registry refuses a bed whose area is not a configured ward, so it
   is ICU configuration), the server's module-2 endpoints (not enforced — an
   authenticated API caller can still reach them), the data model, and the
   permission atoms (admissions.create is also what lets a doctor admit).

   States: 'pending' until /healthz answers — the module-2 items are NOT
   shown (hidden-until-reported: an ICU install never flashes them); 'full'
   when the server says "full" or reports NO edition (a server from before
   this field IS the full app — the only reading that is true of it); 'icu'
   on "icu", on any other value, and when the server cannot be reached
   (show less, not more). A pure-mock dev session (no API) keeps every
   screen, exactly as before. */

export type EditionState = 'pending' | 'icu' | 'full'

let state: EditionState = apiHealthUrl() === null ? 'full' : 'pending'
const listeners = new Set<() => void>()

function set(next: EditionState) {
  if (next === state) return
  state = next
  listeners.forEach(l => l())
}

/** Called by EnvironmentGate with the parsed /healthz body (null when the
 *  API was unreachable or answered non-JSON). */
export function recordEdition(health: unknown): void {
  if (health === null || typeof health !== 'object') { set('icu'); return }
  const v = (health as { edition?: unknown }).edition
  if (v === undefined) { set('full'); return }
  set(v === 'full' ? 'full' : 'icu')
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }
const snapshot = () => state

/** live view of the edition — re-renders when /healthz answers */
export function useEdition(): EditionState {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}
