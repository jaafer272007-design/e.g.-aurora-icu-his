import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import './OrdersMedication.css'
import { AppHeader, type KpiSpec } from '../../components/AppHeader'
import { NavSidebar } from '../../components/NavSidebar'
import { NotFoundCard } from '../../components/NotFoundCard'
import { PatientBar } from '../../components/PatientBar'
import { PatientRail } from '../../components/PatientRail'
import { Toast, useToast } from '../../components/Toast'
import { IconAlertTriangle, IconPencil, IconPill } from '../../components/icons'
import {
  createOrders, discontinueOrder, getFormulary, getInteractionRules, getOrderSetDefs,
  getPatientDetail, getPatientOrders, getPatients, getPendingOrders, modifyOrder, signOrder,
} from '../../lib/api'
import type {
  FormularyDrug, InteractionRule, MedicationDetails, NewOrderDraft, Order, OrderPriority,
  OrderSetDef, OrderSetItemTemplate, Patient, PatientSummary,
} from '../../lib/api/types'
import { OrderListCard } from './OrderListCard'
import { NewOrderCard } from './NewOrderCard'
import { OrderSetsCard } from './OrderSetsCard'
import { DiscontinueDialog, ModifyDialog } from './OrderDialogs'

const DOCTOR_ACTOR = 'Dr. S. Rahman'

/** Screen 5 — Orders & Medication. The canonical source of truth for orders
 *  and medications; Doctor Workspace and Nurse Workspace read derived views
 *  of the same model. Doctor RBAC: create / modify / discontinue. */
export function OrdersMedication() {
  const { patientId = '' } = useParams()
  const navigate = useNavigate()
  const { toast, showToast } = useToast()
  const [patients, setPatients] = useState<PatientSummary[] | null>(null)
  const [patient, setPatient] = useState<Patient | null>(null)
  const [missing, setMissing] = useState(false)
  const [orders, setOrders] = useState<Order[] | null>(null)
  const [pendingAll, setPendingAll] = useState<Order[]>([])
  const [formulary, setFormulary] = useState<FormularyDrug[] | null>(null)
  const [rules, setRules] = useState<InteractionRule[]>([])
  const [setDefs, setSetDefs] = useState<OrderSetDef[]>([])
  const [modifyId, setModifyId] = useState<string | null>(null)
  const [discontinueId, setDiscontinueId] = useState<string | null>(null)

  useEffect(() => {
    getPatients().then(setPatients)
    getFormulary().then(setFormulary)
    getInteractionRules().then(setRules)
    getOrderSetDefs().then(setSetDefs)
  }, [])

  /* no patient in the URL → default to the first patient */
  useEffect(() => {
    if (!patientId && patients?.length) navigate(`/orders/${patients[0].patientId}`, { replace: true })
  }, [patientId, patients, navigate])

  const refresh = useCallback(() => {
    if (patientId) getPatientOrders(patientId).then(setOrders)
    getPendingOrders().then(setPendingAll)
  }, [patientId])

  useEffect(() => {
    if (!patientId) return
    let stale = false
    setMissing(false)
    getPatientDetail(patientId).then(res => {
      if (stale) return
      if (!res) {
        /* locked decision: explicit not-found — never another patient's data */
        setPatient(null)
        setOrders(null)
        setMissing(true)
        return
      }
      setPatient(res.patient)
    })
    refresh()
    return () => { stale = true }
  }, [patientId, refresh])

  const orderById = (id: string | null) => orders?.find(o => o.orderId === id) ?? null

  const handleSign = (orderId: string) => {
    signOrder(orderId, DOCTOR_ACTOR).then(o => {
      if (!o) return
      refresh()
      showToast('Order signed', `${o.summary} · now active`)
    })
  }

  const handleModify = (changes: Partial<MedicationDetails>, reason: string) => {
    if (!modifyId) return
    modifyOrder(modifyId, changes, reason, DOCTOR_ACTOR).then(o => {
      setModifyId(null)
      if (!o) return
      refresh()
      showToast('Order modified', `${o.summary} · reason documented`)
    })
  }

  const handleDiscontinue = (reason: string) => {
    if (!discontinueId) return
    discontinueOrder(discontinueId, reason, DOCTOR_ACTOR).then(o => {
      setDiscontinueId(null)
      if (!o) return
      refresh()
      showToast('Order discontinued', `${o.summary} · reason documented`)
    })
  }

  const handleCreate = (medication: MedicationDetails, priority: OrderPriority, sign: boolean, overrideNote?: string) => {
    const draft: NewOrderDraft = { patientId, category: 'Medication', medication, priority }
    createOrders([draft], DOCTOR_ACTOR, sign, overrideNote).then(([o]) => {
      refresh()
      showToast(sign ? 'Order signed & active' : 'Order saved as pending', o?.summary ?? '')
    })
  }

  const handleExpandSet = (set: OrderSetDef, items: OrderSetItemTemplate[], skipped: string[]) => {
    const drafts: NewOrderDraft[] = items.map(it => ({
      patientId,
      category: it.category,
      summary: it.summary,
      medication: it.medication,
      priority: it.priority,
      requiresImplementation: it.requiresImplementation,
    }))
    createOrders(drafts, DOCTOR_ACTOR, false).then(created => {
      refresh()
      showToast(
        `${set.name} expanded`,
        `${created.length} pending order${created.length === 1 ? '' : 's'}${skipped.length ? ` · skipped (blocked): ${skipped.join(', ')}` : ''}`,
        3400,
      )
    })
  }

  const activeMeds = orders?.filter(o => o.status === 'active' && o.medication).length
  const toImplement = orders?.filter(o => o.status === 'active' && o.requiresImplementation).length
  const dcToday = orders?.filter(o => o.status === 'discontinued').length

  const kpis: KpiSpec[] = [
    { icon: <IconPencil size={14} stroke="var(--amber)" />, iconBg: 'rgba(255,180,84,.14)', value: pendingAll.length, label: 'Pending · Unit' },
    { icon: <IconPill size={14} stroke="var(--cyan)" />, iconBg: 'rgba(53,224,208,.13)', value: activeMeds ?? '—', label: 'Active Meds' },
    {
      icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--blue)" strokeWidth="2" strokeLinecap="round"><path d="M20 6L9 17l-5-5" /></svg>,
      iconBg: 'rgba(77,163,255,.15)', value: toImplement ?? '—', label: 'To Implement',
    },
    { icon: <IconAlertTriangle size={14} stroke="var(--red)" />, iconBg: 'rgba(255,93,108,.14)', value: dcToday ?? '—', label: 'Discontinued', valueStyle: { color: 'var(--red)' } },
  ]

  const pendingCountFor = (pid: string) => pendingAll.filter(o => o.patientId === pid).length

  return (
    <div className="app-frame om">
      <AppHeader
        subtitle="Orders & Medication"
        kpis={kpis}
        bellCount={pendingAll.length}
        onBellClick={() => showToast('Pending signatures', `${pendingAll.length} order(s) awaiting signature across the unit`)}
        user={{ initials: 'SR', name: 'Dr. Sara Rahman', role: 'Intensivist · Full order authority' }}
      />
      <div className="shell">
        <NavSidebar active="orders" alertCount={5} footerLines={['Role: Physician', 'Create · modify · discontinue']} />

        <PatientRail
          patients={patients}
          selectedId={patientId}
          onSelect={id => navigate(`/orders/${id}`)}
          badge={p => (pendingCountFor(p.patientId) > 0 ? <span className="prpend amber num">{pendingCountFor(p.patientId)}</span> : null)}
        />

        <main>
          {missing && <NotFoundCard />}

          {patient && (
            <PatientBar patient={patient} links={[{ label: 'Open Mission Control →', to: `/patients/${patient.patientId}` }]}>
              <span className="ptbarallergy">⚠ Allergies: {patient.allergies}</span>
              <span className="ptbarcode">{patient.codeStatus}</span>
            </PatientBar>
          )}

          {patient && orders && (
            <div className="omcols">
              <div className="omcolL">
                <OrderListCard
                  orders={orders}
                  onSign={handleSign}
                  onModify={setModifyId}
                  onDiscontinue={setDiscontinueId}
                />
              </div>
              <div className="omcolR">
                {formulary && (
                  <NewOrderCard
                    patient={{ patientId: patient.patientId, name: patient.name, allergies: patient.allergies }}
                    formulary={formulary}
                    rules={rules}
                    orders={orders}
                    onCreate={handleCreate}
                  />
                )}
                {formulary && (
                  <OrderSetsCard
                    sets={setDefs}
                    patient={{ patientId: patient.patientId, allergies: patient.allergies }}
                    formulary={formulary}
                    rules={rules}
                    orders={orders}
                    onExpand={handleExpandSet}
                  />
                )}
              </div>
            </div>
          )}
        </main>
      </div>

      {modifyId && orderById(modifyId)?.medication && (
        <ModifyDialog order={orderById(modifyId)!} onCancel={() => setModifyId(null)} onConfirm={handleModify} />
      )}
      {discontinueId && orderById(discontinueId) && (
        <DiscontinueDialog order={orderById(discontinueId)!} onCancel={() => setDiscontinueId(null)} onConfirm={handleDiscontinue} />
      )}
      <Toast state={toast} accent="green" />
    </div>
  )
}
