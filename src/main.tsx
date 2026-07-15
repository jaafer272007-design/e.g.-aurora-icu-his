import React from 'react'
import ReactDOM from 'react-dom/client'
import './styles/tokens.css'
import App from './App'
import { initThemeTracking } from './lib/preferences'

/* theme boot — stamps data-theme on the root and follows the device
   preference live (Settings §1.1A; Follow system is the default) */
initThemeTracking()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
