import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { BedOverview } from './pages/BedOverview/BedOverview'
import { MissionControl } from './pages/MissionControl/MissionControl'
import { DoctorWorkspace } from './pages/DoctorWorkspace/DoctorWorkspace'

/* Route map
   /workspace          Doctor Workspace — the role-personalized "Dashboard"
                       (defaults to the physician view until auth exists)
   /beds               ICU Bed Overview
   /patients/:bedId    Patient Mission Control, keyed by bed */
/* Vite injects BASE_URL from the build's --base flag ('/' locally,
   '/e.g.-aurora-icu-his/' on GitHub Pages) — the router must match it. */
const BASENAME = import.meta.env.BASE_URL.replace(/\/+$/, '') || '/'

export default function App() {
  return (
    <BrowserRouter basename={BASENAME}>
      <Routes>
        <Route path="/" element={<Navigate to="/workspace" replace />} />
        <Route path="/workspace" element={<DoctorWorkspace />} />
        <Route path="/beds" element={<BedOverview />} />
        <Route path="/patients/:bedId" element={<MissionControl />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
