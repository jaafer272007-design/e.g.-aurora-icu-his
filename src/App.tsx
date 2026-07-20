import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { BedOverview } from './pages/BedOverview/BedOverview'
import { MissionControl } from './pages/MissionControl/MissionControl'
import { DoctorWorkspace } from './pages/DoctorWorkspace/DoctorWorkspace'
import { NurseWorkspace } from './pages/NurseWorkspace/NurseWorkspace'
import { OrdersMedication } from './pages/OrdersMedication/OrdersMedication'
import { LabImaging } from './pages/LabImaging/LabImaging'
import { LabEntry } from './pages/LabEntry/LabEntry'
import { Timeline } from './pages/Timeline/Timeline'
import { Observations } from './pages/Observations/Observations'
import { Statistics } from './pages/Statistics/Statistics'
import { Alerts } from './pages/Alerts/Alerts'
import { Settings } from './pages/Settings/Settings'
import { AiChat } from './pages/AiChat/AiChat'
import { AdminHome } from './pages/AdminHome/AdminHome'
import { UsersAdmin } from './pages/UsersAdmin/UsersAdmin'
import { Formulary } from './pages/Formulary/Formulary'
import { Configuration } from './pages/Configuration/Configuration'
import { LabCatalog } from './pages/LabCatalog/LabCatalog'
import { OrderSetsAdmin } from './pages/OrderSetsAdmin/OrderSetsAdmin'
import { Admissions } from './pages/Admissions/Admissions'
import { PatientHistory } from './pages/PatientHistory/PatientHistory'
import { Discharges } from './pages/Discharges/Discharges'
import { PrintCenter } from './pages/PrintCenter/PrintCenter'
import { PrintDocument } from './pages/PrintCenter/PrintDocument'
import { Login } from './pages/Login/Login'
import { RequireSession } from './components/RequireSession'
import { EnvironmentBanner, EnvironmentGate } from './components/EnvironmentChrome'
import { getSession, landingRouteOf } from './lib/session'

/* Route map (all except /login require a session; each route also requires
   the listed permission — Stage 9 three-layer RBAC, see lib/session.ts)
   /login                  Login / Role-Switch — LOCAL session only
   /                       redirects to the signed-in profile's landing view
   /workspace              Doctor Workspace           orders.sign
   /nurse                  Nurse Workspace            meds.administer
   /admin                  Administrator landing      admin.view
   /admin/users            User Administration        users.manage (Layer 3)
   /formulary              Formulary management       formulary.manage (Layer 4 — Pharmacy)
   /lab-catalog            Lab catalogue management   labcatalog.manage (Layer 4 — Laboratory)
   /order-sets             Order-set management       ordersets.manage (SeniorDoctor — protocol authorship)
   /beds                   ICU Bed Overview           patients.view
   /patients/:patientId    Patient Mission Control    patients.view
   /patients/:patientId/history  Patient History Overview  results.view (clinical history — the office Administrator is locked out by design)
   /orders(/:patientId)    Orders & Medication        orders.view (mutations need more)
   /labs(/:patientId)      Laboratory & Imaging       results.view
   /lab-entry(/:patientId) Lab Result Entry (manual)  results.document (ICU bedside team documents/transcribes)
   /timeline(/:patientId)  Clinical Timeline          patients.view
   /observations(/:patientId)  Bedside Observations   patients.view (charting needs observations.record; corrections observations.record/correct — Stage 11 §4)
   /ai(/:patientId)        AI Assistant — grounded query chat   ai.view (route patient = chat context only)
   /admissions             ADT — admit                patients.view (admit button needs adt.admit)
   /discharges             ADT — discharge/transfer   patients.view (actions need adt.discharge / adt.transfer)
   /print                  Print Center hub           patients.view (read-only document rendering)
   /print/:templateId/:patientId  Printable document  patients.view */
/* Vite injects BASE_URL from the build's --base flag ('/' locally,
   '/e.g.-aurora-icu-his/' on GitHub Pages) — the router must match it. */
const BASENAME = import.meta.env.BASE_URL.replace(/\/+$/, '') || '/'

function HomeRedirect() {
  const session = getSession()
  return <Navigate to={session ? landingRouteOf(session.jobTitle) : '/login'} replace />
}

export default function App() {
  return (
    /* §11 step 3 environment chrome: the gate REPLACES the whole app on a
       cross-environment mismatch (or a production api-unavailable state);
       the banner marks staging/dev unmistakably and is compiled OUT of
       production bundles. */
    <EnvironmentGate>
      <BrowserRouter basename={BASENAME}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<HomeRedirect />} />
        <Route path="/workspace" element={<RequireSession permission="orders.sign"><DoctorWorkspace /></RequireSession>} />
        <Route path="/nurse" element={<RequireSession permission="meds.administer"><NurseWorkspace /></RequireSession>} />
        <Route path="/admin" element={<RequireSession permission="admin.view"><AdminHome /></RequireSession>} />
        <Route path="/admin/users" element={<RequireSession permission="users.manage"><UsersAdmin /></RequireSession>} />
        <Route path="/formulary" element={<RequireSession permission="formulary.manage"><Formulary /></RequireSession>} />
        <Route path="/lab-catalog" element={<RequireSession permission="labcatalog.manage"><LabCatalog /></RequireSession>} />
        <Route path="/order-sets" element={<RequireSession permission="ordersets.manage"><OrderSetsAdmin /></RequireSession>} />
        {/* Configuration area (first tenant: the Code Status vocabulary —
            clinical governance): codestatus.manage = SeniorDoctor only,
            unreachable by the office Administrator (the F2/F3 rule) */}
        {/* the Configuration AREA is multi-tenant: any-of gate — each
            section inside is gated to its own authority (hospital
            identity → hospital.configure; code status →
            codestatus.manage; imaging catalogue →
            imagingcatalog.manage) */}
        <Route path="/config" element={<RequireSession anyPermission={['hospital.configure', 'codestatus.manage', 'imagingcatalog.manage', 'beds.manage', 'dispositions.manage', 'isolation.manage', 'shifts.manage', 'frequencies.manage']}><Configuration /></RequireSession>} />
        <Route path="/beds" element={<RequireSession permission="patients.view"><BedOverview /></RequireSession>} />
        <Route path="/admissions" element={<RequireSession permission="patients.view"><Admissions /></RequireSession>} />
        <Route path="/discharges" element={<RequireSession permission="patients.view"><Discharges /></RequireSession>} />
        <Route path="/print" element={<RequireSession permission="patients.view"><PrintCenter /></RequireSession>} />
        <Route path="/print/:templateId/:patientId" element={<RequireSession permission="patients.view"><PrintDocument /></RequireSession>} />
        <Route path="/patients/:patientId" element={<RequireSession permission="patients.view"><MissionControl /></RequireSession>} />
        <Route path="/patients/:patientId/history" element={<RequireSession permission="results.view"><PatientHistory /></RequireSession>} />
        <Route path="/orders" element={<RequireSession permission="orders.view"><OrdersMedication /></RequireSession>} />
        <Route path="/orders/:patientId" element={<RequireSession permission="orders.view"><OrdersMedication /></RequireSession>} />
        <Route path="/labs" element={<RequireSession permission="results.view"><LabImaging /></RequireSession>} />
        <Route path="/labs/:patientId" element={<RequireSession permission="results.view"><LabImaging /></RequireSession>} />
        <Route path="/lab-entry" element={<RequireSession permission="results.document"><LabEntry /></RequireSession>} />
        <Route path="/lab-entry/:patientId" element={<RequireSession permission="results.document"><LabEntry /></RequireSession>} />
        <Route path="/timeline" element={<RequireSession permission="patients.view"><Timeline /></RequireSession>} />
        <Route path="/timeline/:patientId" element={<RequireSession permission="patients.view"><Timeline /></RequireSession>} />
        {/* Statistics — unit-level AGGREGATES only (no patient identifiers),
            so patients.view is the right gate: every profile carries it and
            the office Administrator's core use is exactly this page */}
        <Route path="/statistics" element={<RequireSession permission="patients.view"><Statistics /></RequireSession>} />
        {/* Alerts — CLINICAL (patient-identifiable), so results.view: every
            clinical profile carries it; the office Administrator does NOT
            (the locked no-clinical-data rule keeps them out) */}
        <Route path="/alerts" element={<RequireSession permission="results.view"><Alerts /></RequireSession>} />
        {/* Settings — NO clinical data (bed ids/areas only, score versions,
            system info, preferences), so a session gate WITHOUT a
            permission: all eight profiles incl. the office Administrator */}
        <Route path="/settings" element={<RequireSession><Settings /></RequireSession>} />
        <Route path="/observations" element={<RequireSession permission="patients.view"><Observations /></RequireSession>} />
        <Route path="/observations/:patientId" element={<RequireSession permission="patients.view"><Observations /></RequireSession>} />
        <Route path="/ai" element={<RequireSession permission="ai.view"><AiChat /></RequireSession>} />
        <Route path="/ai/:patientId" element={<RequireSession permission="ai.view"><AiChat /></RequireSession>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </BrowserRouter>
      <EnvironmentBanner />
    </EnvironmentGate>
  )
}
