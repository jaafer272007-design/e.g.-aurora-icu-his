/* Pure, data-free domain logic that SCREENS consume via the service layer.
   Extracted from the mock data modules (§11 step 3): these helpers are
   real vocabulary/derivation rules — not demo data — and importing them
   THROUGH data/nursing.ts dragged the demo stores into the
   production bundle (bundle-inspection finding). Living here they are
   part of the real graph in every environment; the mock modules import
   them back, so there is still exactly one definition.
   (The AI risk helpers that lived here — AI_ALERT_THRESHOLD, riskTrendOf,
   isElevated — died with the simulated risk domain.) */

/* I&O category vocabulary (becomes master data at Layer 4) */
export const IO_CATEGORIES: Record<'intake' | 'output', string[]> = {
  intake: ['IV fluids', 'PO fluids', 'Medication infusions', 'Enteral feed', 'Blood products'],
  output: ['Urine', 'CRRT net removal', 'Drain', 'NG aspirate', 'Emesis', 'Stool'],
}
