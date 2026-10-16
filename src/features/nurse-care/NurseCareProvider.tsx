import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { Toast, useToast } from '../../components/Toast'
import { MarController, type MarBusy, type ToastSink } from './marController'
import { NursingRoundsController, type NursingBusy } from './nursingController'
import { IoSaveGuard } from './ioController'
import type { MarRow, Order } from '../../lib/api/types'

/* ---------------- NURSE-CARE PROVIDER (contract §4 invariant 1, §6) ----------------
   ONE instance per browser tab, mounted by App.tsx inside <BrowserRouter> and
   outside <Routes>: the MAR controller, the nursing-round (Orders to Implement)
   controller and the I&O save guard outlive route changes between /nurse and
   /patients/:id, patient switching and either screen's unmounting. Nurse
   Workspace and PatientNurseCarePanel consume it; neither owns a lock.
   Outcome toasts are shown while a consumer is mounted (the per-order notices
   stay with the order either way). The controllers follow the signed-in nurse:
   every route change re-reads the session. */

export interface NurseCare {
  mar: MarController
  nursing: NursingRoundsController
  io: IoSaveGuard
  /** the shared toast — delivered while a nurse-care consumer is mounted */
  showToast: ToastSink
  /** mount bookkeeping for toast delivery; returns the release */
  addConsumer: () => () => void
}

const Ctx = createContext<NurseCare | null>(null)

export function NurseCareProvider({ children }: { children: ReactNode }) {
  const { toast, showToast } = useToast()
  const [consumers, setConsumers] = useState(0)
  const care = useMemo<NurseCare>(() => {
    let mounted = 0
    const sink: ToastSink = (title, text, ms) => { if (mounted > 0) showToast(title, text, ms) }
    const mar = new MarController()
    const nursing = new NursingRoundsController()
    mar.toast = sink
    nursing.toast = sink
    return {
      mar, nursing, io: new IoSaveGuard(), showToast: sink,
      addConsumer: () => {
        setConsumers(++mounted)
        return () => setConsumers(--mounted)
      },
    }
  }, [showToast])

  const location = useLocation()
  useEffect(() => {
    care.mar.syncSession()
    care.nursing.syncSession()
  }, [care, location])
  useEffect(() => {
    care.mar.resume()
    care.nursing.resume()
    return () => { care.mar.dispose(); care.nursing.dispose() }
  }, [care])

  return (
    <Ctx.Provider value={care}>
      {children}
      {consumers > 0 && <Toast state={toast} accent="green" />}
    </Ctx.Provider>
  )
}

export function useNurseCare(): NurseCare {
  const care = useContext(Ctx)
  if (!care) throw new Error('useNurseCare outside <NurseCareProvider> (App.tsx mounts it inside the router)')
  return care
}

/** count this component as a mounted consumer (outcome toasts are shown meanwhile) */
export function useNurseCareConsumer(): NurseCare {
  const care = useNurseCare()
  useEffect(() => care.addConsumer(), [care])
  return care
}

/* one screen's registration with a controller: its patients scope the reads,
   and only a read STARTED after it registered (or changed patients) is shown */
interface Registration { token: number; key: string; minSeq: number }
interface Registrar {
  registerView(ids: readonly string[]): number
  unregisterView(token: number): void
  startedSeq(): number
  refresh(): Promise<void>
}
function useRegistration(ctrl: Registrar, patientIds: readonly string[] | null, tick: number) {
  const key = patientIds ? patientIds.join(',') : null
  const [reg, setReg] = useState<Registration | null>(null)
  useEffect(() => {
    if (key === null) return
    const ids = key === '' ? [] : key.split(',')
    const minSeq = ctrl.startedSeq()
    const token = ctrl.registerView(ids)
    setReg({ token, key, minSeq })
    return () => ctrl.unregisterView(token)
  }, [ctrl, key])
  const current = reg !== null && reg.key === key ? reg : null
  useEffect(() => {
    if (current) void ctrl.refresh()
  }, [ctrl, current, tick])
  const ids = useMemo(() => new Set(key ? key.split(',') : []), [key])
  return { current, ids }
}

/** a screen's MAR view: its patients' rows from a read started after it asked
 *  (null = loading — after a patient switch nothing of the previous patient
 *  shows), the shared busy/notice state and the actions. Reads happen on
 *  `tick` (the shared poll) and whenever `patientIds` changes. */
export function useMarView(patientIds: readonly string[] | null, tick: number) {
  const { mar } = useNurseCareConsumer()
  const snap = useSyncExternalStore(mar.subscribe, mar.getSnapshot)
  const { current, ids } = useRegistration(mar, patientIds, tick)
  const ready = current !== null && snap.seq > current.minSeq && [...ids].every(id => snap.covered.has(id))
  const rows: MarRow[] | null = ready ? snap.rows.filter(r => ids.has(r.patientId)) : null
  return {
    rows,
    at: ready ? snap.at : null,
    busy: snap.busy as ReadonlyMap<string, MarBusy>,
    notices: snap.notices,
    document: (row: MarRow, action: Parameters<MarController['document']>[1], label: string, reason?: string, administeredAt?: string) =>
      mar.document(row, action, label, reason, administeredAt),
    retry: (orderId: string) => mar.retry(orderId),
  }
}

/** the Orders to Implement view (Nurse Workspace): the queue for its patients */
export function useNursingQueue(patientIds: readonly string[] | null, tick: number) {
  const { nursing } = useNurseCareConsumer()
  const snap = useSyncExternalStore(nursing.subscribe, nursing.getSnapshot)
  const { current, ids } = useRegistration(nursing, patientIds, tick)
  const ready = current !== null && snap.orders !== null && snap.seq > current.minSeq
  const orders: Order[] | null = ready ? snap.orders!.filter(o => ids.has(o.patientId)) : null
  return {
    orders,
    at: ready ? snap.at : null,
    busy: snap.busy as ReadonlyMap<string, NursingBusy>,
    notices: snap.notices,
    done: (order: Order, label: string) => nursing.done(order, label),
    retry: (orderId: string) => nursing.retry(orderId),
  }
}

/** whether the I&O save guard holds this patient + admission */
export function useIoSaving(patientId: string, encounterId: string | null): boolean {
  const { io } = useNurseCare()
  useSyncExternalStore(io.subscribe, io.getSnapshot)
  return encounterId !== null && io.isSaving(patientId, encounterId)
}
