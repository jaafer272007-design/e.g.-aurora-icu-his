<!-- Recorded verbatim from the project owner's build instruction of 2026-07-13
     (the Patient Weight & Height Capture design, provided as the build
     blueprint). Clinical source: Jaafer Aljanabi (ICU physician, the project's
     clinical validator). This file is the permanent versioned artifact for the
     specification — per the project rule that specs never live only in memory
     or conversation. Built from this design (see 02_PROJECT_STATUS "Patient
     Weight & Height Capture (built)"). Open item #1 said "patient/encounter
     record" — the choice was FLAGGED (initially resolved patient-level with
     the encounter-scoped alternative recorded) and the PROJECT OWNER DECIDED
     ENCOUNTER-SCOPED before merge: each admission keeps ITS OWN weight/height
     (a patient re-admitted a year later may genuinely differ), a re-admission
     STARTS FRESH — never inherits, never overwrites a prior admission's
     values — and corrections are audited amend-not-erase WITHIN the
     encounter. DateOfBirth stays person-level identity (age already computes
     at read, correctly per-time). Open item #2 resolved as: units FIXED kg/cm; IBW =
     DEVINE (1974), computed only within its ≥152.4 cm domain; BSA = Mosteller;
     BMI = kg/m². Deferred per §6: serial/daily weight as an observation, and
     the SOFA cardiovascular consumers (structured vasopressor dose + current
     infusion rate). Changes are new versions recorded with their source. -->

# Patient Weight & Height Capture — Design Document

**Status:** DESIGN — for approval, then hand to Claude Code as the build blueprint.
**Clinical source:** Jaafer Aljanabi (ICU physician, project clinical validator).
**Origin:** the Clinical Scoring Engine data-source assessment found **patient weight is
missing entirely** — not on the ADT patient record, not as an observation. It is a real
basic-HIS gap (weight is needed for drug dosing generally) and specifically the missing
input for SOFA's cardiovascular component (vasopressor dosing is µg/kg/min — needs weight).
This captures weight (and height).

---

## 0. The core modelling decision (validator's judgment)

**Weight and height are a PATIENT / ENCOUNTER ATTRIBUTE — captured once — NOT a
charted-over-time observation.** Rationale (validator): **ICU patients are not weighed every
day**, so weight is a stable recorded value, not a daily time-series. (This is unlike vitals,
which are observations charted repeatedly.)

Consequence: there is **no "current vs. daily weight" distinction** to model — it is simply
**the patient's recorded weight** (typically the admission/reference weight), which is what
is used for dosing and for SOFA. So the feature is a patient attribute, not an addition to
the Stage 11 observation model.

---

## 1. What we are building

Capture **weight and height** as attributes on the patient/encounter record:
- **Weight** (e.g. kg) — the reference weight used for dosing and SOFA (µg/kg/min).
- **Height** (e.g. cm) — pairs with weight to enable **BMI, ideal body weight (IBW), and body
  surface area (BSA)** — useful for dosing generally and some scores. (Derived values —
  BMI/IBW/BSA — are computed, not stored, consistent with Aurora's derived-values discipline;
  see §4.)

---

## 2. Where and who (Q3 — validator's decision)

- **Captured at admission** — entered as part of the admission / ADT data when a patient is
  admitted (alongside the other admission fields).
- **AND editable / addable later** — if weight/height was not captured at admission, a
  clinician can **add** it later on the patient record; and an entered value can be **edited**
  (corrected). So it is not locked to admission-time only.
- **Who:** the admitting / bedside clinician — **doctor / nurse**. (Weight/height is routine
  clinical data the bedside team records; not restricted to senior tiers, and not the office
  Administrator profile for the clinical value — though note admission demographics are
  entered by whoever admits; the weight/height clinical fields are doctor/nurse-appropriate.)

---

## 3. Editable / correctable (Q5 — validator's decision)

- Weight and height are **editable / correctable** — because they **drive dosing**, a wrong
  value (a typo — 70 kg vs 07 kg) must be fixable.
- **Amend-not-erase / recorded** — a change to weight/height is recorded (who changed it,
  when, and the prior value), consistent with the project discipline (corrections everywhere
  preserve the original). So the value can be corrected, and the change is traceable — a
  weight that drives dosing should have a traceable history, not a silent overwrite.

---

## 4. Derived values (computed, not stored)
- **BMI**, **ideal body weight (IBW)**, and **body surface area (BSA)** are **computed from
  weight + height at render**, never stored — consistent with Aurora's derived-values
  discipline (like Net Balance, GCS Total). If weight or height is missing, the derived
  values are simply not shown (honest — no fabricated BMI without the inputs).
- These are available for display/dosing use; this build computes them where weight+height
  exist. (Which specific dosing/score consumers use them is separate — this build provides
  the data + derivations.)

---

## 5. Why this matters beyond SOFA
- Weight is **basic HIS data** needed for drug dosing broadly — its absence was a real gap.
- It **unblocks SOFA's cardiovascular component** (µg/kg/min vasopressor dosing needs weight)
  — one of the remaining data-source prerequisites for the Clinical Scoring Engine.
- Height + weight enable BMI/IBW/BSA, useful across dosing and scoring.

---

## 6. Scope
**In scope (build now):**
- Weight and height as patient/encounter attributes: captured at admission, addable/editable
  later on the patient record, by doctor/nurse.
- Editable/correctable with amend-not-erase (recorded change history: who/when/prior value).
- Derived BMI/IBW/BSA computed at render from weight+height (not stored); not shown if inputs
  missing.
- Displayed on the patient record where clinically relevant.

**Deferred / not in scope:**
- **Daily/serial weight tracking** as an observation — explicitly NOT this (validator: ICU
  patients aren't weighed daily; weight is a stable attribute). If serial weights are ever
  wanted, that would be a separate observation-model addition — record as a possible future
  item, not built.
- Wiring weight into specific dosing calculators / the vasopressor-rate SOFA input — this
  build provides the weight data + derivations; the SOFA cardiovascular consumer is built with
  the Scoring Engine later. (Also still-open for SOFA cardiovascular: structured vasopressor
  dose + current infusion rate — separate items.)

---

## 7. Build notes / verification
- Add weight + height to the patient/encounter record (ADT) — verify how the ADT patient
  record is structured and add the fields cleanly; **flag if it needs an additive change to
  the patient/encounter model rather than forcing it.**
- Capture at admission (in the admission flow) AND provide add/edit on the patient record
  later.
- Editable/correctable with recorded change history (who/when/prior value) — amend-not-erase.
- Derived BMI/IBW/BSA computed at render from weight+height; not shown if either input is
  missing (honest-data discipline).
- RBAC: doctor/nurse capture/edit the clinical weight/height; server-side.
- Encounter/patient-scoped; identity via the canonical resolver.
- Verify: weight+height captured at admission appear on the patient record; can be added
  later if omitted at admission; can be edited/corrected with the change recorded (prior value
  preserved); BMI/IBW/BSA compute correctly where both exist and are absent (not fabricated)
  where an input is missing; RBAC correct.
- Update `02` (weight/height capture built; serial-weight-as-observation and the SOFA
  vasopressor-dose/rate inputs recorded as future/separate). Draft PR; hands-on rendered
  verification before merge.

---

## 8. Open items (flag, don't silently decide)
1. Patient/encounter model change to hold weight/height + change history (§7) — confirm it can
   take the fields cleanly; flag if an additive change is needed.
2. Units — weight in kg, height in cm (confirm; support the units the hospital uses). IBW
   formula choice (e.g. Devine) — state which is used.

---

*End of Patient Weight & Height Capture design. Weight and height as patient/encounter
attributes (not daily observations — ICU patients aren't weighed daily), captured at
admission and addable/editable later, correctable with amend-not-erase, enabling BMI/IBW/BSA
(computed not stored) and unblocking SOFA's weight-based dosing. This document is the
specification Claude Code builds from.*
