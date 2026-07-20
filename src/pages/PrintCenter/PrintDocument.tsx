import { useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import './print.css'
import { NotFoundCard } from '../../components/NotFoundCard'
import { getSession } from '../../lib/session'
import { PrintLayout } from './PrintLayout'
import { templateById } from './registry'
import type { PrintContext } from './types'
import { clockZone, localStamp } from '../../lib/time'
import { defaultFormat, formatClasses, formatCss, type PrintFormat } from './format'

/** /print/:templateId/:patientId(?enc=ENC-xxxx) — the printable document.
 *  On screen: a paper preview with a toolbar (hidden when printing).
 *  Printing is the browser's own print / print-preview / save-as-PDF via
 *  window.print() — no application chrome renders on this route at all. */
export function PrintDocument() {
  const { templateId, patientId } = useParams()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const template = templateById(templateId)
  const session = getSession()

  const [state, setState] = useState<{ context: PrintContext } | null | 'loading'>('loading')
  const [printedAt, setPrintedAt] = useState('')
  /* per-print formatting (APPLY-AND-PRINT): fresh defaults on every
     document open — the registry's orientation seeds the default */
  const [fmt, setFmt] = useState<PrintFormat>(() => defaultFormat(template?.orientation ?? 'portrait'))
  const [fmtOpen, setFmtOpen] = useState(false)
  useEffect(() => {
    setFmt(defaultFormat(template?.orientation ?? 'portrait'))
    setFmtOpen(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateId, patientId])

  useEffect(() => {
    if (!template || !patientId) return
    let live = true
    template.load(patientId, params.get('enc') ?? undefined).then(d => {
      if (!live) return
      setState(d)
      /* generation metadata — the one clock-derived line on the page */
      setPrintedAt(`${localStamp(Date.now())} ${clockZone() ?? 'local time'}`)
    })
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateId, patientId])

  useEffect(() => {
    if (template && patientId) {
      const prev = document.title
      document.title = `${template.title.replace(/\s+/g, '')}_${patientId}`
      return () => { document.title = prev }
    }
  }, [template, patientId])

  /* unknown template id or unresolvable patient/encounter → the locked
     not-found pattern (one component), never another record's data */
  if (!template || !patientId || state === null) {
    return <div className="print-screen"><NotFoundCard /></div>
  }
  if (state === 'loading') {
    return <div className="print-screen"><p className="print-loading">Preparing document…</p></div>
  }

  const T = template.Component
  return (
    <div className="print-screen">
      {/* THE FORMAT ENGINE (P2, document level): the injected stylesheet
          carries @page (paper/orientation/margins) + the root type size;
          the toggle classes hide document CHROME. Styling only — the
          clinical content below is rendered from the record and is not
          editable anywhere on this page (the 🔴 safety line). The
          registry's orientation is the DEFAULT the user may override. */}
      <style>{formatCss(fmt)}</style>
      <div className="print-toolbar">
        <button className="pt-btn" onClick={() => navigate('/print')}>← Print Center</button>
        <span className="pt-title">{template.title} · {patientId}</span>
        <button className="pt-btn" aria-expanded={fmtOpen} onClick={() => setFmtOpen(o => !o)}>
          Format {fmtOpen ? '▴' : '▾'}
        </button>
        <button className="pt-btn pt-primary" onClick={() => window.print()}>Print / Save as PDF</button>
      </div>
      {fmtOpen && (
        <div className="print-fmtbar" role="group" aria-label="Document formatting — styling only, content is fixed">
          <label>Paper
            <select value={fmt.paper} onChange={e => setFmt(f => ({ ...f, paper: e.target.value as PrintFormat['paper'] }))}>
              <option>A4</option><option>Letter</option><option>Legal</option>
            </select>
          </label>
          <label>Orientation
            <select value={fmt.orientation} onChange={e => setFmt(f => ({ ...f, orientation: e.target.value as PrintFormat['orientation'] }))}>
              <option value="portrait">Portrait</option><option value="landscape">Landscape</option>
            </select>
          </label>
          <label>Margins
            <select value={fmt.margins} onChange={e => setFmt(f => ({ ...f, margins: e.target.value as PrintFormat['margins'] }))}>
              <option value="narrow">Narrow</option><option value="normal">Normal</option><option value="wide">Wide</option>
            </select>
          </label>
          <label>Font size
            <select value={fmt.fontScale} onChange={e => setFmt(f => ({ ...f, fontScale: e.target.value as PrintFormat['fontScale'] }))}>
              <option value="small">Small</option><option value="normal">Normal</option><option value="large">Large</option>
            </select>
          </label>
          <label className="pf-check"><input type="checkbox" checked={fmt.showLogo}
            onChange={e => setFmt(f => ({ ...f, showLogo: e.target.checked }))} /> Logo</label>
          <label className="pf-check"><input type="checkbox" checked={fmt.showSignature}
            onChange={e => setFmt(f => ({ ...f, showSignature: e.target.checked }))} /> Signature block</label>
          <label className="pf-check"><input type="checkbox" checked={fmt.showBrandFooter}
            onChange={e => setFmt(f => ({ ...f, showBrandFooter: e.target.checked }))} /> Footer text</label>
          <span className="pf-note">Formatting changes how this document looks — its clinical content is fixed from the record.</span>
        </div>
      )}
      <div className={`print-page${fmt.orientation === 'landscape' ? ' landscape' : ''} ${formatClasses(fmt)}`}>
        <PrintLayout
          title={template.title}
          context={state.context}
          printedBy={session ? `${session.name} (${session.jobTitle})` : '—'}
          printedAt={printedAt}
        >
          <T data={state as never} />
        </PrintLayout>
      </div>
    </div>
  )
}
