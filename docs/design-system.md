# AURORA ICU — Design System Reference
_Master token source for all screens. Screens 1–2 built before this file existed and have known gaps (noted below) — retrofit when each is next touched._

## Color Tokens
| Token | Value | Use |
|---|---|---|
| `--bg` | `#060b13` | App background base |
| `--stroke` | `rgba(130,170,230,.13)` | Default card/border |
| `--stroke2` | `rgba(130,170,230,.22–.24)` | Hover/active border — **unify to .22** (screens 1/2 currently differ) |
| `--text` | `#e9f1fb` | Primary text |
| `--dim` | `#8fa3bc` | Secondary text |
| `--faint` | `#5d7089` | Tertiary / labels |
| `--blue` | `#4da3ff` | Primary accent, info |
| `--cyan` | `#35e0d0` | Secondary accent |
| `--green` | `#3de8a0` | Stable / success |
| `--amber` | `#ffb454` | Warning / high severity |
| `--red` | `#ff5d6c` | Critical severity |
| `--violet` | `#a78bfa` | CRRT / special support tag |

Severity mapping is fixed across the whole system: **red = critical, amber = high, green = stable** — never reassign these to other meanings on new screens.

## Typography
- Sans: `-apple-system, "SF Pro Display", "Segoe UI", Inter, Roboto, Arial`
- Mono (all numeric/clinical values): `"SF Mono","Cascadia Mono","JetBrains Mono", ui-monospace`
- Base card label: 9–11px uppercase, letter-spacing .8–1.7px, `--faint`/`--dim`
- Data values: mono, 700 weight

## Structure
- Card radius `18px`, border `1px solid var(--stroke)`, glass panel gradient + `backdrop-filter: blur(14–18px)`
- Shadow: `0 12px 34px rgba(0,0,0,.38)`
- Shell: header (auto) / sidebar (fixed ~200–300px) / main (fluid) — sidebar collapses to icon rail <1500px

## Shared Components (reuse verbatim, don't re-derive)
`bed`/`tag`/`chip` pill, `sevdot` (severity dot, pulses on `.crit`), `mini`/`tile`/`rt` stat tile, `spark` inline SVG trend line, `.al`/`.hal` alert row, skeleton shimmer loader, occupancy ring SVG.

## Accessibility baseline — NOT yet done on Screens 1–2, REQUIRED from Screen 3 on
(per `ui-ux-pro-max` checklist — this was skipped earlier and is being corrected now)
- [ ] Touch targets ≥ 44×44px (chips, ack buttons, filter buttons currently undersized)
- [ ] Visible `:focus-visible` ring on every interactive element (currently undefined)
- [ ] `aria-label` on all icon-only buttons (bell, ack ✓, nav icons)
- [ ] Color never the sole signal — pair severity color with icon/text (mostly OK, verify each new screen)
- [ ] Contrast ≥ 4.5:1 body text / 3:1 large text — verify `--dim`/`--faint` on `--bg`

## Screen Inventory
1. ICU Bed Overview — built
2. Patient Mission Control — built, formal review pending
3. Doctor Workspace — in progress
