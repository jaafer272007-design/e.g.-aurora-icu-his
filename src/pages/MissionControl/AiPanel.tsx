import { useEffect, useState } from 'react'
import { Card } from '../../components/Card'
import type { AiRisk } from '../../lib/api/types'

const riskColor = (x: number) => (x >= 70 ? 'var(--red)' : x >= 40 ? 'var(--amber)' : 'var(--green)')

function RiskBar({ pct }: { pct: number }) {
  const [w, setW] = useState(0)
  useEffect(() => {
    setW(0)
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => setW(pct)))
    return () => cancelAnimationFrame(raf)
  }, [pct])
  return (
    <div className="aibar"><i style={{ width: `${w}%`, background: riskColor(pct) }} /></div>
  )
}

export function AiPanel({ risks }: { risks: AiRisk[] }) {
  return (
    <Card className="ai"
      icon={<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--violet)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a4 4 0 014 4c2.5.5 4 2.5 4 5a5 5 0 01-3 4.6V17a4 4 0 01-4 4 4 4 0 01-4-4v-1.4A5 5 0 014 11c0-2.5 1.5-4.5 4-5a4 4 0 014-4z" /><path d="M12 6v12" /></svg>}
      title="Predictive AI · Clinical Risk" aside="Simulated · updated q15min"
    >
      <div>
        {risks.map(r => (
          <div className="airow" key={r.name}>
            <div className="aihead">
              <span className="an">{r.name} Risk</span>
              <span className="ap num" style={{ color: riskColor(r.probability) }}>{r.probability}%</span>
            </div>
            <RiskBar pct={r.probability} />
            <div className="aiex">{r.rationale}</div>
          </div>
        ))}
      </div>
    </Card>
  )
}
