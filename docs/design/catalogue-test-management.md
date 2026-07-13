<!-- Recorded verbatim from the project owner's build instruction of 2026-07-13
     (the Catalogue Test Management / Option B design, provided as the build
     blueprint). Clinical source: the project's clinical validator (ICU
     physician). This file is the permanent versioned artifact for the Option B
     specification — per the project rule that specs never live only in memory
     or conversation. Built from this design (see 02_PROJECT_STATUS "Catalogue
     Test Management (Option B) (built)"), with ONE flagged reconciliation:
     the design asked for a "new" Consultant-tier labcatalog.manage permission,
     but that atom already existed on the Ancillary (Laboratory) profile with a
     recorded Layer-4 governance decision and a deployed E2E suite — resolved
     ADDITIVELY (SeniorDoctor granted the atom ALONGSIDE Ancillary, consistent
     with §1's "laboratory / clinical staff"); flipping to Consultant-ONLY is a
     recorded alternative, not made silently. Open item #2 resolved as
     flag-at-entry with definition snapshots on each result (the store's
     existing architecture; the design permits either when stated). Deferred:
     multi-analyte panel creation, seeded-critical-threshold backfill, Option C
     LIS import. Changes are new versions recorded with their source. -->

# Catalogue Test Management (Option B) — Design Document

**Status:** DESIGN — for approval, then hand to Claude Code as the build blueprint.
**Clinical source:** Jaafer Aljanabi (ICU physician, project clinical validator).
**History:** Option B was deliberately DEFERRED earlier (it needs governance — a wrong
reference range silently mis-flags results for every patient). The validator has now decided
the governance (Consultant-tier only), so it is built. This is distinct from the
custom/free-text entry (Option A, PR #78), which is unstructured and unflagged; Option B
adds *structured, flagged* tests to the catalogue.

---

## 0. What this is

A way for a **Consultant** to **add and remove tests in the lab catalogue** — extending
Aurora's structured, flagged lab test menu to fit the hospital's actual test list. Unlike a
custom/free-text result (Option A, which is unstructured and never flagged), a catalogue
test added here is **structured**: it has a unit, a reference range, and critical thresholds,
and its results are **automatically flagged** (normal / abnormal / critical) like the 7
seeded panels.

**This is why governance matters and why it is Consultant-only:** a catalogue test's
reference range and critical thresholds **drive flagging for every result of that test, for
every patient, entered by everyone.** A wrong range/threshold silently mis-flags (a dangerous
value shows normal, or vice-versa) and looks authoritative. So defining a catalogue test is a
clinical act with patient-safety weight — restricted to Consultant-tier.

---

## 1. Governance (validator's decision)

- **Add and remove catalogue tests → Consultant-tier / SeniorDoctor ONLY.** A new permission
  (e.g. `labcatalog.manage`) on the SeniorDoctor tier.
- **NOT nurse, NOT non-senior doctor, and explicitly NOT the office Administrator profile**
  (receptionist / billing / medical-records) — consistent with the F2/F3 hard constraint
  that non-clinical office roles never touch clinical data or clinical configuration.
  Setting a reference range is a clinical judgment; it belongs with a senior clinician. (In
  real hospitals reference ranges are owned by the laboratory / clinical staff, never
  reception/billing.)
- Consistent with every prior catalogue-governance decision (observation-catalogue
  enablement F3, corrections F2 — all Consultant-tier).

---

## 2. Adding a test

A Consultant adds a **single test** (NOT a multi-analyte panel — most add-ons are single:
Procalcitonin, Ammonia, Serum osmolality, etc.). Defined fields:

- **Test name** — required (e.g. "Procalcitonin").
- **Unit** — required (e.g. "ng/mL").
- **Reference range** — required: normal **low / high** (drives normal-vs-abnormal flagging).
- **Critical thresholds** — **defined here** (validator's decision): critical **low / high**
  (drives the CRITICAL flag). This is the natural moment to set them, and it gives new tests
  proper critical flagging — addressing the critical-flagging gap noted during PR #76 (the
  seeded catalogue models a single reference range, so it grades normal/abnormal only; tests
  added here get critical thresholds too). *(Whether to backfill critical thresholds onto the
  7 seeded panels is a separate future item — see §6 — not part of this build.)*
- (Optional, if useful: category/grouping — otherwise the added test stands alone.)

Once added, the test appears in the lab-entry catalogue (structured entry, like the seeded
tests): documenting a result against it derives unit/range from the definition and
**flags it normal / abnormal / critical** automatically.

---

## 3. Removing a test — NEVER destroys clinical data

The Consultant can remove a test they (or the deployment) no longer want. **Historical
results are ALWAYS preserved** — a documented lab result is a clinical record and never
vanishes (the amend-not-erase discipline used everywhere in Aurora: discontinue-not-delete,
deactivate-not-destroy, correct-preserving-original).

Removal behaviour:
- **If the test has NO results (never used)** → a true delete is harmless (nothing to
  preserve) — the test is removed outright.
- **If the test HAS results** → **deactivate / retire**, do NOT destroy: the test is removed
  from the menu (no NEW results can be documented against it — from the user's view it is
  "deleted", off the list, unusable), **but its existing results are preserved and remain
  readable** (still showing their name / value / range / flag). The clinical record stays
  intact.
- **Audited either way** — who removed/retired the test, and when (append-only record). A
  retired test's results still resolve their definition for display (the definition is
  retired, not deleted, when results reference it).

From the Consultant's perspective this is "delete the test" (it's gone from use); under the
hood it never erases the real results the test already produced.

---

## 4. Editing / correcting a test (safeguard against a wrong range)

Because a wrong reference range/threshold silently mis-flags, a mistake must be
**correctable**:
- A Consultant can **edit** a test's reference range / critical thresholds later — **audited
  and amend-not-erase** (the change records who/when; the prior definition is not silently
  overwritten in the audit trail).
- (Design point for the build: when a range changes, results are flagged against the
  definition at *render* time using the current definition — consistent with computed-not-
  stored flagging — OR the flag is stored at entry; the build should pick the honest,
  consistent option and state it. Recommended: derive the flag from the current definition at
  read, so a corrected range flows through — same principle as derived observation values.)
- **A confirmation** on add/edit that the range/thresholds will drive flagging for ALL
  patients' results of this test — so the Consultant sets it deliberately.

---

## 5. Where it lives (validator's decision)

A **Consultant-gated "Manage Lab Catalogue" area in a settings / admin section** — separate
from the everyday lab-entry screen (which stays focused on documenting results). Add / edit /
remove tests there. The everyday lab-entry screen simply *shows* the resulting catalogue
(seeded + added tests) for documentation; it is not where tests are managed.

---

## 6. Scope
**In scope (build now):**
- Consultant-tier `labcatalog.manage`: add a **single** structured test (name, unit, normal
  low/high, critical low/high); edit its ranges/thresholds (audited, amend-not-erase); remove
  it (delete-if-unused / retire-preserving-results-if-used, audited).
- Added tests behave like seeded tests on the lab-entry screen (structured entry, automatic
  normal/abnormal/critical flagging from the definition).
- The management UI in a settings/admin area, Consultant-gated.
- Governance hard constraint: office Administrator profile excluded; nurse/non-senior doctor
  excluded.

**Deferred / not built (recorded in `02`):**
- **Multi-analyte panel creation** — only single tests for now (validator's decision).
- **Backfilling critical thresholds onto the 7 seeded panels** — a separate future item (the
  critical-flagging gap for the *seeded* catalogue; this build gives *added* tests critical
  thresholds).
- **LIS test-list import (Option C)** — future integration (Scenario C); LIS-sourced test
  definitions become another source populating the catalogue. Already recorded as a future
  item.

---

## 7. Build notes / verification
- Build ONTO the existing lab catalogue + lab-results store (PR #76 / #78) — verify how the
  seeded catalogue is defined and how flagging is derived, and add the Consultant-managed
  add/edit/remove path onto it. **The seeded catalogue is currently read-only; this
  introduces controlled write (Consultant-only) — flag if that conflicts with how the
  catalogue is loaded/seeded rather than forcing it.**
- **Removal never destroys results** (§3): delete-if-unused, retire-preserving-results-if-
  used; retired definitions still resolve for display of their historical results.
- **Flagging from the definition** (§4): a result of an added test flags
  normal/abnormal/critical from its reference range + critical thresholds; a corrected range
  should flow through honestly (state the chosen mechanism).
- Audited/amend-not-erase for add/edit/remove (who/when).
- Consultant-tier RBAC enforced server-side; office-admin and nurse/non-senior-doctor 403;
  the hard constraint holds.
- Honest-data discipline; encounter-scope unaffected (this is catalogue config, not patient
  data); identity via canonical resolver where patient context applies.
- Verify: a Consultant adds a single test (name/unit/normal range/critical thresholds); it
  appears on the lab-entry screen; documenting a result against it flags
  normal/abnormal/critical correctly (incl. a critical value → CRITICAL); a
  nurse/non-senior-doctor/office-admin is 403 on managing the catalogue; removing an unused
  test deletes it; removing a used test retires it while its historical results remain
  readable; editing a range is audited and flows through; the 7 seeded panels and all
  existing behaviour are unchanged.
- Update `02` (record Option B built; multi-analyte panels + seeded-critical-backfill + LIS
  import as future items). Draft PR; hands-on rendered verification before merge.

---

## 8. Open items (flag, don't silently decide)
1. Read-only-seeded catalogue vs controlled Consultant write (§7) — confirm the catalogue can
   take controlled writes cleanly; flag if the seed/load model needs an additive change.
2. Flag-at-render vs flag-at-entry for added tests (§4) — pick the honest, consistent option
   (recommended: at render from current definition) and state it.
3. Backfilling critical thresholds onto the seeded 7 panels — deferred, recorded.

---

*End of Catalogue Test Management (Option B) design. Consultant-only add/remove of single
structured, flagged tests (with critical thresholds), removal never destroying historical
results, in a settings/admin area. Distinct from Option A (custom/free-text, unflagged);
Option C (LIS import) remains a future integration. This document is the specification Claude
Code builds from.*
