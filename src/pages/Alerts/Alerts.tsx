import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import './Alerts.css'
import { AppHeader, type KpiSpec } from '../../components/AppHeader'
import { NavSidebar } from '../../components/NavSidebar'
import { Card } from '../../components/Card'
import { BedChip } from '../../components/Tag'
import { Toast, useToast } from '../../components/Toast'
import { IconAlertTriangle } from '../../components/icons'
import {
  acknowledgeResult, getEncounters, getImagingStudies, getObservations,
  getPendingOrders, getResultInbox,
} from '../../lib/api'
import {
  attentionCount, buildAttentionGroups,
  type AttentionGroup, type AttentionItem,
} from '../../lib/attention'
import { getSession, hasPermission, initialsOf, profileOf } from '../../lib/session'
import { displayStamp } from '../../lib/time'

/** Alerts — the Clinical Attention Center (docs/design/
 *  alerts-attention-center-design.md). Closes the second dead nav item.
 *
 *  DISPLAY-ONLY (the validator's locked D6 decision): a board you look
 *  at — NO notifications, NO pop-ups, NO paging, no escalation workflows
 *  (v2, after clinical experience). Nothing here fires anything.
 *
 *  Six real sources computed at render (no stored alerts) + five honest
 *  "not tracked yet" placeholders. Acknowledging a result here calls the
 *  EXISTING inbox acknowledgment — one truth, no parallel alert state.
 *
 *  PRESENTATION (flagged choice, stated): grouped by SOURCE with the
 *  groups in fixed severity order (critical labs first) — grouped wins
 *  over a flat severity sort because the available actions differ by
 *  source (acknowledge vs informational), and severity still leads.
 *
 *  RBAC: clinical, patient-identifiable — the office Administrator NEVER
 *  sees it (locked rule). Route + nav gated on results.view (all seven
 *  clinical profiles carry it; the Administrator does not). The
 *  acknowledge ACTION additionally requires results.acknowledge — each
 *  source's existing authority, never widened here. */

type LoadState = 'loading' | 'ready' | 'unavailable'

/* the five §3 placeholders — a real capability is missing; never fabricated */
const NOT_TRACKED: { label: string; why: string }[] = [
  { label: 'Pending consultations', why: 'consults are still a mock store (no real domain) — not read, per the design' },
  { label: 'Expired medications', why: 'order duration is free text ("7 days", "ongoing") — no machine-readable end date to compute expiry from' },
  { label: 'Allergies requiring review', why: 'allergies exist and drive real order blocking, but no "requires review" state/workflow exists' },
  { label: 'Missing documentation', why: 'no note store exists and no agreed definition of completeness' },
  { label: 'Device reminders — central line / urinary catheter', why: 'no insertion-time capture (lines are a status enum, no dates) — ventilator duration IS real, above' },
]

export function Alerts() {
  const navigate = useNavigate()
  const session = getSession()!
  const { toast, showToast } = useToast()
  const canAck = hasPermission(session.jobTitle, 'results.acknowledge')
  const [state, setState] = useState<LoadState>('loading')
  const [groups, setGroups] = useState<AttentionGroup[] | null>(null)

  const load = useCallback(() => {
    Promise.all([getResultInbox(), getPendingOrders(), getEncounters({ status: 'open' })])
      .then(async ([inbox, pendingOrders, open]) => {
        const bundles = await Promise.all(open.map(async e => {
          const [observations, imaging] = await Promise.all([
            getObservations(e.patientId, e.encounterId).catch(() => null),
            getImagingStudies(e.patientId).catch(() => null),
          ])
          return { patientId: e.patientId, encounter: e, observations, imaging }
        }))
        setGroups(buildAttentionGroups({ inbox, pendingOrders, bundles, now: new Date() }))
        setState('ready')
      })
      .catch(() => setState('unavailable'))
  }, [])
  useEffect(() => { load() }, [load])

  /* the EXISTING acknowledgment — the same call the results inbox makes;
     on success the item simply disappears on reload (derived, one truth) */
  const ack = (item: AttentionItem) => {
    if (!item.ack) return
    acknowledgeResult(item.ack.kind, item.ack.id, session.name, session.jobTitle).then(okRes => {
      if (!okRes) return
      showToast('Result acknowledged', item.title)
      load()
    })
  }

  const total = groups ? attentionCount(groups) : null
  const kpis: KpiSpec[] = [
    { icon: <IconAlertTriangle size={14} stroke="var(--amber)" />, iconBg: 'rgba(255,180,84,.14)', value: total ?? '—', label: 'Attention Items' },
  ]

  // page prefix "att", NOT "al" — the shared AlertRow component already
  // owns the `.al` class (AlertRow.css), and using it as the page root
  // turned the whole frame into a flex alert-row card.
  return (
    <div className="app-frame att">
      <AppHeader
        subtitle="Alerts · Clinical Attention Center"
        kpis={kpis}
        user={{ initials: initialsOf(session.name), name: session.name, role: `${session.jobTitle} · ${profileOf(session.jobTitle)} profile` }}
      />
      <div className="shell">
        <NavSidebar active="alerts" footerLines={['Display-only attention board', 'No notifications — D6 (v2)']} />

        <main className="al-main">
          <div className="al-honesty" role="note">
            A display-only board computed at render from the live records — not an alarm system:
            no notifications, pop-ups or paging fire from this page (the validator's D6 decision;
            alerting workflows are v2). Acknowledging a result here is the same acknowledgment as
            the results inbox — one truth, no separate alert state.
          </div>

          {state === 'loading' && <div className="al-note" role="status">Deriving attention items from the live records…</div>}
          {state === 'unavailable' && (
            <div className="al-note" role="alert">
              The Attention Center requires the live server — the canonical reads are unavailable and nothing is fabricated.
            </div>
          )}

          {state === 'ready' && groups && (
            <>
              {total === 0 && (
                <div className="al-allclear" role="status">
                  Nothing needs attention right now — every source below is genuinely empty.
                </div>
              )}
              {groups.map(g => (
                <Card key={g.key} icon={<IconAlertTriangle size={15} stroke="var(--amber)" />} title={g.title}
                  aside={`${g.items.length} item${g.items.length === 1 ? '' : 's'}`}>
                  {g.note && <p className="al-gnote">{g.note}</p>}
                  {g.items.length === 0 ? (
                    <div className="al-empty">None — nothing needs attention here.</div>
                  ) : (
                    <div className="al-list">
                      {g.items.map((it, i) => (
                        <div className={`al-row al-${it.severity}`} key={`${g.key}-${i}`}>
                          <span className={`al-sev al-sev-${it.severity}`}>{it.severity === 'info' ? 'INFO' : it.severity.toUpperCase()}</span>
                          <BedChip bedId={it.bedId} />
                          <div className="al-body">
                            <b>{it.patientName}</b> — {it.title}
                            <small>
                              {it.detail}
                              {it.time && <> · {displayStamp(it.time)}</>}
                              {/* responsible clinician only where the source records one —
                                  absent sources say so rather than inventing attribution */}
                              {it.clinician ? <> · {it.clinician}</> : <> · no responsible clinician on this source</>}
                            </small>
                          </div>
                          <span className="al-acts">
                            {it.ack && canAck && (
                              <button className="al-btn" onClick={() => ack(it)} aria-label={`Acknowledge: ${it.title}`}>✓ Acknowledge</button>
                            )}
                            <button className="al-btn" onClick={() => navigate(it.openPath)} aria-label={`Open patient ${it.patientName}`}>Open patient →</button>
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
              ))}

              <Card title="Not tracked yet" aside="capability missing — never fabricated">
                <div className="al-ntlist">
                  {NOT_TRACKED.map(n => (
                    <div className="al-ntrow" key={n.label}>
                      <span className="al-ntbadge">not tracked yet</span>
                      <div className="al-body"><b>{n.label}</b><small>{n.why}</small></div>
                    </div>
                  ))}
                </div>
              </Card>
            </>
          )}
        </main>
      </div>
      <Toast state={toast} accent="amber" />
    </div>
  )
}
