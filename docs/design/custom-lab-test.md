<!-- Recorded verbatim from the project owner's build instruction of 2026-07-13
     (the Custom / Other Lab Test Entry design, provided as the build
     blueprint). Clinical source: the project's clinical validator (ICU
     physician). This file is the permanent versioned artifact for the Custom
     Lab Test specification — per the project rule that specs never live only
     in memory or conversation. Option A (free-text custom entry) is BUILT
     from this design (see 02_PROJECT_STATUS "Custom / Other Lab Test entry
     (built)"); Option B (permanent catalogue tests with flagging-driving
     ranges) is deliberately DROPPED for safety and NOT built; Option C (LIS
     test-list import) is recorded as a future item (Scenario C integration).
     Changes are new versions recorded with their source. -->

# Custom / Other Lab Test Entry — Design Document

**Status:** DESIGN — for approval, then hand to Claude Code as the build blueprint.
**Clinical source:** Jaafer Aljanabi (ICU physician, project clinical validator).
**Builds on:** PR #76 (the Lab Result-Entry / Documentation path) — this ADDS a custom-test
option to that screen without changing the existing 7 catalogue panels or anything else.

---

## 0. What this is (and what it deliberately is NOT)

The lab-entry screen documents results for the 7 **catalogue** panels (CBC, ABG,
Electrolytes, Renal, Liver, Coagulation, Lactate) — structured, with catalogue-derived
units, reference ranges, and automatic normal/abnormal/critical flagging.

**This feature adds a way to document a test the catalogue does NOT have** — a free-text
"Custom / Other" entry for a one-off / rare test that arrives from the lab (or bedside)
without a matching catalogue panel. It is the honest **escape hatch** for results outside
the fixed catalogue.

**Explicitly IN scope (Option A):** free-text custom test entry.
**Explicitly OUT of scope / dropped (Option B):** adding permanent tests to the shared
catalogue (with reference ranges that drive flagging). Dropped by the validator's decision —
it carries a real safety risk (a hand-set reference range applies to everyone's results
silently; a wrong range mis-flags for all patients). Not built.
**Deferred, designed-for (Option C):** importing tests from the LIS test list — a FUTURE
piece, part of the LIS integration (Scenario C Integration Layer). Not built now; noted so
the design doesn't preclude it (LIS-sourced test definitions become a future source, the
same "manual now, integrate later" pattern as lab-result source and observation source).

---

## 1. The core principle — custom tests are UNSTRUCTURED and UNFLAGGED (honest data)

A custom test has **no catalogue definition**, so the system does **not know what is normal
for it** and therefore does **NOT flag it** normal/abnormal/critical. It records exactly
what the clinician typed, without interpreting it. This is the honest-data discipline: the
system never fabricates a clinical judgment (a flag) it cannot justify.

Consequently a custom result must be **visually distinct** from the structured catalogue
results in the Results on File list — clearly tagged "custom" (not carrying a
normal/abnormal/critical flag), so no reader mistakes an un-interpreted custom result for a
properly-flagged structured one.

---

## 2. The entry (Option A)

- **A new "Custom / Other" tab** alongside the 7 catalogue panel chips (CBC, ABG, …). An 8th
  option on the same lab-entry screen.
- **Who:** **Doctor + Nurse** (the same `results.document` bedside-team authority as the
  structured documentation path). Low-risk because the data is unstructured — it only
  records what the clinician typed and does not affect any other patient's data or any
  shared definition. (This is unlike Option B, which is why B was restricted-then-dropped
  and A is fine for doctor+nurse.)
- **Fields:**
  - **Test name** — free text, **required** (e.g. "Procalcitonin", "Ammonia", "Serum
    osmolality").
  - **Result value** — free text, **required** (numeric like "2.5", or descriptive like
    "positive" — free text, because a custom test may not be numeric).
  - **Unit** — free text, **optional** (e.g. "ng/mL").
  - **Reference range** — free text, **optional, DISPLAY-ONLY** (e.g. "0.5–2.0"). It is
    shown next to the result for the reader's context, but it **does NOT drive automatic
    flagging** — the clinician interprets the value against it with their own judgment.
    (This is the safety choice: a hand-typed range on a one-off entry must not produce an
    authoritative-looking auto-flag that could be silently wrong.)
  - **Note** — free text, **optional** (like the existing panels).
- **Provenance (same as structured entries):** server-stamps the documenting clinician +
  time; `source = manual`. Client cannot claim provenance (same discipline as the structured
  path). Encounter-scoped.

---

## 3. How it displays (Results on File)

- Appears in the **same "Results on File" list** as all other results, newest-first, but
  **tagged "custom"** — NOT tagged normal/abnormal/critical (there is no range to flag
  against).
- Shows: **test name, result value, unit (if given), reference range (if given, marked as
  reference/context), the "custom" tag, "manual" badge, and "documented by X at time".**
- The reference range, when present, is shown as *context* (e.g. "ref: 0.5–2.0") — visibly
  informational, not a computed flag.
- Consistent with the existing list's provenance display; visually distinct enough that a
  custom result is never confused with a structured, flagged one.

---

## 4. What is NOT changed
- The 7 catalogue panels, their structured entry, catalogue-derived units/ranges, and
  automatic flagging — **unchanged.**
- The existing lab-results store, the `results.document` / `results.create` split (PR #76),
  the order→result linkage, the acknowledge lifecycle — **unchanged.**
- No catalogue management, no reference-range definitions that drive flagging (Option B is
  NOT built).

---

## 5. Scope
**In scope (build now):**
- The "Custom / Other" tab on the lab-entry screen: free-text test name + value + optional
  unit + optional display-only reference range + optional note.
- Doctor + nurse (`results.document`); server-owned provenance; source=manual;
  encounter-scoped.
- Stored as an **unstructured / custom** lab result (no catalogue link, no flag), and shown
  in Results on File tagged "custom".

**Deferred / not built:**
- **Option B** — adding permanent catalogue tests with flagging-driving reference ranges.
  Dropped (safety).
- **Option C** — LIS test-list import (future, Scenario C integration). Record in `02` as a
  future item; the custom-result model does not preclude it.

---

## 6. Build notes / verification
- Build ONTO the existing PR #76 lab-entry screen and lab-results store — do not rebuild
  either. **Verify the existing store shape and how a result is persisted, and add the
  custom/unstructured path onto it** (a custom result needs to be storable without a
  catalogue analyte definition — e.g. a flag/marker that this is a custom entry, name/value/
  unit/range/note carried as entered). Flag if the existing store can't cleanly hold an
  unstructured result rather than forcing it.
- **No flagging on custom results** — the system must not compute normal/abnormal/critical
  for a custom test; the reference range is display-only text.
- Provenance server-owned (documenting clinician + time; source=manual); client cannot
  claim it.
- Encounter-scoped; honest-data discipline; identity via the canonical resolver.
- Visually distinguish custom results from structured ones in Results on File (tagged
  "custom", no clinical flag).
- Verify: a doctor and a nurse can document a custom test (name + value, with and without
  unit/range/note); it stores with source=manual + provenance; it appears in Results on
  File tagged "custom" with NO normal/abnormal/critical flag; the reference range (if given)
  shows as context only; the 7 catalogue panels and all existing behaviour are unchanged
  (byte-parity where applicable); RBAC correct (doctor+nurse can; others as appropriate).
- Update `02` (record the custom-test entry built; record LIS test-import as a future item).
  Draft PR; hands-on rendered verification before merge.

---

## 7. Open items (flag, don't silently decide)
1. Storage shape for an unstructured result (§6) — confirm the existing store can hold a
   custom/no-catalogue result cleanly; flag if it needs a small additive change.
2. Option C (LIS test import) — deferred; recorded so the model stays LIS-ready.

---

*End of Custom / Other Lab Test Entry design. Adds an honest free-text escape hatch for
tests outside the catalogue — unstructured, unflagged, display-only reference range — onto
the existing lab-entry screen, without changing the catalogue or its flagging. Option B
(catalogue-test definitions) deliberately dropped for safety; Option C (LIS import) deferred
as a future integration. This document is the specification Claude Code builds from.*
