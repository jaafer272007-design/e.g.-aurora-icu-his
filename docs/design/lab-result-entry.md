<!-- Recorded verbatim from the project owner's build instruction of 2026-07-13
     (the Lab Result-Entry (Documentation) design, provided as the build
     blueprint). Clinical source: the project's clinical validator (ICU
     physician). This file is the permanent versioned artifact for the Lab
     Result-Entry specification — per the project rule that specs never live
     only in memory or conversation. The manual documentation path is BUILT
     from this design (see 02_PROJECT_STATUS "Lab Result-Entry (Documentation)
     path (built)"); §8's deferred items (LIS integration, ABG analyzer
     auto-feed, coded analyte identity) are recorded as future items and NOT
     built. The RBAC reconciliation open item (§10.1) was resolved by the
     project owner with a NEW results.document permission atom (Nurse + Doctor
     + SeniorDoctor), keeping results.create as the producing-service/LIS
     authority. Changes are new versions recorded with their source. -->

# Lab Result-Entry (Documentation) Path — Design Document

**Status:** DESIGN — for approval, then hand to Claude Code as the build blueprint.
**Clinical source:** Jaafer Aljanabi (ICU physician, project clinical validator).
**Origin:** the data-source assessment for the future Clinical Scoring Engine found the lab
*store* is complete (structured analytes incl. PaO₂, ref ranges, order→result linkage,
acknowledge lifecycle) but there is **no human feed** — results reach Aurora only via the
`results.create` API endpoint, exercised today only by the E2E suite. This builds the
missing human path: a way for lab results to actually *enter* the system.

---

## 0. The real-world workflow this reflects (validator's operational reality)

**Most of the hospital is not electronic.** Central lab results do NOT flow electronically
into the ICU. The actual workflow: the **central lab runs the tests → prints results on
paper → the paper comes to the ICU → the ICU staff (nurse/doctor) documents/transcribes
those results into Aurora.** Bedside point-of-care tests (ABG on the unit's blood gas
analyzer) are entered by the bedside team directly.

So this is a **manual documentation/transcription** interface — it reflects the paper-based
reality (the ICU documents what arrives), NOT a pretend electronic lab feed. This honesty
about the real workflow is the point.

**There IS a LIS** (Laboratory Information System) as a **separate system**. Integrating it
with Aurora is a **FUTURE** possibility — the automated feed that would *replace* manual
transcription. This is exactly the **Scenario C Integration Layer**: the LIS is one of the
external systems Aurora integrates with "when required." Same "manual now, integrate later"
pattern as the ventilator Device Adapter — build the manual path, make it integration-ready,
add the automated feed later without changing the core.

---

## 1. What we are building

A **manual lab-result-entry (documentation) screen** where a **nurse or doctor** documents
lab results into the existing lab-results store. It serves both:
- **Central-lab results** that arrive on paper (transcribing the paper report: CBC,
  chemistry, coagulation, etc.), and
- **Bedside results** done on the unit's device (ABG — pH/PaO₂/PaCO₂/HCO₃ — from the blood
  gas analyzer).

This is an **entry screen over an existing, complete store** — the same shape as the
Stage 11 `/observations` entry screen was a UI over the observation store. The store,
analyte definitions, ref ranges, order linkage, and acknowledge lifecycle already exist and
are NOT rebuilt; we are adding the *human entry path*.

---

## 2. WHO enters (Q1 — validator's decision)

- **Nurse or doctor** — the ICU bedside team documents results (both transcribing paper
  central-lab reports AND entering bedside ABG). **Not a separate lab-technician role** —
  because in this hospital the ICU documents the results (the hospital is paper-based; there
  is no lab-side electronic entry).
- Note the existing `results.create` is an "Ancillary producing-service" permission with no
  UI. Reconcile with the real workflow: the entry capability must be available to the
  nurse/doctor profiles who actually do this documentation. **Claude Code: verify the
  existing `results.create` permission and how it maps to profiles, and wire the entry
  screen to the profile(s) that document results per this decision — flag if the existing
  permission model conflicts, don't silently repurpose it.**
- **Viewing/acknowledging results already exists** (the LabImaging screen displays and
  acknowledges) and is unchanged — this design adds *entry*, not a new view.

---

## 3. WHAT the entry flow is (Q2 — validator confirmed: per-panel)

Per-panel entry (matches how labs actually report — a panel at a time):
1. Select the **patient** (and encounter) — via the canonical identity resolver.
2. Select the **test/panel** from the lab catalogue (CBC, ABG, Renal, Liver, Coagulation,
   Electrolytes, Lactate).
3. Enter the **value for each analyte** in that panel (e.g. ABG → pH, PaO₂, PaCO₂, HCO₃),
   validated against the catalogue's unit + reference range (flagging out-of-range per the
   existing Flag mechanism).
4. **Submit** → stored as a lab result in the existing structured store (`LabDrawRow` /
   `Items` {Analyte, Value, Unit, RefRange, Flag}), encounter-scoped, via the existing
   creation path.

Works identically for central-lab panels (transcribed from paper) and bedside panels (ABG
from the analyzer).

---

## 4. ORDER LINKAGE (Q3 — validator's decision: BOTH)

A result can be entered:
- **Against an existing lab order** (a doctor ordered CBC → the nurse/doctor documents the
  result, fulfilling the order — using the existing order→result linkage), OR
- **Standalone** (a result documented without a prior order).

Both paths supported. When fulfilling an order, use the existing linkage; when standalone,
create the result without an order reference.

---

## 5. PROVENANCE / HONESTY (Q4 — validator agreed)

- **Capture who documented the result and when** — like observations capture the recorder.
  The record shows e.g. "Creatinine 2.1 mg/dL documented by Dr. X at 14:00." Server-owned
  provenance (the documenting clinician from the token, the entry time server-stamped) —
  the client cannot claim these.
- **Source = manual entry.** The result carries a source indicating manual documentation,
  so that **when LIS integration arrives, LIS-fed results are distinguishable from
  manually-transcribed ones** — the same source-provenance idea as the observation model
  (manual/device/hybrid). This is what makes the LIS integration a clean future addition:
  it becomes a second *source* of the same lab-result object, not a rebuild.
- Honest-data discipline throughout — a documented result reflects exactly what was on the
  paper/device; nothing fabricated.

---

## 6. ABG / POC placement (Q5 — validator agreed)

- **ABG is entered through THIS lab-entry screen** — it's a lab panel (pH, PaO₂, PaCO₂,
  HCO₃) in the ABG catalogue test, entered by the bedside team from the blood gas analyzer
  (or transcribed). So SOFA's PaO₂ input enters via this path.
- **Distinction preserved (consistent with the Stage 11 POC/LIS boundary):** capillary
  glucose and POC lactate are already *observations* (Stage 11, bedside, nurse-entered).
  ABG (with PaO₂) is a *lab* (ABG panel), entered via this lab screen. The POC-observations
  vs lab-results boundary the validator drew in Stage 11 holds — this screen is for
  *lab results* (incl. ABG); POC glucose/lactate stay observations.

---

## 7. Why this matters beyond SOFA
This is a **real HIS capability gap**, not merely a SOFA prerequisite: Aurora could *display*
lab results but had **no human way to enter them**. Building the documentation path fills
that hole for the whole system, and it unblocks ALL lab-based SOFA inputs at once (platelets,
creatinine, bilirubin, PaO₂) by giving them a real feed. It is bounded (entry UI over an
existing store) and follows the proven `/observations` entry-screen pattern.

---

## 8. Scope (in vs. deferred)
**In scope:**
- The manual lab-result-entry (documentation) screen for nurse/doctor: per-panel entry,
  catalogue-validated, order-linked-or-standalone, with documenting-clinician + time
  provenance and source=manual.
- Wiring to the existing lab-results store (no store rebuild) and the existing order→result
  linkage.
- Appropriate RBAC (the profiles that document results), reconciled with the existing
  `results.create` permission.

**Deferred (recorded, NOT built now):**
- **LIS integration** — the future automated feed (Scenario C Integration Layer) that
  replaces manual transcription; LIS-fed results become a second *source* of the same
  lab-result object (source-provenance already built for it here). Record in `02` under the
  Integration Layer / Known Feature Gaps.
- **Analyzer/device auto-feed for ABG** — like the ventilator Device Adapter, a future
  automated feed from the bedside blood gas analyzer (manual entry now).
- **Coded analyte identity (LOINC-style)** — analytes are display strings today; a coded
  system is worth settling later (flagged by the assessment). Not required for this build,
  but noted.

---

## 9. Build notes / verification
- Entry screen over the EXISTING store — do not rebuild the lab-results domain; verify the
  existing `LabDrawRow`/`Items` shape, the `results.create` path, and the order→result
  linkage, and build the UI + any needed endpoint wiring onto them. Flag any mismatch
  (like the MAR administration-data verification and the panels.ts source verification)
  rather than assuming.
- Provenance server-owned (documenting clinician + time from the server; source=manual);
  client cannot claim them (same discipline as observations).
- Catalogue-validated entry (unit + ref range + Flag from the existing catalogue).
- Encounter-scoped; honest-data discipline; identity via the canonical resolver.
- Verify: a nurse/doctor can document a panel (e.g. ABG → PaO₂ etc., and a central panel
  like CBC → platelets) against an order and standalone; the result appears in the existing
  results view with correct values, flags, provenance, and source=manual; RBAC correct
  (the documenting profiles can enter; others as appropriate).
- Update `02` (mark the lab result-entry path built; record LIS integration + ABG
  auto-feed + coded-analytes as future items). Draft PR; hands-on rendered verification
  before merge.

---

## 10. Open items (flag, don't silently decide)
1. **RBAC reconciliation (§2)** — the existing `results.create` is an "Ancillary
   producing-service" permission; the real workflow is nurse/doctor documentation. Wire to
   the correct profiles; flag if the existing permission model needs a conscious change
   rather than silently repurposing it.
2. Coded analyte identity (LOINC-style) vs display-string matching — deferred, but note it
   affects any future scoring join.

---

*End of Lab Result-Entry (Documentation) design. Reflects the real paper-based workflow —
the ICU documents lab results — with LIS integration as the future automated feed (Scenario
C). This document is the specification Claude Code builds from.*
