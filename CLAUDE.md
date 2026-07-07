# AURORA ICU — Adult ICU Mission Control (HIS Module)

## Goal
Best-in-class Adult ICU UI + workflow inside a Hospital Information System:
fast decisions, low cognitive load, easy for doctors/nurses, ready to wire to
real APIs and medical devices later.

## Build Methodology (follow in order, do not skip)
1. UI only, dummy data, HTML/CSS/JS first (already done for screens 1–3 —
   see /reference, treat as the exact visual spec, do not redesign).
2. Convert to a real Vite + React + TypeScript project. Extract shared
   tokens/components once — never re-derive per screen.
3. Review each screen against: UX, ease of use for doctor/nurse, fit with
   real ICU workflow, API-readiness, performance/code organization.
4. Only after a screen is approved, move to the next one in the roadmap.
5. Mock data adapters must be shaped exactly like a future real API response
   (field names, nesting) so swapping in ASP.NET Core endpoints later is a
   data-layer change only, never a UI rewrite.
6. No real API, no auth, no backend until Stage 9 below.

## Screen Roadmap
1. ICU Bed Overview — ✅ approved (`/reference/icu-bed-overview.html`)
2. Patient Mission Control — ✅ built, formal review pending (`/reference/icu-mission-control.html`)
3. Doctor Workspace — ✅ approved (`/reference/icu-doctor-workspace.html`)
4. Nurse Workspace — not started
5. Orders & Medication — not started (standalone screen, own route — confirmed)
6. Laboratory & Imaging — not started (standalone screen, own route — confirmed)
7. Timeline — not started (standalone screen, own route — confirmed)
8. AI Clinical Assistant — not started
9. Login / Role-Switch screen — build right before API Integration
10. API Integration (ASP.NET Core Web APIs)
11. Medical device integration (ventilators, monitors, lab) + AI

## Architecture Rules (binding for all future screens)
See `docs/architecture.md` — production-grade HIS rules: stable PatientID for all
routing/lookups (bed = location only), separated domain models, service-layer
data access, independent reusable components, real-time-ready design, structured
alert/device models. Apply incrementally; don't wholesale-refactor existing code.

## Locked Decisions (do not re-litigate without asking)
- RBAC: Doctor = full order/medication authority. Nurse = administer +
  document only, cannot originate orders.
- Orders & Medication / Lab & Imaging / Timeline are standalone routed
  screens, not drill-down panels inside Patient Mission Control.
- Nav: the sidebar "Dashboard" item is role-personalized — it renders
  Doctor Workspace for a physician session, Nurse Workspace for a nurse
  session, once auth exists. Until then, default to Doctor Workspace.
- Doctor Workspace's quick-order drawer stays lightweight (free text +
  quick-set bundle shortcuts, no drug formulary) — do not expand it. Full
  medication ordering (searchable formulary, dose/route/frequency,
  allergy/interaction checking against the patient's allergy field) is
  Screen 5 (Orders & Medication) scope, built after Nurse Workspace.

## Design System (extract into src/styles/tokens.css, reuse everywhere)
Dark medical theme, glassmorphism, background `#060b13`.
Colors: blue `#4da3ff`, cyan `#35e0d0`, green `#3de8a0`, amber `#ffb454`,
red `#ff5d6c`, violet `#a78bfa`. Severity mapping is fixed system-wide:
red = critical, amber = high, green = stable — never reassign.
Fonts: sans `-apple-system,"SF Pro Display","Segoe UI",Inter,Roboto,Arial`;
mono for all clinical/numeric values `"SF Mono","Cascadia Mono","JetBrains Mono",ui-monospace`.
Card radius 18px, `1px solid rgba(130,170,230,.13)` border, blur 14–18px,
shadow `0 12px 34px rgba(0,0,0,.38)`.
Shared components to build once and reuse: Card, Badge/Tag, SeverityDot
(pulses on critical), VitalTile, Sparkline, AlertRow, KpiPill, NavSidebar,
AppHeader.

## Accessibility — required on every screen from Screen 3 onward
(Screens 1–2 have known gaps — fix opportunistically when next touched)
- Touch targets ≥ 44×44px
- Visible `:focus-visible` ring on every interactive element
- `aria-label` on all icon-only buttons
- Never convey severity by color alone — pair with icon/text
- Contrast ≥ 4.5:1 body text, ≥ 3:1 large text

## Current Status
Screens 1–3 exist only as static HTML prototypes in /reference. No React
project exists yet. First task: scaffold the project and port these three
screens faithfully (pixel-accurate to /reference) into componentized,
routed React pages before building anything new.
