# Inpatient Reception — Design Document

**Status:** DESIGN — for approval, then hand to Claude Code.
**Clinical/operational source:** Jaafer Aljanabi (ICU physician + system owner).
**Module:** #2 (Ward) — this document covers **Reception only**. Ward, OR, and ICD-10
diagnosis are separate designs; this one stops at "the admission exists."

---

## 0. Scope, and why it stops where it does

**In scope:** the inpatient reception desk — a patient arrives, is identified or registered,
and an **admission** is created carrying the department, service, admitting doctor, and
referring doctor. That admission is then the object the ward, the resident, and the OR all
attach to.

**Explicitly NOT in this design** (each gets its own):
- **Ward** — room/bed assignment, nurse assignment, the admitting note.
- **ICD-10 diagnosis** — assigned by the resident, not reception. It is a *data import*
  problem (≈70,000 codes), not a hospital-typed catalogue, and needs its own decision.
- **OR transfers** — a patient in theatre is neither in their bed nor discharged. That is a
  **new lifecycle state** Aurora does not have, and it affects the already-shipped ICU
  module too. It must be designed deliberately, not inherited.

**Reception is the front door of the ward journey, not a standalone screen.** It is designed
here first because everything downstream attaches to the admission it creates.

---

## 1. Reuse Aurora Core — do not duplicate

Aurora already has, shipped and clinician-validated:
- **Patient registry** — MRN (auto), National ID (typed), File Number (typed, optional), all
  searchable; partial-search across all patients incl. discharged (#163).
- **ADT admission** — encounters, lifecycle, EncounterGuard, discharge that closes and never
  deletes.
- **Bed registry** — add/retire, live-occupancy guard.
- **Staff directory + RBAC**, the consultant-only attending endpoint (`/adt/attendings`, #158).
- **Configurable vocabularies** — the established add/retire-never-delete pattern with
  in-use guards (#139).
- **Audit** — append-only `EventsJson` on every clinical write.

**Reception must extend these, never fork them.** A second patient registry or a parallel
admission path would be the fork that kills the one-codebase property.

---

## 2. Hospital master data (owner's ruling — nothing hardcoded)

Every list below is **hospital-configured**, following the existing vocabulary pattern:
add/retire (never rename or delete once referenced), in-use guards, audited.

| Master data | Example values | Notes |
|---|---|---|
| **Admission Type** | Elective · Emergency · Urgent · Transfer · Readmission · Other | Flat list |
| **Department** | Gynaecology & Obstetrics · General Surgery · Paediatrics · Internal Medicine · Orthopaedics | Flat list |
| **Service** | (belongs to exactly one Department) | **Hierarchical — see §2.1** |
| **Source of Admission** | Home · Clinic · Emergency Dept · Another hospital · Transfer from ICU | Flat list |
| **Referring doctors** | saved external referrers | **See §3.4 — combo field** |

Wards/rooms/beds are master data too, but belong to the **Ward design**, not here.

### 2.1 Service belongs to a Department
A Service is defined **under** a Department, never free-floating:

```
General Surgery
  ├── Upper GI
  ├── Colorectal
  └── Vascular
```

- Reception picks **Department first**, then **Service filtered to that department**.
- A Service cannot exist without a parent Department.
- **Retiring a Department must be refused while it has active Services or open admissions**
  — the same in-use guard that refuses retiring an occupied bed (#137).
- **FLAG:** whether a Service may be shared across Departments. Recommend **no** (one parent,
  simplest, matches the owner's tree). Report if the real hospital needs otherwise.

---

## 3. The Reception screen

### 3.1 Patient — find or register
- **Search first, always.** Reuse the existing partial search (name / MRN / File Number /
  National ID) across **all** patients including previously discharged — a returning patient
  must be found, not re-created. This directly reuses #163.
- **Register new only when search finds nothing.** The duplicate-registration guard already
  built into Admissions (#120 lineage) applies unchanged.
- **MRN stays auto-generated.** Never typed. (The #116 wrong-patient hole stays closed.)

### 3.2 The admission fields

| Field | Required | Source |
|---|---|---|
| **Type of Admission** | ✅ | master data dropdown |
| **Department** | ✅ | master data dropdown |
| **Service** | ✅ | dropdown **filtered by the chosen Department** |
| **Admitting Doctor** | ✅ | **staff directory** — see §3.3 |
| **Referring Doctor** | optional | **combo — see §3.4** |
| **Admission date/time** | ✅ | **auto-filled to server-local now, editable** (the #145 rule) |
| **Source of Admission** | optional | master data dropdown |

Then → **Create Admission**.

### 3.3 Admitting doctor — from staff, and the RBAC question
Selected from the hospital's own clinicians, not typed. **FLAG and report before building:**
`/adt/attendings` (#158) returns **Consultants only**, gated on `adt.admit`. For a ward, the
admitting doctor may legitimately be a **registrar/resident**, not only a consultant.
**Report what the endpoint returns and recommend** whether ward admission needs a broader
doctor-tier list than ICU's consultant-only rule. Do not silently widen a deliberately
narrow endpoint — it was narrowed for a reason (sysadmin/clinical separation).

### 3.4 Referring doctor — combo (owner's ruling)
**Both**: pick from a saved list of referrers, **or type a new name**.

- Typing a new referrer **offers to save it** to the referrer list for next time — so
  frequent referrers become dropdown entries without an admin having to pre-load them.
- Free text is unrestricted per #145 (no formatting rules on human-typed names).
- **The referring doctor is frequently EXTERNAL** — a GP, another hospital's physician. So
  this list is **its own master data, NOT the staff directory** — external referrers must
  never become Aurora user accounts.
- **FLAG:** whether an internal staff member can also be a referrer. Recommend the field
  accepts either, but that internal selection records the staff id while external records
  the free text — so an internal referral is traceable to a real account.

### 3.5 What Reception does NOT do
Reception creates the admission and stops. **No bed, no nurse, no note, no diagnosis, no
orders.** Those belong to the ward. An admission that exists without a bed is a valid,
expected state — "admitted, awaiting bed" — and the ward's worklist is what surfaces it.
**FLAG:** confirm Aurora's current ADT can represent an admission with no bed assigned, or
whether that's a new state. ICU admits *into* a bed; ward admits *then* beds.

---

## 4. Department + Service → which beds (owner deferred to recommendation)

**Recommended model: the service's ward is offered first; other wards allowed with a reason
recorded.**

- When the ward assigns a bed, **beds in the ward(s) mapped to that Service are offered
  first** — a surgical patient defaults to a surgical bed.
- **Boarding elsewhere is permitted** (the real case: the right ward is full at 2am), but the
  system **records that it happened and why** — a free-text reason, audited.
- This is the honest middle: it guides toward correctness without lying that overflow never
  happens, and it makes boarding *visible* rather than invisible.

**FLAG:** the Service→Ward mapping is master data belonging to the **Ward design**. Reception
only records Department + Service; it does not choose beds. Note the dependency and stop.

---

## 5. Safety and consistency rules (carried from Aurora ICU — non-negotiable)

- **Never fabricate.** No field defaults to a clinically meaningful value nobody entered.
  Blank means blank, and prints as blank.
- **Never hard-delete.** Admissions supersede/correct; the audit trail survives. Retiring
  master data is retire-not-delete with in-use guards.
- **Every write audited** — who, what, when, which role — the existing `EventsJson` shape.
- **Free text unrestricted** (#145) but **safety validations kept** — uniqueness on the
  identifiers, auto-generated MRN, required fields required.
- **Auto-filled times are server-local and editable** (#140/#145).
- **One codebase, zero forks** — everything hospital-specific is master data.

---

## 6. RBAC

**FLAG and recommend, don't assume.** Reception clerks are the existing **office
Administrator** tier — the role deliberately shut out of every clinical pane (orders,
results, attachments). Registering a patient and creating an admission is **clerical, not
clinical**, so it plausibly fits. But it means an Administrator can create the object the
whole clinical record hangs from.

**Report:** which existing profile should hold `admissions.create`, whether a new
Receptionist profile is warranted, and confirm reception **cannot** see clinical content
(the attachment/results tier stays closed to them).

---

## 7. Build notes
- **Verify-first and report before building:** how ADT currently models admission→bed
  (§3.5); what `/adt/attendings` returns and whether ward admitting needs a wider tier
  (§3.3); whether an admission can exist with no bed; how the existing vocabulary manager
  handles a **hierarchical** list (Service under Department) — it has only ever done flat
  lists (§2.1).
- **Design-first, then build.** Master data (§2) before the screen (§3) — the screen is
  meaningless without the lists.
- **Verify:** all five lists are hospital-configurable with in-use guards; Service filters by
  Department; a returning discharged patient is found by search, not duplicated; referring
  doctor accepts both saved and typed, and offers to save a new one; admission date/time
  auto-fills server-local and is editable; an admission is created with no bed and appears on
  the ward's pending list; RBAC gated per §6; every write audited.

---

## 8. Open items (flag, don't silently decide)
1. Admission with **no bed assigned** — new lifecycle state or existing? (§3.5)
2. **Ward admitting doctor tier** — consultant-only like ICU, or wider? (§3.3)
3. **Hierarchical master data** — Service under Department; the vocabulary manager is flat
   today. (§2.1)
4. **Receptionist RBAC** — existing Administrator or a new profile? (§6)
5. Internal staff as referrer — id vs free text. (§3.4)

---

*End of Inpatient Reception design — the front door of the ward journey. A patient is found
or registered, and an admission is created carrying Type, Department, Service, Admitting
Doctor and Referring Doctor — every list hospital-configured, nothing hardcoded, so a second
hospital installs the same code and defines its own structure. Reception stops at the
admission; the ward assigns the bed, the resident writes the note and the diagnosis, and the
OR transfer is a lifecycle state Aurora does not yet have and must design deliberately. This
document is the specification Claude Code builds from, after it reports the five open items.*

---

## Amendments

*[Appended 2026-08-17. SUPERSEDE, NEVER REWRITE — nothing above this line is
altered: §§0–8 and all five open items stand byte-identical to the approved
document, and this commit's diff is a pure append (0 lines removed). Each
ruling below quotes the item it resolves and records the decision beneath it,
so "what was approved" and "what was decided later" stay separately readable.
Source: the project owner's rulings. Every mechanism cited was verified against
the shipped code before being written down, with the file and line named, so a
reader can check rather than trust.]*

### A · §2 — the five lists are FOUR governed vocabularies plus ONE typeahead source

§2's table lists five kinds of master data under one sentence: *"add/retire
(never rename or delete once referenced), in-use guards, audited."* That
sentence is correct for four of them and **not** for the fifth.

- **Governed vocabularies (four)** — **Admission Type**, **Department**,
  **Service**, **Source of Admission**. These follow the established
  add/retire-never-delete pattern with in-use guards and an append-only audit,
  exactly as §2 states.
- **Typeahead source (one)** — **Referring doctors**. Not a governed
  vocabulary, and it has **no in-use guard** — see ruling 5, where the reason
  and the consequence are stated in full.

### 1 · Admission with no bed assigned — RESOLVED 2026-08-17

> 1. Admission with **no bed assigned** — new lifecycle state or existing? (§3.5)

**Existing. No new lifecycle state.** `bedId` becomes **optional** on
`POST /api/icu/adt/admissions`; the required-field check that today lists
`bedId` alongside `diagnosis` and `attending` (`AdtApi.cs:638-640`) becomes
conditional on it being supplied.

**The four gates that concern a supplied bed still fire, unchanged** — this
ruling relaxes *whether a bed is named*, never *what happens once one is*:

| gate | code | where |
|---|---|---|
| length bound | 400 | `AdtApi.cs:653-656` |
| unknown bedId | 400 | `AdtApi.cs:727-729` |
| retired bed | 409 | `AdtApi.cs:737-739` |
| occupied bed | 409 | `AdtApi.cs:741-743` |

**`Status` stays `open | discharged`.** The two values the endpoint already
validates (`AdtApi.cs:78`) are the whole set; no third value is introduced.
**"Awaiting bed" is DERIVED, never stored** — `Status == "open" && BedId == ""`
— which keeps it on the right side of the locked rule that time- and
state-relative labels are computed at read, never persisted.

**A pending view is part of this ruling, not a later nicety.** An admission
with no bed and no worklist that surfaces it is a patient who exists only in
the database. §3.5 already says the ward's worklist is what surfaces them; this
records it as a requirement of allowing the state at all.

**Bed assignment is NOT a transfer.** It gets its own path, its own action
string and its own atom, specified in the **Ward design** — not here, and not
by reusing `POST /adt/encounters/{id}/transfer`. The reason is a mechanism
fact, not a preference: `AdtEventDto` is
`(string Time, string Actor, string Action, string? Detail)` —
**four strings, with no structured from/to** (`AdtModels.cs:317`). Every ADT
event's provenance lives in `Detail` as prose the writer concatenates:
`$"to {req.BedId}"` on admit (`AdtApi.cs:886`),
`$"from {enc.BedId}…"` on discharge (`AdtApi.cs:955`). **The concatenated
string IS the audit record** — there is no second, structured copy to fall back
on. Route a first bed assignment through transfer and the permanent record
reads *"from  to W-12"*: a sentence asserting an origin that never existed,
unfalsifiable afterwards because nothing else was stored. A distinct action
string is the only way the audit reads true.

### 2 · Ward admitting doctor tier — RESOLVED 2026-08-17

> 2. **Ward admitting doctor tier** — consultant-only like ICU, or wider? (§3.3)

**Wider for the ward, via a NEW ward-scoped list returning both the Doctor and
SeniorDoctor profiles.** `/api/icu/adt/attendings` **stays consultant-only and
byte-identical**; ICU's picker does not move.

§3.3 warns against silently widening a deliberately narrow endpoint. Verifying
what actually narrows it sharpens that warning rather than softening it: the
endpoint is gated on `adt.admit`, and **both Doctor and SeniorDoctor tokens
already hold that atom** (`AdtApi.cs:57`, and the comment at `:48` says so
outright). The gate was never the narrowing. The narrowing is the filter
`Rbac.ProfileOf(t) == "SeniorDoctor"` at `AdtApi.cs:62`. So widening for the
ward is not a matter of relaxing a permission — it would mean editing the one
line that makes ICU's list consultant-only, and every ICU admission form would
silently gain registrars. A second endpoint is the only change that leaves the
first one provably untouched.

### 3 · Hierarchical master data — RESOLVED 2026-08-17

> 3. **Hierarchical master data** — Service under Department; the vocabulary
>    manager is flat today. (§2.1)

**Service sits under Department. The parent is validated in application code**,
consistent with how every existing vocabulary reference is validated, and
**there is no reparenting**.

Reparenting is prevented **structurally, not by a guard**: the edit contract
carries **no `departmentCode` field at all**. This copies the mechanism already
proven by `isDeath` — `CreateDispositionRequest(Code, Label, IsDeath)` versus
`EditVocabEntryRequest(Label)` (`VocabModels.cs`), where the request record
simply has no such member and `JsonUnmappedMemberHandling.Disallow` turns
sending one into a 400. Immutability that lives in the shape of the contract
cannot be forgotten by a future edit path; a guard can.

**No surface may switch, compare or style on a department or service code —
ever.** A code is identity, not meaning. Labels resolve at read; the admission
event **snapshots the label** at the moment it is written, so a later edit
cannot rewrite history; and a change of MEANING is a **new entry plus a
retire**, never a rename. This is the rule that keeps "the hospital renamed
General Surgery" from silently reinterpreting every admission ever recorded
under it.

**Retiring a Department while it has active Services or open admissions stays
refused**, as §2.1 requires — the in-use guard that ruling A confirms applies
to all four governed vocabularies.

### 4 · Receptionist RBAC — RESOLVED 2026-08-17

> 4. **Receptionist RBAC** — existing Administrator or a new profile? (§6)

**A new `admissions.create` atom, held by Doctor, SeniorDoctor and
Administrator.** No new profile. **`adt.admit` is unchanged and is still
required to place a patient in a bed.**

**The split is by BED, not by endpoint.** There is ONE admission path and no
fork: reception calls the same endpoint every clinician calls. What it cannot
do is name a bed — that still costs `adt.admit`, which the office Administrator
does not hold and does not gain here. This is what §6's concern ("an
Administrator can create the object the whole clinical record hangs from")
resolves to: they can open the episode, and they cannot place the patient.

A second, reception-only endpoint was the alternative and is rejected: two
admission paths is the fork §1 exists to forbid, and the two would drift.

**Reception still cannot reach a clinical pane.** The office Administrator
profile holds `admin.view, patients.view, identity.correct, hospital.configure,
beds.manage` and no clinical atom (`Rbac.cs`); `admissions.create` is added to
that set and nothing is removed from the exclusion. Orders, results,
attachments and AI stay closed to them, exactly as the locked constraint
requires.

### 5 · Internal staff as referrer — RESOLVED 2026-08-17

> 5. Internal staff as referrer — id vs free text. (§3.4)

**Both, as two nullable columns.** `ReferrerUserId` — validated against `Users`,
so an internal referral is traceable to a real account. `ReferrerName` — free
text, for the external GP who must never become an Aurora user account (§3.4).

- **Both set → 400.** Two answers to one question is a malformed request, not a
  merge to be guessed at.
- **Neither set → honestly not recorded.** Never a default, never a
  placeholder — the never-fabricate rule of §5.

**THE REFERRER LIST IS A TYPEAHEAD SOURCE, NOT A GOVERNED VOCABULARY, AND IT
HAS NO IN-USE GUARD.** Stated here, in full, at the point a reader arrives
looking for the guard — because §2's table lists "Referring doctors" among the
master data covered by *"in-use guards"*, and a reader who checks will
otherwise find the guard missing and have to decide whether that is a decision
or an oversight. It is a decision. **Nothing references those rows.** The
admission stores the id or the text; it never holds a foreign key into the
referrer list. So there is no in-use relationship for a guard to detect, and
retiring or removing a referrer entry cannot orphan anything. A guard here
would not be a safety net — it would be a check that can never fire, which this
project treats as worse than no check at all.

**Gated on `admissions.create`, NOT `hospital.configure`.** §3.4 requires that
typing a new referrer offers to save it for next time. That save happens
mid-admission, under whatever token is filling the form — and **Doctor does not
hold `hospital.configure`** (`Rbac.cs`: it sits on the office Administrator).
Gating the save on the configuration atom would 403 every doctor on the
save-while-typing path the design asks for, on the one interaction it was
designed around.

### Build sequencing — which of the five lists step 3 ships (recorded 2026-08-17)

Amendment A above splits §2's five lists into four governed vocabularies and
one typeahead source. **Step 3 builds the four. It does not build the fifth**,
and that is a decision with a reason rather than an omission — recorded here,
beside the split, because this is where a reader counting the lists arrives.

**Referring doctors, and the `admissions.create` atom with it, defer to the
Configuration-screen step.** Ruling 5 gates the referrer list on
`admissions.create` precisely because the save happens *mid-admission, under a
Doctor token, while typing* — and that interaction does not exist yet. Two
consequences follow:

- **The gate could not be tested for the reason it was chosen.** With no
  reception screen, an assertion can only show that a Doctor may POST a
  referrer — true, and silent about the 403-on-save-while-typing hazard the
  atom exists to avoid. A gate whose justification cannot be exercised is the
  shape this project already refuses elsewhere.
- **The atom would publish a capability the code does not honour.**
  `01_ARCHITECTURE.md`'s RBAC matrix is maintained as a mirror of `Rbac.cs`, so
  introducing `admissions.create` now would show the office Administrator
  holding it while no endpoint accepts them — a false row in a table whose
  whole value is that it matches the code. This was the decisive argument.

The design also argues against pre-loading on its own terms: §3.4 wants
referrers to accumulate by typing, *"without an admin having to pre-load
them."* An empty referrer list with no screen to fill it has no consumer.

**THE CONFIGURATION UI IS ITS OWN STEP, NAMED HERE SO THE GAP IS VISIBLE.**
After step 3 a hospital has four correctly-governed tables and **no way to
populate them** — every endpoint is an API call. Reception cannot be used until
those screens exist, which is the honest consequence of seeding nothing in
production (§2, and the seeding record in 02_PROJECT_STATUS.md), not a defect
in step 3. An unnamed gap becomes an invisible one, so it is named: **step 4 is
the Configuration screens for the four vocabularies, and it carries the
referrer typeahead and `admissions.create` with it.**

Nothing in §§0–8, in Amendment A, or in rulings 1–5 is altered by this entry.

### §4 superseded by the first real hospital — no wards, so no boarding concept (recorded 2026-08-17)

**A DESIGN CHANGE, NOT A CODE CHANGE.** Nothing has been built from §4, and step
3 (#199) is unaffected: reception records Department and Service and never
chooses a bed (§3.5), so no shipped code depends on the model this entry
supersedes. Source: the hospital under contract, via the project owner.

**The constraint as reported:** rooms are single-bed; there are **no
specialty-separated wards**; surgical and gynaecology patients go into any room,
so **every bed serves every department**; only some **day-case surgery areas**
have a room number with multiple beds; and **the system must show all the empty
beds**.

#### 1 · The recommended model is contradicted, and the boarding machinery must be ABSENT rather than permissive

§4 recommends *"the service's ward is offered first; other wards allowed with a
reason recorded"*, with boarding *"permitted … but the system records that it
happened and why — a free-text reason, audited."* **At this hospital there are
no wards to board out of.**

**The Service→Ward mapping becomes OPTIONAL master data. When it is unset there
is no boarding concept at all**: every empty bed is offered, and **no reason is
asked**.

**This is deliberately NOT "offer all beds first, reason still optional."** The
machinery has to be *absent*, not merely lenient. A boarding reason that is
recorded on 100% of admissions **records nothing** — it becomes a field whose
only possible content is noise, and it makes every routine admission's audit
trail assert a clinical exception that did not occur. That is the design's own
§5 rule (*"No field defaults to a clinically meaningful value nobody
entered"*) applied to a field that would always be entered and never mean
anything. A permanent audit line reading "boarded, reason: n/a" on every
admission is worse than no line: it trains every future reader to ignore the
one place a genuine exception would appear.

**§4 is not wrong — it is CONDITIONAL, and that is the correction.** A hospital
that *does* separate its wards by specialty still wants exactly what §4
describes. So the mapping is optional, and the boarding path exists **only when
the mapping does**: one code path selected by configuration, never two products.
That also makes the hospital's *"show all the empty beds"* requirement satisfied
by construction rather than by a setting someone has to get right.

#### 2 · The bed registry has no ROOM — recorded as a Ward-design input, not solved here

`BedRow` is `BedId` · `Area` · `Seq` · `Active` (plus the append-only audit) —
**there is no room.** And `Area` is not one: it is a **board grouping**. The
seeded values are `Pod A` / `Pod B`, and the bed board derives its groups as the
distinct set of areas (`src/lib/api/bedboard.ts:57`).

Single-bed rooms make **room ≈ bed**, so for the great majority of this
hospital's stock the missing concept costs nothing — the bed id *is* the room.

**The day-case areas are where it bites.** One room number over several beds is
a relationship the model cannot express today. `Area` could be made to carry the
room number, but `Area` is already the board's grouping key, and one field
cannot be both without the bed board silently turning into a room list.

**Recorded as an input to the Ward design; deliberately not solved here.**
Reception never chooses a bed, and introducing a Room entity in the document
about the front door is precisely the scope creep §0 draws its boundary
against. Whether it needs solving at all depends on the day-case question
below.

#### 3 · OPEN, for the hospital to answer: every bed tagged with both departments, or no mapping at all?

Two configurations, **identical behaviour today** — every bed available to every
department either way. They diverge the moment a **third department** is added:

- **Explicit tagging** — every existing bed must be re-tagged for the new
  department. A bed nobody re-tags is invisible to it, and **a forgotten one
  leaves the new department with nowhere to admit.** The failure is silent and
  misattributed: it surfaces as "no beds available" at 2am, not as
  "configuration incomplete".
- **No mapping at all** — the new department inherits every bed with no action
  taken, and nothing can be forgotten because there is nothing to do.

Recorded as open rather than decided, because it is the hospital's call. The
asymmetry above is the fact that makes it worth asking now instead of
discovering later: the two options cost the same today and diverge only under a
change that is certain to happen eventually.

#### 4 · UNRESOLVED: is a day case an inpatient admission here, or same-day in-and-out?

If a day case is **not** an admission, the multi-bed day-case rooms sit outside
this flow entirely and item 2's gap may not need solving for reception at all.
If it **is** an admission, a multi-bed room is a real reception concern and item
2 becomes load-bearing.

Recorded beside item 2 rather than deferred to the Ward design because the
answer sets item 2's scope — asking it later means solving a problem that might
not exist, or missing one that does.

#### 5 · UNRESOLVED: is the admitting doctor selected manually, or derived from the Service?

§3.2 lists Admitting Doctor as required and §3.3 has it chosen from the staff
directory, which reads as manual. If the hospital would rather it were
**derived** from the chosen Service, one constraint is binding:

**it must be a VISIBLE, EDITABLE DEFAULT — never a silent assignment.**

Not a preference. The admitting doctor is an **attribution**, in a record that
is audited and permanent. A silently derived value would **attribute an
admission to a doctor who did not make it**, and nothing on the screen would
have told the clerk that a name had been chosen on their behalf. §5's
never-fabricate rule covers exactly this: no field defaults to a clinically
meaningful value nobody entered. A visible, editable default is a *suggestion
the clerk confirms*; a silent one is a fabricated fact carrying a real person's
name.

Nothing in §§0–8, in Amendment A, in rulings 1–5, or in the Build-sequencing
entry is altered by this entry. §4's original text stands unchanged above, as
the model it was — superseded here, not rewritten.

### The hospital has answered — all three questions closed (recorded 2026-08-17)

The three questions raised in the entry above have been answered by the
contracted hospital, via the project owner. Appended; nothing above is altered.

#### 1 · ANSWERED: no mapping at all — any room, any department

**Not "every bed tagged with both departments". There is NO mapping**, and the
hospital does not want one.

Two consequences, both worth stating rather than leaving to be inferred:

- **The boarding concept is PERMANENTLY absent here**, not merely absent today.
  There is no configuration that could switch it on, because there is nothing to
  map. The previous entry required the machinery to be absent rather than
  lenient when the mapping is unset; at this hospital "unset" is the permanent
  state.
- **A department added later inherits every room**, with no re-tagging and no
  rooms to forget. The failure the previous entry warned about — a bed nobody
  re-tags leaving a new department with nowhere to admit, surfacing as "no beds
  available" at 2am rather than "configuration incomplete" — **cannot occur
  here.** That asymmetry was the reason the question was worth asking before it
  mattered, and it decided the answer.

**§4's conditional path stays in the product.** A hospital that *does* separate
its wards by specialty still gets the mapping, the ward-first offer and the
audited boarding reason. This one simply never sets the mapping. One code path
selected by configuration, exactly as the previous entry required — the answer
narrows this installation, not the product.

#### 2 · ANSWERED: a day case IS an admission, and the multi-bed rooms are day-case ONLY

So **the Room concept is CONFIRMED REQUIRED — and narrowly.** It is one area of
the estate, not the estate: everywhere else the rooms are single-bed and room
and bed are the same thing. The open question from item 4 is closed in the
direction that keeps the gap real but small.

**RECOMMENDATION, not a decision — this stays Ward-design scope.** Two shapes,
with the cost of each stated:

- **A · a nullable `Room` field on the bed.** Null for single-bed stock, where
  room ≈ bed and inventing a room number would be inventing a fact; populated
  only for the day-case beds that genuinely share one. Additive, no new entity,
  and it states honestly that most beds have no room of their own.
  *Cost:* the room becomes a string repeated across sibling beds with nothing
  owning it — renaming one means editing N beds, and nothing enforces that they
  agree.
- **B · a `Room` entity with its own hierarchy**, rooms holding beds. Correct in
  the general case, one place to rename, and able to carry attributes later.
  *Cost:* it imposes a room on the whole estate, where the overwhelming majority
  would be a one-bed room existing only to satisfy the model — ceremony that
  makes every future read join through a table that means nothing.

Which one turns on facts not yet known: whether a room will ever carry
attributes of its own, and whether the day-case area is stable or grows. That is
a Ward-design call, made with the estate in front of you.

**REJECTED, explicitly: encoding the room inside the bed's NAME** (`DC-3 / bed
2`, or any such convention inside `BedId`). This is the `Encounter.Attending`
mistake, and this repo has already paid for it once: 02_PROJECT_STATUS.md
records that the only stored clinician↔patient link was
*"`Encounter.Attending` — free text, joined to nothing, read by nothing"*, and
that the admission form's Attending stayed a free-text `<input>` until a typo
wrote a ghost attending onto an encounter and it had to be replaced with a
`<select>` bound to a real read. **A room number living inside `BedId` is the
same shape:** a real thing represented as text, joined to nothing. Nothing could
list the beds in a room, nothing could rename a room, and every consumer would
re-parse a convention nobody enforces. `BedId` is a permanent natural key —
overloading it makes the room permanent too, and permanently wrong if it is ever
mistyped.

Not built here. Reception never chooses a bed.

#### 3 · ANSWERED: the admitting doctor is chosen MANUALLY, every time

**No derivation from Service.** Item 5's derived-default question is closed —
and closed by removal rather than by satisfaction: since nothing is derived, the
visible-editable-default constraint has nothing to bind to. It stands unused,
and stays on the record for any future proposal to derive the field.

**The referring doctor stays OPTIONAL**, as §3.2 already has it.

**This confirms the ward doctor-tier list is REQUIRED.** Ruling 2's new
ward-scoped Doctor+SeniorDoctor endpoint is no longer one option among several:
with no derivation, a manual picker is the only way the field is ever filled, so
it must offer the tier the ward actually admits under. `/adt/attendings` still
stays consultant-only and byte-identical for ICU.

**OWED, restated here because this answer is what makes it certain:** when that
ward list is built, the deployed ADT suite needs a leg asserting the seeded
Specialist **`liam.osei` is ABSENT** from `/adt/attendings`. The suite's current
`maya.chen`-absence check cannot detect a doctor-tier widening of ICU's picker —
a Staff Nurse is absent under either filter. Already on 02's Known Feature Gaps
shelf from #199; this entry is the reason it will be needed rather than merely
possible.

Nothing in §§0–8, in Amendment A, in rulings 1–5, in the Build-sequencing entry,
or in the §4-superseded entry is altered by this one.
