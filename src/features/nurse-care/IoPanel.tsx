import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Card } from '../../components/Card'
import { DataAge } from '../../components/DataAge'
import { usePollTick } from '../../hooks/useLive'
import { IO_SNAPSHOT_MAX_ML, getIoSnapshots, type IoRead, type IoSnapshot, type IoSnapshotDraft, type IoView } from '../../lib/api'
import { getSession, hasPermission } from '../../lib/session'
import { displayFullStamp, displayStamp } from '../../lib/time'
import { ioKey } from './ioController'
import { useIoSaving, useNurseCareConsumer } from './NurseCareProvider'
import './nurseCare.css'

/* ---------------- INTAKE & OUTPUT — LATEST MANUAL VALUES (contract §5 + Amendment 1 §9.3) ----------------
   Replaces the demo-only worksheet (running shift totals of entries that were
   never persisted). The panel shows the patient's CURRENT intake and output as
   the nurse last entered them for the CURRENT admission — not totals:
   - 500 then 200 shows 200; both stay in the history (newest first, with who,
     when and any amendment — amend-not-erase);
   - zero is a real value; a missing value is "Not recorded" (never an invented
     0); the balance exists only when both values do;
   - values never expire or reset at midnight; a new admission starts blank;
   - reads/writes are the dedicated io_current_* snapshot observations through
     the observations API — never the interval fluid observations, fluid totals,
     urine-output scoring or any trailing window, and never demo state: with no
     server the panel says I&O is unavailable and nothing can be saved.
   The typed values belong to ONE patient + admission (Amendment 1 §9.3): a
   different admission (discharge/readmission) clears them, and a save is sent
   with the admission it was typed against, so it can never land in another. */

const KIND_LABEL = { intake: 'Intake', output: 'Output' } as const

type Outcome = { key: string; kind: 'ok' | 'rejected' | 'uncertain'; text: string }

const ml = (n: number) => `${n.toLocaleString('en-US')} mL`
const signedMl = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toLocaleString('en-US')} mL`

/** whole mL 0…max, or an error to show; '' = not entered */
function parseMl(raw: string): { value?: number; error?: string } {
  const t = raw.trim()
  if (t === '') return {}
  if (!/^\d+$/.test(t)) return { error: 'whole millilitres only (0 or more)' }
  const n = Number(t)
  if (n > IO_SNAPSHOT_MAX_ML) return { error: `at most ${IO_SNAPSHOT_MAX_ML.toLocaleString('en-US')} mL` }
  return { value: n }
}

function SnapshotStamp({ s }: { s: IoSnapshot }) {
  return (
    <span className="iostamp num" title={`${displayFullStamp(s.clinicalTime)} (hospital time)`}>
      {displayStamp(s.clinicalTime)} · {s.recordedBy}{s.amendments.length > 0 && ' · amended'}
    </span>
  )
}

interface IoPanelProps {
  patientId: string
  /** above the values (the workspace's patient selector); the chart passes none */
  toolbar?: ReactNode
  /** the card's DOM id prefix (several panels may share a page) */
  idPrefix?: string
}

/** Intake & Output for ONE patient — the same component in the Nurse
 *  Workspace (behind its patient selector) and the patient chart (fixed). */
export function IoPanel({ patientId, toolbar, idPrefix = 'io' }: IoPanelProps) {
  const care = useNurseCareConsumer()
  const session = getSession()
  const canRecord = !!session && hasPermission(session.jobTitle, 'observations.record')
  const tick = usePollTick()

  /* the read: applied only for the patient on screen, in start order */
  const [read, setRead] = useState<{ patientId: string; result: IoRead } | null>(null)
  const [lastView, setLastView] = useState<IoView | null>(null)
  const [at, setAt] = useState<number | null>(null)
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const pidRef = useRef(patientId)
  pidRef.current = patientId
  const seq = useRef({ started: 0, applied: 0 })
  const load = async (): Promise<IoRead | null> => {
    const pid = patientId
    const mine = ++seq.current.started
    const result = await getIoSnapshots(pid)
    if (pidRef.current !== pid || mine <= seq.current.applied) return null   // another patient, or an older read
    seq.current.applied = mine
    setRead({ patientId: pid, result })
    if (result.kind === 'ok') { setLastView(result.view); setAt(Date.now()) }
    else if (result.kind === 'no-open-encounter') { setLastView(null); setAt(Date.now()) }
    return result
  }
  /* a patient switch clears everything at once — nothing of the previous
     patient renders while the new read is in flight */
  useEffect(() => {
    setRead(null); setLastView(null); setAt(null); setOutcome(null)
  }, [patientId])
  useEffect(() => { void load() }, [patientId, tick])   // eslint-disable-line react-hooks/exhaustive-deps

  const current = read && read.patientId === patientId ? read.result : null
  /* a failed poll keeps the last good values (the DataAge chip ages them);
     a first read that fails shows the unavailable state */
  const view: IoView | null = current?.kind === 'ok' ? current.view
    : current?.kind === 'unavailable' && lastView?.patientId === patientId ? lastView : null
  const failed = current?.kind === 'unavailable'
  const editorKey = view ? ioKey(view.patientId, view.encounterId) : null

  /* ---- the editor: keyed to patient + admission ---- */
  const [editor, setEditor] = useState<{ key: string | null; intake: string; output: string }>({ key: null, intake: '', output: '' })
  const values = editor.key === editorKey ? editor : { key: editorKey, intake: '', output: '' }
  useEffect(() => {
    if (editor.key !== editorKey) setEditor({ key: editorKey, intake: '', output: '' })
  }, [editorKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const saving = useIoSaving(patientId, view?.encounterId ?? null)
  const sending = useRef(false)

  const intake = parseMl(values.intake)
  const output = parseMl(values.output)
  const hasValue = intake.value !== undefined || output.value !== undefined
  const invalid = !!(intake.error || output.error)

  const save = async () => {
    if (!view || !session || !canRecord || sending.current || saving || !hasValue || invalid) return
    sending.current = true
    const key = ioKey(view.patientId, view.encounterId)
    const draft: IoSnapshotDraft = {
      ...(intake.value !== undefined ? { intakeMl: intake.value } : {}),
      ...(output.value !== undefined ? { outputMl: output.value } : {}),
    }
    const what = [draft.intakeMl !== undefined && `intake ${ml(draft.intakeMl)}`, draft.outputMl !== undefined && `output ${ml(draft.outputMl)}`].filter(Boolean).join(', ')
    try {
      const res = await care.io.save(view.patientId, view.encounterId, draft, session.jobTitle)
      if (res === null) return   // a save of this admission is already in flight
      if (res.kind === 'ok') {
        setEditor(e => (e.key === key ? { key, intake: '', output: '' } : e))
        setOutcome({ key, kind: 'ok', text: `Saved — ${what}.` })
        care.showToast('I&O saved', `${what} · now the current value${draft.intakeMl !== undefined && draft.outputMl !== undefined ? 's' : ''}`)
        await load()
      } else if (res.kind === 'rejected') {
        /* the server refused: nothing was saved — the typed values stay,
           unless the admission itself changed (Amendment 1 §9.3) */
        setOutcome({ key, kind: 'rejected', text: `Not saved — ${res.error}.` })
        care.showToast('I&O NOT saved', res.error, 6000)
        if (res.status === 409) {
          const again = await load()
          const moved = again?.kind === 'no-open-encounter' || (again?.kind === 'ok' && again.view.encounterId !== view.encounterId)
          if (moved) setOutcome({ key: again?.kind === 'ok' ? ioKey(again.view.patientId, again.view.encounterId) : key, kind: 'rejected',
            text: `Not saved — ${res.error}. The patient's admission has changed, so the typed values were cleared; nothing was saved into the new admission.` })
        }
      } else {
        /* no answer: it may or may not be on the record — never resent */
        setOutcome({ key, kind: 'uncertain', text: `Not confirmed — ${res.error}. The values may already be saved: check the history below before saving again.` })
        care.showToast('I&O save not confirmed', 'check the history before entering again', 8000)
        await load()
      }
    } finally {
      sending.current = false
    }
  }

  const [showAll, setShowAll] = useState(false)
  useEffect(() => setShowAll(false), [editorKey])
  const history = view?.history ?? []
  const shown = showAll ? history : history.slice(0, 6)
  const visibleOutcome = outcome && (outcome.key === editorKey || (editorKey === null && outcome.key.startsWith(`${patientId}|`))) ? outcome : null

  const outcomeLine = visibleOutcome && (
    <p className={`iooutcome ${visibleOutcome.kind}`} role={visibleOutcome.kind === 'ok' ? 'status' : 'alert'}>{visibleOutcome.text}</p>
  )

  const tile = (label: string, s: IoSnapshot | null, cls: string) => (
    <div className={`iotile ${cls}`}>
      <span className="iotl">{label}</span>
      {s ? (
        <>
          <span className="iotv num">{ml(s.valueMl)}</span>
          <SnapshotStamp s={s} />
        </>
      ) : <span className="iotv iotnone">Not recorded</span>}
    </div>
  )

  return (
    <Card
      className="ncio"
      icon={<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--cyan)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2.7s6.5 7.6 6.5 12.3a6.5 6.5 0 11-13 0C5.5 10.3 12 2.7 12 2.7z" /></svg>}
      title="Intake & Output"
      aside={<DataAge at={at} live label="I&O" what="The latest manually entered intake and output for this admission" unavailable={failed && at === null} />}
    >
      {toolbar}
      {current === null ? (
        <div className="ncempty" role="status">Loading I&amp;O…</div>
      ) : current.kind === 'no-open-encounter' ? (
        <>
          <div className="ionote" role="status">No open admission for this patient — I&amp;O is recorded against the current admission only.</div>
          {outcomeLine}
        </>
      ) : !view ? (
        <div className="iowarn" role="alert">
          I&amp;O unavailable — {current.kind === 'unavailable' ? current.error : 'not read'}.
          {current.kind === 'unavailable' && current.forbidden ? '' : ' Nothing can be saved until the server answers.'}
        </div>
      ) : (
        <>
          {failed && <div className="iowarn" role="alert">Could not refresh — showing the values last read. {current.kind === 'unavailable' ? current.error : ''}</div>}
          <div className="iotiles" aria-live="polite">
            {tile('Current intake', view.intake, 'in')}
            {tile('Current output', view.output, 'out')}
            <div className={`iotile bal${view.balanceMl === null ? '' : view.balanceMl >= 0 ? ' pos' : ' neg'}`}>
              <span className="iotl">Balance</span>
              {view.balanceMl === null
                ? <><span className="iotv iotnone">—</span><span className="iostamp">needs both current values</span></>
                : <><span className="iotv num">{signedMl(view.balanceMl)}</span><span className="iostamp">intake − output</span></>}
            </div>
          </div>
          <p className="ionote">Latest manually entered values for this admission — not running totals. Saving replaces the value shown; every entry stays in the history.</p>

          {canRecord ? (
            <form className="ioform" onSubmit={e => { e.preventDefault(); void save() }} aria-describedby={`${idPrefix}-help`}>
              <div className="field">
                <label htmlFor={`${idPrefix}-in`}>Intake (mL)</label>
                <input id={`${idPrefix}-in`} className="num" inputMode="numeric" autoComplete="off" placeholder="e.g. 500"
                  value={values.intake} aria-invalid={!!intake.error} disabled={saving}
                  onChange={e => setEditor({ ...values, intake: e.target.value })} />
              </div>
              <div className="field">
                <label htmlFor={`${idPrefix}-out`}>Output (mL)</label>
                <input id={`${idPrefix}-out`} className="num" inputMode="numeric" autoComplete="off" placeholder="e.g. 200"
                  value={values.output} aria-invalid={!!output.error} disabled={saving}
                  onChange={e => setEditor({ ...values, output: e.target.value })} />
              </div>
              <button type="submit" className="btn primary iosave" disabled={saving || !hasValue || invalid}
                onClick={e => { if (e.detail > 1) e.preventDefault() }}>
                {saving ? 'Saving…' : 'Save values'}
              </button>
              <p className="iohelp" id={`${idPrefix}-help`}>
                {intake.error ? `Intake: ${intake.error}. ` : ''}{output.error ? `Output: ${output.error}. ` : ''}
                {!intake.error && !output.error && 'Enter one or both; 0 is a valid value. Blank leaves that value unchanged.'}
              </p>
            </form>
          ) : (
            <p className="ionote">View only — recording I&amp;O needs the observations-recording permission.</p>
          )}
          {outcomeLine}

          <div className="iohist">
            <div className="iohhead">History · this admission <span className="num">({history.length})</span></div>
            {history.length === 0 ? <div className="ncempty">No I&amp;O entered for this admission yet.</div> : (
              <ol className="iohlist">
                {shown.map(s => (
                  <li key={s.observationId} className={`iohrow ${s.kind}`}>
                    <span className="iohkind">{KIND_LABEL[s.kind]}</span>
                    <span className="iohval num">{ml(s.valueMl)}{s.amendments.length > 0 && <small> (charted {ml(s.originalValueMl)})</small>}</span>
                    <span className="iohmeta num">{displayFullStamp(s.clinicalTime)} · {s.recordedBy}</span>
                    {s.amendments.map((a, i) => (
                      <span className="iohamend" key={i}>
                        amended {a.previousValue} → {a.newValue} mL by {a.amendedBy} · {displayFullStamp(a.amendedAt)}{a.reason ? ` — ${a.reason}` : ''}
                      </span>
                    ))}
                  </li>
                ))}
              </ol>
            )}
            {history.length > shown.length && (
              <button type="button" className="iomore" onClick={() => setShowAll(true)}>Show all {history.length} entries</button>
            )}
          </div>
        </>
      )}
    </Card>
  )
}
