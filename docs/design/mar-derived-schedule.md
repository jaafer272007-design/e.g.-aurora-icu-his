# MAR Schedule — Derived-at-Read — Design Document

**Status:** DESIGN — for approval, then hand to Claude Code as the build blueprint.
**Clinical source:** Jaafer Aljanabi (ICU physician, project clinical validator).
**Priority: HIGHEST — this is a clinical safety fix, not a feature.**

**The validator's framing (recorded, and it sets the order of work):** the MAR is a **clinical
logic bug** — it can hide missed doses and silently stop therapy. The assignment gap is a
**workflow/permissions bug** — important, but it does not change the clinical truth itself.
**Therefore: MAR schedule first, assignment second.** A record that lies is worse than a record
that can't be reached.

---

## 0. The finding — what is actually broken

**The MAR schedule is a demo.** `OrderLogic.GenerateAdministrations`
(`server/Core/Orders/OrderLogic.cs:228`) is self-described as *"mock schedule generation"*. It
runs **once, at sign time**, and creates:
- for `q<n>h`: the next full hour **plus exactly one more slot** at +interval — **two slots, ever**
- one row for everything else; one availability row for PRN

**Nothing ever regenerates it** — not documentation, not reads, not modify, no daily job. Even
the seeded q8h Meropenem carries only 2 slots.

**Two failure modes, proven live** (fresh DB, 6/6 API + 7/7 rendered checks with the page clock
faked to 23:45 and then 00:15 the next day):

1. **A continuous medication silently stops producing doses.** A q8h order with both slots
   documented stays **ACTIVE with zero scheduled rows**, and no new instance ever appears. The
   MAR shows an active antibiotic with **nothing ever due**. The patient simply stops being
   given it, and nothing anywhere says so. *(This is the ORD-546 class of false record, in
   schedule form.)*
2. **A missed dose is relabelled as an upcoming dose.** The never-documented 23:00 dose rendered
   **OVERDUE at 23:45** and **LATER at 00:15** — a missed dose silently converted into tonight's
   upcoming dose. It never ages and never escalates; the **Meds-Due KPI inherits the same flip**.
   **The system erases the evidence that a dose was missed.**

**PR #95's premise was false.** #95 deliberately kept scheduled times as bare `HH:mm`, reasoning
that *"a scheduled dose is a plan within the MAR's operating day, not a recorded event."* That
described an **intent** — **there is no operating day.** A slot is a dateless row and "today" is
whatever the wall clock says at render (`dueStateFor` compares bare `HH:mm`). This design
**supersedes that decision** (§3).

*(Honest note: the **record** side is already correct — documented administrations carry dated
stamps, and a pre-midnight GIVEN correctly renders as a `D-1 22:37` prior-day stamp. #95 got the
events right; it is the **plan** that has no date.)*

---

## 1. The model — derived-at-read (validator's decision)

**Store only facts. Never store a schedule.**

**Stored:**
- the **Medication Order** (start time + frequency + route/dose — already exists)
- the **Administration Events** (dated, real timestamps — already exist and are correct)

**Never stored:** a fixed table of dose slots.

**At MAR read:**

```
Medication Order
      + Frequency
      + Start Time
      + Current Time
            ↓
Generate Expected Dose Instances
            ↓
Overlay Administration Records
            ↓
Render MAR
```

**What this buys (validator's reasoning):**
- **Doses never run out** — instances are generated, not consumed.
- **Every dose instance carries a real timestamp.**
- **A late dose stays late.**
- **A late dose does NOT shift the schedule.**
- **q8h stays q8h from the start of therapy** — *not* from when the last dose actually landed.
- **PRN depends only on the last administration.**

This is also the project's house pattern: **derive at read, never store clock state** — the same
rule behind computed-at-render scores, ages, and (per #110) order completion.

---

## 2. Dose-instance identity — a DATED identity (this is what kills the rollover bug)

Every expected instance must carry a **dated identity** (e.g. `2026-07-15T23:00`), **never a bare
`HH:mm`**. That is precisely what makes *"the 23:00 dose on the 15th"* a different thing from
*"the 23:00 dose on the 16th"* — so a missed dose **cannot** be relabelled as tomorrow's dose.
The rollover bug dies **by construction**, not by a check.

An administration record overlays the instance whose dated identity it belongs to. An instance
with no administration and a passed time is **missed and stays missed** — it ages, it does not
transform.

---

## 3. This supersedes PR #95's scheduled-time decision (in place, attributed)

#95 recorded: *"scheduled administration times stay HH:mm — a scheduled dose is a plan within the
MAR's operating day, not a recorded event."* The **operating-day premise is now known false**
(§0). **Supersede that decision in place with an attributed note** (the project's pattern for
revised locked decisions). The `#95` treatment of **documented** times (dated) stands and is
correct — only the **scheduled** half is superseded, and it is superseded by removing stored
schedule rows altogether rather than dating them.

---

## 4. Frequency derivation — and the honest-source flag

**Derivable:**
- `q<n>h` → start + n hours, repeating
- fixed-time regimens (e.g. `daily (18:00)`, BD/TDS/QDS at set times) → derivable
- `once` → a single instance
- **PRN** → an availability, derived from the **last administration only** (validator's rule)

**FLAG — free-text / unparseable frequency.** If an order's frequency cannot be **honestly**
parsed, the MAR **must say so** rather than invent a schedule. This is the same discipline #110
applied to free-text lab orders with no coded testId (*"can't be linkage-fulfilled, recorded
rather than papered over"*). **Report which frequencies exist in the real formulary/orders and
which cannot be derived — do not guess a schedule for them.**

---

## 5. Existing data — facts are preserved, the broken plan is not

- **Documented administrations are clinical facts** → **preserved byte-for-byte** (never-destroy).
  They are the overlay in §1 and must render exactly as today.
- **Scheduled-but-never-documented stub rows are not facts** — they are artefacts of a broken
  plan with no clinical meaning. They must **stop being the source of the schedule**.
- **FLAG:** whether those stub rows are removed by migration or simply ignored by the derivation
  — state the choice and its effect on existing staging/seeded data. **Seeded documented
  administrations must be unaffected.**

---

## 6. Render horizon (FLAG — a real decision)

Once instances never run out and missed doses stay missed, a q8h antibiotic ordered three days
ago with nothing given would derive **~9 missed instances**. That is **honest and clinically
important** (the patient is not getting their antibiotic) — but it needs a sensible window.

**FLAG:** what horizon does the MAR render (e.g. the current shift/day plus recent past, versus
an unbounded backlog)? Missed doses must remain **visible**, not silently truncated — but the
view must stay usable. **State the chosen horizon and why.**

---

## 7. Deferred — recorded, not built (validator: future)

The validator noted the derived model makes these addable **without changing the structure
again**: **Missed Dose / Late Dose / Early Dose labels**, a **Dose Window** (±30/±60 min),
**escalation**, and richer audit.

**Not in this build.** Escalation in particular is **alerting** — the locked **D6** decision
(no notifications until v2, after clinical experience) applies. v1 = the honest model and honest
due states.

---

## 8. Interactions to verify (do not break these)

- **PR #110's derived completion:** a **one-off** med completes when its dose is administered;
  **ongoing frequencies stay Active**. #110 reads administration events, which are unchanged —
  but **verify explicitly** that the derived schedule doesn't disturb it.
- **`deployed-mar-e2e`** and **`deployed-orders-e2e`** must stay green.
- **Meds-Due KPI** — currently inherits the OVERDUE→LATER flip; it must inherit the honest model.
- **RBAC unchanged** — `meds.administer` stays exactly as it is.
- The **implement queue** narrowing (#110) is untouched by this.

---

## 9. Scope

**In scope:**
- Derived-at-read dose instances (§1) with **dated instance identity** (§2).
- Retire stored schedule generation (`GenerateAdministrations`'s stub) as the source of truth.
- Honest handling of underivable frequencies (§4).
- Preserve all documented administrations byte-for-byte (§5).
- A stated render horizon (§6).
- Supersede #95's scheduled-time decision, attributed (§3).

**Deferred:** missed/late/early labels, dose windows, escalation/alerting (D6), a Shift entity.

---

## 10. Build notes / verification

- **Verify the real code first** and report the model before changing it.
- Derive; **never store clock state**. Store only orders + administration events.
- **The two proven bugs must be dead — test the exact scenarios that proved them:**
  1. **Doses never run out:** a `q8h` order keeps producing due instances **indefinitely** — test
     across **multiple days**, not two slots. An active continuous med must never render with
     nothing ever due.
  2. **A missed dose stays missed across midnight:** reproduce the **23:45 → 00:15** boundary
     test with a faked clock. The never-documented 23:00 dose must **still be the missed 23:00
     dose of the previous day** at 00:15 — never relabelled as upcoming. The **Meds-Due KPI**
     must reflect the honest state too.
- **A late dose must not shift the schedule:** `q8h` derives from **therapy start**, not from the
  last documented administration. Assert explicitly.
- **PRN** derives from the **last administration only**.
- **Documented administrations preserved byte-for-byte**; seeded rows unaffected.
- **#110's one-off completion still works; ongoing meds stay Active** (the Meropenem q8h pattern).
- **FLAG performance:** the MAR is unit-wide (`GET /api/icu/mar` serves every open encounter) —
  deriving instances for every active med on every read has a cost. **Verify it's acceptable and
  state the finding** (mirroring the Statistics unit-aggregate flag); flag if it needs a
  different approach rather than forcing it.
- `deployed-mar-e2e` + `deployed-orders-e2e` green. Update `02` (with the #95 supersede note).
  Draft PR; rendered verification before merge — including the faked-clock boundary run.

---

## 11. Open items (flag, don't silently decide)
1. Underivable/free-text frequencies (§4) — report what exists; never invent a schedule.
2. Existing stub rows: migrate away or ignore (§5).
3. Render horizon (§6).
4. Derivation performance on the unit-wide MAR (§10).

---

*End of MAR Derived-at-Read design. The MAR schedule is currently a one-shot stub — self-described
mock generation that produces two slots and never regenerates — which makes a continuous
medication silently stop producing doses, and turns a missed dose into tomorrow's upcoming dose
across midnight. Both were proven live at a real day boundary. The fix (validator's decision) is
the house pattern: store the order and the administration events, and **derive** expected dose
instances at read from frequency + start time + current time, overlaying the real records. With a
**dated instance identity**, both bugs die by construction — doses never run out, a late dose
stays late and never shifts the schedule, q8h stays q8h from therapy start, and PRN derives from
the last administration only. This is the highest-priority item in the project: it is a clinical
safety fix. This document is the specification Claude Code builds from.*

---

## Amendments

*[Appended 2026-09-30. SUPERSEDE, NEVER REWRITE — nothing above this line is
altered: §§0–11 stand byte-identical to the approved document, and this
commit's diff is a pure append (0 lines removed). The item below quotes what it
supersedes and records the decision beneath it, so "what was approved" and
"what was decided later" stay separately readable. Source: the project owner's
request, recorded verbatim in `docs/design/icu-update-batch-1.md` §2 (relayed by
the Codex planning handoff; see that file's commit for provenance). The
mechanism paragraphs cite the code that implements them.]*

### A · §1 / §10 — a late dose now RE-TIMES the next repeating dose — SUPERSEDED 2026-09-30 (project owner)

> - **A late dose does NOT shift the schedule.**
> - **q8h stays q8h from the start of therapy** — *not* from when the last dose actually landed.

(§1), and

> - **A late dose must not shift the schedule:** `q8h` derives from **therapy start**, not from the
>   last documented administration. Assert explicitly.

(§10).

**Superseded by the owner, 2026-09-30.** For an active repeating medication
with a derivable interval, when a dose is documented **GIVEN** and its **actual
administration time** is later than its scheduled time, the next repeating dose
is **actual administration time + the prescribed interval**, and the grid
continues from there. The owner's example: q1h due 06:00, given 06:05 → next
07:05, then 08:05; the 07:05 dose given 07:12 → next 08:12. It applies to every
existing interval regimen — `q<n>h` and the named `daily`/`bid`/`tid`/`qid`
interval interpretation of §4. Minute-based frequencies are not part of this
change (owner, 2026-09-30).

**What stands unchanged from the approved document:** the model is still
derived-at-read (§1 — no generated slot is ever stored); the dated identity
(§2); doses never run out; **a late dose stays late** — its fact keeps its
original scheduled identity and reads as late; a missed dose stays missed; PRN
derives from the last administration only; underivable frequencies get no
invented schedule (§4); the render horizon and its explicit missed summary
(§6); RBAC, encounter scope and #110 completion (§8). **Held/refused, on-time or
early GIVEN, `once`, PRN and underivable/continuous regimens never re-time.**
The overdue delay-reason rule is unchanged and independent: OVERDUE shows the
moment an instance passes, a reason is required only beyond the 2-hour
threshold judged against the documenting moment (a backdated actual time cannot
dodge it) — and a 5-minute delay, which needs no reason, still re-times.

**The mechanism (as built — `server/Core/Mar/MarSchedule.cs` re-timing section;
the client mirror is `src/lib/marSchedule.ts`):**

1. **Explicit metadata, not reinterpretation.** A GIVEN fact that re-times
   carries `scheduleAnchor` — its actual administration time, `yyyy-MM-dd
   HH:mm` — stamped by the write endpoint (`MarApi.cs`) only when it re-times.
   It is an additive, optional field inside `AdministrationsJson` (data, not
   schema — **no migration**; absent fields serialize absent, so every existing
   fact's bytes are unchanged). Facts documented before this change carry no
   anchor and are never re-read as re-timing: **installing the update shifts no
   existing order.**
2. **The floor rule decides which late GIVEN re-times** — one predicate
   (`MarSchedule.Retimes`), used by the write endpoint to decide and by the read
   side to replay the facts in recording order (`MarSchedule.RetimingState`),
   so the two can never disagree. The actual time must be later than its own
   scheduled instant **and** later than the floor: the latest of every earlier
   fact's dated scheduled instant and every earlier effective anchor. So
   recording an older dose later never rewinds a newer schedule (a backdated
   actual time at or before the floor re-times nothing, and the audit says so:
   "schedule not re-timed: a later dose is already documented"), and no
   documented instance can fall off the derived grid.
3. **The grid** with effective anchors A1 < … < An: therapy-start points while
   t < A1; then Ai + k·interval (k ≥ 1) while t < A(i+1); the last segment is
   unbounded. Earlier-segment instances that fell **before** a re-timing instant
   stay on the grid as historical misses (a q1h dose given 2½ h late leaves the
   intermediate hourly doses missed — never marked given, never erased);
   instances at or after it are **superseded**. A second browser posting a
   superseded instance gets **409** naming the re-timing (four-code rule: it
   existed, the order's state no longer expects it); a duplicate stays 409; an
   identity that never was an instance stays 404.
4. **Audit.** The administration's history detail records the re-timing and
   the resulting next dose; the MAR row and the printed MAR cell mark a
   re-timed dose ("↻ next dose re-timed"). The original scheduled time, actual
   time, documenting time, reason and every earlier fact are preserved as
   recorded.
5. **Frequency modification** keeps the anchors: the next dose is the latest
   anchor + the *current* interval (a q1h re-timed at 06:05 then modified to q4h
   → next 10:05). Anchors are instants, never stored intervals.

### B · Amendment A and §1 / §6 — the ROLLING TIMER replaces the fixed and segmented grids — SUPERSEDED 2026-09-30 (project owner)

*[Appended 2026-09-30, the same day as A, after Codex's review of PR #234.
Pure append: A and everything above stay byte-identical. Source: the owner's
clarification and the owner-confirmed Held/Refused rule, recorded verbatim in
`docs/design/icu-update-batch-1-correction.md` §2.]*

Amendment A (the whole item above), which read in part:

> For an active repeating medication with a derivable interval, when a dose is
> documented **GIVEN** and its **actual administration time** is later than its
> scheduled time, the next repeating dose is **actual administration time + the
> prescribed interval**, and the grid continues from there.

and

> **Held/refused, on-time or early GIVEN, `once`, PRN and
> underivable/continuous regimens never re-time.**

together with its mechanism points 1–5 (the `scheduleAnchor` field, the floor
rule, the segmented grid, historical misses and superseded instances), and, for
repeating orders, §6's past window and missed-dose summary.

**Superseded by the owner, 2026-09-30:** "basically the timer of the next round
will start after the first has been given (not something fixed)". This is a
workflow change, not a patch to A's floor rule: there is no grid any more,
fixed or segmented. The owner confirmed the Held/Refused rule the same day.

**The rule (repeating medication, active, derivable interval):**

1. **One current round at a time.** Round 1 is the first dose, derived exactly
   as before: the next full hour after therapy start (§1, unchanged).
2. **Given starts the next interval** from its actual administration time,
   whether early, on time or late: next due = actual Given time + the
   prescribed interval. q1h: 06:00 given 06:05 → 07:05; that 07:05 given 08:30
   → 09:30; a 07:05 given early at 06:50 → 07:50; given on time at 07:05 → 08:05.
3. **Held/Refused** (owner-confirmed): next due = the skipped round's
   **scheduled** time + the interval, never its documenting time. q1h: 07:05
   held or refused at 07:20 → 08:05. The reason stays required. If that next
   due is already in the past it is simply overdue: it is never skipped,
   paused or documented automatically.
4. **The clock alone never creates a round.** An unresolved round stays the
   same round as it becomes due, then overdue — at 08:30 with the 07:05 round
   unresolved, 07:05 is the only current round; no 08:05/09:05 round and no
   generated "missed" rows exist. It stays documentable across refreshes,
   midnight and multi-day delay (no 24-hour horizon applies to it).
5. **No rewind.** The timer is the **latest** timer instant of all resolved
   rounds (Given → its actual time, Held/Refused → its scheduled time), judged
   by actual chronology, not by scheduled identity. A genuinely older backdated
   actual time resolves its round but leaves the newer timer in force; the next
   round can then fall due at the same minute as the round just resolved.
6. **Frequency modification** applies the *current* interval to the timer in
   force: q1h given at 06:05, then modified to q4h → the current round is due
   10:05.

**Identity.** A round's documentable identity is its due minute plus its round
number: `yyyy-MM-ddTHH:mm~r<n>` (URL-safe). Two rounds, or a round and a stored
fact, can share a due minute and stay distinguishable. The identity is stable
across refreshes because it derives only from stored facts and the order, never
from the clock. The write endpoint accepts exactly the current round:

- a round already resolved → **409**, naming who documented it and how
  (duplicate or stale submission);
- the current round number with a different due minute → **409**, because the
  schedule changed after the view loaded (a frequency modification);
- anything else → **404** (four-code rule).

**Metadata.** Every fact that resolves a round carries `round` (its number): an
additive, optional integer inside `AdministrationsJson`, so it is data, not
schema, and needs **no migration**. A's `scheduleAnchor` was never released (PR
#234 was never merged or installed), so it is removed rather than carried. The
fact keeps what it always stored: `scheduledTime` is the round's due minute
(scheduled identity), `documentedTime` is the actual administration time for
Given (or the documenting time for Held/Refused), and the history event carries
the documenting time. The history detail also states the next round and what
timed it.

**Existing (legacy) orders — activation without reinterpretation.** A stored
fact without `round` is a legacy fact. It is displayed exactly as stored and
**never** drives the timer, so installing the update uses no old late event to
start a timer and rewrites nothing. An active repeating order whose facts are
all legacy enters the policy at **round 1 = the first slot of its original
therapy-start grid, at or after the slot containing its latest legacy fact's
recorded time, that no legacy fact documents** — or the first dose when it has
no legacy fact. This is one slot, computed from stored facts only (never from
the clock). The grid is used only for that single entry point; it generates no
missed or future rows. The already-approved compatibility case: a 07:00 slot
given early at 06:50 leaves the 06:00 slot outstanding, so round 1 is 06:00;
given at 06:55, the next round is due **07:55**. Out-of-order old slots are
history, not extra current rounds. Clock-derived missed rows the old grid used
to show were never stored and are not preserved.

**Unchanged:** derived-at-read (no round is ever stored before it is
documented); stored facts are never altered; `once`, PRN and
underivable/continuous regimens; the 2-hour delay-reason rule, judged against
the documenting moment; the actual-time entry validations (not in the future,
at most 24 h back, server time when absent); RBAC, encounter scope, #110
completion and discontinue.

**Atomic documentation (Codex review, same batch).** Documenting a dose, and
every other order mutation (sign, modify, discontinue, implement and the
discharge cascade), runs inside a transaction that first takes the order row's
PostgreSQL lock (`SELECT … FOR UPDATE`). The read, validation, fact append,
timer and audit entry therefore see the latest committed facts and commit
together: a competing write waits, then revalidates against fresh facts (409 if
its round was taken, or its order stopped). There is no schema change. The
SQLite demo mode serializes the same code paths through SQLite's single write
lock.

### C · Amendment B point 5 ("No rewind") — CORRECTED 2026-09-30 (Codex's review of head `87358f2`)

Source: `docs/design/icu-update-batch-1-timer-correction.md` (verbatim).
Amendment B above is unchanged except for this correction to its point 5,
which read:

> 5. **No rewind.** The timer is the **latest** timer instant of all resolved
> rounds (Given → its actual time, Held/Refused → its scheduled time), judged
> by actual chronology, not by scheduled identity. A genuinely older backdated
> actual time resolves its round but leaves the newer timer in force; the next
> round can then fall due at the same minute as the round just resolved.

**The defect.** Taking the latest instant mixed two kinds of timestamp: a
Given's actual time and a Held/Refused round's scheduled time. q1h: 06:00 given
06:05 → 07:05; 07:05 held early at 06:10 → 08:05; the next round given early at
06:50 must be due **07:50**, but the skipped 07:05 was "later" than 06:50, so
08:05 stayed in force. Refused behaves the same way.

**Point 5, corrected.** Rounds are replayed in order, keeping two things apart:

- **Action chronology.** Each resolving fact has an action instant: a Given's
  actual administration time, or a Held/Refused's documenting time (neither
  stores a separate actual time).
- **The effective timer.** It is what the next due counts from.

With those two kept apart:

- **A subsequent Given restarts the interval.** If its actual time is no older
  than every earlier action, next due = that actual time + the interval. This
  holds even when a preceding Held/Refused left a later scheduled timer.
- **A genuinely older backdated Given never rewinds the timer.** Its actual
  time is older than an action already recorded. It resolves its round, and the
  timer moves only if the Given's own time is later than the timer in force.
  The next round can then share the due minute of the round just resolved, and
  its identity stays distinct (`~r<n>`).
- **Held/Refused is unchanged.** Next due = the skipped round's own scheduled
  due + the interval.

Worked examples (q1h):

| Sequence | Next due |
|---|---|
| 06:05 given; held 06:10; given at 06:50 | **07:50** |
| The same, with refused instead of held | **07:50** |
| 06:05 given; held 06:30; given backdated to 06:20 (older than the hold) | stays 08:05 |
| Held late at 09:00 (07:05 → 08:05); given documented 09:10, actual 08:30 | **09:30** (forward only) |

The audit detail names which timer stayed in force: "the administration at …"
or "the skipped dose due …".

Nothing stored changes. The rule reads the same fields as before
(`round`, `status`, `scheduledTime`, `documentedTime`), so no stored fact is
reinterpreted. There is no new metadata and no migration. The one current round,
the identities, the 409/404 behaviour, the delay-reason rule and the order write
lock are unchanged.

**Legacy entry (answered).** An active repeating order with no recorded
administrations keeps its original first due, even if that is days overdue. It
is never reset to now and never resolved automatically. This is the rule above,
confirmed.
