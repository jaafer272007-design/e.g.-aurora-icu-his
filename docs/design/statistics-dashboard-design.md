<!-- Recorded verbatim from the project owner's build instruction of 2026-07-15
     (the Statistics — ICU Analytics Dashboard design document, provided as
     STATISTICS_DASHBOARD_DESIGN.md — transcribed here unchanged; that file
     is the source document). Clinical source: Jaafer Aljanabi (ICU
     physician, the project's clinical validator). This file is the
     permanent versioned artifact for the specification — per the project
     rule that specs never live only in memory or conversation. Statistics
     is the first of the final three pages (Statistics → Alerts → Settings)
     closing the ICU module; built against the verified data-model audit
     with both prerequisites (PR #95 dated timestamps, PR #96 discharge
     disposition) in place. -->

# Statistics — ICU Analytics Dashboard — Design Document

**Status:** DESIGN — for approval, then hand to Claude Code as the build blueprint.
**Clinical source:** Jaafer Aljanabi (ICU physician, project clinical validator).
**Origin:** `Statistics` is one of three nav items that exist but **don't work** (dead nav
items — verified live: clicking does nothing). The validator's position: nav items must not be
empty/non-functional — either hide them or build them; **build them** (a non-working nav item
makes the system look unfinished even when the clinical work is excellent). Statistics is the
first of the final three pages (Statistics → Alerts → Settings) that close the ICU module.

**Built against a verified data-model audit** — every metric below was classified against the
real code, not assumed. **Two prerequisites are now met**, unlocking the time-based half:
- **PR #95 — dated timestamps** (ADT/order/lab stamps now carry full calendar dates) → LOS,
  period counts, trends, time-to-antibiotic, readmission windows are computable.
- **PR #96 — discharge disposition** (Home / Ward / Another facility / Higher care / **Died** /
  Other) → **ICU mortality** is computable.

---

## 0. Core principle (non-negotiable)

**Never display any value not backed by real data.** Every metric is either computed from real
data, or shown as an explicit **"not tracked yet"** placeholder (validator's choice) —
**never a fabricated number.** Placeholders are honest and make the future capability visible.

**Two honest consequences to surface in the UI:**
1. **Going-forward data:** the timestamp + disposition fixes apply to **new** records; existing/
   seeded records keep their old (undated / disposition-less) form. So time-based metrics and
   mortality are **accurate but sparse** until new data accumulates. The page must not imply
   more history than exists — where a metric's denominator is small/partial, say so.
2. **INCOMPLETE-aware averages:** SOFA/NEWS2 are INCOMPLETE for patients missing inputs. A unit
   average must be computed **over the patients whose score is computable**, and **labelled**
   with that denominator (e.g. "Average SOFA 6.2 — over 8 of 14 patients with complete data").
   Never average INCOMPLETE-as-zero.

---

## 1. Page structure (validator's design — five sections)

### 1.1 Current Unit Status
| Metric | Source / status |
|---|---|
| **Occupancy rate** | ✅ Real — beds + open encounters (already computed on the bed board) |
| **Available beds** | ✅ Real — same source |
| **Ventilated patients** | 🟡 Real, needs aggregation — from charted `vent_mode`/`resp_support` observations (NOT the demo roster flag) |
| **Vasopressor patients** | 🟡 Real, needs aggregation — active medication orders with vasopressor drug-class / structured infusions |
| **Isolation patients** | ❌ **"Not tracked yet"** — no capture path exists for a real patient's isolation status (needs a field/observation; recorded as future) |
| **Average SOFA** | 🟡 Real — unit average over patients with a computable score, **labelled with the denominator** (§0.2) |
| **Average NEWS2** | 🟡 Real — same, from observations |
| **Average length of stay** | 🟡 Real **(unlocked by #95)** — from dated `admittedAt`; computed over encounters with dated stamps; note sparseness (§0.1) |

### 1.2 Admissions
| Metric | Source / status |
|---|---|
| **Today** | 🟡 Real (unlocked by #95) |
| **This week** | 🟡 Real (unlocked by #95) — dated records only |
| **This month** | 🟡 Real (unlocked by #95) — dated records only |

### 1.3 Outcomes
| Metric | Source / status |
|---|---|
| **Discharges** | 🟡 Real — discharged encounters; period breakdowns from dated stamps (#95) |
| **Deaths** | 🟡 Real **(unlocked by #96)** — disposition = *Died* |
| **ICU mortality** | 🟡 Real **(unlocked by #96)** — deaths ÷ **discharges with a recorded disposition**; encounters without a disposition (pre-#96) are **excluded from the denominator**, and that exclusion is stated |
| **Discharge-outcome breakdown** | 🟡 Real (#96) — Home / Ward / Another facility / Higher care / Died / Other, plus "not recorded" for pre-existing |
| **Readmissions** | 🟡 Real — patients with >1 encounter (computable now); time-windowed readmission (e.g. <48h) unlocked by #95 for dated records |

### 1.4 Clinical Quality
| Metric | Source / status |
|---|---|
| **Critical labs acknowledged** | 🟡 Real — lab `flag: critical` + acknowledged + dated audit events; show the rate |
| **Average time to antibiotic** | 🟡 Real **(unlocked by #95)** — antibiotic drug-class order/administration time minus dated admission time; only over encounters with dated stamps; state the denominator |
| **Medication errors** | ❌ **"Not tracked yet"** — no error-report entity exists. *(Note: safety-override counts ARE real and audited — a different, honestly-labelled metric that could be added instead/later.)* |
| **Documentation completeness** | ❌ **"Not tracked yet"** — no note store and no agreed definition; needs the capability first |

### 1.5 Trends
| Metric | Source / status |
|---|---|
| **Occupancy over time** | 🟡 Real (unlocked by #95) — reconstructable from dated encounter intervals; going-forward |
| **Admissions trend** | 🟡 Real (unlocked by #95) — going-forward |
| **SOFA trend** | 🟡 Real — unit-level from per-patient computable scores over dated windows |
| **NEWS2 trend** | 🟡 Real — from dated observations |

---

## 2. "Not tracked yet" treatment (validator's choice)
The three unsupported metrics — **Isolation patients**, **Medication errors**, **Documentation
completeness** — appear **in their sections** with an explicit **"not tracked yet"** state
(clearly styled as unavailable, not as a zero or a dash that could read as a value), with a
short note of what capability is missing. Rationale: it shows the intended dashboard, keeps the
gap visible as a future item, and is honest — **never a fabricated number**.

---

## 3. Access / RBAC
- Statistics is the **Administrator's** primary value (validator: the admin's core use is ICU
  statistics) — the office Administrator profile **must** be able to reach the ICU statistics.
- Per the locked rule, the office Administrator **never** gets clinical data/config. So:
  Statistics shows **unit-level aggregate metrics** (counts, rates, averages, trends) — **not
  identifiable per-patient clinical detail.** Aggregates are the admin's view; drilling into a
  patient is clinical and stays gated as today.
- Clinicians (doctor/nurse tiers) can also view Statistics.
- **Flag at build:** confirm exactly which profiles get Statistics and that the aggregate view
  contains no per-patient clinical identifiers inappropriate for the office admin.

---

## 4. Honest display rules
- Every metric shows **real computed data** or **"not tracked yet"** — never fabricated.
- **Averages label their denominator** (SOFA/NEWS2 over computable patients; mortality over
  discharges with a disposition; time-to-antibiotic over dated encounters).
- **Sparse/partial data is stated**, not hidden (going-forward metrics will be thin until data
  accumulates — say so rather than implying a full history).
- **Computed at render** from the real sources (consistent with the scoring engine / derived-
  values discipline) — no stored/duplicated statistics.
- Where a metric is 0 because the real answer is 0, that's a real 0 — distinguish it visually
  from "not tracked yet" and from "insufficient data."

---

## 5. Scope
**In scope (build now):**
- The five sections above with every ✅/🟡 metric computed from real data.
- The three ❌ metrics as **"not tracked yet"** placeholders (§2).
- INCOMPLETE-aware, denominator-labelled averages (§0.2); sparse-data honesty (§0.1).
- Administrator access to the aggregate statistics (§3), with no inappropriate clinical detail.
- Computed-at-render; the `Statistics` nav item now works (no dead nav).

**Deferred / recorded as future:**
- **Isolation capture** (a field/observation) → then the isolation count becomes real.
- **Medication-error reporting** (an entity/workflow) → then the metric becomes real. *(A
  safety-override-count metric is real today and could be added as an honestly-labelled
  alternative — flag for a decision.)*
- **A note store + a definition of documentation completeness** → then that metric becomes real.
- Retroactive dating/disposition for pre-fix records — **never** (no fabricated history).

---

## 6. Build notes / verification
- Build `Statistics` as a real screen behind the existing nav item (currently dead).
- Compute every metric from its canonical source (beds/encounters/observations/orders/labs/
  audit + the scoring engine) — **no forks, no mocks, no stored stats**.
- Aggregations needed (per the audit): ventilated (observations), vasopressors (orders), avg
  SOFA/NEWS2 (N-patient engine computation — the recorded unit-level-aggregate follow-up),
  critical-labs-ack rate, LOS, period admissions/discharges, mortality, readmissions,
  time-to-antibiotic, trends.
- **Performance note:** unit-level SOFA/NEWS2 means computing N patients' scores — verify this
  is acceptable at render (the scores are client-computed today); **flag if it needs a
  different approach** rather than forcing it.
- Honest rules per §4 (denominators labelled, sparse data stated, "not tracked yet" distinct
  from a real 0).
- RBAC per §3 — **flag** the exact profile set and confirm no inappropriate clinical detail
  reaches the office admin.
- Verify: every displayed number traces to real data (spot-check several against the source);
  averages exclude INCOMPLETE patients and state the denominator; mortality excludes
  disposition-less encounters and says so; "not tracked yet" renders for the three unsupported
  metrics and is visually distinct from a real 0; the Administrator can reach Statistics and
  sees aggregates only; the nav item now navigates (no longer dead); nothing fabricated
  anywhere. Update `02`. Draft PR; rendered verification before merge.

---

## 7. Open items (flag, don't silently decide)
1. Unit-level SOFA/NEWS2 aggregation performance (§6) — confirm the approach; flag if the
   client-side per-patient computation doesn't scale to the unit view.
2. Exact RBAC profile set for Statistics (§3) — confirm; ensure the office admin sees
   aggregates without inappropriate clinical detail.
3. Whether to add **safety-override counts** (real, audited) as an honestly-labelled quality
   metric in place of / alongside the "not tracked yet" medication-errors placeholder — a small
   decision for the validator.
4. Trend time-granularity (hourly/daily/weekly) and range — choose sensibly given data is
   going-forward and initially sparse; state the choice.

---

*End of Statistics (ICU Analytics Dashboard) design. Five sections — Current Unit Status,
Admissions, Outcomes, Clinical Quality, Trends — every metric computed from real data or shown
as an explicit "not tracked yet" placeholder, never fabricated. Both prerequisites (dated
timestamps #95, discharge disposition #96) are met, unlocking LOS, mortality, period counts,
time-to-antibiotic and trends. Averages are INCOMPLETE-aware and denominator-labelled; sparse
going-forward data is stated honestly. The Administrator reaches the unit-level aggregates
(their core use) without inappropriate clinical detail. Closes the first of the three dead nav
items. This document is the specification Claude Code builds from.*
