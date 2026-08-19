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
