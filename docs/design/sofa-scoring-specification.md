<!-- Recorded verbatim from the project owner's build instruction of 2026-07-14
     (the detailed SOFA Scoring Specification, provided as
     SOFA_SCORING_SPECIFICATION.md — transcribed here unchanged; that file is
     the source document). Clinical source: Jaafer Aljanabi (ICU physician,
     the project's clinical validator) — thresholds and judgment calls
     confirmed/decided in the document. This file is the permanent versioned
     artifact for the specification — per the project rule that specs never
     live only in memory or conversation. It fills in §4 of
     docs/design/clinical-scoring-engine.md (the deliberately-deferred
     detailed SOFA scoring), now that every data source it reads is built:
     labs incl. ABG PaO₂, the Stage 11 observation model (GCS/MAP/FiO₂/urine
     output), the structured Infusion Module (PR #87), and the
     encounter-scoped weight (PR #83). Built from this design (see
     02_PROJECT_STATUS "Classic SOFA v1 (built)"). Changes are new versions
     recorded with their source. -->

# SOFA Scoring Specification — Detailed Design

**Status:** DESIGN — the detailed SOFA scoring spec (deferred until the data sources were
built; they now are). For approval, then hand to Claude Code as the build blueprint, on top
of the already-recorded Clinical Scoring Engine architecture.
**Clinical source:** Jaafer Aljanabi (ICU physician, project clinical validator) — thresholds
and judgment calls confirmed/decided below.
**Guiding principle (validator's):** **faithful to classic SOFA**, honest (no fabricated
data), and **versioned/extensible** — this is **classic SOFA v1**; modified versions can be
added later as separate score definitions **without changing this logic or mixing into the
standard score**.

**Builds on:** the Clinical Scoring Engine architecture + 7 locked principles (generic engine,
missing-data-never-assumed-normal → INCOMPLETE, latest-value-in-window, total + per-component
breakdown, trend retained, computed-not-stored, clinical validation required). This document
fills in the SOFA-specific scoring the engine reads.

**Data sources (all now built):** labs incl. PaO₂ (ABG), platelets, bilirubin, creatinine;
observations GCS, MAP, FiO₂, urine output; the new **Respiratory Support** observation; the
**structured Infusion Module** (vasopressor doses in µg/kg/min); encounter weight (for
µg/kg/min).

---

## 1. The 6 organ components — scoring (0–4 each; total 0–24)

All thresholds confirmed by the validator against classic SOFA.

### 1.1 Respiratory — PaO₂/FiO₂ ratio (P/F)
- P/F ≥ 400 → **0**
- P/F < 400 → **1**
- P/F < 300 → **2**
- P/F < 200 **AND on respiratory support** → **3**
- P/F < 100 **AND on respiratory support** → **4**

- **P/F calc:** PaO₂ (mmHg, from ABG lab) ÷ FiO₂ (as a **fraction** 0.21–1.0; FiO₂ is charted
  as % 21–100, so divide by 100).
- **Respiratory support (validator: option b):** read from a **charted "Respiratory Support"
  observation** (Yes/No, manually documented by clinician) — NOT auto-inferred from ventilator
  settings, and NOT a value entered only at calculation time. **This requires ADDING a
  "Respiratory Support" observation type** to the catalogue (Respiratory/Ventilator group),
  Yes/No (extensible to support type later). If P/F < 200 or < 100 but respiratory support is
  **not** charted Yes, the score **cannot reach 3–4** — it caps at 2 (support is a required
  condition for 3–4). *(Later: a Device Adapter can supply respiratory-support status
  automatically without changing this logic.)*

### 1.2 Coagulation — Platelets (×10³/µL)
- ≥ 150 → **0** · < 150 → **1** · < 100 → **2** · < 50 → **3** · < 20 → **4**
- Reads platelets from the CBC lab panel.

### 1.3 Liver — Bilirubin (mg/dL)
- < 1.2 → **0** · 1.2–1.9 → **1** · 2.0–5.9 → **2** · 6.0–11.9 → **3** · ≥ 12.0 → **4**
- Reads total bilirubin (T.Bili) from the Liver lab panel, **mg/dL** (confirmed unit).

### 1.4 CNS — Glasgow Coma Scale
- 15 → **0** · 13–14 → **1** · 10–12 → **2** · 6–9 → **3** · < 6 → **4**
- Reads **GCS Total** directly (the derived GCS Total observation).

### 1.5 Renal — Creatinine (mg/dL) OR Urine output
- Creatinine < 1.2 → **0**
- 1.2–1.9 → **1**
- 2.0–3.4 → **2**
- 3.5–4.9 **OR** UO < 500 mL/day → **3**
- ≥ 5.0 **OR** UO < 200 mL/day → **4**

- Creatinine from the Renal lab panel, **mg/dL** (confirmed).
- **If BOTH creatinine and urine output are available → take the WORSE (highest score)**
  (validator) — faithful to SOFA's worst-dysfunction philosophy; no fixed precedence.
- **Urine output — rolling 24-hour total ONLY; NEVER extrapolate (validator — safety):**
  - Use urine output **only if a full rolling 24-hour total exists** (sum of urine over the
    last 24h).
  - If a full 24h frame is **not** complete, **do NOT use the urine-output criterion at all**
    — score renal from **creatinine only.**
  - **Never extrapolate** partial-day urine to a full day (that would fabricate data —
    violates honest-data). Only a real rolling-24h total counts.

### 1.6 Cardiovascular — MAP + vasopressors (doses µg/kg/min)
- MAP ≥ 70 → **0**
- MAP < 70 → **1**
- Dopamine ≤ 5 **OR** dobutamine (any dose) → **2**
- Dopamine > 5–15 **OR** epinephrine ≤ 0.1 **OR** norepinephrine ≤ 0.1 → **3**
- Dopamine > 15 **OR** epinephrine > 0.1 **OR** norepinephrine > 0.1 → **4**

- MAP from the charted observation.
- **Vasopressor doses read from the structured Infusion Module** (µg/kg/min, normalised —
  incl. mg/kg/hour → µg/kg/min conversion already built), using the encounter weight.
- **Vasopressin → EXCLUDED** (validator): not in classic SOFA; kept OUT of the calculation.
  (A future Modified SOFA could add a mapping as a **separate version** — do NOT mix into
  standard SOFA.)
- **Phenylephrine → EXCLUDED** (validator): not in classic SOFA; no score in v1.
- Higher vasopressor-based scores and the MAP score: take the applicable highest (a patient on
  norepinephrine > 0.1 scores 4 regardless of MAP; the vasopressor criteria dominate as in
  standard SOFA).

---

## 2. Cross-cutting rules

### 2.1 Missing data → INCOMPLETE (never assumed normal) — P1
- If a component's required input is **missing** (no value within the window — §2.2), that
  component is **NOT scored 0.** It is marked **"insufficient data."**
- SOFA is shown as **INCOMPLETE**, with:
  - the **per-component breakdown** showing each component's score AND which are "insufficient
    data" (uncomputed), and
  - a **partial total** of only the computed components, clearly flagged as incomplete (e.g.
    "SOFA (partial) = 8 — INCOMPLETE: Liver and Renal not scored").
- Never present a falsely-complete total. (Assuming 0 for missing data understates severity —
  unsafe.)

### 2.2 Time windows (recency)
- **Labs** (platelets, bilirubin, creatinine, PaO₂): latest value within the last **24 hours.**
- **Observations** (GCS, MAP, FiO₂, respiratory support): latest value within the last **24
  hours.**
- **Urine output:** rolling **24-hour** total (§1.5).
- **Vasopressor dose:** the **currently active** infusion order (from the Infusion Module).
- Beyond the window → the input is **missing** → §2.1 (that component = insufficient data).

### 2.3 Worst-in-24h (primary), current-latest (secondary)
- **Primary SOFA = worst value in the last 24 hours** for each component (classic SOFA /
  literature convention) — the score the validator wants as the standard.
- **Secondary view = current-latest** SOFA (using the most recent value of each) — available
  as an additional view for live monitoring.
- Both use the same component scoring; they differ only in which value (worst-in-24h vs
  latest) each component uses.

### 2.4 Trend — ΔSOFA (P4)
- SOFA is computed at multiple time points so the **trend and ΔSOFA (change over time)** are
  visible — ΔSOFA is clinically meaningful (more than a single value).

### 2.5 Computed, not stored (P5)
- SOFA is recomputed from the source data at render, never persisted as primary data. A
  correction to an underlying lab/observation flows through automatically.

### 2.6 Replaces fabrication (P6)
- This real computed SOFA replaces the currently-fabricated bedside SOFA/EWS numbers. Where
  inputs are insufficient, it shows INCOMPLETE (§2.1) — never a fabricated number.

### 2.7 Versioned / extensible (validator)
- This is **classic SOFA v1.** The engine treats it as one score **version/definition.**
  Future **Modified SOFA** (or other scores — qSOFA, APACHE II, NEWS2) are **separate
  definitions/versions**, added without changing this logic and **without mixing into the
  standard score** (e.g. vasopressin/phenylephrine only ever enter a *modified* version, never
  classic).

### 2.8 Clinical validation before care use (P7)
- The computed SOFA must be clinically validated by the validator before it informs patient
  care. It is decision-support; "approximately right" is not acceptable for a severity score.

---

## 3. Display
- **Total (0–24) + per-component breakdown** (Resp / Coag / Liver / CNS / Renal / Cardio),
  each showing its score, the contributing value, and that value's time.
- **INCOMPLETE state** clearly marked with which components are insufficient (§2.1).
- **Trend / ΔSOFA** where the data supports it (§2.4).
- Both worst-in-24h (primary) and current-latest (secondary) available (§2.3).
- Honest-data throughout; replaces the fabricated bedside SOFA (§2.6).

---

## 4. Scope
**In scope (build now):**
- Classic SOFA v1 as a score definition on the Clinical Scoring Engine: all 6 components with
  the confirmed thresholds; reading from the built data sources (labs, observations, Infusion
  Module, encounter weight); the P/F calc; the worst-of renal rule; the rolling-24h-urine /
  creatinine-only rule (no extrapolation).
- **Add the "Respiratory Support" observation type** (Yes/No) to the catalogue (needed for
  Respiratory scores 3–4).
- Missing-data → INCOMPLETE with breakdown + partial total; 24h windows; worst-in-24h primary
  + current-latest secondary; ΔSOFA trend; computed-not-stored; replaces fabricated bedside
  SOFA/EWS.
- Versioned so modified SOFA / other scores can be added later.

**Deferred / not in scope:**
- **Modified SOFA** and other scores (qSOFA, APACHE II, NEWS2, SAPS II) — future definitions on
  the same engine.
- **Vasopressin / phenylephrine mapping** — only ever in a future *modified* version, never
  classic.
- **Auto-detection of respiratory support** from ventilator data / Device Adapter — future,
  replaces the manual charted flag without changing SOFA logic.
- Vasopressin structured (units-based) dosing — the recorded infusion follow-up (SOFA excludes
  vasopressin anyway).

---

## 5. Build notes / verification
- Implement classic SOFA v1 as a **score definition on the existing Clinical Scoring Engine**
  (generic engine, this is the first real score) — verify the engine architecture recorded in
  `docs/design/clinical-scoring-engine.md` and build SOFA onto it; flag if the engine needs
  anything to read these specific sources.
- **Add the "Respiratory Support" observation type** (Yes/No) — verify the observation
  catalogue and add it (Respiratory/Ventilator group), consistent with how observation types
  are defined.
- Read each input from its canonical source (labs, observations, Infusion Module normalised
  µg/kg/min, encounter weight) — no forks/mocks.
- **Missing data → INCOMPLETE** (never 0); **no urine extrapolation** (creatinine-only if no
  rolling-24h urine); **worst-of** renal; vasopressin/phenylephrine excluded.
- Computed-at-render; replaces the fabricated bedside SOFA/EWS.
- Mark as **classic SOFA v1** (versioned) so modified versions can be added later.
- **Clinical validation gate:** the computed scores must be validated by the validator before
  informing care — surface as decision-support, clearly.
- Verify: each component scores correctly at its thresholds (test boundary values, incl. P/F
  with and without charted respiratory support — capping at 2 without support; renal worst-of
  creatinine vs urine; renal creatinine-only when no rolling-24h urine, and NO extrapolation;
  cardiovascular reading structured vasopressor doses at the band boundaries; vasopressin/
  phenylephrine ignored); missing any input → that component INCOMPLETE and the total flagged
  partial (never assumed 0); 24h windows; worst-in-24h vs current-latest; ΔSOFA trend;
  computed-not-stored (correct an underlying value → SOFA updates). Update `02`. Draft PR;
  hands-on rendered verification before merge; and explicit clinical validation before any care
  use.

---

## 6. Open items (flag, don't silently decide)
1. Engine readiness (§5) — confirm the recorded Clinical Scoring Engine can host SOFA v1 as a
   definition reading these sources; flag if anything's needed.
2. "Respiratory Support" observation type addition (§1.1) — confirm the observation catalogue
   takes it cleanly.
3. Exact rendering of the INCOMPLETE partial total + breakdown and the worst-in-24h vs
   current-latest views — implement the honest, clear presentation per §2–§3.

---

*End of SOFA Scoring Specification. Classic SOFA v1 — faithful to the standard (worst-of renal,
no urine extrapolation, vasopressin/phenylephrine excluded), honest (missing-data → INCOMPLETE,
never assumed normal), reading the now-complete data sources (labs, observations, Infusion
Module, weight, the new Respiratory Support observation), worst-in-24h primary + current-latest
secondary, with ΔSOFA trend — built as a versioned score definition on the Clinical Scoring
Engine so modified versions can be added later without changing this logic. Requires clinical
validation before care use. This document is the specification Claude Code builds from.*
