import { useMemo, useState } from 'react'
import { Card } from '../../components/Card'
import { Badge } from '../../components/Badge'
import { checkMedicationSafety } from '../../lib/api/safety'
import type {
  FormularyDrug, InteractionRule, Order, OrderSetDef, OrderSetItemTemplate, SafetyIssue,
} from '../../lib/api/types'

interface OrderSetsCardProps {
  sets: OrderSetDef[]
  patient: { patientId: string; allergies: string }
  formulary: FormularyDrug[]
  rules: InteractionRule[]
  orders: Order[]
  /** the applier's orders.sign entitlement — applied orders INHERIT it
   *  exactly like a manual order (signer → signed & active, non-signer →
   *  pending); the button label states which */
  canSign: boolean
  /** adds the expandable items as individual orders (blocked items skipped) */
  onExpand: (set: OrderSetDef, items: OrderSetItemTemplate[], skipped: string[]) => void
}

/** Order sets — each expands into individual orders, safety-checked per item
 *  against the selected patient before anything is added. */
export function OrderSetsCard({ sets, patient, formulary, rules, orders, canSign, onExpand }: OrderSetsCardProps) {
  const [open, setOpen] = useState<string | null>(null)

  const itemSafety = useMemo(() => {
    const map = new Map<string, SafetyIssue[]>()
    for (const s of sets) {
      s.items.forEach((it, idx) => {
        if (!it.medication) return
        const drug = formulary.find(d => d.drugId === it.medication!.drugId)
        if (!drug) return
        map.set(`${s.setId}:${idx}`, checkMedicationSafety(drug, patient.allergies, orders, rules))
      })
    }
    return map
  }, [sets, formulary, patient.allergies, orders, rules])

  const expand = (s: OrderSetDef) => {
    const ok: OrderSetItemTemplate[] = []
    const skipped: string[] = []
    s.items.forEach((it, idx) => {
      const issues = itemSafety.get(`${s.setId}:${idx}`) ?? []
      if (issues.some(i => i.severity === 'block')) skipped.push(it.medication?.drug ?? it.summary ?? 'item')
      else ok.push(it)
    })
    onExpand(s, ok, skipped)
  }

  return (
    <Card
      icon={<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--violet)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="4" rx="1" /><rect x="3" y="10" width="18" height="4" rx="1" /><rect x="3" y="16" width="18" height="4" rx="1" /></svg>}
      title="Order Sets"
      aside="expand into individual orders"
    >
      {sets.map(s => {
        const isOpen = open === s.setId
        const blockedCount = s.items.filter((_, idx) =>
          (itemSafety.get(`${s.setId}:${idx}`) ?? []).some(i => i.severity === 'block')).length
        return (
          <div className="osset" key={s.setId}>
            <button className="ossethead" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : s.setId)}>
              <b>{s.name}</b>
              <span className="ossetdesc">{s.description}</span>
              <span className="ossetn num">{s.items.length} items {isOpen ? '▴' : '▾'}</span>
            </button>
            {isOpen && (
              <div className="ossetbody">
                {s.items.map((it, idx) => {
                  const issues = itemSafety.get(`${s.setId}:${idx}`) ?? []
                  const blocked = issues.some(i => i.severity === 'block')
                  const warned = !blocked && issues.some(i => i.severity === 'warn')
                  return (
                    <div className={`ositem${blocked ? ' blocked' : ''}`} key={idx}>
                      <Badge color={it.category === 'Medication' ? 'green' : it.category === 'Lab' ? 'blue' : 'amber'}>
                        {it.category.toUpperCase()}
                      </Badge>
                      <span className="ositemtext">
                        {it.medication
                          ? `${it.medication.drug} ${it.medication.dose} · ${it.medication.route} · ${it.medication.frequency}`
                          : it.summary}
                      </span>
                      {blocked && <span className="osflag block">⛔ blocked — allergy</span>}
                      {warned && <span className="osflag warn">⚠ warning</span>}
                    </div>
                  )
                })}
                <button className="btn primary ossetadd" onClick={() => expand(s)} disabled={s.items.length === blockedCount}>
                  Add {s.items.length - blockedCount} order{s.items.length - blockedCount === 1 ? '' : 's'} {canSign ? 'signed & active' : 'as pending'}
                  {blockedCount > 0 && ` (${blockedCount} blocked, skipped)`}
                </button>
              </div>
            )}
          </div>
        )
      })}
    </Card>
  )
}
