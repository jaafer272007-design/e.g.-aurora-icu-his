import { useEffect, useRef, useState } from 'react'
import { Card } from '../../components/Card'
import { Badge, type BadgeColor } from '../../components/Badge'
import { agoLabel, clockZone, displayFullStamp, displayStamp, useNow, wireStampOfLocal } from '../../lib/time'
import type { CorrectImagingDraft, ImagingStatus, ImagingStudy, Order, ResultFlag } from '../../lib/api/types'

const STATUS_STEPS: ImagingStatus[] = ['ordered', 'in-progress', 'preliminary', 'final']
const STATUS_LABEL: Record<ImagingStatus, string> = {
  ordered: 'Ordered', 'in-progress': 'In progress', preliminary: 'Preliminary', final: 'Final',
}

const FLAG_BADGE: Record<ResultFlag, { color: BadgeColor; label: string }> = {
  normal: { color: 'green', label: 'NORMAL' },
  abnormal: { color: 'amber', label: 'ABNORMAL' },
  critical: { color: 'red', label: 'CRITICAL' },
}

/** the documenting clinician — the first "documented" audit event (manual
 *  reports only; seeded studies carry no documentation provenance) */
const documentedBy = (s: ImagingStudy): string | null =>
  s.history?.find(e => e.action === 'documented')?.actor ?? null

/* Imaging Report Correction — the PR #80 two-tier hints, verbatim from the
   lab entry screen. The SERVER decides the tier; everything here is display. */
const SELF_WINDOW_MS = 5 * 60_000

const documentedAtMs = (s: ImagingStudy) =>
  s.documentedAt ? Date.parse(`${s.documentedAt.replace(' ', 'T')}Z`) : NaN

const withinSelfWindow = (s: ImagingStudy, now: Date) =>
  !!s.documentedAt && now.getTime() - documentedAtMs(s) <= SELF_WINDOW_MS

const selfWindowLeft = (s: ImagingStudy, now: Date) =>
  Math.min(SELF_WINDOW_MS / 60_000, Math.max(0, Math.ceil((SELF_WINDOW_MS - (now.getTime() - documentedAtMs(s))) / 60_000)))

/** what a correction can target — the report's correctable surface (the
 *  order linkage and derived study identity are facts of what was
 *  documented against, immutable here) */
const TARGETS = [
  ['findings', 'Findings'],
  ['impression', 'Impression'],
  ['performedAt', 'Study performed at'],
  ['reportingRadiologist', 'Reporting radiologist'],
  ['note', 'Note'],
  ['critical', 'Critical flag (clinician-marked)'],
  ['order', 'Order linkage'],
] as const
type Target = (typeof TARGETS)[number][0]

/** the linkage editor's unlink sentinel — UI-only; the wire uses the
 *  explicit `unlink: true` boolean, never a magic string */
const UNLINK = '__unlink__'

const currentValueOf = (s: ImagingStudy, target: Target): string => {
  switch (target) {
    case 'findings': return s.report ?? ''
    case 'impression': return s.impression ?? ''
    /* prefill as WALL TIME (display clock) — converts back to the UTC wire on submit */
    case 'performedAt': return s.performedAt ? displayFullStamp(s.performedAt) : ''
    case 'reportingRadiologist': return s.reportingRadiologist ?? ''
    case 'note': return s.note ?? ''
    case 'critical': return s.flag === 'critical' ? 'critical' : ''
    case 'order': return s.orderId ?? ''
  }
}

/** amendment display: narrative previous/new values can be thousands of
 *  characters — truncate the render, keep the full text in the title */
const clip = (v: string) => (v.length > 90 ? `${v.slice(0, 90)}…` : v)

interface ImagingCardProps {
  studies: ImagingStudy[]
  /** LINKAGE CORRECTION: the patient's PENDING imaging orders (active,
   *  unfulfilled — the same derived rule as the entry screen), offered as
   *  re-point/link targets in the correction editor */
  pendingOrders: Order[]
  /** derived from the session's permissions (results.acknowledge) */
  canAcknowledge: boolean
  /** Imaging Report Correction: results.document (Tier-1 self) /
   *  results.correct (Tier-2 Consultant-tier) + the session identity for
   *  the self-window hint — the server re-decides everything */
  canDocument: boolean
  canCorrect: boolean
  sessionName: string
  onAcknowledge: (studyId: string) => void
  /** reverse an acknowledgment — requires a documented reason (results
   *  audit PR); same permission as acknowledge */
  onUnacknowledge: (studyId: string, reason: string) => void
  /** submit a correction — resolves to an error message, or null on success */
  onCorrect: (studyId: string, draft: CorrectImagingDraft) => Promise<string | null>
}

/* Reversing an acknowledgment requires a documented reason (validated
   server-side like discontinue); the original acknowledgment is preserved
   in the result's audit history — never deleted. */
function UnackReasonDialog(
  { study, onCancel, onConfirm }:
  { study: ImagingStudy; onCancel: () => void; onConfirm: (reason: string) => void },
) {
  const [reason, setReason] = useState('')
  const taRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    taRef.current?.focus()
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [onCancel])
  return (
    <div className="liscrim" onClick={onCancel}>
      <div className="lidialog" role="dialog" aria-modal="true" aria-labelledby="liUnackTitle" onClick={e => e.stopPropagation()}>
        <h2 id="liUnackTitle">Reverse acknowledgment · <span className="num">{study.description}</span></h2>
        <p className="lidnote">
          The original acknowledgment ({study.acknowledgedBy} · {displayStamp(study.acknowledgedAt)}) is preserved in the
          audit history; the study returns to the results inbox.
        </p>
        <div className="field">
          <label htmlFor="liUnackReason">Reason (required)</label>
          <textarea
            ref={taRef} id="liUnackReason" value={reason}
            placeholder="e.g. Acknowledged in error — addendum pending review…"
            onChange={e => setReason(e.target.value)}
          />
        </div>
        <div className="lidfoot">
          <button className="btn ghost" onClick={onCancel}>Cancel</button>
          <button className="btn danger" disabled={!reason.trim()} onClick={() => onConfirm(reason.trim())}>
            ↩ Reverse acknowledgment
          </button>
        </div>
      </div>
    </div>
  )
}

/** Imaging study list with report/impression text and status progression.
 *  Acknowledge is doctor RBAC — nurses view only. Documented reports carry
 *  the PR #80 correction model: Tier-1 self within 5 minutes, Tier-2
 *  Consultant-tier with a reason; amend-not-erase history renders below. */
export function ImagingCard({
  studies, pendingOrders, canAcknowledge: canAck, canDocument, canCorrect, sessionName,
  onAcknowledge, onUnacknowledge, onCorrect,
}: ImagingCardProps) {
  const now = useNow(10_000)
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [unackTarget, setUnackTarget] = useState<ImagingStudy | null>(null)

  /* the open correction editor (one at a time — the lab entry pattern) */
  const [editing, setEditing] = useState<string | null>(null)
  const [editTarget, setEditTarget] = useState<Target>('impression')
  const [editValue, setEditValue] = useState('')
  const [editCritical, setEditCritical] = useState(false)
  const [editReason, setEditReason] = useState('')
  const [editError, setEditError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const toggle = (id: string) =>
    setOpen(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  function openEditor(s: ImagingStudy) {
    setEditing(s.studyId)
    setEditError(null)
    setEditReason('')
    setEditTarget('impression')
    setEditValue(s.impression ?? '')
    setEditCritical(s.flag === 'critical')
  }

  function switchTarget(s: ImagingStudy, target: Target) {
    setEditTarget(target)
    setEditError(null)
    if (target === 'critical') setEditCritical(s.flag === 'critical')
    /* the linkage target starts UNPICKED — prefilling the current order
       would stage a no-op; the corrector must choose deliberately */
    else if (target === 'order') setEditValue('')
    else setEditValue(currentValueOf(s, target))
  }

  async function submitCorrection(s: ImagingStudy) {
    if (busy) return
    const selfTier = withinSelfWindow(s, now) && documentedBy(s) === sessionName && canDocument
    const draft: CorrectImagingDraft = {}
    if (editTarget === 'critical') {
      draft.critical = editCritical
    } else if (editTarget === 'order') {
      if (editValue === '') { setEditError('pick the correct pending order, or unlink'); return }
      if (editValue === UNLINK) draft.unlink = true
      else draft.orderId = editValue
    } else {
      const raw = editValue.trim()
      if (raw === '') { setEditError(`enter the corrected ${editTarget}`); return }
      if (editTarget === 'performedAt')
        /* typed as WALL TIME on the display clock; the wire stays UTC
           (the one conversion path's write side) — a malformed shape
           passes through raw so the server's validation message stays
           the messenger */
        draft.performedAt = wireStampOfLocal(raw) ?? raw
      else draft[editTarget] = raw
    }
    if (!selfTier && !editReason.trim()) { setEditError('a reason is required for a Consultant-tier correction'); return }
    /* tier-1 sends no reason; if the window expired between render and
       submit, the server answers with the tier rule — shown here */
    if (!selfTier && editReason.trim()) draft.reason = editReason.trim()
    setBusy(true)
    setEditError(null)
    const err = await onCorrect(s.studyId, draft)
    setBusy(false)
    if (err === null) setEditing(null)
    else setEditError(err)
  }

  return (
    <Card
      icon={<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--violet)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="9" cy="11" r="2.2" /><path d="M21 15l-4.5-4.5L9 18" /></svg>}
      title="Imaging Studies"
      aside={`${studies.length} studies · report + impression`}
    >
      {studies.length === 0 && <div className="liempty">No imaging studies for this patient yet.</div>}
      {studies.map(s => {
        const stepIdx = STATUS_STEPS.indexOf(s.status)
        const reported = s.status === 'preliminary' || s.status === 'final'
        const isOpen = open.has(s.studyId)
        /* correction: only DOCUMENTED reports carry the model (server 409s
           everything else); self tier = documenter + inside the window */
        const selfTier = !!s.documentedAt && withinSelfWindow(s, now) && documentedBy(s) === sessionName && canDocument
        const correctable = !!s.documentedAt && (selfTier || canCorrect)
        const edited = (s.amendments?.length ?? 0) > 0
        const editedAfterAck = !!s.acknowledged && !!s.amendments?.some(a => a.afterAcknowledgment)
        return (
          <div className={`listudy${s.flag === 'critical' ? ' crit' : ''}`} key={s.studyId}>
            <div className="lisr1">
              <span className="limod">{s.modality}</span>
              <b className="lidesc">{s.description}</b>
              {/* a documented report the clinician did NOT mark critical has
                  NO flag — the system never fabricates a narrative judgment */}
              {reported && s.flag !== '' && <Badge color={FLAG_BADGE[s.flag].color}>{FLAG_BADGE[s.flag].label}</Badge>}
              {s.flag === 'critical' && s.source === 'manual' && (
                <span className="licritmark" title="marked by the documenting clinician — imaging has no thresholds; never system-detected">
                  clinician-marked
                </span>
              )}
              {s.source === 'manual' && <span className="lersource" title="manually documented — the paper report transcribed">✎ manual</span>}
              {s.source === 'manual' && (s.orderId
                ? <span className="lerorder" title="fulfils this imaging order — the study identity came from it">↳ {s.orderId}</span>
                : <span className="lerstandalone" title="documented without an order (outside film / pre-order study) — never a fabricated order">unlinked</span>)}
              {edited && <span className="lisedited" title="corrected — the original stays on the record below">edited ×{s.amendments!.length}</span>}
              {correctable && editing !== s.studyId && (
                <button className="lisfix" onClick={() => openEditor(s)}>
                  ✎ {selfTier ? `Amend (self · ${selfWindowLeft(s, now)} min left)` : 'Correct'}
                </button>
              )}
            </div>
            <div className="listeps" aria-label={`Status: ${STATUS_LABEL[s.status]}`}>
              {STATUS_STEPS.map((st, i) => (
                <span key={st} className={`listep${i < stepIdx ? ' done' : ''}${i === stepIdx ? ' cur' : ''}`}>
                  {STATUS_LABEL[st]}
                </span>
              ))}
            </div>
            <div className="lismeta num">
              {s.orderedAt !== '' ? <>ordered {displayStamp(s.orderedAt)}</> : <>no order — unlinked report</>}
              {s.performedAt && <> · performed {displayStamp(s.performedAt)}</>}
              {s.reportedAt && <> · reported {displayStamp(s.reportedAt)} ({agoLabel(s.reportedAt, now)})</>}
            </div>
            {s.source === 'manual' && (
              <div className="lisprov">
                documented by <b>{documentedBy(s) ?? '—'}</b> · reporting radiologist (paper report):{' '}
                <b>{s.reportingRadiologist ?? '—'}</b>
              </div>
            )}

            {/* amend-not-erase history — every correction with the original
                preserved; §2b entries carry their marker */}
            {edited && (
              <div className="lisamends">
                {s.amendments!.map((a, i) => (
                  <div className="lisamend" key={i}>
                    {a.target}: <s title={a.previousValue || undefined}>{clip(a.previousValue) || '—'}</s>
                    {' → '}<b title={a.newValue}>{clip(a.newValue)}</b>
                    {' '}by {a.amendedBy} ({a.amenderRole}) at <span className="num">{a.amendedAt}</span>
                    {a.reason && <i> — “{a.reason}”</i>}
                    {a.afterAcknowledgment && <span className="lispostacktag" title="this correction happened AFTER the report was acknowledged — the earlier sign-off covers the previous content, not this one">after acknowledgment</span>}
                  </div>
                ))}
              </div>
            )}

            {/* the inline correction editor (one at a time) */}
            {editing === s.studyId && (
              <div className="liseditor">
                <select
                  aria-label="What to correct"
                  value={editTarget}
                  onChange={e => switchTarget(s, e.target.value as Target)}
                >
                  {TARGETS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                </select>
                {editTarget === 'order' ? (
                  <>
                    <select
                      aria-label="Corrected order linkage"
                      value={editValue}
                      onChange={e => { setEditValue(e.target.value); setEditError(null) }}
                    >
                      <option value="">— currently {s.orderId ? `linked to ${s.orderId}` : 'unlinked'}; pick the correction —</option>
                      {pendingOrders.map(o => (
                        <option key={o.orderId} value={o.orderId}>{o.orderId} · {o.summary}</option>
                      ))}
                      {s.orderId && <option value={UNLINK}>Unlink — no order ({s.orderId} returns to pending)</option>}
                    </select>
                    <span className="lislinknote">
                      Fulfilment is derived from the linkage: re-pointing returns the wrong order to
                      pending and fulfils the picked one; the study identity is re-derived from it.
                      The previous linkage and description are preserved as amendments.
                    </span>
                  </>
                ) : editTarget === 'critical' ? (
                  <label className="liseditcrit">
                    <input type="checkbox" checked={editCritical} onChange={e => { setEditCritical(e.target.checked); setEditError(null) }} />
                    <span>marked as a critical finding — <b>clinician-marked</b>, never system-derived; moving this moves the report into/out of the critical results</span>
                  </label>
                ) : editTarget === 'findings' || editTarget === 'impression' ? (
                  <textarea
                    rows={3}
                    aria-label={`Corrected ${editTarget}`}
                    placeholder={`corrected ${editTarget}`}
                    value={editValue}
                    onChange={e => { setEditValue(e.target.value); setEditError(null) }}
                  />
                ) : (
                  <input
                    className={editTarget === 'performedAt' ? 'num' : undefined}
                    aria-label={`Corrected ${editTarget}`}
                    placeholder={editTarget === 'performedAt' ? `yyyy-MM-dd HH:mm (${clockZone() ?? 'local time'})` : `corrected ${editTarget}`}
                    value={editValue}
                    onChange={e => { setEditValue(e.target.value); setEditError(null) }}
                  />
                )}
                {!selfTier && (
                  <input
                    className="lisreason"
                    placeholder="Reason (required — Consultant-tier correction)"
                    aria-label="Correction reason"
                    value={editReason}
                    onChange={e => { setEditReason(e.target.value); setEditError(null) }}
                  />
                )}
                {selfTier && <span className="lisselfnote">Self-correction inside the 5-minute window — no reason needed; the amendment still records you, the original and the time.</span>}
                {editError && <span className="liserr" role="alert">{editError}</span>}
                <span className="liseditbtns">
                  <button className="btn ghost" onClick={() => setEditing(null)} disabled={busy}>Cancel</button>
                  <button className="btn" onClick={() => submitCorrection(s)} disabled={busy}>✓ Save correction</button>
                </span>
              </div>
            )}

            {reported ? (
              <>
                <button className="lisexp" aria-expanded={isOpen} onClick={() => toggle(s.studyId)}>
                  {isOpen ? 'Hide report ▴' : 'View report ▾'}
                </button>
                {isOpen && (
                  <div className="lisreport">
                    <div className="lisrsec"><span>Findings</span><p>{s.report}</p></div>
                    <div className="lisrsec"><span>Impression</span><p className={s.flag === 'critical' ? 'critimp' : ''}>{s.impression}</p></div>
                  </div>
                )}
                <div className="lisack">
                  {s.acknowledged ? (
                    <>
                      <span className="liacked">
                        ✓ Acknowledged by {s.acknowledgedBy} · {displayStamp(s.acknowledgedAt)}
                        {/* §2b safeguard: someone acknowledged one thing and it
                            then changed — visible right where the sign-off
                            shows, never hidden */}
                        {editedAfterAck && <b className="lispostack"> — then EDITED after acknowledgment (history above)</b>}
                      </span>
                      {canAck && (
                        <button
                          className="liunackbtn"
                          onClick={() => setUnackTarget(s)}
                          aria-label={`Reverse acknowledgment of ${s.description}`}
                        >
                          ↩ Reverse
                        </button>
                      )}
                    </>
                  ) : canAck ? (
                    <button className="liackbtn" onClick={() => onAcknowledge(s.studyId)} aria-label={`Acknowledge ${s.description}`}>
                      ✓ Acknowledge
                    </button>
                  ) : (
                    <span className="liviewonly">View only — acknowledgement requires physician role</span>
                  )}
                </div>
              </>
            ) : (
              <div className="lispending">Report pending — {STATUS_LABEL[s.status].toLowerCase()}</div>
            )}
          </div>
        )
      })}
      {unackTarget && (
        <UnackReasonDialog
          study={unackTarget}
          onCancel={() => setUnackTarget(null)}
          onConfirm={reason => { onUnacknowledge(unackTarget.studyId, reason); setUnackTarget(null) }}
        />
      )}
    </Card>
  )
}
