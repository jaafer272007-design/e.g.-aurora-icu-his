import { useEffect, useRef, useState } from 'react'
import { getPatientOrdersAuthoritative, implementNursingOrder } from '../../lib/api'
import type { Order } from '../../lib/api/types'
import {
  displayNursingTime, localizeNursingStamps, newNursingAttemptId, nursingStampOf, settleNursingAttempt,
  type NursingPendingAttempt,
} from '../../lib/nursingRounds'
import type { JobTitle } from '../../lib/session'

/* The Order List's nursing Done (contracts §3.6 + Amendment 1 §9.2), kept
   in PAGE MEMORY (Orders to Implement persists its own; the server's round
   identity makes a duplicate completion impossible either way).
   - one attempt per deliberate Done; an immediate per-order guard;
   - FIRST send: ok → recorded; a refusal → the only request was refused
     (shown, not recorded); no answer → UNCONFIRMED;
   - a RETRY of an unconfirmed attempt re-sends the same { roundId,
     attemptId }; a refusal of it (401 included) is SHOWN but settles
     nothing — the original may still commit;
   - settlement only from an authoritative per-patient order read
     (settleNursingAttempt), applied in the order reads started; a read
     older than one already applied is discarded whole. */

/** re-read cadence while anything awaits the record */
const RECHECK_MS = 5_000

interface Lock {
  phase: 'saving' | 'settling' | 'unconfirmed'
  attempt: NursingPendingAttempt
  /** 'settling' is released by a read of this patient started after this */
  afterSeq: number
}

export interface NursingDoneBusy {
  phase: 'saving' | 'checking' | 'unconfirmed'
}

export function useNursingDone(opts: {
  actor: string
  jobTitle: JobTitle
  /** the patient on screen — its authoritative read also refreshes the list */
  patientId: string
  onOrders: (patientId: string, orders: Order[]) => void
  showToast: (title: string, body: string, ms?: number) => void
}) {
  const optsRef = useRef(opts)
  optsRef.current = opts
  const locks = useRef(new Map<string, Lock>())
  /* per patient: reads started / the newest applied */
  const seq = useRef(new Map<string, { started: number; applied: number }>())
  const [busy, setBusy] = useState<ReadonlyMap<string, NursingDoneBusy>>(new Map())
  const [notices, setNotices] = useState<Record<string, string>>({})

  const sync = () => setBusy(new Map([...locks.current].map(([id, l]) =>
    [id, { phase: l.phase === 'settling' ? 'checking' : l.phase }] as const)))
  const setNotice = (orderId: string, text: string | null) => setNotices(prev => {
    const next = { ...prev }
    if (text === null) delete next[orderId]; else next[orderId] = text
    return next
  })
  const seqOf = (pid: string) => {
    let s = seq.current.get(pid)
    if (!s) { s = { started: 0, applied: 0 }; seq.current.set(pid, s) }
    return s
  }

  const settle = (pid: string, readSeq: number, orders: Order[]) => {
    let changed = false
    for (const [orderId, l] of locks.current) {
      if (l.attempt.patientId !== pid || l.phase === 'saving') continue
      if (l.phase === 'settling') {
        if (readSeq > l.afterSeq) { locks.current.delete(orderId); changed = true }
        continue
      }
      const verdict = settleNursingAttempt(l.attempt, orders)
      if (verdict.kind === 'confirmed') {
        locks.current.delete(orderId); changed = true
        setNotice(orderId, null)
        optsRef.current.showToast('Saved — confirmed',
          `${l.attempt.label}: done at ${displayNursingTime(verdict.completion.completedTime)} is on the record`)
      } else if (verdict.kind === 'not-saved') {
        locks.current.delete(orderId); changed = true
        optsRef.current.showToast('Completion NOT saved', `${l.attempt.label}: ${verdict.reason}`, 6000)
        setNotice(orderId, `Not saved — ${verdict.reason}.`)
      }
      /* otherwise unconfirmed: an absent completion is not proof */
    }
    if (changed) sync()
  }

  /** start an authoritative read of one patient's orders now */
  const refresh = async (pid: string) => {
    const s = seqOf(pid)
    const mine = ++s.started
    const orders = await getPatientOrdersAuthoritative(pid)
    if (!orders || mine <= s.applied) return   // unreadable (locks stay) or stale (discarded whole)
    s.applied = mine
    if (pid === optsRef.current.patientId) optsRef.current.onOrders(pid, orders)
    settle(pid, mine, orders)
  }

  const send = async (a: NursingPendingAttempt, retry: boolean) => {
    const lock: Lock = { phase: 'saving', attempt: a, afterSeq: Infinity }
    locks.current.set(a.orderId, lock)
    setNotice(a.orderId, null)
    sync()
    const { actor, jobTitle, showToast } = optsRef.current
    const res = await implementNursingOrder(a.orderId, actor, jobTitle, { roundId: a.roundId, attemptId: a.attemptId })
    if (locks.current.get(a.orderId) !== lock) return
    if (res.kind === 'ok') {
      const done = res.order.nursing?.completions.find(c => c.attemptId === a.attemptId)
      showToast(retry ? 'Saved — confirmed' : 'Done', `${a.label}${done ? ` · ${displayNursingTime(done.completedTime)}` : ''}`)
      lock.phase = 'settling'
    } else if (res.kind === 'rejected' && !retry) {
      /* the first and only request was refused — nothing was recorded */
      const why = localizeNursingStamps(res.error)
      showToast('Completion NOT recorded', `${a.label}: ${why}`, 6000)
      setNotice(a.orderId, `Not recorded — ${why}`)
      lock.phase = 'settling'
    } else if (res.kind === 'rejected') {
      /* a refused RETRY proves nothing about the original — keep it */
      const why = res.status === 401
        ? 'your session has expired — sign in again, then retry saving'
        : localizeNursingStamps(res.error)
      lock.phase = 'unconfirmed'
      showToast('Save still not confirmed', `${a.label}: ${why}. Your completion is kept and may already be on the record.`, 8000)
      setNotice(a.orderId, `Not confirmed — ${why}.`)
    } else {
      lock.phase = 'unconfirmed'
      showToast('Save not confirmed',
        `${a.label}: ${res.error} — your completion is kept and may already be on the record. `
        + 'It is confirmed from the server\'s record; "Retry saving" re-sends the same completion and can never record it twice.', 8000)
    }
    lock.afterSeq = seqOf(a.patientId).started
    sync()
    await refresh(a.patientId)
  }

  /** Done on the order's CURRENT round (the caller checked it is open) */
  const done = (order: Order) => {
    const round = order.nursing?.currentRound
    if (!round || locks.current.has(order.orderId)) return   // immediate guard
    void send({
      attemptId: newNursingAttemptId(), orderId: order.orderId, patientId: order.patientId,
      roundId: round.roundId, label: `${order.summary} · round ${round.number}`,
      clickedAt: nursingStampOf(Date.now()),
    }, false)
  }

  /** "Retry saving": the SAME attempt again — only while it is unconfirmed */
  const retry = (orderId: string) => {
    const l = locks.current.get(orderId)
    if (l?.phase === 'unconfirmed') void send(l.attempt, true)
  }

  /* while anything awaits the record, re-read every patient involved */
  const waiting = [...busy.values()].some(b => b.phase !== 'saving')
  useEffect(() => {
    if (!waiting) return
    const t = window.setInterval(() => {
      const pids = new Set([...locks.current.values()].filter(l => l.phase !== 'saving').map(l => l.attempt.patientId))
      for (const pid of pids) void refresh(pid)
    }, RECHECK_MS)
    return () => window.clearInterval(t)
  }, [waiting])

  return { busy, notices, done, retry }
}
