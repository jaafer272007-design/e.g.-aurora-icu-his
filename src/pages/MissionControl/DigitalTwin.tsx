import { Card } from '../../components/Card'
import type { ScoreState } from '../../hooks/usePatientScores'
import type { ScoredComponent, SofaComputation } from '../../lib/scoring'
import { systemStatusFromScore, type SystemStatus } from '../../lib/scoring/display'

/* Patient Digital Twin — organ status DERIVED from the computed SOFA
   (worst-24h primary view, the same computation the SOFA card renders;
   they can never disagree). Every organ claim is score-backed or not
   made: a SOFA sub-score of 0 earns green "Stable" from real data; 1–2 =
   "Watch"; 3–4 = "Critical"; a system the engine marks insufficient-data
   (P1) renders grey "Not assessed" — NEVER green. The old wire `organs`
   snapshot (seeded fixtures + an all-"ok" default for fresh admissions)
   is retired: it painted reassuring green over patients the scores
   flagged, and over organs with no data at all (the no-reassuring-default
   rule, scoring/display.ts). */

/** the twin's six body systems = SOFA's six components, by engine key.
 *  Heart & Circulation share Cardiovascular (MAP + vasopressors — one
 *  system clinically and in the score); Coagulation is list-only (blood
 *  has no honest glyph). */
const SYSTEMS: { key: string; organ: string }[] = [
  { key: 'cns', organ: 'Brain' },
  { key: 'respiratory', organ: 'Lungs' },
  { key: 'cardiovascular', organ: 'Heart & Circulation' },
  { key: 'liver', organ: 'Liver' },
  { key: 'renal', organ: 'Kidneys' },
  { key: 'coagulation', organ: 'Coagulation' },
]

const STATUS_TEXT: Record<SystemStatus, string> = {
  ok: 'Stable', watch: 'Watch', crit: 'Critical', nd: 'Not assessed',
}

const CIRC_STROKE: Record<SystemStatus, string> = {
  ok: 'rgba(var(--green-rgb),.5)',
  watch: 'rgba(var(--amber-rgb),.65)',
  crit: 'rgba(var(--red-rgb),.75)',
  nd: 'rgba(var(--steel3-rgb),.4)',
}

export function DigitalTwin({ state, sofa }: { state: ScoreState; sofa: SofaComputation | null }) {
  /* primary view = worst-in-24h (SOFA spec §2.3) — matches the SOFA
     card's primary tab */
  const byKey = new Map<string, ScoredComponent>(
    (sofa?.worst.components ?? []).map(c => [c.key, c]))
  const st = (key: string): SystemStatus =>
    state === 'ready' ? systemStatusFromScore(byKey.get(key)?.score ?? null) : 'nd'
  const cls = (key: string) => `organ o-${st(key)}`

  const rows = SYSTEMS.map(s => {
    const c = byKey.get(s.key)
    return { ...s, status: st(s.key), comp: c ?? null }
  })
  const scoredCount = rows.filter(r => r.status !== 'nd').length

  return (
    <Card
      icon={<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--cyan)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="5" r="3" /><path d="M12 8v5m0 0l-4 8m4-8l4 8M6 12h12" /></svg>}
      title="Patient Digital Twin" aside="SOFA-derived · worst 24 h"
    >
      <div className="twin">
        <svg viewBox="0 0 120 240" aria-label="Body diagram — organ status from the computed SOFA">
          <defs>
            <linearGradient id="bodyG" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="rgba(var(--steel2-rgb),.16)" /><stop offset="1" stopColor="rgba(var(--steel2-rgb),.06)" />
            </linearGradient>
          </defs>
          {/* silhouette */}
          <g fill="url(#bodyG)" stroke="rgba(var(--steel3-rgb),.35)" strokeWidth="1.4">
            <circle cx="60" cy="26" r="16" />
            <path d="M60 42c-14 0-22 8-24 20l-4 34c-1 8 2 12 6 12l2 44c0 6 3 10 8 10h24c5 0 8-4 8-10l2-44c4 0 7-4 6-12l-4-34c-2-12-10-20-24-20z" />
            <path d="M36 66l-10 40c-1 5 1 8 4 9l4 1 8-46" />
            <path d="M84 66l10 40c1 5-1 8-4 9l-4 1-8-46" />
            <path d="M50 162l-3 60c0 4 2 7 6 7h4l3-64" />
            <path d="M70 162l3 60c0 4-2 7-6 7h-4l-3-64" />
          </g>
          {/* circulation ring — Cardiovascular (one system with the heart) */}
          <ellipse className="organ" cx="60" cy="118" rx="30" ry="66" fill="none" stroke={CIRC_STROKE[st('cardiovascular')]} strokeWidth="2" strokeDasharray="4 7" />
          {/* organs — each glyph restates its SOFA system's sub-score */}
          <ellipse className={cls('cns')} cx="60" cy="24" rx="10" ry="8" />
          <path className={cls('respiratory')} d="M54 62c-8 0-12 8-12 18s3 16 9 16c4 0 6-4 6-10V68c0-4-1-6-3-6z" />
          <path className={cls('respiratory')} d="M66 62c8 0 12 8 12 18s-3 16-9 16c-4 0-6-4-6-10V68c0-4 1-6 3-6z" />
          <path className={cls('cardiovascular')} d="M60 74c3-4 9-4 11 0 2 3 1 7-3 11l-8 7-8-7c-4-4-5-8-3-11 2-4 8-4 11 0z" />
          <path className={cls('liver')} d="M46 104c-5 1-8 5-7 10 1 4 5 6 11 5l16-4c4-1 5-5 3-8-3-4-14-5-23-3z" />
          <ellipse className={cls('renal')} cx="48" cy="128" rx="5" ry="8" />
          <ellipse className={cls('renal')} cx="72" cy="128" rx="5" ry="8" />
        </svg>
        <div className="organlist">
          {state === 'unavailable' && (
            <div className="twinempty">Organ status unavailable — the observation data source is not reachable in this session. Nothing is assumed.</div>
          )}
          {state === 'loading' && <div className="twinempty" aria-busy="true">Computing…</div>}
          {state === 'ready' && rows.map(r => (
            <div key={r.key} className={`orow st-${r.status}`}>
              <span className="odot" />
              <span className="on">{r.organ}</span>
              <span className="os">{STATUS_TEXT[r.status]}</span>
              {r.status === 'nd'
                ? <span className="osc nd" title={r.comp?.incompleteReason ?? 'not scored'}>ND</span>
                : <span className={`osc s-${r.status}`} title={r.comp?.detail}>{r.comp!.score}/4</span>}
            </div>
          ))}
          {state === 'ready' && (
            <div className="twinfoot">
              {scoredCount === 0
                ? 'No system scored — insufficient data in the last 24 h. Grey is the honest state, not "stable".'
                : `${scoredCount}/6 systems scored (SOFA, worst 24 h) — unscored systems are grey "Not assessed", never green.`}
            </div>
          )}
        </div>
      </div>
    </Card>
  )
}
