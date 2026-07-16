# Patient Assignment & Responsibility — Design Document

**Status:** DESIGN — for approval, then hand to Claude Code as the build blueprint.
**Clinical source:** Jaafer Aljanabi (ICU physician, project clinical validator).
**Priority: #1 on the care pathway** — the validator's own ordering: *close anything affecting the
delivery of care first.* Live consequence: **P-1191 (رضا) has an OVERDUE Paracetamol that no
nurse can give or document**, because he is assigned to nobody and assignment cannot be created.

---

## 0. The finding — there is no assignment concept anywhere

Verified against real code:
- **Nurse assignment is a compiled-in client fixture** — `NURSE_ASSIGNMENT`
  (`src/lib/api/data/nursing.ts:22`): hardcoded `'RN Maya Chen'`,
  `ASSIGNED_PATIENT_IDS = ['P-1001','P-1004']`, and the shift is the **display literal**
  `'07:00–19:00'`. **It ignores who is signed in** — any nurse, including a brand-new account,
  sees Maya Chen's two patients. **"MY ASSIGNED PATIENTS · 2 of 2 · this shift" is a fabricated
  claim** — the same class as the retired SOFA/EWS tiles, surviving in an unaudited screen.
- **The doctor rounding list is the same pattern** — `ROUNDING_LIST`
  (`src/lib/api/data/workspace.ts`): `'Dr. Sara Rahman'` + six fixed patient IDs. Its own comment
  states the panel is *"an explicit ASSIGNMENT … not attending-derived: it includes cross-cover
  patients"* — **a design intent that was never given a mechanism.**
- **Nothing on the server:** no table, no endpoint, no migration ever touched assignment. The
  only clinician↔patient link stored is **`Encounter.Attending`** — a **free-text display string**
  from the admission form ("Dr. S. Rahman"), never parsed, never joined to a Users row, **read by
  no panel**.
- **No shift entity exists.** The closest thing is the JWT's 12-hour expiry.
- **The MAR itself is real and unit-wide** — `GET /api/icu/mar` serves rows for **every open
  encounter** (P-1191's ORD-556 rows are in that response now). The workspace then **narrows
  client-side to the fixture's IDs** (deliberate, per `MarApi.cs:28`: *"the nurse-assignment
  narrowing stays a client-side derivation"*). **The data already flows; only the scoping list
  has no source of truth.** The implement queue narrows the same way.

---

## 1. Locked decisions (validator)

| # | Decision |
|---|---|
| 1 | **Patient ⇄ Nurse is many-to-many.** **No 409 on a second nurse** — in ICU this is routine, not exceptional: **ECMO, CRRT, massive transfusion, severely unstable patients, and during handover** (briefly three). |
| 2 | Each assignment carries: **Start Time, End Time, Primary/Secondary, Shift, Assigned By.** |
| 3 | **Patient-based, never bed-based.** Responsibility is for the **patient**, not the bed — moving a patient from Bed 3 to Bed 7 for sterilisation or equipment failure must **never** silently drop the nurse. *The bed is a Location; the assignment is to the patient.* |
| 4 | **Authority: SeniorDoctor** holds assignment authority (validator: *"Senior Doctor have all authorities"*) — **no Admin role** (§5), **no new SeniorNurse profile for now** (§5.1). |
| 5 | **Shift is a LABEL, not a new entity** (validator: *"لا تنشئ شيئاً جديداً"*). |
| 6 | **Assignment is NOT authority** (§6) — `meds.administer` stays global. |

---

## 2. The model

**One Core concept, two kinds.** `PatientAssignment` lives in **Aurora Core** (it is ADT-adjacent
and module-independent):

```
{ assignmentId, encounterId, userId, kind: 'nurse' | 'doctor',
  role: 'primary' | 'secondary', shift: 'day' | 'night',
  assignedAt, assignedBy, endedAt?, endedBy?, endReason? }
```

- **Encounter-scoped** — the encounter is the aggregate root; the patient is reached through it,
  exactly as orders are. (The locked lifecycle rule: order/observation/measurement/report
  lifecycle is bounded by the encounter.)
- **`userId` references a real Users row** — **never free text.** *(Contrast `Encounter.Attending`,
  which is free text and read by nothing — §9.)*
- **Ended, never deleted** (never-destroy). An ended assignment is history, not an absence.
- **Every create and end is audited** — actor + **active role** (#104) + time.
- **The nurse workspace and the rounding list become derived views** over this. **The fixtures
  retire.**

---

## 3. Nurse assignment

- **Many-to-many, no blocking** (decision 1). A patient may have a **Primary** and one or more
  **Secondary** nurses; handover may briefly produce three. **Never 409 a second assignment.**
- **Open-ended, explicitly ended/handed over** — there is no shift entity, so "this shift" is not
  a boundary the system enforces; an assignment ends when someone ends it (or at discharge, §8).
- **Shift label** (decision 5): `day` / `night` — matching the **Day 07–19 / Night 19–07** filters
  the timeline feed already has. **FLAG:** chosen by the assigner, or derived from `assignedAt`?
  **Recommendation: chosen** — the assigner knows which shift they are staffing, and derivation
  breaks at boundaries (a nurse arriving 06:45 for handover is on the **day** shift).
- **FLAG:** may two *active* assignments both be `primary`? **Recommendation: do not block**
  (decision 1 is explicit that the system must not refuse), but **render it plainly** — two
  primaries is normal for ten minutes at handover and a data-quality signal at six hours.

---

## 4. Doctor assignment

- **Per-encounter**, auto-ended by the discharge cascade (§8).
- **Unlimited** — **cross-cover is real**, and the existing fixture's own comment already says the
  rounding list *"includes cross-cover patients"* and is **not attending-derived**.
- Same `primary` / `secondary` shape (primary = the responsible consultant; secondary =
  cross-cover). **FLAG** if a different vocabulary is wanted for doctors.

---

## 5. Authority

- **`assignments.manage` — a new permission atom, held by SeniorDoctor** (decision 4). It covers
  assigning/ending **both** nurse and doctor assignments.
- **No Admin.** *(The validator's earlier list named "Admin"; it collides with two locked rules —
  the **office** Administrator is barred from clinical data, and the **System** Administrator
  (#104) manages identities only, never clinical. **Deciding who nurses a patient is a clinical
  care decision.** Resolved: SeniorDoctor.)*
- **Everyone with `patients.view` can SEE assignments** — knowing who is responsible for a patient
  is basic clinical safety, not privileged information. Only **managing** them is gated.

### 5.1 The SeniorNurse follow-up (recorded, deliberately not built)
Staff / Charge / Head Nurse **all collapse into the same Nurse profile** today, so charge-nurse-only
authority would need a **new SeniorNurse profile row** (mirroring the existing SeniorDoctor row).
The validator's decision: **create nothing new for now.**

**Why this is safe to defer:** the atom is the model. When a SeniorNurse profile is added later it
simply **also holds `assignments.manage`** — **no model change, no migration of assignments.**
**Record honestly in `02`:** in a real ICU the **charge nurse** allocates nursing, not the
consultant; SeniorDoctor holding it is a deliberate interim, and the follow-up is a profile row.

---

## 6. Assignment is a WORKLIST, not an AUTHORITY (decision 6 — get this right)

**`meds.administer` stays global.** Today any nurse may document any patient's dose server-side,
and `MarApi.cs:28` explicitly treats the narrowing as **workflow, not authority**. **Keep it that
way.**

**Clinical reason: a nurse responding to an emergency must NEVER be 403'd.** A patient arrests and
the nearest nurse pushes adrenaline — the system must let her document it. Assignment answers
*"whose worklist is this on?"*, not *"who is permitted to act?"*

**Server-side enforcement — or an audited "not assigned" override — is a separate hardening
decision, not this build.** Do not gate administration on assignment.

---

## 7. The Unassigned panel (this is the P-1191 failure made structural)

**Zero assignments is allowed — but must be VISIBLE.** An **"Unassigned patients"** panel lists
every open encounter with no active nurse (and/or no active doctor), so **no patient can silently
fall through**. That is exactly what happened to رضا: admitted, prescribed, and invisible to every
nurse's MAR.

**FLAG:** where it lives (the nurse workspace, the bed board, both) and whether nurse-unassigned
and doctor-unassigned are shown separately. **Recommendation: both kinds, visible on the bed board
and the workspaces** — it is a unit-level safety view.

**No auto-assignment at admission.** *(Considered and rejected: there is no reliable user
reference to auto-assign — `Encounter.Attending` is free text, and registration may be performed
by a clerk who is not a clinician. So a newly admitted patient is honestly **unassigned** and
appears in the panel until someone assigns them. The panel is the safety net; a fabricated
default would not be.)* **FLAG if you want a default instead.**

---

## 8. Lifecycle

- **Discharge auto-ends all assignments** — a cascade, audited ("ended at encounter close"),
  mirroring the existing order-discontinue cascade. The encounter is closed; responsibility ends
  with it.
- **Bed transfer touches nothing** (decision 3) — the assignment is to the patient. **Assert this
  explicitly in the tests**; it is the validator's stated clinical reason for patient-based.
- **Handover** = end one assignment, start another. Both are audited events; the overlap is
  visible and permitted (§3).

---

## 9. Retiring the fixtures (and one honest note about `Attending`)

- `NURSE_ASSIGNMENT` and `ROUNDING_LIST` **retire**. Both panels derive from real assignments.
- The **fabricated "2 of 2 · this shift"** claim dies with them; the counts become real.
- The MAR/implement **client-side narrowing** (`MarApi.cs:28`) now narrows on a **real** list
  rather than a fixture — **the mechanism stays, its source becomes true.**
- **`Encounter.Attending` (free text) — FLAG, do not silently rewrite.** It is a legacy display
  string from the admission form, joined to nothing and read by nothing. The real doctor
  assignment supersedes it in meaning. **State whether it is left alone (recommended), rendered
  as legacy, or retired** — but **never** parse a free-text name into a user reference (that is
  the same guess this project refuses everywhere else).

**Also recorded (expectations):** the same nurse workspace's **nursing tasks, I&O, and the SBAR
handoff note are equally fixtures.** This build makes the **MAR and implement halves** honest; it
**does not touch those** — they remain fabricated and must be recorded as such in `02`.

---

## 10. Seed
- **Staging/dev seed** creates the demo assignments (Maya → P-1001/P-1004; Rahman → her six) so
  the demo keeps working and the suites stay meaningful.
- **Production seeds none.**
- **Existing open encounters start unassigned** and appear in the panel (§7) — honest.

---

## 11. Scope

**In scope:** the `PatientAssignment` model (§2); nurse (§3) and doctor (§4) assignment;
`assignments.manage` on SeniorDoctor (§5); assignment **never gates** administration (§6); the
**Unassigned panel** (§7); the discharge cascade and transfer-invariance (§8); retiring both
fixtures so the workspaces derive from truth (§9); seed (§10); full audit with the active role.

**Deferred / recorded:** a **SeniorNurse profile** holding the same atom (§5.1); server-side
enforcement or an audited not-assigned override (§6); a real **Shift entity** and rosters; the
nurse workspace's **tasks / I&O / SBAR fixtures** (§9); auto-assignment defaults (§7).

---

## 12. Build notes / verification
- **Verify the real code first** and report before changing anything.
- Additive server model + endpoints; **client fixtures retire** in the same PR.
- **Every create/end audited** with actor + active role (#104).
- **#104 interaction:** an assignment binds to the **user**; what a workspace shows derives from
  **(userId, kind matching the ACTIVE profile)**. A dual-role person **acting as Consultant** sees
  their doctor panel, **not** their nurse assignments — **assignments don't change when the active
  role switches; visibility does.** Assert both directions.
- **Verify:** a SeniorDoctor assigns a nurse; **a SECOND nurse assigns successfully (no 409)** with
  primary/secondary distinct; a non-SeniorDoctor gets **403** and sees no control; **everyone with
  `patients.view` can see** who is assigned; **P-1191's exact scenario is fixed** — assign a nurse
  and his OVERDUE Paracetamol **appears on her MAR and can be documented**; **an unassigned nurse
  can still administer** (`meds.administer` NOT gated — assert the emergency case explicitly); a
  **bed transfer leaves assignments intact**; **discharge auto-ends all assignments**, audited;
  **unassigned patients appear in the panel** and disappear when assigned; the workspace **no
  longer shows another nurse's fixture patients to whoever signs in** (assert with a second nurse
  account — this is the fabricated-claim fix); the dual-role visibility rule holds; seeded demo
  assignments keep the suites green. Update `02` (including §5.1's honest interim note and §9's
  remaining fixtures). Draft PR; rendered verification before merge.

---

## 13. Open items (flag, don't silently decide)
1. Shift label: chosen vs derived (§3) — recommend chosen.
2. Two active primaries: permitted-and-visible (§3) — recommend no block.
3. Doctor primary/secondary vocabulary (§4).
4. Unassigned panel placement + whether nurse/doctor are shown separately (§7).
5. `Encounter.Attending`: leave alone (recommended) / render as legacy / retire (§9) — **never
   parse it into a user reference.**
6. Auto-assignment default at admission (§7) — recommend none; the panel is the safety net.

---

*End of Patient Assignment & Responsibility design. There is no assignment concept in the system —
both panels are compiled-in client fixtures, and "MY ASSIGNED PATIENTS · 2 of 2 · this shift" is a
fabricated claim that ignores who is signed in. The consequence is live: a patient admitted through
Aurora is assigned to nobody, cannot be assigned, and his prescribed medication is invisible to
every nurse's MAR. This builds a real encounter-scoped `PatientAssignment` — many-to-many with
Primary/Secondary because ICU nursing genuinely is (ECMO, CRRT, massive transfusion, handover),
patient-based because responsibility follows the patient and not the bed, managed by SeniorDoctor,
audited with the active role, ended-never-deleted. **Assignment is a worklist, never an authority**
— a nurse responding to an arrest must never be refused. Unassigned is allowed but **visible**, so
the failure that produced رضا's un-givable Paracetamol becomes structural rather than silent. This
document is the specification Claude Code builds from.*
