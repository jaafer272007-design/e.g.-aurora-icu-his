import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card } from '../../components/Card'
import { IconFlask } from '../../components/icons'
import type { Labs } from '../../lib/api/types'
import { tokenRgba, useThemeVersion } from '../../hooks/useCanvasTheme'

/* LABORATORY RESULTS (renamed from "Laboratory Trends", ICU update
   2026-10-15, owner's plan §3) — the same derived panels, latest values
   and trend chart as before, plus a link to the full results screen. The
   caller gates it on results.view (the server's gate on the lab read). */
export function LabsCard({ labs, patientId }: { labs: Labs; patientId: string }) {
  const navigate = useNavigate()
  const [tab, setTab] = useState(labs.panels[0]?.name ?? 'CBC')
  const [hover, setHover] = useState<number | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const themeV = useThemeVersion() // canvas colours re-resolve on theme change
  const panel = labs.panels.find(p => p.name === tab) ?? labs.panels[0]
  const times = labs.drawTimes
  /* a trend needs a series with two or more points (a panel drawn once has
     none) — without one the chart would plot NaN axes, so it is not drawn
     and the latest values below stand alone */
  const hasTrend = !!panel && times.length >= 2 && panel.series.some(s => s.points.length >= 2)

  const draw = useCallback(() => {
    const cv = canvasRef.current
    if (!cv || !panel) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const r = cv.getBoundingClientRect()
    cv.width = r.width * dpr
    cv.height = r.height * dpr
    const c = cv.getContext('2d')!
    c.setTransform(dpr, 0, 0, dpr, 0, 0)
    const W = r.width, H = r.height, padL = 34, padR = 12, padT = 12, padB = 22
    c.clearRect(0, 0, W, H)
    const all = panel.series.flatMap(s => s.points)
    let mn = Math.min(...all), mx = Math.max(...all)
    const sp = (mx - mn) || 1
    mn -= sp * 0.12
    mx += sp * 0.12
    const X = (i: number) => padL + (i / (times.length - 1)) * (W - padL - padR)
    const Y = (v: number) => padT + (1 - (v - mn) / (mx - mn)) * (H - padT - padB)
    c.strokeStyle = tokenRgba('--steel-rgb', .12)
    c.lineWidth = 1
    c.font = '10px ' + getComputedStyle(document.body).getPropertyValue('--mono')
    c.fillStyle = tokenRgba('--dim-rgb', .8)
    c.textAlign = 'center'
    for (let i = 0; i < times.length; i++) {
      c.beginPath(); c.moveTo(X(i), padT); c.lineTo(X(i), H - padB); c.stroke()
      c.fillText(times[i], X(i), H - 8)
    }
    for (let j = 0; j <= 3; j++) {
      const y = padT + (j / 3) * (H - padT - padB)
      c.beginPath(); c.moveTo(padL, y); c.lineTo(W - padR, y); c.stroke()
      c.textAlign = 'right'
      c.fillText((mx - (j / 3) * (mx - mn)).toFixed(1), padL - 6, y + 3)
      c.textAlign = 'center'
    }
    panel.series.forEach(({ color, points }) => {
      c.strokeStyle = color
      c.lineWidth = 2
      c.lineJoin = 'round'
      c.beginPath()
      points.forEach((v, i) => (i ? c.lineTo(X(i), Y(v)) : c.moveTo(X(i), Y(v))))
      c.stroke()
      c.fillStyle = color
      points.forEach((v, i) => {
        c.beginPath()
        c.arc(X(i), Y(v), hover === i ? 4.5 : 2.6, 0, 7)
        c.fill()
      })
    })
    if (hover !== null) {
      c.strokeStyle = tokenRgba('--text-rgb', .35)
      c.setLineDash([3, 4])
      c.beginPath(); c.moveTo(X(hover), padT); c.lineTo(X(hover), H - padB); c.stroke()
      c.setLineDash([])
      const lines = panel.series.map(s => ({ t: s.points[hover].toFixed(1), col: s.color }))
      const bw = 54, bh = 14 * lines.length + 10
      let bx = X(hover) + 10
      if (bx + bw > W - 6) bx = X(hover) - bw - 10
      c.fillStyle = tokenRgba('--glass2-rgb', .94)
      c.strokeStyle = tokenRgba('--steel-rgb', .3)
      c.beginPath(); c.roundRect(bx, padT + 4, bw, bh, 8); c.fill(); c.stroke()
      lines.forEach((l, k) => {
        c.fillStyle = l.col
        c.textAlign = 'left'
        c.fillText(l.t, bx + 10, padT + 20 + k * 14)
      })
    }
  }, [panel, times, hover, themeV])

  useEffect(() => {
    draw()
    window.addEventListener('resize', draw)
    return () => window.removeEventListener('resize', draw)
  }, [draw])

  const onMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const padL = 34, padR = 12
    const x = e.clientX - r.left
    let i = Math.round((x - padL) / ((r.width - padL - padR) / (times.length - 1)))
    i = Math.max(0, Math.min(times.length - 1, i))
    if (i !== hover) setHover(i)
  }

  if (!labs.panels.length) {
    return (
      <Card id="labs" icon={<IconFlask size={15} stroke="var(--blue)" />} title="Laboratory Results" aside="from results store">
        <div className="labempty">No lab results on file for this patient yet.</div>
        <div className="cardfoot"><span /><button className="obclink" onClick={() => navigate(`/labs/${patientId}`)}>Labs &amp; Imaging →</button></div>
      </Card>
    )
  }

  return (
    <Card id="labs" icon={<IconFlask size={15} stroke="var(--blue)" />} title="Laboratory Results" aside="Recent draws · tap a series">
      <div className="tabs" role="tablist">
        {labs.panels.map(p => (
          <button key={p.name} role="tab" aria-selected={p.name === tab} className={`tab${p.name === tab ? ' on' : ''}`} onClick={() => setTab(p.name)}>
            {p.name}
          </button>
        ))}
      </div>
      {hasTrend ? (<>
        <canvas id="labChart" ref={canvasRef} onMouseMove={onMove} onMouseLeave={() => setHover(null)} />
        <div className="legend">
          {panel.series.map(s => <span key={s.label} className="lg"><i style={{ background: s.color }} />{s.label}</span>)}
        </div>
      </>) : (
        <div className="labnotrend">No trend for {panel.name} yet — fewer than two draws of this panel. Latest values below.</div>
      )}
      <div className="labvals">
        {panel.results.map(v => <span key={v.analyte} className={`lv ${v.flag}`}>{v.analyte} <b>{v.value}</b></span>)}
      </div>
      <div className="cardfoot"><span /><button className="obclink" onClick={() => navigate(`/labs/${patientId}`)}>Labs &amp; Imaging →</button></div>
    </Card>
  )
}
