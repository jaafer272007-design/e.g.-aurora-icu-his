import { useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import './print.css'
import { NotFoundCard } from '../../components/NotFoundCard'
import { getSession } from '../../lib/session'
import { PrintLayout } from './PrintLayout'
import { templateById } from './registry'
import type { PrintContext } from './types'

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

  useEffect(() => {
    if (!template || !patientId) return
    let live = true
    template.load(patientId, params.get('enc') ?? undefined).then(d => {
      if (!live) return
      setState(d)
      /* generation metadata — the one clock-derived line on the page */
      setPrintedAt(new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC')
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
      {/* ADAPTIVE orientation (Stage 11, design P1): a landscape template
          overrides the global @page — the registry's orientation field is
          the layout-driving fact the future Print Center Engine (P2) will
          expose as a user setting. */}
      {template.orientation === 'landscape' && <style>{'@page { size: A4 landscape; }'}</style>}
      <div className="print-toolbar">
        <button className="pt-btn" onClick={() => navigate('/print')}>← Print Center</button>
        <span className="pt-title">{template.title} · {patientId}</span>
        <button className="pt-btn pt-primary" onClick={() => window.print()}>Print / Save as PDF</button>
      </div>
      <div className={`print-page${template.orientation === 'landscape' ? ' landscape' : ''}`}>
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
