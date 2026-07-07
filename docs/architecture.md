# AURORA ICU — Project Architecture Rules

_Binding for every screen and component from Screen 4 (Nurse Workspace) onward.
Do NOT refactor existing code to these rules wholesale — apply them incrementally,
and only touch existing code when it naturally needs modification._

This project is **not a frontend demo**. It is the foundation of a production-grade
Hospital Information System that will later connect to ASP.NET Core Web APIs,
SQL Server, medical devices, and AI services.

## 1. Stable identifiers
Never use Bed ID as a primary identifier. Use **PatientID** everywhere for routing
and lookups (`/patients/{patientId}`). Bed number is location only — display data
that can change (transfers, bed swaps). ✅ Already applied to routing.

## 2. Separate domain models
Do not grow one giant Patient object. Independent domain models, each
independently replaceable by an API: **Patient, Admission, Vitals, Laboratory,
Medication, Ventilator, Hemodynamics, Orders, Timeline, Alerts, Devices,
AI Insights, Daily Goals.**

## 3. Reusable components
Every major section is an independent React component
(`<PatientHeader/>`, `<VitalPanel/>`, `<VentilatorPanel/>`, `<MedicationPanel/>`,
`<DigitalTwin/>`, `<AlertCenter/>`, `<DailyGoals/>`, `<Timeline/>`).
Never build giant pages.

## 4. API-ready design
The UI never knows where data comes from. All data flows through service layers
(`src/lib/api`). Mock adapters today, ASP.NET Core endpoints later — switching
must require minimal code change.

## 5. Alert model
Every alert carries: `alertId, priority, category, source, time, acknowledged,
acknowledgedBy, assignedTo, resolved, resolvedTime`.

## 6. Device model
Medical devices are independent objects with their own state: Ventilator, Monitor,
CRRT, ECMO, Infusion Pump, Central Line, Arterial Line, Foley Catheter, Chest Tube.

## 7. Digital twin
An independent component, never dependent on page layout. It will later receive
live physiological data.

## 8. Real-time ready
Design every live component assuming future WebSocket support. No architecture
that depends on page refresh.

## 9. Scalability
Don't hardcode assumptions that block scaling (fixed 16-bed arrays,
single-hospital assumptions). But don't add scaling infrastructure (caching,
virtualization, state-management libraries) until a screen actually needs it —
this is not yet a 500-bed multi-hospital deployment.

## 10. Clean architecture
Separate layers: Presentation, State Management, Domain Models, API Services,
Utilities, Shared Components. Avoid tight coupling.
