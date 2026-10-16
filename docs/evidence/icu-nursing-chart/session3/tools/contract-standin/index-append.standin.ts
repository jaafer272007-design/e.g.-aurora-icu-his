
/* [SESSION-3 CONTRACT STAND-IN — appended to a SCRATCH copy of src/lib/api/index.ts only;
   contract §3.5, §5.3 and Amendment 1 §9.2/§9.3. Session 1 owns the real adapters and mock
   parity; this exists only so Session 3's branch can be type-checked and driven before
   Session 1's branch exists.] */
export * from './ioSnapshots'
import { deriveIoView as standinDeriveIoView, IO_INTAKE_TYPE as STANDIN_IN, IO_OUTPUT_TYPE as STANDIN_OUT, IO_SNAPSHOT_MAX_ML as STANDIN_MAX } from './ioSnapshots'
import type { IoRead as StandinIoRead, IoSnapshotDraft as StandinIoDraft, IoWriteResult as StandinIoWrite } from './ioSnapshots'
import type { NursingImplementRequest as StandinNIR } from './types'

export type NursingWriteResult =
  | { kind: 'ok'; order: Order }
  | { kind: 'rejected'; error: string; status?: number }
  | { kind: 'uncertain'; error: string }

const standinMockImplement = (orderId: string, actor: string, request?: StandinNIR): NursingWriteResult => {
  const o = allOrders().find(x => x.orderId === orderId)
  if (!o) return { kind: 'rejected', error: 'order not found', status: 404 }
  if (!o.nursing) {
    if (request) return { kind: 'rejected', error: 'this order has no rounds', status: 400 }
    const r = applyImplementation(orderId, actor)
    return r ? { kind: 'ok', order: r } : { kind: 'rejected', error: 'order already completed', status: 409 }
  }
  if (request && o.nursing.completions.some(c => c.attemptId === request.attemptId))
    return o.nursing.completions.find(c => c.attemptId === request.attemptId)!.roundId === request.roundId
      ? { kind: 'ok', order: o } : { kind: 'rejected', error: 'attempt id reused for another round', status: 409 }
  if (o.nursing.intervalMinutes !== undefined && !request) return { kind: 'rejected', error: 'a repeating nursing order needs roundId + attemptId', status: 400 }
  if (o.status !== 'active' || !o.nursing.currentRound) return { kind: 'rejected', error: `order is ${o.status}`, status: 409 }
  const cur = o.nursing.currentRound
  if (request && request.roundId !== cur.roundId) return { kind: 'rejected', error: 'not the current round', status: 409 }
  const now = Math.ceil(Date.now())
  if (now < Date.parse(cur.dueTime)) return { kind: 'rejected', error: `not due yet — opens at ${cur.dueTime}`, status: 409 }
  const completedTime = new Date(now).toISOString()
  o.nursing.completions.push({ round: cur.number, roundId: cur.roundId, dueTime: cur.dueTime, completedTime, completedBy: actor, ...(request ? { attemptId: request.attemptId } : {}) })
  o.history.push({ time: nowHm(), actor, action: 'implemented', ...(o.nursing.intervalMinutes !== undefined ? { detail: `round ${cur.number}` } : {}) })
  if (o.nursing.intervalMinutes === undefined) {
    o.status = 'completed'; o.history.push({ time: nowHm(), actor, action: 'completed' }); delete o.nursing.currentRound
  } else {
    const due = new Date(now + o.nursing.intervalMinutes * 60_000).toISOString()
    o.nursing.currentRound = { roundId: `${due}~r${cur.number + 1}`, number: cur.number + 1, dueTime: due }
  }
  return { kind: 'ok', order: o }
}

export async function implementNursingOrder(
  orderId: string, actor: string, jobTitle: JobTitle, request?: StandinNIR,
): Promise<NursingWriteResult> {
  if (!hasPermission(jobTitle, 'orders.implement')) return respond({ kind: 'rejected', error: 'Insufficient permissions' }, 120)
  if (import.meta.env.VITE_APP_ENV !== 'production' && runtimeApiBase === null) return respond(standinMockImplement(orderId, actor, request), 120)
  await clockReady
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), API_TIMEOUT_MS)
    const res = await fetch(`${API_BASE}/api/icu/orders/${encodeURIComponent(orderId)}/implement`, {
      method: 'POST', signal: ctrl.signal,
      headers: { ...authHeaders(), ...(request ? { 'Content-Type': 'application/json' } : {}) },
      ...(request ? { body: JSON.stringify(request) } : {}),
    })
    clearTimeout(timer)
    if (res.ok) return { kind: 'ok', order: (await res.json()) as Order }
    if (res.status === 401) {
      if (import.meta.env.VITE_APP_ENV !== 'production' && !getToken()) return respond(standinMockImplement(orderId, actor, request), 120)
      return { kind: 'rejected', error: 'session expired — sign in again; nothing was recorded', status: 401 }
    }
    if (res.status >= 500) return { kind: 'uncertain', error: `the server failed (${res.status})` }
    const err = (await res.json().catch(() => null)) as { error?: string } | null
    return { kind: 'rejected', error: err?.error ?? `rejected (${res.status})`, status: res.status }
  } catch {
    return { kind: 'uncertain', error: 'the server did not answer' }
  }
}

export async function getPatientOrdersAuthoritative(patientId: string): Promise<Order[] | null> {
  if (import.meta.env.VITE_APP_ENV !== 'production' && runtimeApiBase === null) return respond(allOrders().filter(o => o.patientId === patientId), 120)
  return apiGet<Order[]>(`/api/icu/orders?patientId=${encodeURIComponent(patientId)}`, 'orders')
}

export async function getIoSnapshots(patientId: string): Promise<StandinIoRead> {
  if (import.meta.env.VITE_APP_ENV !== 'production' && runtimeApiBase === null)
    return { kind: 'unavailable', error: 'I&O needs the live server — not available in the offline demo', forbidden: false }
  const encs = await apiGet<Encounter[]>(`/api/icu/adt/encounters?patientId=${encodeURIComponent(patientId)}&status=open`, 'ADT encounters')
  if (!encs) { const forbidden = lastReadWasForbidden; return { kind: 'unavailable', error: forbidden ? 'you do not have access to this record' : 'the server is not reachable', forbidden } }
  const enc = encs.find(e => e.patientId === patientId && e.status === 'open')
  if (!enc) return { kind: 'no-open-encounter' }
  const read = (code: string) => apiGet<Observation[]>(
    `/api/icu/observations?patientId=${encodeURIComponent(patientId)}&encounterId=${encodeURIComponent(enc.encounterId)}&typeCode=${code}`, 'observations')
  const [a, b] = await Promise.all([read(STANDIN_IN), read(STANDIN_OUT)])
  if (!a || !b) { const forbidden = lastReadWasForbidden; return { kind: 'unavailable', error: forbidden ? 'you do not have access to this record' : 'the server is not reachable', forbidden } }
  return { kind: 'ok', view: standinDeriveIoView(patientId, enc.encounterId, [...a, ...b]) }
}

export async function recordIoSnapshot(
  patientId: string, encounterId: string, draft: StandinIoDraft, jobTitle: JobTitle,
): Promise<StandinIoWrite> {
  if (!hasPermission(jobTitle, 'observations.record')) return { kind: 'rejected', error: 'Insufficient permissions' }
  const entries = ([[STANDIN_IN, draft.intakeMl], [STANDIN_OUT, draft.outputMl]] as const)
    .filter(([, v]) => v !== undefined).map(([typeCode, value]) => ({ typeCode, value: value as number }))
  if (!entries.length || entries.some(e => !Number.isInteger(e.value) || e.value < 0 || e.value > STANDIN_MAX))
    return { kind: 'rejected', error: `enter whole mL from 0 to ${STANDIN_MAX}` }
  if (import.meta.env.VITE_APP_ENV !== 'production' && runtimeApiBase === null)
    return { kind: 'rejected', error: 'I&O needs the live server — nothing was saved' }
  await clockReady
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), API_TIMEOUT_MS)
    const res = await fetch(`${API_BASE}/api/icu/observations`, {
      method: 'POST', signal: ctrl.signal, headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ patientId, entries, expectedEncounterId: encounterId }),
    })
    clearTimeout(timer)
    if (res.ok) return { kind: 'ok', observations: (await res.json()) as Observation[] }
    if (res.status === 401) return { kind: 'rejected', error: 'session expired — sign in again; nothing was saved', status: 401 }
    if (res.status >= 500) return { kind: 'uncertain', error: `the server failed (${res.status})` }
    const err = (await res.json().catch(() => null)) as { error?: string } | null
    return { kind: 'rejected', error: err?.error ?? `rejected (${res.status})`, status: res.status }
  } catch {
    return { kind: 'uncertain', error: 'the server did not answer' }
  }
}
