import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { BedOverview } from './pages/BedOverview/BedOverview'
import { MissionControl } from './pages/MissionControl/MissionControl'
import { DoctorWorkspace } from './pages/DoctorWorkspace/DoctorWorkspace'
import { NurseWorkspace } from './pages/NurseWorkspace/NurseWorkspace'
import { OrdersMedication } from './pages/OrdersMedication/OrdersMedication'

/* Route map
   /workspace              Doctor Workspace — the role-personalized "Dashboard"
                           (defaults to the physician view until auth exists)
   /nurse                  Nurse Workspace — the nurse session's "Dashboard"
   /beds                   ICU Bed Overview
   /patients/:patientId    Patient Mission Control, keyed by the stable
                           patient identifier (bed number is location only) */
/* Vite injects BASE_URL from the build's --base flag ('/' locally,
   '/e.g.-aurora-icu-his/' on GitHub Pages) — the router must match it. */
const BASENAME = import.meta.env.BASE_URL.replace(/\/+$/, '') || '/'

export default function App() {
  return (
    <BrowserRouter basename={BASENAME}>
      <Routes>
        <Route path="/" element={<Navigate to="/workspace" replace />} />
        <Route path="/workspace" element={<DoctorWorkspace />} />
        <Route path="/nurse" element={<NurseWorkspace />} />
        <Route path="/beds" element={<BedOverview />} />
        <Route path="/patients/:patientId" element={<MissionControl />} />
        <Route path="/orders" element={<OrdersMedication />} />
        <Route path="/orders/:patientId" element={<OrdersMedication />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
