# One action per medication round — evidence (2026-10-05)

The owner's correction, recorded verbatim: `docs/design/icu-update-mar-one-action-per-round.md`.
The rule: MAR design `docs/design/mar-derived-schedule.md` **### E**. Synthetic data only, local stack only.
The retired hosted service was never contacted, and no hospital was accessed.

**The rule.** A scheduled dose can be documented (Given, Held or Refused) from its **exact scheduled
time**, never before. A scheduled dose is a repeating order's current round, or the dose of a `once` order.
- The server refuses an early action with 409 inside the existing order lock, against the freshly derived
  round and the server clock, and writes nothing.
- The page shows the current round with its controls locked, and when they open. They open by themselves
  at that time.
- Every MAR action has immediate submission protection, and uncertain outcomes are settled by a fresh
  server read before any retry.
- The rolling timer, overdue reasons, backdating protection, identities, row locks, daily cards, sidebar
  and filters are unchanged.

## Commits

| Commit | What |
|---|---|
| `a8ded8d` | the request, recorded verbatim |
| `d8506ea` | the source: server gate, client mirror, mock adapter, MAR card locks, submission protection |
| `d32a7ad` | the deployed MAR and assignments suites no longer document a run-created round before its time |
| `d8fe9ce` | the evidence tools (docs only) |
| the commit after it | the `02` record, MAR design ### E, these logs and screenshots (docs only) |

## Final verification — once, on the committed source `d32a7ad`

`tools/final-verify-oneaction.sh` runs every step. Each command and its exit code are in
`logs/final/SUMMARY.txt`, and each step's output is in `logs/final/NN-*.log`.

| Check | Result |
|---|---|
| `npm run build`, `dotnet build -c Release`, the `ci.yml` frontend + server steps (tsc, vite, 5 gates, vite-env allow-list, dotnet build) | all exit 0. The one warning is the existing `BootGuards.cs` CS8602, plus the existing chunk-size note. |
| Rolling-timer replay: 25 scenarios, the server sources (C#) against the client modules (TS) | **372 checks, 0 failures**, using the superseding TS harness (see below) |
| Daily cards (`marDays.ts` changed): grouping harness | **25/25** |
| One-action client mirror on a fake hospital clock (`tools/oneaction-harness.ts`), device zones UTC and America/Los_Angeles | **36/36** in each zone |
| Real API + PostgreSQL 16 (`tools/api-check-oneaction.py`) | **41/41** |
| Deployed suites replayed locally (`run-suite.py`): MAR, assignments, encounter-scope | all **PASSED** |
| Browser, Chromium, live stack (`tools/browser/oneaction-browser.cjs`) | **60/60**. The controls opened by themselves 46 ms after the due minute. Rendered contrast: lock line ≥ 6.46:1 (dark) / ≥ 6.36:1 (light), notice 5.81:1 (dark). |

### The timer replay, and why there is a superseding copy

The first final run used the original TS harness, `correction/tools/rollts/harness.ts`. Its steps 14–16
reported **122 mismatches, all on the client side**. Two reasons, neither a timer change:
1. The mock adapter's `applyAdministration` now returns its refusal wording (a string) instead of `null`.
   The old harness read any truthy result as success.
2. The 25 scenarios (written 2026-09-30) contain **12 steps that documented a round before its time**.
   That was legal then, so such facts can be in stored data, and the unchanged timer must still replay
   them. The mock now refuses those steps.

`tools/rollreplay/harness.ts` is a superseding copy; the original is kept unchanged with its logs.
- It reads a string as a refusal.
- It loads each gate-refused step as the **stored pre-gate fact** the old mock wrote (same fields, same
  audit wording).
- It reports the count: `gate-refused scenario steps loaded as stored pre-gate facts: 12`.

The C# side replays the endpoint's pre-gate branches, as before. Both sides therefore replay identical
facts: **372/0**. The first run's failing log is kept as `logs/final/16-expectations+parity.first-run.log`.
Steps 14b–16b in `SUMMARY.txt` re-ran only these three steps, with the copy, after the run.

### The browser steps ran twice (my error, stated)

I edited `final-verify-oneaction.sh` (the comment above step 14) while bash was still executing it.
1. After step 30, bash resumed at a shifted byte offset.
2. It hit a garbled fragment (`ython3: command not found`).
3. It re-ran the screenshot reset and steps 29–30.

The **first** browser check also exited 0 (see `SUMMARY.txt`), but its log and screenshots were
overwritten. The kept `30-browser-check.log` (60/60) and the screenshots come from the **second** run: the
same committed source and the same stack. `SUMMARY.txt` notes this.

### Earlier development runs (`logs/earlier-runs/`, kept)

- **API check, run 1:** the setup reused one drug for two orders. The server's real duplicate-therapy check
  refused it, correctly. Each order now gets its own synthetic drug.
- **Browser, run 1 (45/47):** a found defect.
  - On the fast local server, a continuous order's save and refresh finished in under 30 ms, the ON DEMAND
    row reopened, and a click 30 ms later recorded a **second** dose.
  - Fixed in the source before the commit: the 2nd/3rd clicks of a multi-click are ignored
    (`event.detail`), and the check now uses real mouse multi-clicks.
  - The second failure was a contrast reading taken through the fixed staging banner.
- **Browser, run 2 (57/60):** three contrast readings were of elements under the fixed staging banner.
  The check now centres each element and verifies that nothing covers it before measuring.
- **Suites, run 1:** all passed. `suite-mar-before-contrast.log` is the unmodified MAR suite against the
  new server: it fails at its old early-documentation leg.

## What each check covers

**Real API + PostgreSQL** (`api-check-oneaction.py`). The setup backdates an order's "signed" event so
that round 1 is due 4 h ago, then documents through the API. Every refusal is checked byte-for-byte
against the order row's `AdministrationsJson` and `HistoryJson`.
1. **The owner's example on the server clock.**
   - Round 1 Given now → round 2 due an interval later.
   - Given, Held and Refused are all refused before it: **409** "is not due until …", nothing written, the
     same current round still served.
   - A Given with a delay reason and an actual time is refused too.
2. **6 concurrent early requests** (mixed actions) → all 409, nothing written.
3. **The exact boundary.**
   - Round 2 is due about 90 s ahead.
   - 4 s before it, a Given → 409.
   - At due + 1 s, **5 concurrent mixed requests → exactly one 200**, the rest 409 already-documented.
   - Exactly one fact and one audit entry are written, and round 3 is locked.
4. **A stale page.** After another station documents the round, the page's Held on it → 409
   already-documented. The refreshed next round → 409 not-due-yet. Nothing written.
5. **An already-due next round stays open** (no cooldown). A Held whose scheduled time + interval has
   passed leaves the next round open at once. A round ending in the future locks.
6. **Once orders.** A new once dose (the next full hour) → 409. A due once dose → 200 once, then 409.
7. **PRN and continuous are NOT gated** (stated, not hidden). Three sequential Given on a continuous order
   → three facts, the screenshot's pattern on the server. Two Given on a PRN order → two facts.

**Client, fake clock** (`oneaction-harness.ts`): the real `marSchedule` / `marDays` / `time` / mock-adapter
modules on the hospital clock.
- **The owner's literal example:**
  - q1h, round 1 due 06:00, Given at 06:05 → round 2 at 07:05;
  - refused at 06:05, at 06:40 (the DUE SOON window) and at 07:04:59.999;
  - eligible at 07:05:00.000, where one Held is accepted;
  - a second action → already documented;
  - round 3 at 08:05 is locked.
- **Refused at due** → the next round = scheduled time + interval, locked.
- **An already-due next round** → open at once.
- **Once:** 10:59:59 refused, 11:00 accepted.
- **Hospital midnight:**
  - at 23:59:59 the round due 00:00 is locked, on tomorrow's open card, with today's card referencing it;
  - at 00:00:00 it is eligible, on today's card.
- **PRN / on-demand:** no lock.

**Deployed suites** (`.github/workflows`), replayed against the local stack.
- **Why they changed:** a run-created order's round 1 is the next full hour, so it is never documentable
  in-run.
  - The **MAR** suite now asserts that every action on it is 409 with nothing written. Its
    positive/replay/held legs run on a run-created PRN order.
  - The **assignments** suite's removed nurse documents a PRN dose.
  - **Encounter-scope** is unaffected: its post-discharge 409 comes from the encounter guard, which
    runs first.
- **Contrast:** the unmodified MAR suite fails against the new server at exactly its old leg
  (`logs/suite-mar-before-contrast.log`).

**Browser** (`oneaction-browser.cjs`, after `oneaction-setup.py`). Live stack, server zone Asia/Baghdad,
browser device zone UTC. Every POST the page sends is recorded, and the stored facts are re-read after
each scenario.
1. **LOCK:**
   - the current round shows **DUE SOON** with Given/Held/Refused disabled and
     "🔒 Opens HH:mm (in N min) — one action per round";
   - it stays locked through a poll;
   - scripted clicks send nothing;
   - the controls **open by themselves at the scheduled time** (tens of ms after it, no reload);
   - 5 + 3 rapid mixed clicks → **one request**;
   - round 3 is then locked "Opens …".
2. **RAPID:** mixed clicks in one task → one request, and no dialog left open.
3. **DIALOG:** Held → reason → double-click confirm → one request.
4. **UNCERTAIN, recorded:** the answer is lost after the server recorded the dose → "Checking the record",
   then "Documented — confirmed", with no blind retry.
5. **UNCERTAIN, not recorded:** the request never arrives.
   - The order stays locked while checking (still locked 8 s later).
   - After ≥ 15 s, "Dose NOT recorded" appears and the round reopens with a notice.
   - Documenting again records it once.
6. **STALE page:** another station documents the round → this page's Given → "Dose NOT recorded" with the
   server's reason **in hospital time**. The refreshed row is round 3, locked, with the notice.
7. **CONTINUOUS Insulin (Actrapid) 2.5 U/h**: see below.
8. **Readability:** rendered contrast of the lock line and the notice in dark and light, plus a 390 px
   overflow check.

## The owner's screenshot — continuous Insulin (Actrapid) 2.5 U/h, three Given at the same minute

**Scheduled locking does not apply to it**, and this change does not claim to fix it. Its frequency is
`continuous`, which derives no round. "U/h" is an infusion rate, not a repeat frequency.

**What this change does for it:**
- One documentation at a time per order, and the 2nd/3rd clicks of a double or triple click are ignored.
- The browser check shows it: a real triple click → **1** request. A real double click whose two clicks
  are 150 ms apart (the page's save and refresh had already finished, and the row was open again between
  them) → **1** more request. Two facts in total, one per multi-click.
- Three same-minute Givens from repeated clicking can no longer happen.

**What it does not do:**
- A deliberate later click still records another dose. The ON DEMAND controls are open again after each
  save, because nothing defines when the next documentation is due.

**Source check — none exists:**
- `MedicationDto` / `MedicationDetails` carry drug, dose, route, frequency, duration, PRN fields, and an
  optional structured infusion dose. That dose is value + mass unit + time basis: a rate.
- The formulary entry (`insulin-actrapid`: doses, routes, frequencies `continuous` / `q6h` /
  `sliding scale`) and the order sets define no check interval.
- The only "q1h" on the seeded order is free text in its creation history ("Glucose check q1h while on
  infusion"). That is a glucose-check instruction, not a documentation round.

**Smallest proposed change** (MAR design ### E): an additive, prescriber-set documentation interval on
continuous-infusion orders. It would live inside `MedicationJson`, so no migration. It would be shown on
the order and the card, and drive a rolling "rate check" round through this same gate.

**PRN** is unresolved too. A PRN order stores a frequency that is never shown or used. Whether it is a
minimum interval is a clinical decision.

## Screenshots (`screenshots/`, from the final run)

| File | Shows |
|---|---|
| `dark-desktop-round-locked-until-due.jpg` | a current round in the DUE SOON window, its three actions disabled, "Opens HH:mm (in N min) — one action per round" |
| `dark-desktop-checking-uncertain-outcome.jpg` | an order locked while an unanswered documentation is checked against the server |
| `dark-desktop-stale-page-refusal.jpg` | after a stale-page refusal: the next round locked, with the server's reason on the row in hospital time |
| `dark-desktop-continuous-insulin-after-one-given.jpg` | the screenshot's prescription after the multi-clicks: one fact per multi-click, ON DEMAND controls open again (unresolved) |
| `light-desktop-round-locked.jpg` | locked rounds, light theme |
| `dark-narrow390-round-locked.jpg` | 390 px. The fixed STAGING banner can cover the bottom edge of a tall capture. |

## Not verified / limitations

- **Browsers:** Chromium only.
- **Time:** real server time only; no faked server clock. Hospital midnight and the exact 07:05:00.000
  boundary are covered by the client fake-clock harness. On the server, the boundary was taken 4 s before
  and 1 s after a real due time.
- **Clock skew:** if the browser's clock runs ahead of the server's by a few seconds, a click right at the
  due time can be refused once ("not due until …"). The refusal is shown, the round stays open, and a
  click a moment later succeeds.
- **Uncertain outcomes:** "not recorded" is decided only by a server read that started at least 15 s after
  the failure. A request the server holds for longer than that (for example, queued on the order lock)
  could still land afterwards. It would then show on the next read, and a repeated click would get the
  stale/duplicate 409 for a round, but not for PRN / on-demand.
- **Deployed suites:** the copies under `.github/workflows` were replayed locally. They were not run
  against a hosted target.
- **Concurrency:** the earlier concurrency suite (`correction/tools/concurrency-check.py`) was not
  re-run. The row lock is unchanged, and the API check's bursts (6 early, 5 at due) exercise it.
- **Release gate:** the update-write/rollback release gate stays **UNRESOLVED**. No installer work.
