import { useMemo, useState } from 'react'
import { Card } from '../../components/Card'
import { IconFlask } from '../../components/icons'
import type { LabTest, OrderPriority } from '../../lib/api/types'

interface LabOrderCardProps {
  catalog: LabTest[]
  onOrder: (test: LabTest, priority: OrderPriority, sign: boolean) => void
}

/** Layer 4 phase 2 — catalogue-driven lab ordering: the Orders screen
 *  reads the lab test catalogue from the API and places a Lab order
 *  carrying the test's id (the order half of the order→result linkage —
 *  the technician's result for the same test auto-links to it). INACTIVE
 *  tests are excluded from selection (the server 409s them regardless). */
export function LabOrderCard({ catalog, onOrder }: LabOrderCardProps) {
  const [query, setQuery] = useState('')
  const [priority, setPriority] = useState<OrderPriority>('Routine')

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return catalog
      .filter(t => t.active !== false)
      .filter(t => t.name.toLowerCase().includes(q) || t.testId.toLowerCase().includes(q)
        || t.category.toLowerCase().includes(q))
      .slice(0, 5)
  }, [query, catalog])

  return (
    <Card icon={<IconFlask size={15} stroke="var(--cyan)" />} title="Order Lab Test" aside="from the lab catalogue">
      <div className="omlabrow">
        <input
          value={query} onChange={e => setQuery(e.target.value)}
          placeholder="Search catalogue — test or category…" aria-label="Search lab test catalogue"
          className="omlabsearch"
        />
        <select value={priority} onChange={e => setPriority(e.target.value as OrderPriority)} aria-label="Priority">
          {(['Routine', 'Urgent', 'STAT'] as const).map(p => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>
      {results.map(t => (
        <div className="omlabhit" key={t.testId}>
          <span>
            <b>{t.name}</b> <small className="num">{t.testId}</small>
            <small className="omlabmeta"> · {t.category} · {t.specimen}</small>
          </span>
          <span className="omlabacts">
            <button className="btn ghost" onClick={() => { onOrder(t, priority, false); setQuery('') }}>Pending</button>
            <button className="btn primary" onClick={() => { onOrder(t, priority, true); setQuery('') }}>Sign &amp; order</button>
          </span>
        </div>
      ))}
      {query.trim() && results.length === 0 && <div className="omempty">No catalogue match for "{query}".</div>}
      {!query.trim() && <div className="omempty">Search the catalogue to order a test.</div>}
    </Card>
  )
}
