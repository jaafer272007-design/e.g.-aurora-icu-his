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
| `/` | redirects to `/workspace` |
| `/workspace` | Doctor Workspace — the role-personalized "Dashboard" (physician default until auth exists) |
| `/nurse` | Nurse Workspace — the nurse session's "Dashboard" (administer + document only, no order origination) |
| `/beds` | ICU Bed Overview — click any occupied bed to open that patient |
| `/patients/:patientId` | Patient Mission Control, keyed by the stable patient id (e.g. `/patients/P-1001`); bed number is display-only location data |
| `/orders/:patientId` | Orders & Medication — canonical orders record with formulary, safety checks, order sets, audit history (doctor RBAC) |

## Structure

- `src/styles/tokens.css` — master design tokens (single source, per `docs/design-system.md`)
- `src/components/` — shared components: `Card`, `Badge`, `Tag`/`BedChip`, `SeverityDot`,
  `VitalTile`, `Sparkline`, `AlertRow`, `KpiPill`/`AppHeader`, `NavSidebar`, `Toast`, icons
- `src/pages/` — one folder per screen, page-scoped CSS ported from the prototypes
- `src/lib/api/` — mock data adapters shaped exactly like the future ASP.NET Core
  REST responses (`types.ts` is the contract; swapping in real endpoints is a
  data-layer change only)
