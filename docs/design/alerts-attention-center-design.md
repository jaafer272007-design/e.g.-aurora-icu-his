<!-- Recorded verbatim from the project owner's build instruction of 2026-07-15
     (the Alerts — Clinical Attention Center design document, provided as
     ALERTS_ATTENTION_CENTER_DESIGN.md — transcribed here unchanged; that
     file is the source document). Clinical source: Jaafer Aljanabi (ICU
     physician, the project's clinical validator). This file is the
     permanent versioned artifact for the specification — per the project
     rule that specs never live only in memory or conversation. Alerts is
     page 2 of the final three (Statistics ✅ → Alerts → Settings) closing
     the ICU module; DISPLAY-ONLY per the validator's locked D6 decision —
     no notifications/pop-ups/paging in v1. -->

# Alerts — Clinical Attention Center — Design Document

**Status:** DESIGN — for approval, then hand to Claude Code as the build blueprint.
**Clinical source:** Jaafer Aljanabi (ICU physician, project clinical validator).
**Origin:** `Alerts` is the second of three nav items that exist but **don't work** (dead nav
items — verified live: clicking does nothing; it even carries a "5" badge). The validator's
position: a non-working nav item makes the system look unfinished — build it. Alerts is page 2
of the final three (Statistics ✅ → **Alerts** → Settings) that close the ICU module.

**Built against the verified data-model audit** — every item below is classified against the
real code, not assumed.

---

## 0. What Alerts IS (and is NOT) — the defining decision

**Alerts is a CLINICAL ATTENTION CENTER: a display-only list of things needing attention.**

- **It is NOT an automated alerting/alarm system.** Per the validator's locked **D6** decision
  on NEWS2: v1 shows **severity/colour only — no notifications, no pop-ups, no paging**;
  alerting workflows (notifications, escalation, nurse acknowledgement, alert audit) are **v2,
  after clinical experience**. Alerts v1 honours that: it is a **board you look at**, not a
  system that pages you.
- Consistent with the project-wide discipline: **no fake alarms until there is a real clinical
  rule set** — and where a rule set exists (NEWS2), it is used **as validated**, not invented.

---

## 1. Core principles
1. **Never display anything not backed by real data** — every item is real, or shown as an
   explicit **"not tracked yet"** placeholder (the validator's chosen treatment, as on
   Statistics). Never fabricated.
2. **Reuse existing acknowledgments — do NOT create a parallel "alert acknowledged" state.**
   A critical lab is acknowledged exactly as it is in the results inbox (one truth). Items with
   no existing acknowledgment concept are **informational** (no acknowledge action).
3. **Abnormal vitals use NEWS2's validated thresholds**, not home-made ones (§2.2).
4. **Computed at render** from canonical sources — no stored alert entities.

---

## 2. What Alerts shows — v1 (real sources)

### 2.1 Critical laboratory results ✅ (real)
- Source: lab results with `flag: 'critical'` that are **unacknowledged** (the catalogue's
  critical thresholds drive the flag; the results inbox already serves this).
- **Action: Acknowledge** — the **existing** result acknowledgment (not a new state) + **Open
  patient**.
- Severity: critical.

### 2.2 Abnormal vital signs 🟡 (real observations + validated thresholds)
- Source: charted observations, with "abnormal" defined by **NEWS2's validated parameter
  thresholds** — a parameter scoring **≥2** (and separately ≥3, which is NEWS2's own
  single-parameter escalation trigger) is a principled, validated definition. **Do NOT invent
  thresholds.**
- **Informational** (no acknowledge — there is no existing acknowledgment concept for an
  observation) + **Open patient**.
- Severity from the NEWS2 parameter score (2 = medium, 3 = high), using standard NEWS2 colours.
- Honest: only observations within the recency window count; missing data is not an alert (it's
  absence, not abnormality — NEWS2 INCOMPLETE handles that separately).

### 2.3 Unacknowledged results ✅ (real)
- Source: the unit-wide results inbox (unacknowledged results, incl. non-critical).
- **Action: Acknowledge** (existing) + **Open patient**.
- Severity: normal/abnormal per the result's own flag (critical ones surface in §2.1).

### 2.4 Orders pending signature ✅ (real)
- Source: `getPendingOrders` (the Doctor Workspace queue already uses this).
- **Action: Open patient / open the order** (signing happens in the real ordering flow — do not
  duplicate signing here).
- Severity: informational/attention.

### 2.5 Pending imaging reports 🟡 (real, needs a filter)
- Source: imaging studies with `status: in-progress | preliminary` (i.e. not `final`).
- **Informational** + **Open patient**. (Acknowledgment of a *result* is §2.3's concern.)

### 2.6 Ventilation duration 🟡 (real, honestly derived)
- Source: dated `resp_support` / `vent_mode` observations → **time-on-support is honestly
  derivable from the charting history** (dated timestamps, PR #95).
- **Informational** + **Open patient**. Shows duration on support.
- Honest: derived from **charted** support history only — if support isn't charted, no duration
  is claimed (never inferred).

---

## 3. "Not tracked yet" (real capability missing — never fabricated)

These appear as explicit **"not tracked yet"** placeholders (visually distinct from a real
zero/empty), each naming the missing capability:

| Item | Why not yet |
|---|---|
| **Pending consultations** | Consults are still a **mock store** (the adapter refuses in production) — no real domain behind it. |
| **Expired medications** | Order duration is **free text** ("7 days", "ongoing") with no machine-readable end date — honest expiry needs structured duration. |
| **Allergies requiring review** | Allergies exist (free-text per patient) and **do** drive real order blocking — but a "requires review" **state/workflow doesn't exist**. |
| **Missing documentation** | **No note store** exists and no agreed definition of completeness. |
| **Device reminders — central line / urinary catheter** | **No insertion-time capture** (lines are a status enum, no dates) → duration can't be derived. *(Ventilator duration IS real — §2.6.)* |

---

## 4. Alert item shape (validator's design)
Each real item shows:
- **Severity** (critical / high / medium / informational — from the item's own real basis: lab
  flag, NEWS2 parameter score, etc. — never invented)
- **Patient** (bed + name)
- **Time** (dated — real, per PR #95)
- **Responsible clinician** where the source has one (e.g. the ordering/documenting clinician —
  **flag if a source has no responsible clinician** rather than inventing one)
- **Acknowledge** — **only** where a real acknowledgment exists (§2.1, §2.3); otherwise
  informational
- **Open patient** — navigates to the patient (and now benefits from the persistent patient
  context)

---

## 5. Display / organisation
- Grouped by the categories in §2 (+ the §3 placeholders), or sorted by severity — **choose the
  clearer presentation and state it**; severity ordering (critical first) is the safer default.
- **Standard NEWS2 colours** for the NEWS2-derived severities (§2.2); the lab flag's own
  critical styling for §2.1 — consistent with the rest of the app.
- The nav item's **badge count** must reflect the **real** number of attention items (it
  currently shows a hardcoded "5" — verified as a dead nav item; the count must become real or
  be removed — never fabricated).
- **Empty state is honest and good news** — "nothing needs attention" is a real answer, and
  must be visually distinct from "not tracked yet."
- **Computed at render**; no stored alerts.

---

## 6. RBAC
- Alerts is **clinical** — it shows patient-identifiable clinical items. Per the locked rule the
  **office Administrator NEVER gets clinical data** → the Administrator must **not** see Alerts
  (unlike Statistics, which is unit-level aggregates and is theirs).
- Clinician profiles see the items their existing authority allows — **reuse the existing
  authority of each source** (e.g. results the user can acknowledge; orders they can act on) —
  **do not widen access** via this page. **Flag the exact profile set at build.**

---

## 7. Scope
**In scope (build now):**
- The six real sources (§2) as a display-only attention list, with the item shape (§4).
- The five "not tracked yet" placeholders (§3), visually distinct from empty/zero.
- Existing acknowledgments reused (§1.2) — no parallel alert state.
- Abnormal vitals via **NEWS2 validated thresholds** (§2.2) — no invented rules.
- A **real** badge count (or no badge) — never the hardcoded fabricated one.
- RBAC per §6 (clinical — not the office Administrator).
- The `Alerts` nav item now works (no dead nav).

**Deferred / recorded as future (v2+):**
- **Automated alerting** — notifications, pop-ups, paging, escalation workflows, nurse
  acknowledgement of alerts, alert audit trail (the validator's D6: after clinical experience).
- The capabilities behind the §3 placeholders: real consults domain, structured medication
  duration (→ expiry), an allergy-review workflow, a note store (→ documentation), and
  line/catheter insertion-time capture (→ device duration).

---

## 8. Build notes / verification
- Build `Alerts` as a real screen behind the existing (currently dead) nav item.
- Read every item from its canonical source (lab flags/inbox, pending orders, imaging status,
  observations + the NEWS2 definition for thresholds, dated vent-support history) — **no forks,
  no mocks, no stored alerts**. The consults source is a **mock store — do NOT read it**; it's a
  §3 placeholder.
- **Display-only** — no notifications/pop-ups/paging (D6). Verify none fire.
- **Reuse existing acknowledgments**; do not create a parallel acknowledged state.
- **NEWS2 thresholds** for abnormal vitals — read the NEWS2 definition, don't re-implement or
  invent thresholds.
- **Badge count must be real** (currently hardcoded "5") — make it real or remove it.
- RBAC per §6 — **flag the exact profile set**; office Administrator excluded.
- Verify: every item traces to real data (spot-check against sources); acknowledging from Alerts
  performs the **existing** acknowledgment (same truth as the inbox — verify no parallel state);
  abnormal vitals match NEWS2's parameter thresholds exactly (test boundaries: a parameter at 2
  and at 3); vent duration derives only from charted support (absent when not charted); "not
  tracked yet" renders distinctly for the five unsupported items; empty state distinct from "not
  tracked"; badge count real; **no notifications fire**; office Administrator cannot reach
  Alerts; the nav item navigates (no longer dead); nothing fabricated. Update `02`. Draft PR;
  rendered verification before merge.

---

## 9. Open items (flag, don't silently decide)
1. Exact RBAC profile set (§6) — confirm; Administrator excluded; per-source authority reused
   not widened.
2. Presentation: grouped-by-category vs severity-sorted (§5) — choose the clearer and state it.
3. "Responsible clinician" (§4) — sources without one should say so rather than invent
   attribution; flag which sources lack it.
4. The recency window for abnormal vitals (§2.2) — align with the NEWS2 windowing decision
   (and note NEWS2's own recorded flag that a shorter window may suit a current-state score).

---

*End of Alerts (Clinical Attention Center) design. A display-only attention board — six real
sources (critical labs, abnormal vitals via NEWS2's validated thresholds, unacknowledged
results, orders pending signature, pending imaging, ventilation duration), reusing existing
acknowledgments rather than a parallel state, with five honest "not tracked yet" placeholders
for capabilities that don't exist yet (consults, medication expiry, allergy review,
documentation, line/catheter duration). No notifications/alarms — that's v2 per the validator's
D6 decision. Clinical, so not for the office Administrator. Closes the second of the three dead
nav items. This document is the specification Claude Code builds from.*
