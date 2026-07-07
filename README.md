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
| `/beds` | ICU Bed Overview — click any occupied bed to open that patient |
| `/patients/:bedId` | Patient Mission Control, keyed by bed (e.g. `/patients/B-01`) |

## Structure

- `src/styles/tokens.css` — master design tokens (single source, per `docs/design-system.md`)
- `src/components/` — shared components: `Card`, `Badge`, `Tag`/`BedChip`, `SeverityDot`,
  `VitalTile`, `Sparkline`, `AlertRow`, `KpiPill`/`AppHeader`, `NavSidebar`, `Toast`, icons
- `src/pages/` — one folder per screen, page-scoped CSS ported from the prototypes
- `src/lib/api/` — mock data adapters shaped exactly like the future ASP.NET Core
  REST responses (`types.ts` is the contract; swapping in real endpoints is a
  data-layer change only)
