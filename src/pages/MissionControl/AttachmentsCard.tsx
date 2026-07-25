import { useEffect, useRef, useState } from 'react'
import { Card } from '../../components/Card'
import {
  fetchAttachmentBlob, getAttachments, retractAttachment, uploadAttachment,
  type PatientAttachment,
} from '../../lib/api'
import { getSession, hasPermission } from '../../lib/session'

/** File Attachments (the approved 2026-07-25 design): scanned reports,
 *  photos of paper notes, outside documents on the patient chart. Bytes
 *  live IN the database (base64 — the logo precedent generalized) so the
 *  nightly backup keeps capturing the whole record. PATIENT-scoped: shown
 *  on every visit's chart; the open encounter at upload time is stamped
 *  server-side. Retract-not-delete: a wrong upload is hidden with an
 *  audited reason (Tier-1 uploader/5-min, Tier-2 results.correct), its
 *  bytes and trail retained.
 *
 *  RBAC (owner's decision): attachments.view = the chart's clinical tier
 *  (results.view holders); attachments.add = the documenting roles. The
 *  card renders nothing without view — exactly how the identity-tier
 *  office Administrator experiences the other clinical panes.
 *
 *  Real-server-only domain (no mock store — inventing clinical documents
 *  would fabricate data): the card renders nothing when the list read is
 *  unavailable. */

const ACCEPT = 'application/pdf,image/png,image/jpeg'
const CLIENT_MAX_MB = 20 // courtesy pre-check; the server's ATTACH_MAX_MB is authoritative

function fmtSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

/* chunked base64 — btoa on a whole multi-MB buffer builds an enormous
   intermediate string; 32 KB slices keep it flat */
function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let bin = ''
  const CHUNK = 32768
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(bin)
}

export function AttachmentsCard({ patientId }: { patientId: string }) {
  const session = getSession()
  const canView = session != null && hasPermission(session.jobTitle, 'attachments.view')
  const canAdd = session != null && hasPermission(session.jobTitle, 'attachments.add')
  const canConsultantRetract = session != null && hasPermission(session.jobTitle, 'results.correct')

  const [rows, setRows] = useState<PatientAttachment[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [description, setDescription] = useState('')
  const [retracting, setRetracting] = useState<string | null>(null)
  const [retractReason, setRetractReason] = useState('')
  const [showRetracted, setShowRetracted] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let stale = false
    setRows(null)
    setErr(null)
    if (!patientId || !canView) return
    getAttachments(patientId).then(list => { if (!stale) setRows(list) })
    return () => { stale = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId])

  if (!canView || rows == null) return null

  const visible = rows.filter(a => !a.retracted)
  const hidden = rows.filter(a => a.retracted)

  async function refresh() {
    const list = await getAttachments(patientId)
    if (list) setRows(list)
  }

  async function onPick(file: File) {
    setErr(null)
    if (!ACCEPT.split(',').includes(file.type)) {
      setErr('Only PDF, PNG or JPEG files can be attached.')
      return
    }
    if (file.size > CLIENT_MAX_MB * 1024 * 1024) {
      setErr(`That file is ${fmtSize(file.size)} — the limit is ${CLIENT_MAX_MB} MB.`)
      return
    }
    setBusy(true)
    try {
      const dataBase64 = toBase64(await file.arrayBuffer())
      const res = await uploadAttachment(patientId, {
        fileName: file.name, mime: file.type, dataBase64,
        ...(description.trim() ? { description: description.trim() } : {}),
      })
      if (res.kind === 'ok') { setDescription(''); await refresh() }
      else if (res.kind === 'rejected') setErr(res.error)
      else setErr('The live server is unreachable — attachments need the real API.')
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function openAttachment(a: PatientAttachment) {
    setErr(null)
    const res = await fetchAttachmentBlob(a.attachmentId)
    if (res == null) { setErr('The live server is unreachable.'); return }
    if ('error' in res) { setErr(res.error); return }
    const url = URL.createObjectURL(res.blob)
    window.open(url, '_blank', 'noopener')
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }

  async function doRetract(a: PatientAttachment) {
    setErr(null)
    setBusy(true)
    const res = await retractAttachment(a.attachmentId, retractReason)
    setBusy(false)
    if (res.kind === 'ok') { setRetracting(null); setRetractReason(''); await refresh() }
    else if (res.kind === 'rejected') setErr(res.error)
    else setErr('The live server is unreachable.')
  }

  return (
    <Card title="Attachments" aside={visible.length === 0 ? 'No files attached' : `${visible.length} file${visible.length === 1 ? '' : 's'}`}>
      {err && <div className="att-err" role="alert">{err}</div>}

      {visible.length > 0 && (
        <ul className="att-list">
          {visible.map(a => (
            <li key={a.attachmentId} className="att-row">
              <button type="button" className="att-name" onClick={() => void openAttachment(a)}
                title={`Open ${a.fileName}`}>
                {a.fileName}
              </button>
              <span className="att-meta">
                {fmtSize(a.sizeBytes)} · {a.uploadedBy} ({a.uploadedRole}) · {a.uploadedAt} UTC
                {a.encounterId ? ` · ${a.encounterId}` : ' · after discharge'}
              </span>
              {a.description && <span className="att-desc">{a.description}</span>}
              {(canAdd || canConsultantRetract) && retracting !== a.attachmentId && (
                <button type="button" className="att-retract" disabled={busy}
                  onClick={() => { setRetracting(a.attachmentId); setRetractReason(''); setErr(null) }}>
                  Retract
                </button>
              )}
              {retracting === a.attachmentId && (
                <span className="att-retract-form">
                  <input value={retractReason} onChange={e => setRetractReason(e.target.value)}
                    placeholder="Reason (required outside your 5-minute window)" maxLength={2000} />
                  <button type="button" disabled={busy} onClick={() => void doRetract(a)}>Confirm</button>
                  <button type="button" disabled={busy} onClick={() => setRetracting(null)}>Cancel</button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {hidden.length > 0 && (
        <div className="att-hidden">
          <button type="button" onClick={() => setShowRetracted(v => !v)}>
            {showRetracted ? 'Hide' : 'Show'} {hidden.length} retracted
          </button>
          {showRetracted && (
            <ul className="att-list att-list-retracted">
              {hidden.map(a => (
                <li key={a.attachmentId} className="att-row att-row-retracted">
                  <span className="att-name-dead">{a.fileName}</span>
                  <span className="att-meta">
                    retracted {a.retractedAt} UTC by {a.retractedBy}
                    {a.retractReason ? ` — ${a.retractReason}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {canAdd && (
        <div className="att-upload">
          <input value={description} onChange={e => setDescription(e.target.value)}
            placeholder="What is this file? (optional)" maxLength={2000} disabled={busy} />
          <label className={busy ? 'att-pick att-pick-busy' : 'att-pick'}>
            {busy ? 'Uploading…' : 'Attach file'}
            <input ref={fileRef} type="file" accept={ACCEPT} hidden disabled={busy}
              onChange={e => { const f = e.target.files?.[0]; if (f) void onPick(f) }} />
          </label>
          <span className="att-hint">PDF, PNG or JPEG · up to {CLIENT_MAX_MB} MB</span>
        </div>
      )}
    </Card>
  )
}
