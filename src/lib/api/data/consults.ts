import type { Consult } from '../types'

/* Shared consult store — extracted from the previously hardcoded Doctor
   Workspace list so consults exist once, keyed by patientId. Doctor
   Workspace's "Incoming Consults" and the Timeline read the same records.
   Replaced by the ASP.NET Core consults service at Stage 10. */

const CONSULTS: Consult[] = [
  {
    consultId: 'CON-8001', patientId: 'P-1004', bedId: 'B-04', patientName: 'Susan Wright',
    specialty: 'Nephrology', message: 'CRRT circuit clotting recurring, requests bedside review', time: '08:10',
  },
  {
    consultId: 'CON-8002', patientId: 'P-1012', bedId: 'B-13', patientName: 'Aisha Mahmoud',
    specialty: 'General Surgery', message: 'new fluid collection, considering drainage', time: '07:05',
  },
  {
    consultId: 'CON-8003', patientId: 'P-1001', bedId: 'B-01', patientName: 'Ahmed Al-Saadi',
    specialty: 'Infectious Disease', message: 'culture sensitivities back, de-escalation advice pending your ack', time: '06:40',
  },
]

export const allConsults = (): Consult[] => CONSULTS

export const consultsFor = (patientId: string): Consult[] =>
  CONSULTS.filter(c => c.patientId === patientId)
