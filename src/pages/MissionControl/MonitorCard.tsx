import { useEffect, useRef, useState } from 'react'
import { Card } from '../../components/Card'
import { Badge } from '../../components/Badge'
import { VitalTile } from '../../components/VitalTile'
import { IconPulse } from '../../components/icons'
import { useReducedMotion } from '../../hooks/useClock'
import type { MonitorVitals } from '../../lib/api/types'

/* ---- waveform generators (ported 1:1 from the reference prototype) ---- */
const g = (t: number, c: number, w: number) => Math.exp(-(((t - c) / w) ** 2))
const GEN = {
  ecg: (t: number) => 0.14 * g(t, 0.16, 0.03) - 0.13 * g(t, 0.235, 0.012) + 1 * g(t, 0.262, 0.011) - 0.26 * g(t, 0.29, 0.014) + 0.28 * g(t, 0.5, 0.05),
  art: (t: number) => Math.max(0, Math.sin(Math.PI * Math.min(t * 2.7, 1))) * Math.exp(-t * 1.7) + 0.16 * g(t, 0.42, 0.045),
  ple: (t: number) => Math.max(0, Math.sin(Math.PI * Math.min(t * 2.1, 1))) * Math.exp(-t * 1.3),
  rsp: (t: number) => (Math.sin(2 * Math.PI * t - Math.PI / 2) + 1) / 2,
  co2: (t: number) => (t < 0.06 ? t / 0.06 : t < 0.55 ? 1 + 0.06 * (t - 0.06) : t < 0.64 ? 1.03 * (1 - (t - 0.55) / 0.09) : 0),
}

interface WfChannel {
  cv: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  gen: (t: number) => number
  color: string
  slow: boolean
  amp: number
  x: number
  py: number | null
  W: number
  H: number
}

interface Display {
  hr: number
  spo2: number
  sys: number
  dia: number
  map: number
  rr: number
  co2: number
  temp: number
  cvp: number
}

const fromBase = (v: MonitorVitals, hard: boolean): Display => {
  const j = (x: number, a: number) => x + (hard ? 0 : (Math.random() - 0.5) * a)
  const sys = Math.round(j(v.sys, 4))
  const dia = Math.round(j(v.dia, 3))
  return {
    hr: Math.round(j(v.hr, 3)),
    spo2: Math.min(100, Math.round(j(v.spo2, 1.2))),
    sys, dia,
    map: Math.round((sys + 2 * dia) / 3),
    rr: Math.round(j(v.rr, 1.6)),
    co2: Math.round(j(v.etco2, 1.4)),
    temp: j(v.temp, 0.08),
    cvp: Math.round(j(v.cvp, 0.8)),
  }
}

export function MonitorCard({ vitals, rhythm }: { vitals: MonitorVitals; rhythm: string }) {
  const reduced = useReducedMotion()
  const [d, setD] = useState<Display>(() => fromBase(vitals, true))
  const rates = useRef({ hr: vitals.hr, rr: vitals.rr })
  const ecgRef = useRef<HTMLCanvasElement>(null)
  const artRef = useRef<HTMLCanvasElement>(null)
  const pleRef = useRef<HTMLCanvasElement>(null)
  const rspRef = useRef<HTMLCanvasElement>(null)
  const co2Ref = useRef<HTMLCanvasElement>(null)

  /* live vitals jitter, hard-reset whenever the selected patient changes */
  useEffect(() => {
    const set = (hard: boolean) => {
      const next = fromBase(vitals, hard)
      rates.current = { hr: next.hr, rr: next.rr }
      setD(next)
    }
    set(true)
    if (reduced) return
    const t = setInterval(() => set(false), 2500)
    return () => clearInterval(t)
  }, [vitals, reduced])

  /* sweeping waveform engine */
  useEffect(() => {
    const defs: [React.RefObject<HTMLCanvasElement>, (t: number) => number, string, boolean, number][] = [
      [ecgRef, GEN.ecg, '#3de8a0', false, 0.68],
      [artRef, GEN.art, '#ff5d6c', false, 0.6],
      [pleRef, GEN.ple, '#35e0d0', false, 0.58],
      [rspRef, GEN.rsp, '#ffb454', true, 0.55],
      [co2Ref, GEN.co2, '#dfe8f4', true, 0.6],
    ]
    const list: WfChannel[] = []
    for (const [ref, gen, color, slow, amp] of defs) {
      const cv = ref.current
      if (!cv) return
      list.push({ cv, ctx: cv.getContext('2d')!, gen, color, slow, amp, x: 0, py: null, W: 0, H: 0 })
    }
    const size = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      list.forEach(w => {
        const r = w.cv.getBoundingClientRect()
        w.cv.width = r.width * dpr
        w.cv.height = r.height * dpr
        w.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        w.W = r.width
        w.H = r.height
        w.x = 0
        w.py = null
        w.ctx.clearRect(0, 0, w.W, w.H)
      })
    }
    const drawStatic = () => {
      list.forEach(w => {
        const c = w.ctx
        c.clearRect(0, 0, w.W, w.H)
        c.strokeStyle = w.color
        c.lineWidth = 1.8
        c.beginPath()
        const freq = w.slow ? 2 : 4
        for (let x = 0; x <= w.W; x++) {
          const ph = ((x / w.W) * freq) % 1
          const y = w.H * (0.86 - w.amp * w.gen(ph))
          if (x) c.lineTo(x, y)
          else c.moveTo(x, y)
        }
        c.stroke()
      })
    }
    size()
    let raf = 0
    let LT = performance.now()
    const loop = (now: number) => {
      const dt = Math.min((now - LT) / 1000, 0.05)
      LT = now
      const T = now / 1000
      list.forEach(w => {
        const freq = (w.slow ? rates.current.rr : rates.current.hr) / 60
        const speed = w.slow ? 46 : 110
        let nx = w.x + speed * dt
        const c = w.ctx
        c.clearRect(w.x, 0, Math.min(nx - w.x + 22, w.W - w.x), w.H)
        if (nx >= w.W) {
          c.clearRect(w.x, 0, w.W - w.x, w.H)
          nx = 0
          w.py = null
          c.clearRect(0, 0, 24, w.H)
        }
        const ph = (T * freq) % 1
        const y = w.H * (0.86 - w.amp * w.gen(ph) * (w.gen === GEN.rsp || w.gen === GEN.co2 ? 0.9 : 1))
        c.strokeStyle = w.color
        c.lineWidth = 1.8
        c.lineCap = 'round'
        c.shadowColor = w.color
        c.shadowBlur = reduced ? 0 : 6
        if (w.py !== null && nx > w.x) {
          c.beginPath()
          c.moveTo(w.x, w.py)
          c.lineTo(nx, y)
          c.stroke()
        }
        w.x = nx
        w.py = y
      })
      raf = requestAnimationFrame(loop)
    }
    const relayout = () => {
      size()
      if (reduced) drawStatic()
    }
    window.addEventListener('resize', relayout)
    if (reduced) drawStatic()
    else raf = requestAnimationFrame(t => { LT = t; loop(t) })
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', relayout)
    }
  }, [reduced])

  const hrCrit = d.hr > 130 || d.hr < 45
  const spo2Crit = d.spo2 < 94
  const mapCrit = d.map < 65

  return (
    <Card id="monitor" icon={<IconPulse size={15} stroke="var(--green)" />} title="Live Physiologic Monitor"
      aside={<>Lead II · 25 mm/s · <Badge color="green">STREAMING</Badge></>}>
      <div className="wfrow">
        <div className="wfwrap"><span className="wflabel" style={{ color: 'var(--green)' }}>ECG · II</span><canvas ref={ecgRef} /></div>
        <div className="vtcol"><span className="lbl" style={{ color: 'var(--green)' }}>Heart Rate</span>
          <div className="vt-read" style={{ color: 'var(--green)' }}><span className={`big${hrCrit ? ' crit' : ''}`}>{d.hr}</span><span className="u">bpm</span></div></div>
      </div>
      <div className="wfrow">
        <div className="wfwrap"><span className="wflabel" style={{ color: 'var(--red)' }}>ART · IBP</span><canvas ref={artRef} /></div>
        <div className="vtcol"><span className="lbl" style={{ color: 'var(--red)' }}>IBP · MAP</span>
          <div className={`vt-read${mapCrit ? ' crit' : ''}`} style={{ color: 'var(--red)' }}><span className="med">{d.sys}/{d.dia}</span><span className="u">({d.map})</span></div></div>
      </div>
      <div className="wfrow">
        <div className="wfwrap"><span className="wflabel" style={{ color: 'var(--cyan)' }}>PLETH</span><canvas ref={pleRef} /></div>
        <div className="vtcol"><span className="lbl" style={{ color: 'var(--cyan)' }}>SpO₂</span>
          <div className="vt-read" style={{ color: 'var(--cyan)' }}><span className={`big${spo2Crit ? ' crit' : ''}`}>{d.spo2}</span><span className="u">%</span></div></div>
      </div>
      <div className="wfrow">
        <div className="wfwrap"><span className="wflabel" style={{ color: 'var(--amber)' }}>RESP</span><canvas ref={rspRef} /></div>
        <div className="vtcol"><span className="lbl" style={{ color: 'var(--amber)' }}>Resp Rate</span>
          <div className="vt-read" style={{ color: 'var(--amber)' }}><span className="med">{d.rr}</span><span className="u">/min</span></div></div>
      </div>
      <div className="wfrow">
        <div className="wfwrap"><span className="wflabel" style={{ color: '#dfe8f4' }}>EtCO₂</span><canvas ref={co2Ref} /></div>
        <div className="vtcol"><span className="lbl">EtCO₂</span>
          <div className="vt-read" style={{ color: '#dfe8f4' }}><span className="med">{d.co2}</span><span className="u">mmHg</span></div></div>
      </div>
      <div className="substrip">
        <VitalTile variant="mini" label="NIBP" value={`${vitals.nibpSys}/${vitals.nibpDia}`} unit="mmHg" />
        <VitalTile variant="mini" label="Temperature" value={d.temp.toFixed(1)} unit="°C" />
        <VitalTile variant="mini" label="CVP" value={d.cvp} unit="mmHg" />
        <VitalTile variant="mini" label="Rhythm" value={rhythm} valueStyle={{ fontSize: 14, paddingTop: 4 }} />
      </div>
    </Card>
  )
}
