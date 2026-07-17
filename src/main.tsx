import React from 'react'
import ReactDOM from 'react-dom/client'
import './styles/tokens.css'
import App from './App'
import { initThemeTracking } from './lib/preferences'
import { runtimeConfigError } from './lib/runtimeConfig'

/* theme boot — stamps data-theme on the root and follows the device
   preference live (Settings §1.1A; Follow system is the default) */
initThemeTracking()

/* FAIL-LOUD GATE (appliance Phase 1): with a missing or malformed
   runtime config the app REFUSES to start — rendering the app without a
   declared API origin risks it quietly pointing at the wrong one (in a
   hospital: the wrong hospital's API). Absence must never look like a
   working deployment. */
function RuntimeConfigFailure({ error }: { error: string }) {
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, fontFamily: 'system-ui, sans-serif', background: '#0b1120', color: '#e6ecf7' }}>
      <div style={{ maxWidth: 560, border: '1px solid #ff5d6c', borderRadius: 14, padding: '22px 26px' }}>
        <h1 style={{ fontSize: 18, margin: '0 0 10px', color: '#ff5d6c' }}>AURORA cannot start — runtime configuration error</h1>
        <p style={{ fontSize: 14, lineHeight: 1.6, margin: '0 0 10px' }}>{error}</p>
        <p style={{ fontSize: 12.5, lineHeight: 1.6, margin: 0, opacity: 0.75 }}>
          This deployment must serve a valid <code>runtime-config.js</code> next to the app
          (apiBaseUrl: &quot;&quot; for same-origin, an absolute URL for a cross-origin API, or null for
          the no-API demo). Refusing to guess an API origin.
        </p>
      </div>
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {runtimeConfigError !== null ? <RuntimeConfigFailure error={runtimeConfigError} /> : <App />}
  </React.StrictMode>,
)
