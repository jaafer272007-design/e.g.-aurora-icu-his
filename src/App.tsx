import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { BedOverview } from './pages/BedOverview/BedOverview'
import { MissionControl } from './pages/MissionControl/MissionControl'
import { DoctorWorkspace } from './pages/DoctorWorkspace/DoctorWorkspace'
import { NurseWorkspace } from './pages/NurseWorkspace/NurseWorkspace'
import { OrdersMedication } from './pages/OrdersMedication/OrdersMedication'
import { LabImaging } from './pages/LabImaging/LabImaging'
import { Timeline } from './pages/Timeline/Timeline'
import { AiAssistant } from './pages/AiAssistant/AiAssistant'
import { AdminHome } from './pages/AdminHome/AdminHome'
import { UsersAdmin } from './pages/UsersAdmin/UsersAdmin'
import { Formulary } from './pages/Formulary/Formulary'
import { LabCatalog } from './pages/LabCatalog/LabCatalog'
import { OrderSetsAdmin } from './pages/OrderSetsAdmin/OrderSetsAdmin'
import { Admissions } from './pages/Admissions/Admissions'
import { Discharges } from './pages/Discharges/Discharges'
import { Login } from './pages/Login/Login'
import { RequireSession } from './components/RequireSession'
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
   /order-sets             Order-set management       ordersets.manage (Layer 4 — Pharmacy)
   /beds                   ICU Bed Overview           patients.view
   /patients/:patientId    Patient Mission Control    patients.view
   /orders(/:patientId)    Orders & Medication        orders.view (mutations need more)
   /labs(/:patientId)      Laboratory & Imaging       results.view
   /timeline(/:patientId)  Clinical Timeline          patients.view
   /ai(/:patientId)        AI Clinical Assistant      ai.view
   /admissions             ADT — admit                patients.view (admit button needs adt.admit)
   /discharges             ADT — discharge/transfer   patients.view (actions need adt.discharge / adt.transfer) */
/* Vite injects BASE_URL from the build's --base flag ('/' locally,
   '/e.g.-aurora-icu-his/' on GitHub Pages) — the router must match it. */
const BASENAME = import.meta.env.BASE_URL.replace(/\/+$/, '') || '/'

function HomeRedirect() {
  const session = getSession()
  return <Navigate to={session ? landingRouteOf(session.jobTitle) : '/login'} replace />
}

export default function App() {
  return (
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
        <Route path="/beds" element={<RequireSession permission="patients.view"><BedOverview /></RequireSession>} />
        <Route path="/admissions" element={<RequireSession permission="patients.view"><Admissions /></RequireSession>} />
        <Route path="/discharges" element={<RequireSession permission="patients.view"><Discharges /></RequireSession>} />
        <Route path="/patients/:patientId" element={<RequireSession permission="patients.view"><MissionControl /></RequireSession>} />
        <Route path="/orders" element={<RequireSession permission="orders.view"><OrdersMedication /></RequireSession>} />
        <Route path="/orders/:patientId" element={<RequireSession permission="orders.view"><OrdersMedication /></RequireSession>} />
        <Route path="/labs" element={<RequireSession permission="results.view"><LabImaging /></RequireSession>} />
        <Route path="/labs/:patientId" element={<RequireSession permission="results.view"><LabImaging /></RequireSession>} />
        <Route path="/timeline" element={<RequireSession permission="patients.view"><Timeline /></RequireSession>} />
        <Route path="/timeline/:patientId" element={<RequireSession permission="patients.view"><Timeline /></RequireSession>} />
        <Route path="/ai" element={<RequireSession permission="ai.view"><AiAssistant /></RequireSession>} />
        <Route path="/ai/:patientId" element={<RequireSession permission="ai.view"><AiAssistant /></RequireSession>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
