<!-- Recorded verbatim from the project owner's instruction of 2026-07-12
     (the updated design with the F1/F2/F3 RBAC decisions baked in).
     Clinical source: the project's clinical validator (ICU physician).
     This file is the permanent versioned artifact for the Stage 11
     specification — per the project rule that specs never live only in
     memory or conversation. Changes are new versions recorded here with
     their source. -->

# Stage 11 — Observation Model: Design Document

**Status:** DESIGN — for approval, then hand to Claude Code as the build blueprint.
**Clinical source:** Jaafer Aljanabi (ICU physician, project clinical validator).
**Supersedes:** the fragment ("Build the Observation model so that Manual entry
works fully today, AND so that a Device source can be added later WITHOUT changing
the model") that produced draft PR #67. That one sentence is **one pillar of this
design, not the design.** PR #67 is not to be merged as-is; it is reworked to match
this document (salvageable engineering noted in §9).

---

## 0. Why this document exists

Stage 11 is the largest remaining architectural piece and it is the **clinical core**
of Aurora — how bedside observations are recorded. It was partially built (PR #67) from
a fragment before the design was finished, and the result is missing 6 of 8 clinical
categories and 2 of 3 architectural pillars. This document is the complete design, so
Stage 11 is built **once, correctly, from the clinician's specification** — not from a
guess. Nothing here is invented: the clinical model is the validator's; the engineering
pillars extend principles already proven in Aurora (data-driven catalogues; Core
independence; supersede-don't-erase auditing).

---

## 1. The clinical model — WHAT gets charted (validator's taxonomy, verbatim)

Observations are **individual clinical observations grouped into logical categories.**
The model must support manual entry today and a seamless transition to device-generated
observations **without changing the clinical data model.**

**1. Vital Signs** — Heart Rate (HR); Systolic BP; Diastolic BP; Mean Arterial Pressure
(MAP); Respiratory Rate (RR); Oxygen Saturation (SpO₂); Body Temperature; Cardiac Rhythm
(optional).

**2. Neurological Assessment** — Glasgow Coma Scale (Eye, Verbal, Motor + Total); RASS
Sedation Score; Pain Score (NRS or appropriate scale); Pupils (size and light reaction).

**3. Respiratory / Ventilator** — Ventilation Mode; FiO₂; PEEP; Set Respiratory Rate;
Measured Respiratory Rate; Tidal Volume (Set / Exhaled); Peak Airway Pressure (Ppeak);
Plateau Pressure (Pplat); Driving Pressure (**derived** if available); Minute Ventilation;
I:E Ratio.

**4. Hemodynamics** — CVP; Arterial Line Pressure; Pulmonary Artery Pressure (if
applicable); Cardiac Output / Cardiac Index (if monitored); SVR (if available).

**5. Fluid Balance** — Urine Output; Drain Output; NG Output; Stool Output (when
clinically relevant); Oral Intake; IV Fluids; Blood Products; Total Input (**derived**);
Total Output (**derived**); Net Balance (**derived**).

**6. Laboratory Point-of-Care Observations** — Capillary Blood Glucose; Lactate (POC if
applicable). *(Laboratory results from the LIS remain laboratory data, NOT manually
charted observations — a hard boundary.)*

**7. Devices** — Infusion pump rates (device-displayed later); ECMO parameters (**future**);
CRRT parameters (**future**); ICP monitoring (**future**).

**8. Nursing Clinical Assessment** — Skin integrity / Pressure-injury assessment; Lines
and catheter assessment; Endotracheal tube position; Airway secretion assessment;
Restraint assessment (where applicable).

### Clinical principle (drives §4 configurability)
Not every ICU uses every observation type. The model must support **optional observation
types, configurable hospital-specific templates, and future expansion without database
redesign.** Hospitals enable/disable observation **groups** per local practice. This lets
one consistent clinical data model serve different ICUs (cardiac / general / neuro).

**Notes carried from the taxonomy that the build must honor:**
- **Derived values are computed, never stored as primary entries:** Driving Pressure,
  Total Input, Total Output, Net Balance. (Store the inputs; compute the derived value
  at read/render.)
- **Set-vs-measured distinctions are real and separate observations:** Set RR vs Measured
  RR; Tidal Volume Set vs Exhaled. Do not collapse them.
- **Optional/conditional markers** ("optional", "if applicable", "if monitored", "when
  clinically relevant", "where applicable") map to configurability (§4) — the type exists
  in the catalogue and a deployment enables it or not.
- **POC vs LIS boundary:** only capillary glucose and POC lactate are observations; all
  LIS-resulted labs stay in the existing Labs domain.

---

## 2. Pillar 1 — Source-agnostic model (Manual now, Device-ready)

The shape of an Observation is **identical** whether a clinician typed it (Manual, today)
or a device fed it (Device / Hybrid, later). The clinical data is the same; the only
difference is the `source` field.

- **Today:** the only producer is Manual entry. It must work **fully** — this is what
  makes Aurora usable in the ICU now (it replaces the simulated bedside data — see §5).
- **Later:** a **Device Adapter** becomes a *second producer* of the *same* Observation
  object. Adding it changes **no** clinical field and **no** table shape — it is a new
  caller of the same Observation Service (§5).
- **Provenance is server-owned.** The manual endpoint stamps `source = 'manual'` and the
  recording actor server-side. A client payload that tries to *claim* `source`,
  `deviceId`, `unit`, `verifiedBy`, `recordedBy`, or any correction-actor field is
  rejected (400). (PR #67 implemented this correctly — keep it.)

`source ∈ { manual, device, hybrid }`. `hybrid` = a device value a clinician confirmed
(defined now, produced later). Device-era fields (`source`, `deviceId`, `verifiedBy`)
exist in the schema from day one so the later adapter needs no migration.

---

## 3. Pillar 2 — Configurable / data-driven observation types

**This is the pillar PR #67 got backwards** (it built a *closed server-side vocabulary* —
the opposite of configurable). The build must be data-driven.

### Mechanism (mirrors Aurora's existing Formulary / Lab Catalogue)
- An **Observation Type Catalogue** — a data table, owned/configured like the Formulary
  and Lab Catalogue already are. Each entry defines one observation type:
  `{ typeCode, category/group, displayName, unit, valueType (numeric | enum | compound),
  validRange or allowedValues, isDerived, derivationInputs, optionalFlags... }`.
  - Example enum type: Cardiac Rhythm (allowed values), Pupil reaction.
  - Example compound type: GCS (Eye + Verbal + Motor, Total derived).
  - Example derived type: Driving Pressure (`derivationInputs = [Pplat, PEEP]`),
    Net Balance (`derivationInputs = [TotalInput, TotalOutput]`).
- **Groups/categories are data** (the 8 categories are catalogue groupings, not code).
- **A deployment/unit configuration layer** records which groups/types are **enabled** for
  this hospital (and, if desired, per unit). Turning Neuro on or ECMO off is a
  **configuration change, not a migration.**

### The consequence for the Observation record (critical)
The Observation table is **generic**. One Observation row is:

```
Observation {
  observationId
  patientId, encounterId           # scoping (see §6)
  typeCode                         # → references the Observation Type Catalogue
  value                            # the charted value (numeric/enum/compound payload)
  unit                             # server-derived from the catalogue, not client-supplied
  clinicalTime                     # measurement time (see §7)
  source                           # manual | device | hybrid  (server-stamped)
  deviceId                         # null for manual; set by the future adapter
  recordedBy                       # the charting clinician (server-stamped)
  enteredAt                        # system timestamp of entry (audit; see §7)
  # correction/amendment audit — see §8
  amendments[] { previousValue, newValue, amendedBy, amendedAt, reason, amenderRole }
}
```

It is **NOT** a fixed table with a column per vital (HR column, PEEP column, …). It stores
`(typeCode → value)` against the catalogue. **This is the whole difference between
configurable (required) and #67's closed vocabulary — and it is a different database
design, which is why #67 must be reworked, not tweaked.**

Adding a new observation type later = **a new catalogue entry (data)**. No schema change,
ever, to expand the clinical vocabulary. This is what makes Aurora a product, not a
one-hospital tool, and it directly delivers the validator's Clinical Principle (§1).

### Catalogue management authority (F3 — DECISION CONFIRMED)
- **v1 scope:** the Observation Type Catalogue ships **seeded from §1 and read-only** —
  **no catalogue-management UI in Stage 11** (deferred complexity avoided). What exists is
  the standard clinical set; a hospital does not edit type definitions on day one.
- **Live in v1:** only **group enable/disable** (which of the 8 categories this deployment
  charts). This is the minimal configurability that delivers the validator's Clinical
  Principle without a full admin console.
- **Who holds group-enablement:** the same **Consultant-tier / senior-clinical authority**
  as F2 (§4) — a clinical-governance decision ("what does our ICU chart"), **NOT** the
  office Administrator profile. (Parallels how Formulary is owned by Pharmacy and Lab
  Catalogue by Laboratory — a specialized authority, never office admin.)
- **Deferred to v2:** a catalogue-management UI (adding/editing type definitions), and
  per-unit (vs per-hospital) enablement granularity.

---

## 4. WHO charts, and WHO corrects (RBAC) — DECISIONS CONFIRMED

These three points were flagged by Claude Code against the real RBAC model (findings
F1/F2/F3) and **decided by the clinical validator.** They are settled, not open.

- **Charting (create an observation) — `observations.record`:** the **Doctor profile
  AND the Nurse profile** (F1 → option a). Any doctor or nurse may chart. **No junior/
  senior Doctor-profile split** — the existing three-layer model has one Doctor profile
  (Consultant→Intern) and it is NOT changed for Stage 11. Rationale: there is no clinical
  harm in a senior doctor also charting; blocking it would add RBAC machinery to prevent
  a non-problem.
- **Correcting (tier-2, after the self-window or on another's entry) —
  `observations.correct`:** a **Consultant-tier / senior-clinical authority** (F2).
  **NOT the general Administrator profile** — that profile includes Receptionist, Billing
  Officer, and Medical Records Officer, and those non-clinical office roles must **never**
  be able to amend a clinical observation. Correcting the clinical record is a clinical
  act and requires clinical seniority. Correction is a **distinct permission** from
  charting.
- **Read:** profiles without `observations.record` see the observations **read-only**
  (view the chart; cannot enter or edit).

**Hard constraint (F2 + F3):** no permission that touches clinical observations —
charting, correcting, or catalogue/enablement management — may be granted to the office
Administrator profile (Receptionist / Billing / Medical Records). Clinical data and
clinical configuration are clinically governed.

---

## 5. Pipeline + the `panels.ts` transition (the engineering half)

### The pipeline (source-agnostic by construction)
```
   Producers                     Service (single choke point)        Store
 ┌──────────────┐
 │ Manual entry │ ─────┐
 │  (today)     │      │
 └──────────────┘      │        ┌───────────────────────┐      ┌──────────────────┐
                       ├──────▶ │  Observation Service   │ ───▶ │  Clinical Store   │
 ┌──────────────┐      │        │  - validates against   │      │  (Observation     │
 │ Device       │ ─────┘        │    the Type Catalogue  │      │   table, generic) │
 │ Adapter      │               │  - server-stamps       │      └──────────────────┘
 │ (LATER)      │               │    provenance/actor    │
 └──────────────┘               │  - enforces encounter  │
                                │    scope + corrections │
                                └───────────────────────┘
```
- **Every** producer goes through the **Observation Service**. Manual is producer #1
  today; the Device Adapter is producer #2 later. Same service, same validation, same
  store. This is what makes "add a device without changing the model" literally true.
- The Service is where catalogue-validation, provenance-stamping, encounter-scope
  enforcement (§6), and the correction rules (§8) live — once, server-side.

### The `panels.ts` transition (the trickiest part — do it safely)
Today the ICU Mission Control bedside columns (the live-monitor screen: vitals, NIBP,
ventilator, hemodynamics tiles) render from **`panels.ts` — simulated/mock data.** For a
real admitted patient these read as zeros; there is no real data because there is no real
producer. Stage 11's job is to make that display read **real charted Observations**
without breaking the screen.

**Approach — read-swap behind a stable shape, not a rewrite of the display:**
1. **Do not touch the Mission Control display components in the same step that introduces
   Observations.** (PR #67 correctly left `panels.ts` untouched — keep that discipline.)
2. Introduce a **read projection**: a function that produces the *same shape the bedside
   tiles already consume*, but sourced from the latest Observations per type for the
   patient instead of from `panels.ts`. The display keeps rendering the same shape; only
   the source behind it changes.
3. **Cut over the source, honestly:** where a real Observation exists for a type, the tile
   shows it (with its clinical time and source). Where none exists yet, the tile shows an
   **honest empty state** ("— / not charted"), **never a fabricated or simulated number.**
   This is the honest-data discipline applied to the monitor: a bedside value with no real
   observation is blank, not invented.
4. **Retire `panels.ts` as a data source** once the projection is proven — the simulated
   bedside stream should be **compiled out of production** the same way the mock/demo layer
   is (sourcemap-inventory proof it's absent from production bundles), so a real deployment
   can never show simulated vitals. (In dev, a clearly-labelled simulator may remain for
   demos, gated like other dev-only mocks.)
5. **Verify byte-parity** on every existing screen and endpoint that is *not* the bedside
   tiles — Stage 11 adds observations; it must not alter unrelated behavior.

**Net:** the display the user already saw keeps working; its numbers become real (or
honestly blank); the fake source is removed from production; and when devices arrive they
feed the *same* Observations the manual entry does, so the same tiles light up from
devices with no further display change.

---

## 6. Encounter scope & lifecycle (consistent with existing Aurora rules)

Observations are **encounter-scoped**, like orders and labs.
- **Charting on an OPEN encounter:** allowed.
- **Charting on a CLOSED (discharged) encounter:** **409** — you cannot initiate new
  bedside care on a closed encounter (the same precedent as orders/results:
  409 = "there, but not like that").
- **Correcting an observation after discharge:** **200** — completing/correcting the
  record of care that happened is legitimate (admin-tier per §8). Distinguish *new
  charting* (blocked on closed) from *correcting an existing entry* (allowed, audited).

*(PR #67 implemented this open/closed 409-vs-200 distinction correctly — keep it.)*

---

## 7. Time semantics

- **Clinical time = measurement time.** The `clinicalTime` on an Observation is when the
  reading was taken, and it is the clinically meaningful time used on flowsheets/prints.
- **Live charting, no back-dating by bedside clinicians.** Nurses/junior doctors chart at
  current time; they cannot stamp an observation for an arbitrary earlier time. (Charting
  is at/near the bedside in real time, so measurement-time and entry-time align closely.)
- **`enteredAt` is recorded separately** as the system timestamp, for audit — so the
  record can always show "charted at HH:mm (entered HH:mm) by X."
- **Immutable once charted** by bedside clinicians — the record cannot be silently altered;
  every change is an audited amendment (§8). ("Immutable" = no silent alteration; the
  original is always preserved.)
- **Time display convention** matches the Print Center: `HH:mm` for today, `D-n HH:mm`
  for prior days; calendar dates remain the recorded open question, interpreted against
  the admission date on multi-day documents.

---

## 8. Correction / amendment model (supersede-don't-erase — Aurora-wide discipline)

Two tiers, **both audited, both preserve the original** (amend, never overwrite):

**Tier 1 — Self-correction (bedside clinician, short window):**
- A nurse or junior doctor may amend **their own** observation within **5 minutes** of
  charting it (the fat-finger fix — e.g. HR 210 → 120).
- **Per-observation:** the 5-minute clock starts when *that* observation was charted.
- **Flat 5 minutes, always audited, regardless of whether the value was already used.**
  No early-close-on-use complexity — the audit trail covers the "was it acted upon" case.

**Tier 2 — Senior-clinical correction (after the window, or anyone else's entry):**
- After 5 minutes, or to correct **another** clinician's entry, correction requires
  `observations.correct`, held by a **Consultant-tier / senior-clinical authority**
  (F2 decision, §4). **NOT** the office Administrator profile (Receptionist / Billing /
  Medical Records) — those roles must never amend a clinical observation. (Where this
  document earlier said "admin," read: senior-clinical authority, per the F2 decision.)

**Both tiers, mandatory properties:**
- **Amend, not erase.** The record preserves the original value; the correction is layered
  on top: `{ previousValue, newValue, amendedBy, amendedAt, reason, amenderRole }`.
- **Actor is always recorded.** This **fixes the gap PR #67 flagged** ("no `overrideBy`
  field, actor not on the record"). Every correction — self or admin — records who made
  it. The schema MUST carry the amender/corrector actor.
- **Reason required** for corrections (at least for admin-tier; recommended for self-tier
  too).

*(PR #67 has an "override with required reason that preserves the original" — the
amend-not-erase spirit is right and salvageable; but it is available to
`observations.record` holders with no window and no recorded actor. Rework to: self-tier
= own entry + 5-min window + recorded actor; admin-tier = thereafter/others + recorded
actor. Add the corrector-actor field.)*

---

## 9. What to do with PR #67 (rework map)

**KEEP (correct engineering, do not rebuild):**
- Source-agnostic fields present now (`source`, `deviceId`, `verifiedBy`) and device as a
  future second caller of one service (Pillar 1).
- Server-owned provenance; payloads claiming provenance/actor → 400 (proven at set and
  entry level).
- Encounter semantics: charting on closed → 409; correcting after discharge → 200 (§6).
- Atomic write of a charted set: a mixed valid+invalid set writes **nothing** (all-or-
  nothing validation).
- Byte-parity harness and production-bundle-absence proof approach.

**CHANGE (shape is wrong vs this design):**
- **Closed server-side vocabulary → data-driven Observation Type Catalogue** + generic
  `(typeCode → value)` record + per-hospital group enable/disable (Pillar 2, §3). This is
  the big one; it changes the DB design.
- **~2 categories → all 8** clinical categories from §1 (add Neuro, Fluid Balance, POC
  labs, Nursing Assessment; complete Ventilator/Hemodynamics fields), with derived values
  computed (§1 notes) and set-vs-measured kept separate.
- **Corrections available to any recorder → the two-tier model (§8):** 5-min self-correct
  (own entry, recorded actor) + admin-only thereafter, both amend-not-erase.
- **Add the corrector/amender actor field** (the `overrideBy` gap #67 itself flagged).

**PRESERVE (correct restraint):**
- `panels.ts` and existing bedside display left untouched in the model-introduction step;
  the read-swap (§5) is its own carefully-verified step.

---

## 10. Scope of Stage 11 (in vs. deferred)

**In scope (Stage 11 now):**
- The generic, configurable Observation model + Type Catalogue + per-hospital enablement.
- **Manual entry, fully working**, for the enabled set — both entry modes (§ below).
- The Observation Service + Clinical Store; encounter scoping; time semantics; the
  two-tier audited correction model.
- The `/observations` entry+chart screen (grouped entry form; chart/flowsheet read view;
  read-only without the permission).
- The `panels.ts` read-swap so Mission Control bedside tiles show **real or honestly-blank**
  values (fake source removed from production).

**Entry modes (both, §ex):** a **timed round** (a set of observations sharing one
`clinicalTime`, entered together) **and** individual **ad-hoc** entries (a single
observation). Same atomic model; a round is just many observations sharing a timepoint.

**Deferred (explicitly NOT Stage 11 now):**
- **Device integration** — the Device Adapter (producer #2). Model is built ready for it;
  the adapter itself is a later phase (hardware/protocol work).
- **Device-only categories** — ECMO, CRRT, ICP parameters (future, per §1).
- **The 3 Stage-11-dependent Print templates** (MAR, Vital Signs / Observation Flowsheet,
  Ventilator & Device Report) — these consume Observations, so they are built **after** the
  model exists, as a following step (already recorded in the Print Center Contract as
  Stage-11-deferred).

---

## 11. Decisions & remaining open questions

**DECIDED by the clinical validator (F1/F2/F3 — see §4, §3, §8):**
- **F1 — who charts:** Doctor profile + Nurse profile (no junior/senior split).
- **F2 — who corrects (tier-2):** Consultant-tier / senior-clinical authority; NOT the
  office Administrator profile.
- **F3 — catalogue management:** v1 = seeded read-only catalogue + permissioned group
  enable/disable held by the same Consultant-tier authority; no management UI in v1.

**Still open (flag, don't silently decide):**
1. Reason-required on **self-tier (5-min)** corrections (definitely required on the
   Consultant-tier correction) — recommend yes, lightweight.
2. Calendar-date handling for `clinicalTime` — the existing recorded open question
   (dates not in the charted record); Stage 11 inherits the Print Center convention, does
   not resolve it here.
3. Per-unit (not just per-hospital) enablement granularity — per-hospital for v1,
   per-unit deferred to v2 (§3).

---

## 12. Build sequencing (after this design is approved)
1. **Model + Catalogue + config** (the generic Observation table, Type Catalogue, group
   enablement) — the foundation Pillar 2 requires.
2. **Observation Service + Manual endpoint** (validation, provenance, encounter scope,
   corrections) — Pillar 1 producer #1.
3. **`/observations` screen** (grouped entry: timed round + ad-hoc; chart read view;
   read-only without permission; RBAC per §4).
4. **`panels.ts` read-swap** (§5) — its own step, byte-parity + production-absence proof.
5. **Then** (separate, following work): the 3 Stage-11 print templates; and, later still,
   the Device Adapter.

Each as its own draft PR on the proven method; hands-on rendered verification before merge.

---

*End of Stage 11 Observation Model design. This document — not any single sentence from
it — is the specification Claude Code builds from.*

---

*[Build-time note, recorded with the design (2026-07-12, from the pre-build
verification report the owner acknowledged): §5's description of the bedside
tiles was written without repo access and names one fake source; the verified
code has TWO — the server-side roster bedside-snapshot table
(`MonitorVitalsJson`, which serves the vitals/NIBP monitor tiles and returns
honest zeros for fresh real patients) and the frontend `panels.ts` module
(ventilator/hemodynamics/infusions/alerts/goals, identical for every
patient). The §12 step-4 read-swap therefore replaces BOTH sources; §5's
intent (real-or-honestly-blank, fake sources absent from production) applies
to both. In production TODAY neither fake source can reach a screen
(panels.ts is already compiled out; the Mission Control detail read's
production arm refuses) — the read-swap makes Mission Control WORK in
production rather than removing a live hazard.]*

---

## Step-4 build decisions (the owner/clinical validator, 2026-07-13 — recorded verbatim)

*The pre-build verification of §12 step 4 surfaced six findings (F5–F10)
where the real code differed from, or was underspecified by, this design.
The owner decided all six before any step-4 code was written:*

- **F5 → (a):** In the manual era, the bedside display is a **"Latest
  charted observations" card** — real values with clinical time + source
  badge, NO waveforms/jitter/STREAMING. Confirmed intent: the animated
  monitor + STREAMING returns later when the Device Adapter brings
  genuinely streaming data (**presentation tracks the real source**).
- **F6:** **add EtCO₂ as a chartable observation type** (standard for
  ventilated patients); Compliance and SVV optional/deferred — those
  tiles show "— not charted" or are dropped for now. EtCO₂ is a new
  catalogue entry (**data, no schema change**).
- **F7 → confirmed:** arterial sys/dia ← `art_sbp`/`art_dbp`; NIBP ←
  `sbp`/`dbp`; MAP ← the charted `map` (**not recomputed**).
- **F8 → ok for Step 4:** SOFA/EWS/severity/organs/flags/sparkline stay
  as-is (demo rows in staging, synthesized defaults for fresh patients),
  recorded as drift — they are derived scores/views for a later piece,
  NOT part of the bedside read-swap. Fresh-patient rhythm default →
  honestly blank ("—"), not a fabricated "SR" (cardiac_rhythm is
  chartable). A new roadmap item is recorded: **"Derived Clinical Scores
  — compute SOFA, EWS, etc. from charted observations + labs (enabled by
  Stage 11)"**, to be built after Step 4 as its own piece with clinical
  validation of the scoring logic. Score computation is NOT built in
  Step 4.
- **F9 → demo-overridden-by-real:** production is pure real-or-blank (no
  fake bedside data ever); in demo-seeded environments (staging), the
  demo snapshot remains a clearly-labelled fallback, overridden per-type
  by real observations wherever charted.
- **F10 → ok:** production Mission Control stays refused after Step 4
  (its composite still carries mock infusions/alerts/goals); Step 4's
  production-visible surface is the roster/bed board (real-or-blank
  vitals); full MC becomes honest in staging. Recorded: this refusal is
  a **gate that lifts progressively** as those other domains become real
  — not permanent.
