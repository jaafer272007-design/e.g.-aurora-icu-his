import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import './AiChat.css'
import { AppHeader, type KpiSpec } from '../../components/AppHeader'
import { NavSidebar } from '../../components/NavSidebar'
import { Badge } from '../../components/Badge'
import { BedChip } from '../../components/Tag'
import { IconBrain } from '../../components/icons'
import { aiTranslateQuery, getPatients } from '../../lib/api'
import type { PatientSummary } from '../../lib/api/types'
import { executeAiTool, type AiToolResult } from '../../lib/ai/tools'
import { chatHistory, pushChatTurn } from '../../lib/ai/chatMemory'
import { lastPatientId, useRememberPatient } from '../../lib/patientContext'
import { getSession, initialsOf, profileOf } from '../../lib/session'
import type { ScoreResult } from '../../lib/scoring'

/* AI ASSISTANT — GROUNDED QUERY CHAT (the validator's design). The
 * simulated risk screen that lived at this route (fabricated percentages
 * ranking the patient rail, sparklines, contributing factors, suggested
 * actions, MODEL TICK) is DELETED — removed, not labelled.
 *
 * THE DEFINING RULE (§2): the LLM emits a QUERY, never a VALUE. The
 * server translates the question into ONE tool call; THIS SCREEN executes
 * it through the same canonical, RBAC-enforced reads every other screen
 * uses, on the user's own token, and renders the result with Aurora's own
 * components. The tool call is SHOWN with every answer, so a wrong
 * question is small and visible. EVERY clinical value on this screen came
 * from Aurora — the model contributes no displayed text at all (the
 * flagged prose budget, resolved to ZERO: the answer IS the rendered
 * data).
 *
 * READ-ONLY FOREVER (§4): the registry holds no write tool — nothing here
 * can order, chart, acknowledge, correct or assign. Every question is
 * AUDITED server-side as patient-data access (§3) before translation.
 *
 * SCOPE (§8, the flagged choice): the chat is UNIT-scoped; the remembered
 * patient (or /ai/:patientId) rides along as CONTEXT so "his orders"
 * resolves, but no patient is forced. Conversation memory is (question,
 * tool) pairs only, cleared on sign-out (chatMemory.ts). */

interface ChatEntry {
  id: number
  question: string
  state: 'pending' | 'done'
  tool: string | null
  args: Record<string, unknown> | null
  unanswerable: string | null
  error: string | null
  result: AiToolResult | null
}

const EXAMPLES = [
  'Give me all the orders for رضا',
  'Give me the worst period that رضا was in',
  'Who was assigned today, and who is the worst of them by NEWS2?',
]

let nextId = 1

export function AiChat() {
  const { patientId: routePatient = '' } = useParams()
  const session = getSession()!
  const sessionProfile = profileOf(session.jobTitle)

  const [census, setCensus] = useState<PatientSummary[] | null>(null)
  const [entries, setEntries] = useState<ChatEntry[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [contextCleared, setContextCleared] = useState(false)
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => { getPatients().then(setCensus) }, [])
  /* a route patient becomes the remembered cross-section context (only
     once the census confirms the id resolves) */
  useRememberPatient(routePatient, census)

  /* the CONTEXT patient: the route's, else the remembered one — shown as
     a chip the user can drop for this chat (the screen never forces a
     patient; §8) */
  const contextId = contextCleared ? null : (routePatient || lastPatientId())
  const contextPatient = contextId ? census?.find(p => p.patientId === contextId) ?? null : null

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [entries])

  async function ask(text: string) {
    const question = text.trim()
    if (!question || busy) return
    setDraft('')
    setBusy(true)
    const id = nextId++
    setEntries(prev => [...prev, {
      id, question, state: 'pending', tool: null, args: null, unanswerable: null, error: null, result: null,
    }])
    const patch = (p: Partial<ChatEntry>) =>
      setEntries(prev => prev.map(e => (e.id === id ? { ...e, ...p } : e)))
    try {
      const t = await aiTranslateQuery(question, contextPatient?.patientId ?? null, chatHistory())
      pushChatTurn({ question, tool: t.tool })
      if (t.unanswerable !== null || t.tool === null) {
        patch({ state: 'done', unanswerable: t.unanswerable ?? 'the model did not select a tool' })
        return
      }
      patch({ tool: t.tool, args: t.args })
      try {
        const result = await executeAiTool(t.tool, t.args)
        patch({ state: 'done', result })
      } catch (e) {
        patch({ state: 'done', error: e instanceof Error ? e.message : 'the query could not be executed' })
      }
    } catch (e) {
      pushChatTurn({ question, tool: null })
      patch({ state: 'done', error: e instanceof Error ? e.message : 'the question could not be translated' })
    } finally {
      setBusy(false)
    }
  }

  const kpis: KpiSpec[] = [
    { icon: <IconBrain size={14} stroke="var(--violet)" />, iconBg: 'rgba(var(--violet-rgb),.15)', value: census ? census.length : '—', label: 'Patients on Census' },
    {
      icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--cyan)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l7 4v5c0 4.4-3 8.4-7 9-4-.6-7-4.6-7-9V7z" /></svg>,
      iconBg: 'rgba(var(--cyan-rgb),.13)', value: 'Read-only', label: 'No Write Tools Exist',
    },
    {
      icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--amber)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></svg>,
      iconBg: 'rgba(var(--amber-rgb),.14)', value: 'Audited', label: 'Every Query Logged',
    },
  ]

  return (
    <div className="app-frame ac">
      <AppHeader
        subtitle="AI Assistant · Grounded Query"
        kpis={kpis}
        user={{ initials: initialsOf(session.name), name: session.name, role: `${session.jobTitle} · ${sessionProfile} profile` }}
      />
      <div className="shell">
        <NavSidebar
          active="ai"
          footerLines={[`Role: ${sessionProfile} profile`, 'Read-only · every query audited']}
        />
        <main>
          <div className="acdisclaimer" role="note">
            <IconBrain size={14} stroke="var(--violet)" />
            <span>
              <b>Grounded query chat.</b> The model only translates your question into the query
              shown with each answer — every clinical value on this screen comes from Aurora's own
              records, read with your role's permissions. Read-only: this screen can never order,
              chart or change anything. Every question is logged as patient-data access.
            </span>
          </div>

          {contextPatient && (
            <div className="acctx">
              <span>Context patient:</span>
              <BedChip bedId={contextPatient.bedId} />
              <b>{contextPatient.name}</b>
              <i className="num">{contextPatient.patientId}</i>
              <button onClick={() => setContextCleared(true)} aria-label="Drop the context patient">×</button>
            </div>
          )}

          <div className="aclog" ref={logRef} aria-live="polite">
            {entries.length === 0 && (
              <div className="acempty">
                <p>Ask about Aurora's real data — orders, results, observations, admissions, scores.</p>
                <div className="acexamples">
                  {EXAMPLES.map(q => (
                    <button key={q} onClick={() => ask(q)} disabled={busy}>{q}</button>
                  ))}
                </div>
              </div>
            )}
            {entries.map(e => (
              <div key={e.id} className="acturn">
                <div className="acq"><span className="acwho">{initialsOf(session.name)}</span><p>{e.question}</p></div>
                {e.state === 'pending' && <div className="acpending">translating…</div>}
                {e.tool && (
                  <div className="acquery" title="The exact query the model asked — Aurora executed it with your permissions">
                    <span>QUERY</span>
                    <code>{e.tool}({e.args ? JSON.stringify(e.args) : ''})</code>
                  </div>
                )}
                {e.unanswerable !== null && (
                  <div className="acrefusal">
                    <b>This can't be answered here.</b> {e.unanswerable}
                  </div>
                )}
                {e.error !== null && <div className="acerror">{e.error}</div>}
                {e.result && <ResultBlock r={e.result} />}
              </div>
            ))}
          </div>

          <form
            className="accomposer"
            onSubmit={ev => { ev.preventDefault(); void ask(draft) }}
          >
            <input
              value={draft}
              onChange={ev => setDraft(ev.target.value)}
              placeholder="Ask about the unit's real data…"
              maxLength={2000}
              aria-label="Ask the assistant"
            />
            <button type="submit" disabled={busy || !draft.trim()}>Ask</button>
          </form>
        </main>
      </div>
    </div>
  )
}

/* ---------------- result rendering — Aurora's own components ----------------
   Every renderer below shows values from the canonical reads verbatim
   (the same strings the Orders / MAR / Labs / Observations screens show).
   Empty is EMPTY — "nothing found", never filled in. */

const SCORE_LABEL = { sofa: 'SOFA (classic v1)', news2: 'NEWS2 (standard v1, Scale 1)' } as const

function agoLabel(minutes: number): string {
  if (minutes < 60) return 'now'
  const h = Math.round(minutes / 60)
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`
}

const ScoreFooter = ({ instrument }: { instrument: 'sofa' | 'news2' }) => (
  <p className="acscorefoot">
    ⚠ Decision-support · {SCORE_LABEL[instrument]} · computed by Aurora's scoring engine from the
    charted record — requires clinical validation before use in care. Missing inputs are shown as
    insufficient data, never scored 0.
  </p>
)

function ScoreLine({ result }: { result: ScoreResult }) {
  return result.complete
    ? <b className="num">{result.total} / {result.maxTotal}</b>
    : (
      <span className="acincomplete">
        INCOMPLETE — {result.computedCount}/{result.componentCount} components computable
        {result.incompleteComponents.length > 0 && <> (missing: {result.incompleteComponents.join(', ')})</>}
      </span>
    )
}

function PatientLine({ p }: { p: PatientSummary }) {
  return (
    <span className="acpat">
      <BedChip bedId={p.bedId} />
      <b>{p.name}</b>
      <i className="num">{p.patientId} · {p.mrn}</i>
    </span>
  )
}

function Empty({ what }: { what: string }) {
  return <p className="acnone">Nothing found — Aurora holds no {what}.</p>
}

function ResultBlock({ r }: { r: AiToolResult }) {
  switch (r.kind) {
    case 'no-patient':
      return (
        <div className="acrefusal">
          <b>No admitted patient matches “{r.ref}”.</b> The census was searched by name, full legal
          name, patient id, bed, MRN and national ID — no match. (Discharged patients are reachable
          from Patient History, not from this chat's census tools.)
        </div>
      )
    case 'candidates':
      return (
        <div className="accard">
          <h3>“{r.ref}” matches {r.candidates.length} admitted patients — say which one:</h3>
          <ul className="aclist">
            {r.candidates.map(p => (
              <li key={p.patientId}><PatientLine p={p} /><span className="acdim">{p.diagnosis}</span></li>
            ))}
          </ul>
        </div>
      )
    case 'unavailable':
      return <div className="acerror">{r.what} is not reachable in this session — no substitute data is shown.</div>
    case 'census':
      return (
        <div className="accard">
          <h3>Current census — {r.rows.length} admitted patients</h3>
          {r.rows.length === 0 ? <Empty what="admitted patients" /> : (
            <ul className="aclist">
              {r.rows.map(p => (
                <li key={p.patientId}><PatientLine p={p} /><span className="acdim">{p.diagnosis}</span></li>
              ))}
            </ul>
          )}
        </div>
      )
    case 'identity':
      return (
        <div className="accard">
          <h3>Identity — <PatientLine p={r.patient} /></h3>
          <dl className="acdl">
            <dt>Legal name</dt><dd>{r.identity.fullName || r.identity.name}</dd>
            <dt>MRN</dt><dd className="num">{r.identity.mrn}</dd>
            <dt>National ID</dt><dd className="num">{r.identity.nationalId || '—'}</dd>
            <dt>Age</dt><dd>{r.identity.age} ({r.identity.ageSource === 'dateOfBirth' ? `DOB ${r.identity.dateOfBirth}` : 'recorded at admission'})</dd>
            <dt>Sex</dt><dd>{r.identity.sex}</dd>
            <dt>Allergies</dt><dd>{r.identity.allergies || 'None recorded'}</dd>
          </dl>
        </div>
      )
    case 'encounters':
      return (
        <div className="accard">
          <h3>Admissions — <PatientLine p={r.patient} /> ({r.rows.length})</h3>
          {r.rows.length === 0 ? <Empty what={`admissions for ${r.patient.name}`} /> : (
            <ul className="aclist">
              {r.rows.map(e => (
                <li key={e.encounterId}>
                  <i className="num">{e.encounterId}</i>
                  <b>{e.status === 'open' ? 'OPEN' : 'DISCHARGED'}</b>
                  <span>{e.diagnosis} · {e.attending}</span>
                  <span className="acdim">
                    {e.admittedAt || 'admission time not recorded'}
                    {e.dischargedAt ? ` → ${e.dischargedAt}` : ''}
                    {e.disposition ? ` · ${e.disposition}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )
    case 'assignments':
      return (
        <div className="accard">
          <h3>
            Assignments {r.patient ? <>— <PatientLine p={r.patient} /></> : '— whole unit'} ({r.rows.length})
          </h3>
          {r.rows.length === 0
            ? <Empty what={r.patient ? `active assignments for ${r.patient.name}` : 'active assignments'} />
            : (
              <ul className="aclist">
                {r.rows.map(a => (
                  <li key={a.assignmentId}>
                    <b>{a.userName}</b>
                    <span className="acdim">{a.userTitle}</span>
                    <span>{a.kind} · {a.role} · {a.shift} shift</span>
                    <span>→ {a.patientName}</span>
                    <BedChip bedId={a.bedId} />
                  </li>
                ))}
              </ul>
            )}
          <p className="acscorefoot">Assignment is a worklist, never an authority.</p>
        </div>
      )
    case 'orders':
      return (
        <div className="accard">
          <h3>
            Orders — <PatientLine p={r.patient} />{r.status ? ` · ${r.status} only` : ''} ({r.rows.length})
          </h3>
          {r.rows.length === 0 ? <Empty what={`${r.status ?? ''} orders for ${r.patient.name}`.trim()} /> : (
            <ul className="aclist">
              {r.rows.map(o => (
                <li key={o.orderId}>
                  <i className="num">{o.orderId}</i>
                  <Badge color={o.status === 'active' ? 'green' : o.status === 'pending' ? 'amber' : o.status === 'discontinued' ? 'red' : 'blue'}>{o.status.toUpperCase()}</Badge>
                  <b>{o.summary}</b>
                  <span className="acdim">{o.category} · {o.priority} · {o.orderedBy} · {o.orderedTime}</span>
                  {o.statusReason && <span className="acdim">({o.statusReason})</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )
    case 'mar':
      return (
        <div className="accard">
          <h3>MAR — <PatientLine p={r.patient} /> ({r.rows.length} doses)</h3>
          {r.rows.length === 0 ? <Empty what={`MAR doses for ${r.patient.name}`} /> : (
            <ul className="aclist">
              {r.rows.map(m => (
                <li key={m.adminId}>
                  <b>{m.medication}</b>
                  <span>{m.dose} · {m.route}</span>
                  <span className="num">{m.scheduledTime}</span>
                  <Badge color={m.status === 'given' ? 'green' : m.status === 'scheduled' ? 'blue' : m.status === 'missed-earlier' ? 'red' : 'amber'}>{m.status.toUpperCase()}</Badge>
                  {m.documentedTime && <span className="acdim">documented {m.documentedTime}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )
    case 'observations': {
      const latest = r.rows.slice(-30)
      return (
        <div className="accard">
          <h3>Observations — <PatientLine p={r.patient} /> ({r.rows.length} charted)</h3>
          {r.rows.length === 0 ? <Empty what={`charted observations for ${r.patient.name}`} /> : (
            <>
              <ul className="aclist">
                {latest.map(o => (
                  <li key={o.observationId}>
                    <span className="num">{o.clinicalTime}</span>
                    <b>{o.typeCode}</b>
                    <span>{o.value} {o.unit}</span>
                    <span className="acdim">{o.recordedBy}</span>
                  </li>
                ))}
              </ul>
              {r.rows.length > latest.length &&
                <p className="acdim">Showing the latest {latest.length} of {r.rows.length} — the full history is on the Observations screen.</p>}
            </>
          )}
        </div>
      )
    }
    case 'labs':
      return (
        <div className="accard">
          <h3>Laboratory results — <PatientLine p={r.patient} /> ({r.rows.length} draws)</h3>
          {r.rows.length === 0 ? <Empty what={`lab results for ${r.patient.name}`} /> : (
            <ul className="aclist acgroups">
              {r.rows.map(d => (
                <li key={d.labId}>
                  <div><b>{d.label}</b> <span className="acdim">{d.resultedAt || d.collectedAt} · {d.acknowledged ? 'acknowledged' : 'unacknowledged'}</span></div>
                  <div className="acanalytes">
                    {d.custom
                      ? <span>{d.customValue} {d.customUnit}</span>
                      : d.items.map(it => (
                        <span key={it.analyte} className={it.flag !== 'normal' ? `f-${it.flag}` : ''}>
                          {it.analyte} <b className="num">{it.value}</b> {it.unit}
                        </span>
                      ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )
    case 'imaging':
      return (
        <div className="accard">
          <h3>Imaging — <PatientLine p={r.patient} /> ({r.rows.length} studies)</h3>
          {r.rows.length === 0 ? <Empty what={`imaging studies for ${r.patient.name}`} /> : (
            <ul className="aclist">
              {r.rows.map(s => (
                <li key={s.studyId}>
                  <b>{s.modality}</b>
                  <span>{s.description}</span>
                  <Badge color={s.status === 'final' ? 'green' : 'amber'}>{s.status.toUpperCase()}</Badge>
                  <span className="acdim">{s.reportedAt ?? s.performedAt ?? s.orderedAt}</span>
                  {s.impression && <span className="acdim">— {s.impression}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )
    case 'timeline': {
      const latest = r.rows.slice(0, 40)
      return (
        <div className="accard">
          <h3>Timeline — <PatientLine p={r.patient} /> ({r.rows.length} events)</h3>
          {r.rows.length === 0 ? <Empty what={`timeline events for ${r.patient.name}`} /> : (
            <>
              <ul className="aclist">
                {latest.map(ev => (
                  <li key={`${ev.refId}-${ev.id}`}>
                    <span className="num">{ev.time}</span>
                    <b>{ev.categoryLabel}</b>
                    <span>{ev.title}</span>
                    {ev.detail && <span className="acdim">{ev.detail}</span>}
                  </li>
                ))}
              </ul>
              {r.rows.length > latest.length &&
                <p className="acdim">Showing the latest {latest.length} of {r.rows.length} — the full feed is on the Timeline screen.</p>}
            </>
          )}
        </div>
      )
    }
    case 'score': {
      if (r.instrument === 'news2') {
        const c = r.news2
        return (
          <div className="accard">
            <h3>NEWS2 — <PatientLine p={r.patient} /></h3>
            <p className="acscore"><ScoreLine result={c.result} />
              {c.result.complete && c.band && <span> · band: {c.band.label} (display only)</span>}
            </p>
            {c.ventilated && <p className="acdim">On respiratory support — standard NEWS2 has known limitations under mechanical ventilation (shown, never silently adjusted).</p>}
            <ScoreFooter instrument="news2" />
          </div>
        )
      }
      const c = r.sofa
      return (
        <div className="accard">
          <h3>SOFA — <PatientLine p={r.patient} /></h3>
          <p className="acscore">Worst-in-24h: <ScoreLine result={c.worst} /> · Latest: <ScoreLine result={c.latest} /></p>
          <ScoreFooter instrument="sofa" />
        </div>
      )
    }
    case 'ranking': {
      const name = r.instrument === 'sofa' ? 'SOFA' : 'NEWS2'
      return (
        <div className="accard">
          <h3>Unit ranking by {name} — computed by Aurora</h3>
          <p>
            Of <b className="num">{r.total}</b> patients, <b className="num">{r.ranked.length}</b> have
            a computable {name}{r.incomplete.length > 0 && <>
              ; <b className="num">{r.incomplete.length}</b> are INCOMPLETE and cannot be ranked —
              a missing score is never ranked as low</>}.
          </p>
          {r.ranked.length === 0
            ? <p className="acnone">No patient currently has a complete {name} — this question cannot be answered from the charted data.</p>
            : (
              <ul className="aclist">
                {r.ranked.map((s, i) => (
                  <li key={s.patient.patientId}>
                    <span className="num acrank">{i + 1}</span>
                    <PatientLine p={s.patient} />
                    <b className="num">{name} {s.result.total} / {s.result.maxTotal}</b>
                  </li>
                ))}
              </ul>
            )}
          {r.incomplete.length > 0 && (
            <p className="acdim">
              INCOMPLETE: {r.incomplete.map(s => s.patient.name).join(' · ')}
            </p>
          )}
          <ScoreFooter instrument={r.instrument} />
        </div>
      )
    }
    case 'worst-period': {
      const name = r.instrument === 'sofa' ? 'SOFA' : 'NEWS2'
      const s = r.series
      return (
        <div className="accard">
          <h3>Worst period by {name} — <PatientLine p={r.patient} /></h3>
          {s.peak === null ? (
            <p className="acnone">
              No complete {name} could be computed at any point across the charted record
              ({s.points.length} window ends evaluated over the last {s.spanHours} h) — the worst
              period cannot be identified. Nothing is approximated in its place.
            </p>
          ) : (
            <>
              <p className="acscore">
                Peak {name}: <b className="num">{s.peak.result.total} / {s.peak.result.maxTotal}</b>{' '}
                in the window ending <b>{agoLabel(s.peak.endedMinutesAgo)}</b>.
              </p>
              <p className="acdim">
                Aurora recomputed the score at {s.points.length} window ends ({s.stepHours}-hourly,
                reaching back {s.spanHours} h across the charted data): {s.completeCount} complete
                {s.incompleteCount > 0 && <>, {s.incompleteCount} INCOMPLETE (excluded from the
                comparison — a missing score is never treated as low)</>}.
              </p>
              <div className="acseries">
                {[...s.points].reverse().map(p => (
                  <span
                    key={p.endedMinutesAgo}
                    className={p.result.complete ? (p === s.peak ? 'pt peak' : 'pt') : 'pt inc'}
                    title={`${agoLabel(p.endedMinutesAgo)}: ${p.result.complete ? `${p.result.total}/${p.result.maxTotal}` : 'INCOMPLETE'}`}
                  >
                    {p.result.complete ? p.result.total : '·'}
                  </span>
                ))}
              </div>
            </>
          )}
          <ScoreFooter instrument={r.instrument} />
        </div>
      )
    }
  }
}
