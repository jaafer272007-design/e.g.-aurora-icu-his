import type { ClinicalNote } from '../types'

/* Minimal ClinicalNote store — see the model comment in types.ts: this is
   the one genuine gap the Timeline exposed (freeform notes not tied to any
   structured store action). Seeds carry over the previously hardcoded
   Mission Control timeline entries that had no structured source. */

const NOTES: ClinicalNote[] = [
  /* P-1001 · Ahmed Al-Saadi */
  {
    noteId: 'NOTE-9001', patientId: 'P-1001', kind: 'nursing', time: '08:55', author: 'RN M. Chen',
    text: 'Hourly urine output 25–30 mL; nephrology aware, foley patent.',
  },
  {
    noteId: 'NOTE-9002', patientId: 'P-1001', kind: 'vent', time: '08:10', author: 'RT D. Silva',
    text: 'PEEP increased 8 → 10 cmH₂O; FiO₂ weaned 60 → 55%.',
  },
  {
    noteId: 'NOTE-9003', patientId: 'P-1001', kind: 'progress', time: '00:45', author: 'Dr. N. Farouk (night)',
    text: 'Septic shock day 4 — slow pressor wean attempted, reversed at 00:30.',
  },
  {
    noteId: 'NOTE-9004', patientId: 'P-1001', kind: 'procedure', time: 'D-1 22:15', author: 'Dr. S. Rahman',
    text: 'Bedside ultrasound: IVC 1.8 cm, minimal collapse — volume replete.',
  },
  /* P-1004 · Susan Wright */
  {
    noteId: 'NOTE-9005', patientId: 'P-1004', kind: 'nursing', time: '09:15', author: 'RN M. Chen',
    text: 'CRRT running at 200 mL/h, access pressures stable; vascath site clean.',
  },
  /* P-1012 · Aisha Mahmoud */
  {
    noteId: 'NOTE-9006', patientId: 'P-1012', kind: 'procedure', time: '06:20', author: 'Dr. S. Rahman',
    text: 'Bedside paracentesis performed; 1.2 L straw-coloured fluid drained, samples to lab.',
  },
]

export const notesFor = (patientId: string): ClinicalNote[] =>
  NOTES.filter(n => n.patientId === patientId)
