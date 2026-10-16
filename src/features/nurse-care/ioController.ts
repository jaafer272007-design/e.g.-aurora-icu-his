import { recordIoSnapshot, type IoSnapshotDraft, type IoWriteResult } from '../../lib/api'
import type { JobTitle } from '../../lib/session'

/* ---------------- I&O SAVE GUARD (contract §5 + Amendment 1 §9.3) ----------------
   The I&O panel's only shared state: which patient + admission has a save in
   flight. It lives in the per-tab NurseCareProvider so the guard survives the
   panel unmounting and remounting (the workspace ⇄ chart route change, or a
   patient switch and back): a second save of the same admission cannot start
   while the first is unanswered. The values, outcome text and editor state stay
   in the panel, keyed by patient + admission. No automatic resend exists (an
   observation carries no attempt id): an unanswered save is reported as not
   confirmed and the nurse checks the history before entering again. */

export const ioKey = (patientId: string, encounterId: string) => `${patientId}|${encounterId}`

export interface IoDeps {
  record: typeof recordIoSnapshot
}

export class IoSaveGuard {
  private readonly deps: IoDeps
  private inFlight = new Set<string>()
  private listeners = new Set<() => void>()
  private version = 0

  constructor(deps: Partial<IoDeps> = {}) {
    this.deps = { record: recordIoSnapshot, ...deps }
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn)
    return () => { this.listeners.delete(fn) }
  }
  /** changes whenever a save starts or finishes (useSyncExternalStore) */
  getSnapshot = (): number => this.version
  private emit() {
    this.version++
    for (const fn of [...this.listeners]) fn()
  }

  isSaving = (patientId: string, encounterId: string): boolean => this.inFlight.has(ioKey(patientId, encounterId))

  /** one save per patient + admission at a time; null = refused here because
   *  one is already in flight (nothing sent) */
  async save(patientId: string, encounterId: string, draft: IoSnapshotDraft, jobTitle: JobTitle): Promise<IoWriteResult | null> {
    const key = ioKey(patientId, encounterId)
    if (this.inFlight.has(key)) return null
    this.inFlight.add(key)
    this.emit()
    try {
      return await this.deps.record(patientId, encounterId, draft, jobTitle)
    } finally {
      this.inFlight.delete(key)
      this.emit()
    }
  }
}
