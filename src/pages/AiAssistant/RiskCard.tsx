import { useState } from 'react'
import { Sparkline } from '../../components/Sparkline'
import { riskTrendOf } from '../../lib/api'
import type { RiskPrediction, RiskTrend } from '../../lib/api/types'

/* one prediction card — everything on it is read-only; suggestions are
   advisory text and never trigger an order */

export const riskColor = (x: number) => (x >= 70 ? 'var(--red)' : x >= 40 ? 'var(--amber)' : 'var(--green)')

export function trendLabel(trend: RiskTrend, delta: number): string {
  if (trend === 'rising') return `▲ Rising +${delta} / 2 h`
  if (trend === 'falling') return `▼ Falling ${delta} / 2 h`
  return '— Stable / 2 h'
}

export function RiskCard({ risk }: { risk: RiskPrediction }) {
  const [open, setOpen] = useState(false)
  const trend = riskTrendOf(risk.history)
  const delta = risk.probability - risk.history[0]
  const color = riskColor(risk.probability)

  return (
    <article className={`riskcard${risk.probability >= 70 ? ' crit' : ''}`}>
      <div className="rkhead">
        <h3>{risk.category} Risk</h3>
        <span className={`rktrend t-${trend}`}>{trendLabel(trend, delta)}</span>
        <span className="rkpct num" style={{ color }}>{risk.probability}%</span>
      </div>
      <div className="rkspark">
        <Sparkline data={risk.history} color={color} width={150} height={30} />
        <small>q15min ticks · ~2 h window · simulated</small>
      </div>
      <p className="rkrationale">{risk.rationale}</p>

      <button className="rkexpand" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        Contributing factors ({risk.factors.length}) {open ? '▴' : '▾'}
      </button>
      {open && (
        <div className="rkfactors">
          {risk.factors.map(f => (
            <div className="rkfac" key={f.label}>
              <span className={`rkflabel${f.mitigating ? ' mit' : ''}`}>
                {f.label}
                {f.mitigating && <i className="rkmit">mitigating</i>}
              </span>
              <span className="rkfbar"><i style={{ width: `${f.weight}%`, background: f.mitigating ? 'var(--green)' : color }} /></span>
              <span className="rkfw num">{f.weight}%</span>
            </div>
          ))}
        </div>
      )}

      {risk.suggestions && risk.suggestions.length > 0 && (
        <div className="rksugg">
          <div className="rksugghead">Suggested actions — advisory only</div>
          <ul>
            {risk.suggestions.map(s => <li key={s}>{s}</li>)}
          </ul>
          <small>The assistant never places orders or acts autonomously.</small>
        </div>
      )}
    </article>
  )
}
