import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import './OrdersMedication.css'
import { DataAge } from '../../components/DataAge'
import { AppHeader, type KpiSpec } from '../../components/AppHeader'
import { NavSidebar } from '../../components/NavSidebar'
import { NotFoundCard } from '../../components/NotFoundCard'
import { PatientBar } from '../../components/PatientBar'
import { PatientRail } from '../../components/PatientRail'
import { Toast, useToast } from '../../components/Toast'
import { IconAlertTriangle, IconPencil, IconPill } from '../../components/icons'
import {
  completeImplementation, createOrders, discontinueOrder, getEncounters, getFormulary,
  getImagingCatalog, getInteractionRules, getLabCatalog, getOrderSetDefs, getRosterPatient,
  getPatientOrders, getPatients, getPendingOrders, modifyOrder, signOrder,
} from '../../lib/api'
import type {
  FormularyDrug, ImagingStudyDef, InteractionRule, LabTest, MedicationDetails, NewOrderDraft, Order, OrderPriority,
  OrderSetDef, OrderSetItemTemplate, Patient, PatientSummary,
} from '../../lib/api/types'
import { defaultPatientId, useRememberPatient } from '../../lib/patientContext'
import { resolveCodeStatus } from '../../lib/codeStatus'
import { getSession, hasPermission, initialsOf, profileOf } from '../../lib/session'
import { OrderListCard } from './OrderListCard'
import { NewOrderCard } from './NewOrderCard'
import { OrderSetsCard } from './OrderSetsCard'
import { LabOrderCard } from './LabOrderCard'
import { ImagingOrderCard } from './ImagingOrderCard'
import { NursingOrderCard, type NursingOrderEntry } from './NursingOrderCard'
import { useNursingDone } from './useNursingDone'
import { NotYetAvailable } from '../../components/NotYetAvailable'
import { DiscontinueDialog, ModifyDialog } from './OrderDialogs'


/** Screen 5 — Orders & Medication. The canonical source of truth for orders
 *  and medications; Doctor Workspace and Nurse Workspace read derived views
 *  of the same model. Doctor RBAC: create / modify / discontinue. */
export function OrdersMedication() {
  /* behind RequireSession(orders.view); mutations additionally need the
     prescriber permissions — checked here for the UI and re-checked in the
     service layer */
  const session = getSession()!
  const canPrescribe = hasPermission(session.jobTitle, 'orders.create')
  /* implementation is a NURSING permission (locked RBAC) — the ✓ Implement
     control renders for task orders here too, not only on the Nurse
     Workspace queue */
  const canImplement = hasPermission(session.jobTitle, 'orders.implement')
  /* applied order sets inherit the signing status the applier is entitled
     to — the SAME orders.sign atom the manual-order guard uses
     (createOrders refuses sign without it; the server 403s it again) */
  const canSign = hasPermission(session.jobTitle, 'orders.sign')
  const { patientId = '' } = useParams()
  const navigate = useNavigate()
  const { toast, showToast } = useToast()
  const [patients, setPatients] = useState<PatientSummary[] | null>(null)
  /* PATIENT-KEYED (Codex review of 72a7894): the identity, the order list,
     the not-found flag and the weight are held WITH the patient they were
     read for, and shown only while that patient is the routed one — so on a
     patient switch the previous patient's header and prescribing body are
     gone from the very first render (no effect clearing them a render
     later), and a late read or a write's refresh for the previous patient
     can never fill this one's page. */
  const [rosterOf, setRosterOf] = useState<{ pid: string; patient: Patient } | null>(null)
  const [missingOf, setMissingOf] = useState<string | null>(null)
  const [ordersOf, setOrdersOf] = useState<{ pid: string; list: Order[] } | null>(null)
  const patient = rosterOf?.pid === patientId ? rosterOf.patient : null
  const missing = missingOf === patientId
  const orders = ordersOf?.pid === patientId ? ordersOf.list : null
  /* the routed patient as of the last commit: async answers compare against it */
  const routedRef = useRef(patientId)
  useLayoutEffect(() => { routedRef.current = patientId }, [patientId])
  /* order-list reads land in the order they STARTED (an older read never
     replaces a newer one) and only for the patient still routed */
  const ordersSeq = useRef({ started: 0, applied: 0 })
  const acceptOrders = useCallback((pid: string, seq: number, list: Order[]): boolean => {
    if (routedRef.current !== pid || seq <= ordersSeq.current.applied) return false
    ordersSeq.current.applied = seq
    setOrdersOf({ pid, list })
    return true
  }, [])
  const [pendingAll, setPendingAll] = useState<Order[]>([])
  const [formulary, setFormulary] = useState<FormularyDrug[] | null>(null)
  const [labCatalog, setLabCatalog] = useState<LabTest[] | null>(null)
  const [rules, setRules] = useState<InteractionRule[]>([])
  const [setDefs, setSetDefs] = useState<OrderSetDef[]>([])
  /* the imaging STUDY VOCABULARY — the REAL Imaging Catalogue (third
     Configuration tenant; the mock ORDER_SETS.Imaging that nulled out in
     production is retired — PRODUCTION IMAGING ORDERING UNBLOCKS here).
     Only ACTIVE studies are orderable; null = the catalogue service is
     unreachable (the card says so — never a fabricated list). */
  const [imagingStudies, setImagingStudies] = useState<ImagingStudyDef[] | null>([])
  /* the OPEN encounter's recorded weight (PR #83, encounter-scoped) —
     drives the structured-infusion absolute-rate preview; undefined =
     not recorded, handled honestly (no fabricated rate) */
  const [weightOf, setWeightOf] = useState<{ pid: string; kg: number | undefined } | null>(null)
  const weightKg = weightOf?.pid === patientId ? weightOf.kg : undefined
  const [modifyId, setModifyId] = useState<string | null>(null)
  const [discontinueId, setDiscontinueId] = useState<string | null>(null)

  useEffect(() => {
    getPatients().then(setPatients)
    getFormulary().then(setFormulary)
    getLabCatalog().then(setLabCatalog)
    getInteractionRules().then(setRules)
    getOrderSetDefs().then(setSetDefs)
    getImagingCatalog().then(list => setImagingStudies(list ? list.filter(st => st.active) : null))
  }, [])

  /* no patient in the URL → the remembered cross-section patient when
     this screen lists them, else the first patient (honest fallback) */
  useEffect(() => {
    if (!patientId && patients?.length) navigate(`/orders/${defaultPatientId(patients)}`, { replace: true })
  }, [patientId, patients, navigate])
  /* record the viewed patient as the cross-section context (only once
     this screen's own list confirms the id resolves) */
  useRememberPatient(patientId, patients)

  /* CHART AGE (step 1): this screen reads when it opens and on the user's
     own writes — it does NOT follow the ward. The chip states that plainly
     so a chart left open through a shift cannot pass for current. */
  const [chartAt, setChartAt] = useState<number | null>(null)
  /* re-read one patient's orders (and the unit's pending list) — a refresh
     for a patient no longer routed (a write that finished after a switch)
     refreshes only the unit-wide pending list */
  const refreshFor = useCallback((pid: string) => {
    getPendingOrders().then(setPendingAll)
    if (!pid || routedRef.current !== pid) return
    const seq = ++ordersSeq.current.started
    getPatientOrders(pid).then(list => { acceptOrders(pid, seq, list) })
    setChartAt(Date.now())
  }, [acceptOrders])
  const refresh = useCallback(() => refreshFor(patientId), [patientId, refreshFor])

  useEffect(() => {
    if (!patientId) return
    let stale = false
    getEncounters({ patientId, status: 'open' })
      .then(list => { if (!stale) setWeightOf({ pid: patientId, kg: list[0]?.weightKg }) })
      .catch(() => {})
    /* Phase 3 PR 1: IDENTITY ONLY from the real roster — this screen's
       body is already real; it no longer pulls the Stage-11 composite */
    getRosterPatient(patientId).then(res => {
      if (stale) return
      if (!res) {
        /* locked decision: explicit not-found — never another patient's data */
        setRosterOf(null)
        setOrdersOf(null)
        setMissingOf(patientId)
        return
      }
      setRosterOf({ pid: patientId, patient: res })
      setMissingOf(null)
    })
    refresh()
    return () => { stale = true }
  }, [patientId, refresh])

  const orderById = (id: string | null) => orders?.find(o => o.orderId === id) ?? null

  /* NURSING ROUNDS (contracts §3.6, §9.2): Done on a nursing order's
     current round — one attempt per click, settled only from the server's
     record; the authoritative read also refreshes this patient's list */
  const nursingDone = useNursingDone({
    actor: session.name, jobTitle: session.jobTitle, patientId, showToast,
    onOrders: (pid, list) => { if (acceptOrders(pid, ++ordersSeq.current.started, list)) setChartAt(Date.now()) },
  })

  const handleSign = (orderId: string) => {
    signOrder(orderId, session.name, session.jobTitle).then(o => {
      if (!o) return
      refresh()
      showToast('Order signed', `${o.summary} · now active`)
    })
  }

  const handleImplement = (orderId: string) => {
    completeImplementation(orderId, session.name, session.jobTitle).then(o => {
      if (!o) { showToast('Not permitted', 'Implementation is a nursing action'); return }
      refresh()
      showToast('Order implemented', `${o.summary} · completed`)
    })
  }

  const handleModify = (changes: Partial<MedicationDetails>, reason: string) => {
    if (!modifyId) return
    modifyOrder(modifyId, changes, reason, session.name, session.jobTitle).then(o => {
      setModifyId(null)
      if (!o) return
      refresh()
      showToast('Order modified', `${o.summary} · reason documented`)
    })
  }

  const handleDiscontinue = (reason: string) => {
    if (!discontinueId) return
    discontinueOrder(discontinueId, reason, session.name, session.jobTitle).then(o => {
      setDiscontinueId(null)
      if (!o) return
      refresh()
      showToast('Order discontinued', `${o.summary} · reason documented`)
    })
  }

  const handleCreate = (medication: MedicationDetails, priority: OrderPriority, sign: boolean, overrideNote?: string) => {
    const draft: NewOrderDraft = { patientId, category: 'Medication', medication, priority }
    createOrders([draft], session.name, sign, session.jobTitle, overrideNote).then(([o]) => {
      refresh()
      showToast(sign ? 'Order signed & active' : 'Order saved as pending', o?.summary ?? '')
    })
  }

  /* NEW NURSING ORDER (icu-update-nursing-patient-chart.md §2): category
     Nursing, completed from Orders to Implement; `nursing: {}` = one-time,
     { intervalMinutes } = repeating. Same create path and permissions as
     every other order. The order is for the patient the FORM was showing
     (its captured pid — Codex review of 72a7894), never whichever patient
     is routed when the click lands or the answer returns; an answer after a
     switch refreshes and names only that patient. */
  const handleNursingOrder = async (pid: string, entry: NursingOrderEntry, sign: boolean): Promise<boolean> => {
    const draft: NewOrderDraft = {
      patientId: pid, category: 'Nursing', summary: entry.instructions, priority: entry.priority,
      requiresImplementation: true,
      nursing: entry.intervalMinutes === null ? {} : { intervalMinutes: entry.intervalMinutes },
    }
    const [o] = await createOrders([draft], session.name, sign, session.jobTitle)
    refreshFor(pid)
    const elsewhere = routedRef.current !== pid ? ` (patient ${o?.patientName || pid})` : ''
    if (!o) {
      showToast('Nursing order NOT created', `the server refused it or could not be reached — nothing was saved${elsewhere}`, 5000)
      return false
    }
    showToast(sign ? 'Nursing order signed & active' : 'Nursing order saved as pending', `${o.summary}${elsewhere}`)
    return true
  }

  /* Lab orders complete when a RESULT is documented against them (the
     derived-completion model) — they no longer carry the implement flag;
     the nurse to-implement queue is task orders only */
  const handleLabOrder = (test: LabTest, priority: OrderPriority, sign: boolean) => {
    const draft: NewOrderDraft = {
      patientId, category: 'Lab', summary: `${test.name} (${test.specimen})`,
      testId: test.testId, priority,
    }
    createOrders([draft], session.name, sign, session.jobTitle).then(([o]) => {
      refresh()
      showToast(sign ? 'Lab order signed & active' : 'Lab order saved as pending', o?.summary ?? '')
    })
  }

  /* imaging goes through the SAME canonical create path as meds and labs
     (category 'Imaging' is first-class in the server's Order model —
     full lifecycle + audit + encounter scoping). Since Imaging Result
     Entry, an imaging order IS fulfilled by the report documented against
     it (the picked-order linkage) — so like labs it completes via its
     result and carries no implement flag. */
  const handleImagingOrder = (study: ImagingStudyDef, region: string, contrast: boolean,
    detail: string, priority: OrderPriority, sign: boolean) => {
    /* CODED order (the linkage key): studyId joins the order to the
       catalogue. The CORRECTED model: region + contrast are order-time
       and travel structured on the draft; the summary snapshots the
       ASSEMBLED description ("CT — head — with contrast — indication")
       at order time — never re-resolved later. */
    const assembled = [study.name, region || null, contrast ? 'with contrast' : null, detail || null]
      .filter(Boolean).join(' — ')
    const draft: NewOrderDraft = {
      patientId, category: 'Imaging',
      studyId: study.studyId,
      summary: assembled,
      ...(region ? { region } : {}),
      ...(contrast ? { contrast } : {}),
      priority,
    }
    createOrders([draft], session.name, sign, session.jobTitle).then(([o]) => {
      refresh()
      showToast(sign ? 'Imaging order signed & active' : 'Imaging order saved as pending', o?.summary ?? '')
    })
  }

  const handleExpandSet = (set: OrderSetDef, items: OrderSetItemTemplate[], skipped: string[]) => {
    const drafts: NewOrderDraft[] = items.map(it => ({
      patientId,
      category: it.category,
      summary: it.summary,
      medication: it.medication,
      testId: it.testId,
      priority: it.priority,
      requiresImplementation: it.requiresImplementation,
    }))
    createOrders(drafts, session.name, canSign, session.jobTitle).then(created => {
      refresh()
      showToast(
        `${set.name} expanded`,
        `${created.length} ${canSign ? 'signed & active' : 'pending'} order${created.length === 1 ? '' : 's'}${skipped.length ? ` · skipped (blocked): ${skipped.join(', ')}` : ''}`,
        3400,
      )
    })
  }

  const activeMeds = orders?.filter(o => o.status === 'active' && o.medication).length
  /* the implement queue is TASK orders only — Lab/Imaging orders complete
     via their documented results, never a manual done */
  const implementable = (o: Order) =>
    o.status === 'active' && !!o.requiresImplementation && o.category !== 'Lab' && o.category !== 'Imaging'
  const toImplement = orders?.filter(implementable).length
  const dcToday = orders?.filter(o => o.status === 'discontinued').length

  const kpis: KpiSpec[] = [
    { icon: <IconPencil size={14} stroke="var(--amber)" />, iconBg: 'rgba(var(--amber-rgb),.14)', value: pendingAll.length, label: 'Pending · Unit' },
    { icon: <IconPill size={14} stroke="var(--cyan)" />, iconBg: 'rgba(var(--cyan-rgb),.13)', value: activeMeds ?? '—', label: 'Active Meds' },
    {
      icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--blue)" strokeWidth="2" strokeLinecap="round"><path d="M20 6L9 17l-5-5" /></svg>,
      iconBg: 'rgba(var(--blue-rgb),.15)', value: toImplement ?? '—', label: 'To Implement',
    },
    { icon: <IconAlertTriangle size={14} stroke="var(--red)" />, iconBg: 'rgba(var(--red-rgb),.14)', value: dcToday ?? '—', label: 'Discontinued', valueStyle: { color: 'var(--red)' } },
  ]

  const pendingCountFor = (pid: string) => pendingAll.filter(o => o.patientId === pid).length

  return (
    <div className="app-frame om">
      <AppHeader
        subtitle="Orders & Medication"
        kpis={kpis}
        user={{ initials: initialsOf(session.name), name: session.name, role: `${session.jobTitle} · ${profileOf(session.jobTitle)} profile` }}
        dataAge={<DataAge at={chartAt} what="This patient's orders" />}
      />
      <div className="shell">
        <NavSidebar active="orders" alertCount={5} footerLines={[`Role: ${profileOf(session.jobTitle)} profile`, canPrescribe ? 'Create · modify · discontinue' : 'View orders only']} />

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
              {(() => { const cs = resolveCodeStatus(patient); return (
                <span className={`ptbarcode${cs.kind === 'none' ? ' none' : ''}`}>
                  Code: {cs.label}{cs.kind === 'legacy' ? ' · UNVERIFIED' : ''}
                </span>
              ) })()}
              {!canPrescribe && <span className="ptbarviewonly">View only — no prescribing authority</span>}
            </PatientBar>
          )}

          {patient && orders && (
            <div className="omcols">
              <div className="omcolL">
                <OrderListCard
                  orders={orders}
                  canManage={canPrescribe}
                  canImplement={canImplement}
                  onSign={handleSign}
                  onModify={setModifyId}
                  onDiscontinue={setDiscontinueId}
                  onImplement={handleImplement}
                  onNursingDone={nursingDone.done}
                  onNursingRetry={nursingDone.retry}
                  nursingBusy={nursingDone.busy}
                  nursingNotices={nursingDone.notices}
                />
              </div>
              <div className="omcolR">
                {formulary && canPrescribe && (
                  <NewOrderCard
                    patient={{ patientId: patient.patientId, name: patient.name, allergies: patient.allergies }}
                    formulary={formulary}
                    rules={rules}
                    orders={orders}
                    weightKg={weightKg}
                    onCreate={handleCreate}
                  />
                )}
                {labCatalog && canPrescribe && (
                  <LabOrderCard catalog={labCatalog} onOrder={handleLabOrder} />
                )}
                {canPrescribe && (
                  /* keyed: a patient switch mounts a fresh, empty editor */
                  <NursingOrderCard key={patient.patientId} patientId={patient.patientId} canSign={canSign} onCreate={handleNursingOrder} />
                )}
                {imagingStudies === null && canPrescribe && (
                  <NotYetAvailable what="The imaging study list" />
                )}
                {imagingStudies !== null && imagingStudies.length > 0 && canPrescribe && (
                  <ImagingOrderCard studies={imagingStudies} onOrder={handleImagingOrder} />
                )}
                {formulary && canPrescribe && (
                  <OrderSetsCard
                    sets={setDefs.filter(x => x.active !== false)}
                    patient={{ patientId: patient.patientId, allergies: patient.allergies }}
                    formulary={formulary}
                    rules={rules}
                    orders={orders}
                    canSign={canSign}
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
