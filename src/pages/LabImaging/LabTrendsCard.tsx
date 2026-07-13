import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Card } from '../../components/Card'
import { Badge } from '../../components/Badge'
import { Sparkline } from '../../components/Sparkline'
import { IconFlask } from '../../components/icons'
import { agoLabel, useNow } from '../../lib/time'
import type { LabDraw, LabPanelKey, ResultFlag } from '../../lib/api/types'

const FLAG_META: Record<ResultFlag, { label: string; cls: string }> = {
  normal: { label: 'NORMAL', cls: 'fl-normal' },
  abnormal: { label: 'ABN', cls: 'fl-abnormal' },
  critical: { label: 'CRIT', cls: 'fl-critical' },
}

const FLAG_COLOR: Record<ResultFlag, string> = {
  normal: '#3de8a0',
  abnormal: '#ffb454',
  critical: '#ff5d6c',
}

/** Per-patient lab results with trend charts — one analyte charted at a time
 *  with its real units and reference band. View-only (acknowledge lives in
 *  the results inbox). */
export function LabTrendsCard({ draws: allDraws }: { draws: LabDraw[] }) {
  const now = useNow()
  /* Custom / Other results are UNSTRUCTURED (no numeric analytes, no
     reference band) — not chartable here. They stay out of the trends card
     and surface tagged "custom" in the lab-entry Results-on-File list. */
  const draws = useMemo(() => allDraws.filter(d => !d.custom), [allDraws])
  const panels = useMemo(() => [...new Set(draws.map(d => d.panel))], [draws])
  const [panel, setPanel] = useState<LabPanelKey | null>(null)
  const [analyte, setAnalyte] = useState<string | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const activePanel = panel && panels.includes(panel) ? panel : panels[0]
  const panelDraws = useMemo(
    () => draws.filter(d => d.panel === activePanel),
    [draws, activePanel],
  )
  const latest = panelDraws[panelDraws.length - 1]
  const analytes = latest?.items ?? []
  const activeAnalyte = analyte && analytes.some(i => i.analyte === analyte) ? analyte : analytes[0]?.analyte

  const series = useMemo(() => panelDraws.map(d => {
    const item = d.items.find(i => i.analyte === activeAnalyte)
    return { label: d.label, value: item?.value ?? 0, flag: item?.flag ?? 'normal' as ResultFlag }
  }), [panelDraws, activeAnalyte])
  const refItem = latest?.items.find(i => i.analyte === activeAnalyte)

  const draw = useCallback(() => {
    const cv = canvasRef.current
    if (!cv || !refItem || series.length === 0) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const r = cv.getBoundingClientRect()
    cv.width = r.width * dpr
    cv.height = r.height * dpr
    const c = cv.getContext('2d')!
    c.setTransform(dpr, 0, 0, dpr, 0, 0)
    const W = r.width, H = r.height, padL = 44, padR = 14, padT = 14, padB = 24
    c.clearRect(0, 0, W, H)

    const vals = series.map(s => s.value)
    let mn = Math.min(...vals, refItem.refLow)
    let mx = Math.max(...vals, Math.min(refItem.refHigh, Math.max(...vals) * 1.5 + 1))
    const sp = (mx - mn) || 1
    mn -= sp * 0.15
    mx += sp * 0.15
    const X = (i: number) => padL + (i / Math.max(series.length - 1, 1)) * (W - padL - padR)
    const Y = (v: number) => padT + (1 - (v - mn) / (mx - mn)) * (H - padT - padB)

    /* reference band */
    const bandTop = Y(Math.min(refItem.refHigh, mx))
    const bandBot = Y(Math.max(refItem.refLow, mn))
    c.fillStyle = 'rgba(61,232,160,.08)'
    c.fillRect(padL, bandTop, W - padL - padR, Math.max(bandBot - bandTop, 0))
    c.strokeStyle = 'rgba(61,232,160,.3)'
    c.setLineDash([4, 5])
    for (const bound of [refItem.refLow, refItem.refHigh]) {
      if (bound > mn && bound < mx) {
        c.beginPath(); c.moveTo(padL, Y(bound)); c.lineTo(W - padR, Y(bound)); c.stroke()
      }
    }
    c.setLineDash([])

    /* grid + labels */
    c.strokeStyle = 'rgba(130,170,230,.12)'
    c.lineWidth = 1
    c.font = '10px ' + getComputedStyle(document.body).getPropertyValue('--mono')
    c.fillStyle = 'rgba(143,163,188,.8)'
    c.textAlign = 'center'
    series.forEach((s, i) => {
      c.beginPath(); c.moveTo(X(i), padT); c.lineTo(X(i), H - padB); c.stroke()
      c.fillText(s.label, X(i), H - 8)
    })
    for (let j = 0; j <= 3; j++) {
      const y = padT + (j / 3) * (H - padT - padB)
      c.beginPath(); c.moveTo(padL, y); c.lineTo(W - padR, y); c.stroke()
      c.textAlign = 'right'
      c.fillText((mx - (j / 3) * (mx - mn)).toFixed(1), padL - 6, y + 3)
      c.textAlign = 'center'
    }

    /* series line + flag-colored points */
    c.strokeStyle = '#4da3ff'
    c.lineWidth = 2
    c.lineJoin = 'round'
    c.beginPath()
    series.forEach((s, i) => (i ? c.lineTo(X(i), Y(s.value)) : c.moveTo(X(i), Y(s.value))))
    c.stroke()
    series.forEach((s, i) => {
      c.fillStyle = FLAG_COLOR[s.flag]
      c.beginPath()
      c.arc(X(i), Y(s.value), s.flag === 'normal' ? 3 : 4.2, 0, 7)
      c.fill()
    })
  }, [series, refItem])

  useEffect(() => {
    draw()
    window.addEventListener('resize', draw)
    return () => window.removeEventListener('resize', draw)
  }, [draw])

  if (!panels.length) {
    return (
      <Card icon={<IconFlask size={15} stroke="var(--blue)" />} title="Laboratory Results" aside="canonical record">
        <div className="liempty">No lab results on file for this patient yet.</div>
      </Card>
    )
  }

  return (
    <Card icon={<IconFlask size={15} stroke="var(--blue)" />} title="Laboratory Results"
      aside={latest ? <>latest {activePanel} resulted {latest.resultedAt} · {agoLabel(latest.resultedAt, now)}</> : 'canonical record'}>
      <div className="litabs" role="tablist">
        {panels.map(p => (
          <button key={p} role="tab" aria-selected={p === activePanel} className={`litab${p === activePanel ? ' on' : ''}`}
            onClick={() => { setPanel(p); setAnalyte(null) }}>
            {p}
          </button>
        ))}
      </div>

      <canvas className="lichart" ref={canvasRef} aria-label={`${activeAnalyte} trend chart`} />
      <div className="lichartmeta">
        <span><i className="liband" /> reference range {refItem?.refRange} {refItem?.unit}</span>
        {/* Lab Result-Entry design §5: surface how the latest draw ENTERED
            Aurora — a manually-documented result is provenance-flagged so a
            future LIS feed stays distinguishable */}
        {latest?.source === 'manual' && <span className="lisource" title="manually documented by the ICU bedside team">✎ manually documented</span>}
        {latest && (
          <span className={latest.acknowledged ? 'liacked' : 'liunacked'}>
            {latest.acknowledged
              ? `✓ acknowledged${latest.acknowledgedBy ? ` by ${latest.acknowledgedBy}` : ''}${latest.acknowledgedAt ? ` · ${latest.acknowledgedAt}` : ''}`
              : '● latest draw unacknowledged'}
          </span>
        )}
      </div>
      {/* display fix (bug 2): the note recorded with a draw was stored but
          never shown here — surface the latest draw's note with its time */}
      {latest?.note && (
        <div className="linote">note ({latest.resultedAt}): {latest.note}</div>
      )}

      <div className="lianalytes">
        {analytes.map(item => {
          const vals = panelDraws.map(d => d.items.find(i => i.analyte === item.analyte)?.value ?? 0)
          const meta = FLAG_META[item.flag]
          return (
            <button
              key={item.analyte}
              className={`liarow${item.analyte === activeAnalyte ? ' on' : ''}`}
              aria-pressed={item.analyte === activeAnalyte}
              onClick={() => setAnalyte(item.analyte)}
            >
              <span className="lianame">{item.analyte}</span>
              <span className={`liaval num ${meta.cls}`}>{Number.isInteger(item.value) ? item.value : item.value.toFixed(item.value < 10 ? 2 : 1)}<small>{item.unit}</small></span>
              <span className="liaref num">{item.refRange}</span>
              <Badge color={item.flag === 'critical' ? 'red' : item.flag === 'abnormal' ? 'amber' : 'green'}>{meta.label}</Badge>
              <Sparkline data={vals} color={FLAG_COLOR[item.flag]} width={64} height={20} />
            </button>
          )
        })}
      </div>
    </Card>
  )
}
