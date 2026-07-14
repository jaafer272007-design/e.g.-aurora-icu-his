<!-- Recorded verbatim from the project owner's build instruction of 2026-07-14
     (the EWS / NEWS2 v1 Scoring Specification, provided as
     EWS_NEWS2_SPECIFICATION.md — transcribed here unchanged; that file is
     the source document). Clinical source: Jaafer Aljanabi (ICU physician,
     the project's clinical validator). This file is the permanent versioned
     artifact for the specification — per the project rule that specs never
     live only in memory or conversation. NEWS2 is the SECOND score on the
     Clinical Scoring Engine (docs/design/clinical-scoring-engine.md); the
     first, classic SOFA v1 (docs/design/sofa-scoring-specification.md), has
     been clinically validated, which is what cleared this build (see §  and
     "BUILD DEFERRED until SOFA is clinically validated"). Built from this
     design (see 02_PROJECT_STATUS "Standard NEWS2 v1 (built)"). Build-time
     resolutions of the open items are recorded in 02, not here. Changes are
     new versions recorded with their source. -->

# EWS / NEWS2 v1 — Scoring Specification

**Status:** DESIGN — architecture decisions locked; thresholds are standard NEWS2 (correctable
later). **BUILD DEFERRED until SOFA is clinically validated** (validator's sequencing: EWS
*design* doesn't depend on SOFA correctness, but EWS *implementation* depends on trusting the
scoring engine, which SOFA must prove clinically first).
**Clinical source:** Jaafer Aljanabi (ICU physician, project clinical validator).
**Guiding principle:** faithful to **standard NEWS2** (a validated instrument — don't corrupt
it with home-made rules), honest (missing → INCOMPLETE, never assumed normal), and
**versioned** — this is **standard NEWS2 v1**; an **ICU-EWS v2** with ICU-specific adaptations
comes later as a separate definition, without changing this logic.

**Builds on:** the Clinical Scoring Engine (the generic engine SOFA is now the first score on)
— NEWS2 is the **second score definition**, plugging into the same engine with no engine
change.

---

## 1. Locked architecture decisions (validator, D1–D6)

- **D1 — Base:** **standard NEWS2 as v1.** ICU-specific modifications are **ICU-EWS v2** later
  (same versioning discipline as SOFA classic/modified). Keeps a clear, validatable global
  standard.
- **D2 — Ventilated patients:** **do NOT modify NEWS2 in v1.** Compute standard NEWS2 as far
  as applicable. Where mechanical ventilation makes some elements inapplicable/unreliable,
  **do NOT invent new rules** — document the limitation clearly in this spec AND in the UI. Any
  ventilated-patient customization is **ICU-EWS v2**, not inside standard NEWS2.
- **D3 — Consciousness:** use **AVPU/ACVPU directly** — NOT derived from GCS. NEWS2 was
  validated with AVPU/ACVPU; mapping GCS would change a validated instrument. **Add a small
  standalone AVPU/ACVPU observation**; keep GCS as-is for ICU purposes; **never derive one from
  the other** (see §3).
- **D4 — Recompute:** **computed-at-render**, recomputed on **every new observation**;
  **INCOMPLETE** when required data missing — never assume a value (see §4).
- **D5 — Display:** **Bed Board / Roster + Mission Control + Printing**, all from the **same
  scoring engine** — no fabricated/fixed numbers anywhere.
- **D6 — Alerting:** **v1 = standard NEWS2 colours + escalation bands ONLY — NO notifications,
  pop-ups, or paging.** The system **displays severity level only.** v2 (after clinical
  experience) may add notifications, escalation workflows, nurse acknowledgement, and an alert
  audit trail. (Consistent with the no-automated-alarms-until-proven discipline.)

---

## 2. The 7 NEWS2 parameters — scoring (each 0–3; total 0–20)

**Standard NEWS2 thresholds** (correctable later if the validator refines any):

**1. Respiration rate (breaths/min):**
- ≤ 8 → **3** · 9–11 → **1** · 12–20 → **0** · 21–24 → **2** · ≥ 25 → **3**

**2. SpO₂ — Scale 1 (default, most patients):**
- ≤ 91 → **3** · 92–93 → **2** · 94–95 → **1** · ≥ 96 → **0**

**3. Air or supplemental oxygen:**
- Air → **0** · Supplemental O₂ → **2**
- Source: read from the oxygen/FiO₂ or Respiratory Support observation (see §6 open item — one
  source chosen at build; whichever authoritatively indicates the patient is on supplemental
  O₂). NOT fabricated.

**4. Systolic blood pressure (mmHg):**
- ≤ 90 → **3** · 91–100 → **2** · 101–110 → **1** · 111–219 → **0** · ≥ 220 → **3**

**5. Pulse / heart rate (beats/min):**
- ≤ 40 → **3** · 41–50 → **1** · 51–90 → **0** · 91–110 → **1** · 111–130 → **2** · ≥ 131 → **3**

**6. Consciousness (ACVPU):**
- **Alert → 0** · **new Confusion / Voice / Pain / Unresponsive → 3**
- Reads the standalone AVPU/ACVPU observation (§3). NOT derived from GCS.

**7. Temperature (°C):**
- ≤ 35.0 → **3** · 35.1–36.0 → **1** · 36.1–38.0 → **0** · 38.1–39.0 → **1** · ≥ 39.1 → **2**

**SpO₂ Scale 2** (hypercapnic respiratory failure, target 88–92%, e.g. COPD): **DEFERRED to a
later version** unless the validator asks to include it — it needs a per-patient "on Scale 2"
flag. v1 uses **Scale 1** for all patients. (Recorded so it's a conscious deferral, not an
omission.)

---

## 3. AVPU/ACVPU — standalone observation (validator addition 1)
- **AVPU/ACVPU is an independent Observation.**
- It is **NOT derived from GCS**, and **GCS is NOT derived from AVPU** — no undocumented
  inference either direction.
- **If AVPU/ACVPU is not recorded, NEWS2 is INCOMPLETE** — even if GCS is present. (GCS does
  not substitute.)
- **Add** the AVPU/ACVPU observation type to the catalogue; keep GCS unchanged (it remains for
  ICU/SOFA use).

---

## 4. Completeness — INCOMPLETE rule (validator addition 2; mirrors SOFA)
- To compute NEWS2, **all required parameters must be present:** Respiratory Rate, SpO₂, Oxygen
  supplementation (air/O₂), Temperature, Systolic BP, Heart Rate, AVPU/ACVPU.
- If **any** is missing:
  - its value is **NOT replaced with 0**,
  - a **stale value outside the validity window is NOT used** (if an observation recency window
    is defined — see §5),
  - the UI shows **"NEWS2: Incomplete"** with the missing parameter(s) named.
- Never present a falsely-complete NEWS2. (Assuming 0 or reusing stale values understates
  deterioration — unsafe.)

---

## 5. Cross-cutting (consistent with SOFA / engine)
- **Computed-at-render, never stored** — recomputed from source observations on every new
  observation; a correction to an underlying observation flows through automatically.
- **Recency window:** latest value of each parameter within a defined window (align with the
  observation windowing approach; beyond it → missing → §4). *(Confirm the exact window at
  build, consistent with how observations are windowed elsewhere.)*
- **Replaces fabrication:** real NEWS2 replaces the fabricated bedside/roster EWS numbers (the
  fabricated SOFA/EWS tiles across roster/bed board/print/KPI are retired as part of this build
  — the follow-up recorded against the SOFA build, now enabled because both real scores exist).
- **Versioned:** standard NEWS2 v1; ICU-EWS v2 later as a separate definition (D1/D2).
- **Decision-support:** displayed as decision-support; v1 shows severity (colours/bands) only,
  no automated alerts (D6).

---

## 6. Escalation bands + colours (D6 — display only in v1)
Standard NEWS2 escalation:
- **0** → low (routine monitoring)
- **1–4** → low (ward/team response)
- **3 in any single parameter** → low-medium (urgent review)
- **5–6** → medium (urgent response)
- **≥ 7** → high (emergency threshold)

Standard NEWS2 colour-coding applied for display. **v1: display the band/colour only — NO
notifications/pop-ups/paging.** (v2 may add alerting workflows.)

---

## 7. Display
- **Total (0–20) + per-parameter breakdown** (RR / SpO₂ / O₂ / SBP / HR / ACVPU / Temp), each
  with its score, value, and time.
- **Band + colour** per §6.
- **INCOMPLETE state** clearly marked with which parameters are missing (§4).
- **Ventilated-patient limitation** documented in the UI where relevant (D2) — the score is
  standard NEWS2; elements unreliable under ventilation are noted, not silently adjusted.
- On **Bed Board/Roster, Mission Control, and Printing** — all from the same engine (D5).
- Honest-data throughout; replaces the fabricated EWS numbers.

---

## 8. Scope
**In scope (build — AFTER SOFA clinical validation):**
- Standard NEWS2 v1 as a second score definition on the Clinical Scoring Engine: all 7
  parameters at the standard thresholds; reading real observations.
- **Add the AVPU/ACVPU observation type** (§3); keep GCS unchanged.
- Completeness/INCOMPLETE rule (§4); computed-at-render; recency windowing (§5).
- Escalation bands + colours, **display-only** (§6, D6).
- Display on Bed Board + Mission Control + Printing from one engine (D5).
- **Retire the fabricated SOFA/EWS tiles** across roster/bed board/print/KPI/seed (now enabled
  because both real SOFA and real NEWS2 exist) — real scores replace them; INCOMPLETE where
  data insufficient (never fabricated).
- Versioned so ICU-EWS v2 can be added later.

**Deferred / not in scope (v1):**
- **ICU-EWS v2** — ICU-specific adaptations, including any ventilated-patient customization
  (D1/D2) — future separate definition.
- **SpO₂ Scale 2** (COPD/hypercapnic) — later, needs a per-patient flag (§2).
- **Automated alerts** — notifications/escalation-workflows/nurse-acknowledgement/alert-audit
  are **v2** (D6).
- Deriving AVPU/GCS from each other — explicitly never (§3).

---

## 9. Build notes / verification (when built, post-SOFA-validation)
- Implement standard NEWS2 v1 as a **second score definition on the Clinical Scoring Engine**
  (the engine SOFA proved) — no engine change expected; flag if any needed.
- **Add the AVPU/ACVPU observation type** — verify the observation catalogue takes it cleanly;
  keep GCS unchanged; never derive either from the other.
- Read each parameter from its canonical observation; choose and state the authoritative source
  for "supplemental oxygen" (§2 param 3 / §6 open item).
- **Missing any required parameter → INCOMPLETE** (never 0, never stale-outside-window);
  computed-at-render; recompute on every observation.
- Standard thresholds + bands + colours; **display-only, no automated alerts** (v1).
- Document the **ventilated-patient limitation** in spec + UI (D2) — no invented rules.
- **Retire the fabricated SOFA/EWS tiles** across roster/bed board/print/KPI/seed — real SOFA +
  NEWS2 replace them; verify no fabricated score numbers remain anywhere; INCOMPLETE shown
  where data insufficient.
- Display on Bed Board + Mission Control + Printing from the one engine.
- Mark **standard NEWS2 v1 (versioned)**.
- Verify: each parameter scores correctly at its thresholds (boundary values); the single-
  parameter-3 escalation trigger; INCOMPLETE when any parameter missing (incl. AVPU missing
  even with GCS present — INCOMPLETE); no stale-value use; computed-not-stored (correct an
  observation → NEWS2 updates); colours/bands correct; NO automated alerts fire in v1;
  ventilated-patient limitation surfaced; fabricated tiles gone (real scores or INCOMPLETE
  everywhere). Update `02`. Draft PR; hands-on rendered verification before merge; clinical
  validation before care use (P7).

---

## 10. Open items (flag, don't silently decide)
1. Authoritative source for "supplemental oxygen" (§2 param 3) — the oxygen/FiO₂ observation or
   the Respiratory Support observation; choose one at build and state it.
2. Exact recency window for observations feeding NEWS2 (§5) — align with existing observation
   windowing; state it.
3. List-level display of the score + retiring the fabricated tiles cleanly across all surfaces
   (roster/bed board/print/KPI/seed) — implement the honest presentation; confirm every
   fabricated number is replaced by a real score or INCOMPLETE.

---

*End of EWS/NEWS2 v1 Scoring Specification. Standard NEWS2 v1 — faithful to the validated
instrument (no home-made rules, ventilated-patient limits documented not invented), honest
(missing → INCOMPLETE, AVPU never derived from GCS, no stale/assumed values), computed-at-
render on the Clinical Scoring Engine as its second score, displayed on Bed Board + Mission
Control + Printing from one engine with standard colours/bands but NO automated alerts in v1,
and retiring the fabricated SOFA/EWS tiles once built. ICU-EWS v2, SpO₂ Scale 2, and alerting
workflows are deferred. BUILD AFTER SOFA is clinically validated. This document is the
specification Claude Code builds from.*
