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
