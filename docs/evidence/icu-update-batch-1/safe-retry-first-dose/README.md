# First dose + safe retry — evidence (2026-10-05)

The follow-up, recorded verbatim: `docs/design/icu-update-mar-safe-retry-first-dose.md`.
The rules: MAR design `docs/design/mar-derived-schedule.md` **### F**, which supersedes ### E's open
questions and its uncertain-save settlement. Synthetic data and the local stack only. The retired hosted
service was never contacted, and no hospital was accessed.

**The owner's decisions.**
- **Continuous:** documentation stays available when needed; no recording interval.
- **PRN:** stays as needed; its hidden frequency is not a minimum interval.
- **First dose:** available immediately after signing, including once orders. Every later round stays
  locked until its due time.
- **History and legacy orders:** existing history and identities are untouched. An order with any
  recorded fact, legacy included, is not at its first dose, so its schedule is never reset.

**The settlement correction (SAFE RETRY).**
- Every documentation is one attempt with its own `attemptId`, stored on the fact it creates.
- The server answers a resend of a recorded attempt with the existing record, under the existing order
  lock and before any state check: no fact, no audit entry.
- The page settles an unanswered save only from the record: a fact carrying its attempt id, or the same
  round documented by another fact. Elapsed time plus an absent fact proves nothing.
- Stale reads are discarded whole, both display and verdict.
- **Retry saving** re-sends the same attempt.
- Unconfirmed attempts survive a reload.

## Commits

| Commit | What |
|---|---|
| `a3ff24d` | the request, recorded verbatim |
| `cbf74cd` | the source: first-dose exemption, `attemptId` deduplication, page settlement + Retry saving, mock mirror |
| `0907f09` | the deployed MAR suite: documents the run order's first dose, asserts the next round's lock, adds a safe-retry leg |
| `f3b50db` | the evidence tools (docs only) |
| `c5c3b31` | the pinned-retry fallback: a 400 on a pinned retry re-sends the original request exactly |
| `303ae8c` | the device-clock-ahead scenario (S4) in the tools (docs only) |
| `b5357c0` | MAR design ### F (docs only) |
| the commit after it | the `02` record, these logs and screenshots (docs only) |

## 1 · Codex's two failures, reproduced first, on the pre-change build

`tools/browser/saferetry-browser.cjs` drives the **real page** with Playwright-controlled transport:
- the page's documentation POST is captured verbatim and the page gets no answer;
- the harness sends that exact request to the server itself **21 s later** (the original "commits
  later");
- in the out-of-order case, one MAR read fetched before the commit is held and released **after** a
  newer read was applied.

"The nurse follows the page": when the page offers Retry saving, the harness uses it. When the page says
NOT recorded and reopens the dose, the harness documents it again, as the page tells the nurse to.

Run with `S1,S2` against the build of reviewed head `d66c6cf`: `logs/before/browser-S1-S2.log`, **1
passed, 8 failed**.
- **S1, late commit:** at failure +16.0 s the page had already said "Dose NOT recorded" and reopened
  the dose. Documenting again, plus the original arriving at +21 s, left **2 facts and 2 audit entries**
  for one dose.
- **S2, stale read:** read #2 (taken at failure +15.6 s, before the commit) was held. Read #3 (after the
  commit) was applied. Releasing #2 produced "Dose NOT recorded" while the fact was on screen, which
  led to **2 facts**.
- `logs/before/browser-S1-S2.racy-gate.log` is the first attempt. It had a race in the harness's own
  read gate (fixed). It shows the same verdicts.

## 2 · Final verification — once, on the committed source

`tools/final-verify-saferetry.sh` runs every step, from a copy, so it was not edited while running. Each
command and its exit code are in `logs/final/SUMMARY.txt`, and each step's output is in
`logs/final/NN-*.log`.

Run on the committed source `303ae8c` (head before this docs commit: `b5357c0`, docs-only on top). All
32 steps exit 0. The one compiler warning is the existing `BootGuards.cs` CS8602, plus the existing
chunk-size note.

| Check | Result |
|---|---|
| `npm run build`, `dotnet build -c Release`, the `ci.yml` frontend + server steps (tsc, vite, 5 gates, vite-env allow-list, dotnet build) | all exit 0 |
| Rolling-timer replay: 25 scenarios, server sources (C#) against client modules (TS), using one-action-per-round's superseding harness | **372 checks, 0 failures**. The same 12 pre-gate steps are loaded as stored facts; the timer is unchanged. |
| Daily cards (`marDays.ts` changed): grouping harness | **25/25** |
| Client/mock mirror on a fake hospital clock (`tools/mirror-harness.ts`), UTC and America/Los_Angeles | **46/46** in each zone. Covers: the first dose open 20 min early and round 2 locked until actual + 1 h; the owner's 06:05 → 07:05 example as a subsequent round (07:04:59.999 refused, 07:05:00.000 open); no cooldown; once orders; a legacy order locked; midnight; attempt replay for PRN, continuous, a round and after discontinuation |
| Real API + PostgreSQL 16 (`tools/api-check-saferetry.py`) | **29/29**. Covers: first dose 33 min early → 200, round 2 = actual + 1 h and 409 before it with nothing written; first dose Held → round 2 = scheduled + 1 h; once dose; legacy round 1 unchanged and 409; replays → 200 with the row byte-identical (PRN, on-demand, round, once, after discontinuation); same id with a different action → 409; **6 concurrent copies of one attempt → 1 fact, 1 audit entry**; malformed ids → 400; no `attemptId` → unchanged behaviour |
| The previous round's real-API check, superseding copy (`tools/api-check-oneaction.v2.py`; only the new once order's expectation changed) | **40/40**. Every subsequent round's lock, the exact boundary, concurrent bursts, the stale page and no cooldown are unchanged. |
| Deployed suites replayed locally: MAR (updated), assignments, encounter-scope | all **PASSED** (9 / 11 / 12 steps) |
| Browser, Chromium, live stack, controlled transport (`tools/browser/saferetry-browser.cjs`) | **41/41** |

Browser check, scenario by scenario:
- **F:** first dose and once dose open before 13:00. Round 2 is locked until actual + 1 h. The legacy
  and subsequent rounds are locked.
- **S1, delayed original + Retry saving:** at failure +16 s the dose is still locked and unconfirmed.
  The retry re-sends the same attempt with its minute pinned. The original lands at +21 s and is
  answered with the record. Result: **1 fact, 1 audit entry**.
- **S1b:** the late original is confirmed by the page itself at +25.2 s, with no retry.
- **S2, out of order:** stale read #5 is discarded; the newer read #6 confirmed the save. **1 fact.**
- **S3, lost original:** the attempt stays unconfirmed for 16 s and **across a reload**. A real
  double-click on Retry saving sends 1 request, which records the dose at its documented minute.
- **S4, device clock 3 min ahead:** the pinned retry gets 400, the original request is re-sent exactly,
  and the late original adds nothing. **1 fact.**
- **Every PRN/continuous case** ends with an intentional later Given, which is a new attempt and a
  second fact.
- **Rendered contrast:** dark 9.84 / 6.66, light 6.09 / 7.56. At 390 px the MAR group fits.

**The previous round's `oneaction-harness.ts` is not re-run.** Its first scenario documents a *new*
order's round 1, and its once scenario a new once dose, both expected locked: exactly the lock the
owner's first-dose decision removed. Every later step of that timeline cascades from it. Its run in the stopped first final run is kept as
`logs/stopped-run-before-pin-fix/23-oneaction-harness-old-run-UTC.log`: 15 failures, all downstream of
those two first doses, then a crash on the now-absent locked round. `mirror-harness.ts` [2] re-runs its
owner's example as a subsequent round, and [5] its midnight case.

### The pinned-retry fallback (found in self-review, reproduced, fixed)

The first final run (`logs/stopped-run-before-pin-fix/SUMMARY.txt`, on `f3b50db`) was **stopped**
during step 28 (steps 1–27 exit 0), before any browser step, when a review of my own
change found a gap. A retried on-time Given pins its documented minute. If the device clock runs ahead,
the server refuses that pinned minute (400), while the original request, still in flight, would be
accepted. Treating the 400 as final let the page say "not saved" before the original committed.
- `logs/before-pin-fix/browser-S4.log`: on `cbf74cd`, **0/3**. The page said "Documentation NOT
  saved"; the nurse documented again; the original committed; **2 facts**.
- `c5c3b31`: a 400 on a pinned retry re-sends the original request exactly.
- `logs/after-pin-fix/browser-S4.log`: **3/3**. The full final run above includes S4.

## Screenshots

`screenshots/` (synthetic patient):
- `dark-desktop-first-dose-open.jpg`: the first dose and the once dose open before 13:00; the legacy
  and subsequent rounds locked with "Opens …".
- `dark-desktop-unconfirmed-retry-saving.jpg`: an unanswered PRN save, unconfirmed with Retry saving,
  next to confirmed cases.
- `light-desktop-unconfirmed-retry-saving.jpg`, `light-narrow390-unconfirmed-retry-saving.jpg`: the
  same state, light theme, desktop and 390 px.

## Additive contract and compatibility

All new fields live in existing JSON columns: no migration. `WhenWritingNull` keeps existing bytes
unchanged.
- **Request body `attemptId`:** optional; 8–64 chars of `A–Z a–z 0–9 - _`, otherwise 400.
- **Stored fact and MAR fact row `attemptId`:** present only when the fact was recorded with one.
- **Current-round / `once` row `firstDose: true`:** present only when the order has no documented
  administration.

Compatibility:
- A request without `attemptId` behaves exactly as before, with no deduplication.
- A server older than this change refuses a body carrying `attemptId` (400, because unknown fields are
  disallowed). Client and server ship together: the appliance serves its own frontend from one origin.

## Limitations (stated)

- **Browser:** Chromium only.
- **Real time, not a faked clock:** the delayed commit and the stale read are driven in real time.
  Only the fake-clock harness moves the clock.
- **Reload persistence is per tab and per nurse** (`sessionStorage`). An unconfirmed attempt is not
  carried to another tab or device. After that, documenting a PRN/on-demand dose again elsewhere is a
  new attempt. A scheduled round still takes only one fact.
- **A retried on-time Given carries its documented minute from the device clock.** If the device runs
  more than a minute ahead of the server, that pinned minute is refused (400). The page then re-sends
  the original request, which records the server's time of the retry instead (S4).
- **The 390 px page scroll** comes from the I&O card's totals row (`.iototals`). It predates this change
  and is outside it; the MAR group fits. It was flagged as a separate task.
- **Suites:** replayed locally; no hosted run.
