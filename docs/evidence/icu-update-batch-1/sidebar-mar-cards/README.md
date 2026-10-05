# Evidence — sidebar hover across sections + daily MAR prescription cards (draft PR #234, 2026-10-04)

Proof for the two owner-approved refinements made after Codex's review passed
at `def08a9`.

| Source | Where |
|---|---|
| The request, verbatim | `docs/design/icu-update-sidebar-mar-daily-cards.md` |
| The MAR presentation rule | MAR design `### D` in `docs/design/mar-derived-schedule.md` (pure append) |
| The status record | `02_PROJECT_STATUS.md` 2026-10-04 |

All of it was produced on 2026-10-04/05 in the implementation container.
Only synthetic patients and drugs were used, with no hospital system and no
real clinical data, and the retired hosted test service was never contacted.
It is docs-only review evidence and can be dropped before merge.

## Commits

| Commit | Content |
|---|---|
| `ab4455d` | the request, recorded verbatim |
| `f42523a` | **the change**: `lib/navHover.ts`, `NavSidebar.tsx`, `session.ts` sign-out; `NurseWorkspace/marDays.ts`, `MarCard.tsx`, `NurseWorkspace.css` |
| `fc7ad99` | CSS: the history chevron stays beside the date. **The bundle and server under test** (`logs/healthz.json`) |
| `e6a9d48` | evidence tools (docs only). **The source every final build/harness step ran on** |

No server file changed: `git diff def08a9 -- server` is empty.

## Results

| Check | Result | Log |
|---|---|---|
| `npm run build`, `dotnet build -c Release`, the `ci.yml` frontend + server steps (tsc `--force`, vite, 4 gates, env allow-list, dotnet, vocab gate) | all exit 0; the chunk-size warning and one CS8602 in `BootGuards.cs` are pre-existing | `logs/final/SUMMARY.txt`, `01…11-*.log` |
| Rolling-timer harness (25 scenarios, real server sources vs real client modules) | **372 checks, 0 failures**, unchanged | `logs/final/12…16-*.log` |
| Daily-card grouping harness (real `marDays.ts` + `time.ts`, hospital Asia/Baghdad) | **25/25**, identical with the device zone at UTC, UTC−7 and UTC+14 | `logs/final/17…19-*.log`, `logs/mardays-harness*.log` |
| Browser on the live stack | **46/46** | `logs/cards-browser.log` |

### The browser check

The stack:
- server `fc7ad99` with its staging bundle, on local PostgreSQL 16;
- server zone Asia/Baghdad; the browser's device zone is UTC.

The run happened at 02:2x hospital time on 2026-10-05, when the UTC date was
still 2026-10-04. A browser-zone or sliced-UTC date would therefore put the
night's rows on the wrong day.

`tools/cards-setup.py` built one synthetic patient through the API. The
database was touched only to backdate therapy starts, and to add two undated
legacy facts to a discontinued order.

**Sidebar:**
- Mouse:
  - the pointer resting on the **label** (x=150, beyond the 64 px rail)
    through Orders → Lab Entry → Observations → Orders keeps every new
    page's sidebar open at full width, with 600 ms of no movement;
  - leaving collapses it after the delay;
  - a 40 ms crossing never opens it;
  - keyboard focus opens it, and leaving focus closes it.
- Other modes:
  - the 700 px overlay drawer survives a section change;
  - the touch toggle works and the tap never uses hover;
  - **sign-out clears the hover**: after a keyboard-only sign-out and sign-in,
    with the pointer unmoved on a label, the new sidebar is collapsed.

**MAR grouping:**
- three q1h rounds whose UTC date differs land in **one** "Today · 2026-10-05" card;
- the same drug as two prescriptions gives two cards;
- the header shows the drug, dose and route · frequency once;
- a Held round reads "held · documented …";
- **yesterday's outstanding round** keeps its controls on its own open card,
  and today's card only references it (the button moves focus there);
- **tomorrow's current round** gets an open "Tomorrow" card, with a "Next"
  reference from today;
- **23:00 due / 00:20 given** stays on yesterday's card, showing "given at
  2026-10-05 00:20" and the delay reason;
- **PRN / on-demand** doses sit on their documentation day, and the
  availability on today;
- **undated legacy** history goes under "Date unavailable", last, shown exactly
  as stored.

**MAR integrity:**
- control groups = actionable server rows (7);
- rows in open cards + rows counted by collapsed cards = server rows (17);
- the **due count** equals the existing predicate over the server rows;
- opened history cards **stay open through a poll**.

**Hospital midnight:** the browser clock is moved to 23:59:30 hospital time,
and the shared 30 s tick rolls the page over:
- tomorrow's card becomes today's;
- PRN availability moves to the new today;
- every prescription with an outstanding round on the previous day gets a
  new today card that references it.

**Actions:** Given posted to `/api/icu/mar/<orderId>/administrations/<the
server row's adminId>`, then the server refresh. Yesterday's overdue round
used the existing delay-reason dialog (reason + UTC `administeredAt`); after
the refresh, its card became collapsed history and today's card held round 2.

**Readability:** the new text measured against the rendered background has a
lowest contrast of **4.52:1** in dark and **5.75:1** in light. At 390 px no MAR
element overflows, and the controls stay ≥ 36 px tall.

## Screenshots (`screenshots/`, synthetic patient only)

For each shot, the other patients' MAR groups were hidden: the MAR scrolls
inside the page.

| File | What to look at |
|---|---|
| `dark-desktop-nurse-mar-daily-cards.jpg` | Tomorrow's card first, then today's cards (several rounds in one card; the same drug twice; the references), yesterday's open outstanding round, opened and collapsed history, Date unavailable |
| `light-desktop-nurse-mar-daily-cards.jpg` | the same, light theme |
| `dark-narrow390-nurse-mar-daily-cards.jpg` | 390 px, touch. The page's fixed STAGING banner covers the bottom edge of this tall capture (the last card's header). |
| `dark-desktop-nurse-mar-after-hospital-midnight.jpg` | after the browser clock crosses hospital midnight: every prescription with an outstanding round gets a today card that references the previous day's card |

## Earlier runs (`logs/earlier-runs/`), kept

The very first setup attempt aborted on the check's own first-dose alignment:
the second prescription's first dose was not on the hour. Its log was
overwritten, and that synthetic patient was discharged. Each later run used a
fresh synthetic patient, and the previous one was discharged.

| Run | Result | What changed afterwards |
|---|---|---|
| run 1 | 42/46 | **test-side only:** the 00:20 dose is 80 min after its due time, so no LATE marker (the 120 min rule is unchanged); collapsed cards render no rows; the sign-out check rested the pointer on the rail (Chromium re-reports a pointer under new content, and ordinary hover then opens the rail), so it now rests on a label, which discriminates; the 390 px page overflow is the pre-existing I&O totals row, so the check is now scoped to the MAR |
| run 2 | 45/46 | summary parsing read "2026-10-04" + "1 given" as "41 given" |
| run 3 | 46/46 | the element capture landed on the wrong area (nested scroll container); the shots are now clipped |
| run 4 | 46/46 | its shots showed the history chevron wrapping onto its own line, fixed in `fc7ad99` |

The final run is `logs/cards-browser.log`, on `fc7ad99`.

## Not verified, and observed

**Not verified:**
- browsers other than Chromium, and real touch hardware;
- a real hospital midnight (the browser clock and the harness drove it);
- the `production-seed` / `installer-powershell` CI jobs (GitHub runs them);
- the update-write/rollback **release gate**, which stays **UNRESOLVED**. No
  installer was changed or built.

**Observed, pre-existing, not changed:**
- at 390 px the page overflows because of the I&O card's totals row
  (`.iototals`);
- never-documented seeded demo orders show today's card pointing at an
  outstanding round from days ago. This is the owner-approved legacy entry
  rule.

## Tools (`tools/`)

The local DB password is read from `AURORA_LOCAL_DB_PASSWORD`.

- `mardays-harness.ts`: the grouping rules on a fake clock.
- `cards-setup.py`: the synthetic patient on the live server.
- `browser/cards-browser.cjs`: the browser check, plus `browser/lib.cjs`, the
  first round's helper.
- `final-verify-cards.sh`: produced `logs/final/`.
