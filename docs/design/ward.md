# Ward — Design Document

**Status:** DESIGN — for approval, then hand to Claude Code.
**Clinical/operational source:** Jaafer Aljanabi (ICU physician + system owner).
**Module:** #2 (Ward). This document covers the WARD only. The admitting note has
its own design; OR has its own design; the day-case area is out of scope entirely.

---

## 0. Scope, and why it stops where it does

Reception creates an admission and stops. This document covers what happens next: the
patient gets a bed, a nurse, moves around the hospital if needed, and is eventually
discharged.

**In scope:** assigning a bed to an already-admitted patient; the awaiting-bed
worklist; nurse assignment per shift; bed-to-bed and ward-to-ward moves; discharge.

**Explicitly NOT in this design** (each has its own):
- **The admitting note** — a structured history/examination intake with dropdowns and a
  free-text box, which also carries orders of all types. Written by the ward's resident
  doctor. It is large enough to need its own document, and its shape is deliberately
  shared with the EMR's first encounter.
- **OR transfers** — a patient in theatre is neither in their bed nor discharged. A new
  lifecycle state Aurora does not have, which also touches the shipped ICU module.
- **The day-case area** — the multi-bed day-case rooms are a SEPARATE AREA, not part of
  the ward. See §2.1 for the consequence.
- **ICD-10 diagnosis** — assigned by the resident, an import problem, not hospital-typed.

---

## 1. Reuse Aurora Core — do not duplicate

Already shipped and clinician-validated:
- **Bed registry** — add/retire with a live-occupancy guard.
- **Derived occupancy** — occupancy is computed from open encounters, never stored.
- **Transfer** — bed-to-bed, nursing authority, audited.
- **Shift vocabulary and staff assignment** — the machinery nurse-per-shift needs.
- **Discharge** — dispositions, the immutable `isDeath` flag, closes and never deletes.
- **Admission with an optional bed** — `bedId` optional, "awaiting bed" derived from
  `open && BedId == ""`, plus the pending view. Shipped in step 5.
- **Audit** — append-only `EventsJson` on every clinical write.

**Ward extends these. It forks none of them.**

---

## 2. Hospital master data

**Rooms are NOT master data and must not be built.** The ward is single room, single
bed — a room and a bed are the same thing. Anyone reaching for a Room entity, a room
field, or a room encoded inside a bed's name should stop and re-read this line. The
last one in particular is the `Encounter.Attending` mistake: a real thing living as
free text, joined to nothing.

**Wards may already exist.** The bed registry carries an `Area` field, used in ICU as a
board grouping (Pod A / Pod B). Verify before building anything: if `Area` is the ward,
then wards are already master data and ward-to-ward movement is already the transfer
path. Report the finding; do not create a parallel Ward entity on the assumption that
one is missing.

### 2.1 The day-case consequence, recorded so it does not read as a defect
Day cases ARE registered as admissions, but the day-case area is out of ward scope. So a
day-case admission will sit in the awaiting-bed list until it is discharged the same day.
That is expected behaviour, not a bug, and the design says so here so that nobody
"fixes" it later.

---

## 3. The ward flows

### 3.1 Assigning a bed
Reception admits without a bed. The bed is assigned afterwards, by **the receptionist or
the ward nurse**, from the awaiting-bed list.

**This is NOT a transfer, and must not reuse the transfer path.** The reason is recorded
in the reception design's amendments: `AdtEventDto` is four strings with no structured
from/to, so the concatenated string IS the audit record — and reusing transfer produced
a dangling `"admitted — to Bed"` with an empty source. Bed assignment gets its own path,
its own action string, and its own atom.

Guards, all server-enforced, all leaving nothing written on refusal:
- the bed exists, is active, and is free
- the encounter is open and not discharged
- the encounter does not already have a bed (assigning to an occupied encounter is a
  move, and moves go through §3.4)

### 3.2 The awaiting-bed list
Derived from `open && BedId == ""` — never stored, never a third Status value.
Visible to **the receptionist and the ward nurse**: the same two people who can act on
it, which is the point. One action from each row: assign a bed.

### 3.3 Nurse assignment — per shift
A nurse is assigned **per shift**, not per patient and not permanently.

Verify before building: what the existing staff-assignment surface does today, whether it
is per-unit or per-patient, and whether the shift vocabulary already carries what this
needs. Report it. Nurse-per-shift is very likely a use of existing machinery rather than
new machinery, and building a second assignment model beside the first would be a fork.

### 3.4 Moves
Both bed-to-bed and ward-to-ward are wanted. Nursing authority, as transfer is today.

Verify first: if `Area` is the ward (§2), then a ward-to-ward move is a transfer between
beds whose areas differ, and both cases are one existing path. Report whether that holds
before designing anything new.

### 3.5 Discharge
Discharge closes the encounter, never deletes it. Existing dispositions and the immutable
`isDeath` flag apply unchanged.

**The bed frees immediately, and this requires no code.** Occupancy is derived from open
encounters, so closing the encounter frees the bed by construction. Do not write a
release step; do not store a free/occupied flag. If a "release the bed" line appears in a
diff, it is wrong.

**Authority — a stated limitation, not an oversight.** The clinical intent is that a
**senior resident or a senior doctor** discharges. Aurora's permissions are by PROFILE,
and the Doctor profile bundles Specialist, Senior Resident, Resident and Intern — so
"senior resident yes, resident no" is not expressible today. The accepted position is
that any doctor-tier account may discharge, with the intent recorded here. This must NOT
be solved by remapping a title into SeniorDoctor: that would hand out `results.correct`,
`beds.manage` and three clinical vocabularies with it.

---

## 4. What Ward does NOT do

No admitting note, no orders, no diagnosis, no OR transfer, no rooms. A ward patient
whose note has not been written is a valid and expected state.

---

## 5. Safety rules — carried from Aurora ICU, non-negotiable

- **Never fabricate.** No field defaults to a clinically meaningful value nobody entered.
- **Never hard-delete.** Discharge closes; retire never deletes; corrections supersede.
- **Every write audited** — who, what, when, which role — in the same transaction.
- **Derived stays derived.** Occupancy, the awaiting-bed state and ward census are all
  computed from open encounters. Storing any of them is forbidden.
- **Refusals write nothing.** A rejected assignment or move leaves no partial state.
- **One codebase, zero forks.** Everything hospital-specific is master data.

---

## 6. RBAC

**A new atom for bed assignment** — provisionally `beds.assign` — held by the office
**Administrator** (the receptionist) and the **Nurse** profile.

It must be distinct from both neighbours, following the precedent that kept
`labcatalog.manage` and `imagingcatalog.manage` apart so a later split costs a row edit:
- `beds.manage` is bed REGISTRY administration (add/retire), not placement.
- `adt.admit` stays doctor authority and still governs admitting a patient straight into
  a bed, which is how ICU works. Reception and nursing must not gain that.

The awaiting-bed list is readable by whoever holds `beds.assign`. Moves keep the existing
transfer authority. Discharge keeps the existing doctor authority.

Assert both directions in the rendered pass: the receptionist and the nurse can assign a
bed and cannot admit into one; a nurse still cannot reach a clinical pane they could not
reach before.

---

## 7. Build notes

**Verify first and report before building anything:**
1. Is `Area` the ward? If so, wards are already master data.
2. Does the existing transfer already cover ward-to-ward, given the answer to 1?
3. What does the existing staff-assignment surface do today — per-unit or per-patient —
   and does the shift vocabulary already carry what nurse-per-shift needs?
4. Does anything today assume an encounter always has a bed? Step 5 made `bedId`
   optional; enumerate the readers that have not yet been taught about it.

**Then build in this order:** bed assignment and the awaiting-bed list first, because
without them reception's output goes nowhere and no patient can reach a ward at all.
Nurse assignment second. Moves third, if they are not already free. Discharge is last and
is expected to be close to zero work.

**Verify:** a bedless admission appears in the awaiting-bed list; a receptionist and a
nurse can each assign a bed; neither can admit into one; an occupied bed refuses; a
retired bed refuses; a refusal writes nothing; assignment appears in the audit with a
non-dangling action string; discharge frees the bed with no release step; a day-case
admission sits in the awaiting-bed list until discharged.

---

## 8. Open items (flag, don't silently decide)

1. **Is `Area` the ward?** (§2) — decides whether wards and ward-to-ward moves are new
   work or already shipped.
2. **What the existing staff assignment does** (§3.3) — decides whether nurse-per-shift
   is a use of existing machinery or new machinery.
3. **The discharge title/profile gap** (§3.5) — accepted for now, recorded, not enforced.
   Revisit only if a resident discharging without senior sign-off is a real hazard at
   this hospital.
4. **Readers that assume a bed exists** (§7.4) — enumerate before building, not after.
5. **The Department retire guard's open-admissions half** — owed since step 3, blocked
   until admissions carried a department, which they now do. It belongs to whoever picks
   it up; it is not ward work, but this is the moment it became buildable.

---

*End of Ward design — the middle of the ward journey. Reception hands over an admission
with no bed; the ward gives it a bed, a nurse per shift, the ability to move, and
eventually a discharge that frees the bed by construction rather than by instruction.
Rooms do not exist here, because a room and a bed are the same thing at this hospital.
The admitting note, the OR transfer and the day-case area are each deliberately absent
and each have their own design. This document is the specification Claude Code builds
from, after it reports the five open items.*


---

## Amendments

*Appended 2026-08-19, after the §7 verification pass. Everything above this
line is the design exactly as received and is unchanged — these entries
supersede rather than rewrite (03's documentation discipline). Two of §7's
four verify-first items came back REFUTED, one came back WRONG, and one held.*

### A1 · §2's premise is REFUTED — `Area` is not the ward. RULING: promote it to a governed Ward vocabulary

**Verified against the repository, not inferred:**
- `BedRow.Area` (`server/Core/Adt/AdtModels.cs:338`) is a plain `string`.
- **No vocabulary, no foreign key, no validation.** Nothing in
  `server/Core/MasterData/` references it; nothing in `AuroraDb.cs` constrains it.
- **Labelled as free text to the user.** `src/pages/Configuration/Configuration.tsx:937`
  reads: *"Area (free text — the board groups beds by area)"*.
- **Set once at creation, never editable.** `CreateBedRequest` carries it; there is
  **no** `EditBedRequest` and **no** `MapPut` on the bed registry. A typo is permanent,
  and a ward could never be renamed.
- Seeds as `Pod A` ×8 / `Pod B` ×8 — ICU board grouping, exactly as §2 guessed.

So §2's instruction *"do not create a parallel Ward entity on the assumption that one is
missing"* pointed the right way, but its premise does not hold: **wards are not already
master data.** Adopting `Area` as the ward as it stands would commit precisely the
mistake §2 forbids one paragraph earlier — *"a real thing living as free text, joined to
nothing… the `Encounter.Attending` mistake"* — and on a field with no edit path at all.

**RULING (owner, 2026-08-19): promote `Area` to a governed WARD VOCABULARY on the #199
pattern.** A fifth tenant beside admission types, departments, services and admission
sources: add / retire-never-delete, managed in Configuration, the same mapper.
**Backfilled from the DISTINCT values already in the bed registry** — honest backfill
from real data, never fabrication; whatever a hospital has typed becomes its starting
vocabulary and it curates from there.
**It also needs a bed EDIT path**, because a bed's area cannot be changed today at all —
without one, a backfilled typo is unfixable and a ward cannot be renamed.
**NOT a Ward entity.** Nothing beyond a name has been asked of a ward; a vocabulary is
the whole requirement, and anything more would be built on speculation.

**Consequence for §3.4 — ward-to-ward movement needs NO new operation.** It is a transfer
whose two beds differ in ward. That difference is **derived at read time from the beds,
never stored on the encounter** (the derived-stays-derived rule in §5). No second path,
no move type, no ward field on the encounter.

### A2 · §3.3's premise is REFUTED — the shipped model is opt-out coverage, and this is OPEN pending the owner

**What actually shipped** (`server/Core/Assignments/AssignmentModels.cs:6` states it
outright — *"the OPT-OUT coverage model … REPLACING #114's many-to-many opt-in model"*):
- **Nurses cover ALL patients by default.** There is no assignment act.
- The stored concept is a **`AssignmentRemoval`** — one carved exception taking one
  patient off one nurse's focused worklist. Restored-never-deleted.
- **Doctors have no assignment concept at all** — *"a formal doctor-assignment is a
  fiction; the doctor view is simply 'all patients'"*.
- **Primary/secondary was dropped.** It is *covering / not covering*.
- The endpoints are **`/assignments/remove`** and **`/assignments/restore`**. There is
  **no assign endpoint.**
- Hard invariant: removing the **last** covering nurse is refused **409**. An uncovered
  patient cannot exist.
- Authority is `assignments.manage` on **SeniorDoctor**, with a recorded interim note
  that a real ICU's charge nurse does this and the follow-up is a SeniorNurse profile row.

**And there is NO SHIFT on the model.** `AssignmentRemoval` carries `EncounterId`,
`UserId`, removed/restored actor + time + role, and an optional reason. No shift field,
no time window. A `Shifts` vocabulary exists (seeded `day` / `night`) and the coverage
model **does not reference it**.

So §3.3's expectation — *"very likely a use of existing machinery rather than new
machinery"* — **does not hold.** *"A nurse is assigned per shift"* is not expressible
against a model whose only concept is *this nurse is not covering this patient,
indefinitely*. Delivering it means either adding a shift dimension to removals, or
introducing a positive assignment beside the opt-out one — and that second option is the
fork §3.3 warns against, now aimed at the model that actually shipped.

**STATUS: OPEN, pending the owner.** Nothing is built for nurse-per-shift until this is
answered.

**Also recorded: `docs/design/patient-assignment.md` is STALE.** It specifies the
many-to-many opt-in model with primary/secondary and a doctor assignment — all three of
which were superseded by the opt-out coverage build. It should be read as the superseded
design, not as the description of the shipped system. Whoever picks up A2 should start
from the code and from this entry, not from that document.

### A3 · §1 is WRONG where it says the pending view shipped in step 5 — the awaiting-bed list is NEW WORK

§1 lists, under *"Already shipped and clinician-validated"*:
> **Admission with an optional bed** — `bedId` optional, "awaiting bed" derived from
> `open && BedId == ""`, plus the pending view. Shipped in step 5.

The optional `bedId` and the derivation are correct. **The pending view is not.**
Evidence:
- The **only** `awaiting bed` text on the server is an **audit detail string**
  (`server/Core/Adt/AdtApi.cs:1201`), written into the admit event when no bed is named.
  It is a record of what happened, not a view.
- On the client, the phrase appears only in a type comment and in Reception's own row
  label. **No awaiting-bed list exists on any screen.**
- `getEncounters` supports `patientId`, `status` and `admittedOn` — and **no bedless
  filter**.
- Reception's *"Admitted today"* is **date-filtered**, so **a bedless admission from
  yesterday appears on no list anywhere in the product.**

That last point is the operational consequence and the reason this correction matters:
today a patient can be admitted with no bed and, from the next calendar day, be visible
on no worklist at all. §7's build order already puts the awaiting-bed list first; this
entry records that it is **new work**, and that §1's "already shipped" line must not be
relied on when estimating it.

### A4 · §7's expectation held for ONE of three — the estimate moves

§7 asks four verify-first questions in the expectation that they would reveal existing
machinery. Scored honestly:

| item | expectation | finding |
|---|---|---|
| 1 · Is `Area` the ward? | wards already master data | **REFUTED** — free text; a governed vocabulary + a bed edit path are new work (A1) |
| 2 · Does transfer already cover ward-to-ward? | already free | **HOLDS, but only after A1** — once ward is a vocabulary, a cross-ward move is a transfer whose beds differ, derived and stored nowhere |
| 3 · Staff assignment / shift | existing machinery | **REFUTED** — opposite polarity, no shift dimension, no assign endpoint; OPEN pending the owner (A2) |
| 4 · Readers assuming a bed | enumerate | **HELD** — enumerated in A5; one was a live defect, fixed separately |

**One of three came back as expected.** The design's own build-order reasoning is
unchanged and still right; what changes is the size of the first two items. Recorded
plainly rather than left to be discovered mid-build.

### A5 · Item 4 — the readers that assume a bed exists, and what to do about each

Enumerated before building, as §7.4 asks.

**Already fixed, separately and ahead of any ward work** — `POST /adt/encounters/{id}/transfer`
wrote its audit as `"{from} → {to}"` with no guard that the encounter had a bed, so a
bedless encounter produced `" → B-05"`, a dangling arrow with an empty source, permanent
in `EventsJson`. It was reachable from the shipped Discharges screen. **The fix was
REFUSAL, not string repair** — 409, nothing written — because making the string read well
would legitimise an operation §3.1 says does not exist. The Transfer control is now
absent on a bedless row.

**To fix when the ward build starts:**
- **`BedChip` (`src/components/Tag.tsx:33`) — fix ONCE, with an explicit empty
  rendering.** It is `<span>{bedId}</span>` with no empty handling, and it is the shared
  renderer for roughly ten call sites (Discharges, DoctorWorkspace, Alerts,
  MissionControl, AiChat ×3, NurseWorkspace). One change covers most of this class.
- **The `??` sites catch `null` but not `""`.** `MissionControl.tsx:362` is
  `Bed {p?.bedId ?? '—'}`, which renders **`Bed `** with nothing after it for a bedless
  patient. **Treat empty as absent everywhere** — the nullish guard is not enough, and
  this is the same shape as the match dialog's `"admitted to Bed —"` defect.
- **`PrintLayout.tsx:78` and `SbarSheet.tsx:16` put the bed on a PRINTED CLINICAL
  DOCUMENT.** A blank field on paper is ambiguous — the reader cannot tell "no bed" from
  "nobody filled this in". These must read **"awaiting bed" in words**, not render empty.
- Also in this class, on the Discharges screen: the confirm text *"Close encounter X and
  free **{bedId}**?"* and the discharge toast *"— {bedId} is now free"*, both of which
  read with a gap for a bedless encounter. A bedless discharge is routine, not exotic —
  §2.1's day cases are exactly it.

**CORRECT AS IT STANDS, do not "fix" it:** `BedOverview` iterates beds and reads
`b.patient`, so **a bedless admission does not appear on the bed board at all.** That is
right per §3.2 — the awaiting-bed list is the surface for those patients, not the bed
board, which is a map of beds. Recorded here so a later reader does not mistake the
absence for an oversight and "repair" it by inventing a bedless slot on a board of beds.

### A6 · §3.3 RESOLVED by the owner — whoever is on shift covers everyone, so this is NO WORK (recorded 2026-08-19)

**Supersedes A2's "OPEN pending the owner" status.** A2 stands as written — it is
the finding; this is the ruling on it.

**THE OWNER'S ANSWER: whoever is on shift covers everyone.** *"Per shift"* in
§3.3 is satisfied **operationally, by who is on duty** — it was never a
statement about something the system should store. The rota lives in the ward,
not in the database.

**CONSEQUENCE: §3.3 resolves to NO WORK. The shipped opt-out coverage model
stands unchanged**, and each half of it is now the answer rather than an
obstacle:
- **Every nurse covers every patient by default.** Coverage is DERIVED — active
  Nurse-profile accounts minus active removals (`AssignmentsApi.cs:35`) — which
  is exactly "whoever is on shift covers everyone" expressed in the only terms
  the system needs.
- **The only stored object stays the `AssignmentRemoval`** — one carved
  exception, restored-never-deleted. (`PatientAssignments` remains the frozen
  #114 audit table: history, no new rows, readable via `/assignments/history`.)
- **Removing the last covering nurse stays a 409** (`AssignmentsApi.cs:164`):
  *"a patient must never have zero nurse coverage."* An uncovered patient
  cannot exist, and that guarantee is untouched by this ruling.

**TWO THINGS EXPLICITLY FORBIDDEN, because they are what a reader would
otherwise build from §3.3's wording:**
1. **Do NOT add a shift dimension to removals.** A removal is *"this nurse is
   not covering this patient"*, full stop. Time-boxing it would store the rota,
   which is the thing the owner has just said is not the system's to hold.
2. **Do NOT introduce a positive assignment beside the opt-out model.** That is
   the fork §3.3 itself warns against, and A2 identified the shipped model as
   what it would fork. Two models answering the same question is the defect,
   regardless of which one is nicer.

**§3.3's own text is not wrong — it is satisfied.** *"A nurse is assigned per
shift, not per patient and not permanently"* describes precisely what
everyone-covers-everyone delivers: no per-patient assignment exists, nothing is
permanent, and the shift is the duty roster. The design asked for a property;
the shipped model already has it. What was refuted in A2 was the assumption that
delivering it required building something.

### A6.1 · §7's estimate, final — one held, one refuted UPWARD, one refuted to ZERO

A4 scored §7's verify-first items with item 3 still open. It is now closed, and
this is the settled scoring. **Supersedes A4's table for item 3 only**; items 1,
2 and 4 are unchanged.

| item | expectation | outcome |
|---|---|---|
| 1 · Is `Area` the ward? | wards already master data | **REFUTED UPWARD** — free text; a governed Ward vocabulary **and** a bed edit path are new work (A1) |
| 2 · Ward-to-ward already covered by transfer? | already free | **HELD** — but only downstream of A1: a cross-ward move is a transfer whose beds differ in ward, derived at read, stored nowhere |
| 3 · Staff assignment / shift | existing machinery | **REFUTED DOWNWARD, TO ZERO** — not "use existing machinery" but "no machinery, and none to add" (A6) |
| 4 · Readers assuming a bed | enumerate | **HELD** — enumerated in A5; one was a live defect, fixed and merged separately |

**WARD'S GENUINELY NEW WORK, the whole of it:**
1. **The Ward vocabulary** — a fifth #199 tenant, add/retire-never-delete,
   backfilled from the distinct `Area` values already in the bed registry.
2. **A bed edit path** — because a bed's area cannot be changed today at all,
   so without it a backfilled typo is permanent and a ward can never be renamed.
3. **Bed assignment** — its own path, its own action string, its own atom
   (`beds.assign`), never the transfer path (§3.1, and see the merged transfer
   refusal that made the reason concrete).
4. **The awaiting-bed list** — new work, per A3; §1's "shipped in step 5" was
   wrong, and today a bedless admission from yesterday is on no list anywhere.

**EVERYTHING ELSE IS EXISTING, DERIVED, OR READER CLEANUP:**
- **Existing, unchanged:** nurse coverage (A6), transfer, discharge and its
  dispositions, the `isDeath` flag, the bed registry, the audit trail.
- **Derived, so no code:** occupancy, the awaiting-bed STATE itself, ward census,
  ward-to-ward as a bed-difference, and the bed freeing on discharge — §3.5's
  *"requires no code"* holds exactly as written.
- **Reader cleanup:** A5's list — `BedChip` once, the `??` sites treated as
  absent-when-empty, and "awaiting bed" **in words** on the printed documents.

**The shape of the estimate changed, not its order.** §7's build order — bed
assignment and the awaiting-bed list first, because without them reception's
output goes nowhere — is unaffected and still right. What moved is that item 1
grew a prerequisite and item 3 disappeared.

### A7 · Two ICU-scoped surfaces the Ward build must clear — recorded from the Hospital Shell design (2026-08-19)

**Source: the Hospital Shell design (`docs/design/hospital-shell.md` §5) and the
owner's shell brief.** Both entries are TRUE today and become FALSE the day the
first ward admission exists. They are corrected **in the Ward build itself** —
not before (correcting a true statement early is its own small lie), and not
silently after (a scope statement that has quietly become false is the worse
failure). Recorded here because this file is where the Ward build starts, so
the build cannot begin without seeing them. Verified against the repository,
file and line named:

1. **`src/pages/PatientHistory/PatientHistory.tsx:154-156`** — the scope
   statement reads: *"Aurora holds no external, pre-Aurora or non-ICU
   records."* The sidebar footer on the same screen says *"Aurora ICU records
   only."* The moment Ward ships, Aurora holds non-ICU records and both
   sentences lie — on the one surface whose stated job is that *"silence must
   never imply completeness."* The Ward build rewrites the scope statement to
   say what Aurora then actually holds (ICU and ward encounters; still no
   external or pre-Aurora records).

2. **Both AI prompts are ICU-scoped** — the translator
   (`server/Core/Ai/AiApi.cs:101`: *"a clinician's question about ICU
   patients"*, and its refusal instruction names *"non-ICU data"* as
   unanswerable) and the interpreter (`AiApi.cs:355`: *"the interpretation
   layer of an ICU information system"*). The failure mode is not a bug but a
   correctly-functioning model following its instructions: a clinician asking
   about a ward patient can be REFUSED as out of scope. The Ward build
   re-scopes both prompts to the hospital, and its verification must include
   the direction that cannot pass by accident: an AI question about a
   ward-admitted patient answered, not refused.

Nothing in §§0–8 or in amendments A1–A6.1 is altered by this entry.
