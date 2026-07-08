# AURORA ICU — HIS Module

Adult ICU Mission Control UI for a Hospital Information System.
Vite + React + TypeScript port of the approved static prototypes in `/reference`
(treat those files as the visual spec — see `CLAUDE.md` for the build methodology
and `docs/design-system.md` for tokens).

## Run

```bash
npm install
npm run dev      # local dev server
npm run build    # type-check + production build
npm run preview  # serve the production build
```

## Routes

| Route | Screen |
|---|---|
| `/login` | Login / Role-Switch — LOCAL session simulation (name + job title from preset staff; three-layer RBAC: JobTitle → PermissionProfile → Permissions, derived at read time; sessionStorage survives refresh). NOT real authentication — Stage 10 |
| `/` | redirects to the signed-in profile's landing view (or `/login`) |
| `/admin` | Administrator landing — census, occupancy, unit performance; read-only |
| `/workspace` | Doctor Workspace — the role-personalized "Dashboard" (physician default until auth exists) |
| `/nurse` | Nurse Workspace — the nurse session's "Dashboard" (administer + document only, no order origination) |
| `/beds` | ICU Bed Overview — click any occupied bed to open that patient |
| `/patients/:patientId` | Patient Mission Control, keyed by the stable patient id (e.g. `/patients/P-1001`); bed number is display-only location data |
| `/orders/:patientId` | Orders & Medication — canonical orders record with formulary, safety checks, order sets, audit history (doctor RBAC) |
| `/labs/:patientId` | Laboratory & Imaging — canonical results record: lab trends, imaging reports, abnormal/critical flags, doctor-only acknowledge (acknowledge requires the `results.acknowledge` permission; other profiles view-only) |
| `/timeline/:patientId` | Clinical Timeline — read-only aggregated feed over the canonical stores (order audit trail, results + acknowledgments, MAR, task completions, I&O, consults, clinical notes) with category and day/shift filters and deep-links back to the originating screens |
| `/ai` · `/ai/:patientId` | AI Clinical Assistant — simulated risk predictions (canonical AI domain): unit-wide ranking by highest risk, per-risk trend from q15min history, contributing-factor breakdown, advisory-only suggestions; threshold crossings surface in the existing alert center (view-only for non-clinical-actor profiles) |

## Structure

- `src/styles/tokens.css` — master design tokens (single source, per `docs/design-system.md`)
- `src/components/` — shared components: `Card`, `Badge`, `Tag`/`BedChip`, `SeverityDot`,
  `VitalTile`, `Sparkline`, `AlertRow`, `KpiPill`/`AppHeader`, `NavSidebar`, `Toast`, icons
- `src/pages/` — one folder per screen, page-scoped CSS ported from the prototypes
- `src/lib/api/` — mock data adapters shaped exactly like the future ASP.NET Core
  REST responses (`types.ts` is the contract; swapping in real endpoints is a
  data-layer change only)
