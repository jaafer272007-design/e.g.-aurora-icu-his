<!-- Recorded verbatim from the project owner's instruction of 2026-07-13
     (the Clinical Scoring Engine architectural design, provided with the
     documentation instruction). Clinical source: the project's clinical
     validator (ICU physician), design session. This file is the
     permanent versioned artifact for the Clinical Scoring Engine
     specification — per the project rule that specs never live only in
     memory or conversation. The detailed SOFA scoring rules are
     DELIBERATELY DEFERRED here (§4) until the prerequisite data sources
     are complete; changes are new versions recorded with their source. -->

# Clinical Scoring Engine — Architectural Design

**Status:** ARCHITECTURAL DESIGN — records the engine's structure and locked principles.
The **detailed SOFA scoring rules are DELIBERATELY DEFERRED** until the data sources they
depend on (Labs, Ventilator module, ABG integration) are complete — see §4.
**Clinical source:** Jaafer Aljanabi (ICU physician, project clinical validator).
**Origin:** the validator's insight that Stage 11's real observation data *unlocks* real
computed clinical scores (replacing the fabricated SOFA/EWS numbers on the bedside
display), AND the validator's sequencing judgment that SOFA must be built on *complete
integrated data sources*, not on data-source assumptions that may still change.

---

## 0. The core decision — sequencing (validator's judgment)

**Do NOT specify detailed SOFA scoring rules now.** SOFA depends on data that isn't fully
built yet: vasopressor doses (depend on the finished medication/MAR module), PaO₂/FiO₂ and
ventilation status (depend on the Ventilator module + ABG/lab integration), and the lab
values (depend on Labs being complete and connected). Specifying SOFA's thresholds and
input-mappings against incomplete sources would risk rework when those sources are
finished.

**Correct project sequence (validator's):**
1. Finish the Print system ✓ (done — 13/13 templates)
2. Finish Labs and connect them
3. Finish the Ventilator module and ABG
4. **THEN** build the Clinical Scoring Engine with SOFA as the first score — on complete,
   real, integrated data sources.

This document therefore records the **engine architecture and the locked principles**
(which are independent of the data sources), and **defers the detailed SOFA scoring spec**
(§4) until step 4's prerequisites exist. This keeps SOFA built on real integrated data, not
assumptions — consistent with Aurora's discipline of not building on incomplete
foundations.

---

## 1. The engine (not SOFA-specific code)

Build a **generic Clinical Scoring Engine**, with SOFA as its *first* score — never
SOFA-specific code. Other scores plug in later without restructuring:

```
Clinical Scoring Engine
    ├── SOFA          (first — built when data sources are ready)
    ├── qSOFA         (later)
    ├── APACHE II     (later)
    ├── NEWS2         (later)
    ├── SAPS II       (later)
    └── Custom Scores (future)
```

**This mirrors the Observation Type Catalogue pattern exactly** (generic, data-driven,
extend by adding a definition — not by rewriting structure). A score is defined by its
inputs (which observations / labs / medications it reads), its per-component scoring rules,
and its aggregation — as *configuration/definition*, so adding qSOFA/APACHE later is adding
a score definition, not re-architecting.

**Engine responsibilities (generic, score-agnostic):**
- Resolve a score's declared inputs from the real data sources (observations, labs,
  medications) — via the canonical reads, never forks/mocks.
- Apply the score's component rules to the resolved inputs.
- Handle missing inputs per the locked principle (§2) — never assume normal.
- Aggregate to a total + per-component breakdown.
- Compute at render, never store (§2).
- Expose the result with provenance (which inputs, their times, which components were
  computable vs incomplete).

---

## 2. Locked principles (safe to decide now — independent of data sources)

These are the validator's clinical decisions at the *engine* level. They hold regardless of
how Labs/Ventilator/ABG are ultimately structured, so they are locked now:

- **P1 — Missing data is NEVER assumed normal.** If an input for a component is missing,
  the component is **not scored as 0** — the score is shown as **INCOMPLETE**, with the
  uncomputed components explicitly marked. (Assuming 0 for missing data understates
  severity — clinically unsafe.) An incomplete SOFA displays the components it *could*
  compute and clearly flags which it could not, rather than presenting a falsely-complete
  total.
- **P2 — Latest value within a defined time window.** The engine uses the *most recent*
  value of each input *within a defined recency window* (window length per input type, set
  when the detailed score is specified) — **never stale old data**. If nothing exists
  within the window, that input is missing (→ P1).
- **P3 — Total + per-component breakdown.** Always display both the aggregate score AND the
  per-component breakdown (e.g. Resp / Coag / Cardio / CNS / Renal for SOFA) — the number
  alone is not clinically useful; the clinician needs to see *which* systems are driving
  it.
- **P4 — Trend retained.** Keep the score **over time** — ΔScore (e.g. ΔSOFA) is more
  clinically meaningful than a single value. The engine supports a score trend, not just a
  point value.
- **P5 — Computed, never stored.** Scores are recomputed from the source data at
  render/display, never persisted as primary data — consistent with Aurora's
  derived-values discipline (like Net Balance, GCS Total). This also means a correction to
  an underlying observation/lab flows through to the score automatically.
- **P6 — Replaces fabrication.** The engine's real computed scores replace the currently
  *fabricated* SOFA/EWS numbers on the bedside display (the F8-recorded drift from Stage 11
  step 4). Where inputs are insufficient, the display shows INCOMPLETE (P1) — NOT a
  fabricated number and NOT a falsely-complete score.
- **P7 — Clinical validation required before care use.** The scoring rules (thresholds,
  bands, mappings) MUST be clinically validated by the validator before any computed score
  informs patient care. Computed scores are decision-support and must be correct;
  "approximately right" is not acceptable for a severity score. (This is why the detailed
  rules are specified by the clinician, not generated — see §4.)

---

## 3. Display (per the locked principles)
- SOFA (and each score) shows: **total + per-component breakdown** (P3), with each
  component's contributing input and its time.
- **INCOMPLETE state** (P1): components without data are marked "insufficient data"; the
  displayed total is flagged as partial/incomplete, never presented as a complete score.
- **Trend** (P4): the score over time (ΔSOFA), where the underlying data supports it.
- Replaces the fabricated bedside SOFA/EWS (P6).
- Consistent with honest-data discipline throughout: computed-not-stored, no fabrication,
  insufficient-data shown honestly.

---

## 4. DEFERRED — the detailed SOFA scoring specification

**NOT specified now.** To be designed with the validator once Labs, the Ventilator module,
and ABG integration are complete (§0 sequence). When that specification session happens, it
will settle (the 16 questions previously drafted, in particular):

- **The 6 organ-system thresholds** (Respiratory PaO₂/FiO₂; Coagulation platelets; Liver
  bilirubin incl. units; Cardiovascular MAP + vasopressor bands; CNS GCS; Renal creatinine
  or urine output) — confirmed/corrected by the clinician against standard SOFA.
- **The data-source-dependent mappings that are being deferred precisely because their
  sources aren't ready:**
  - **Vasopressor dose mapping** (Cardiovascular) — how the finished medication/MAR module
    exposes the active vasopressor + dose in µg/kg/min for the SOFA bands.
  - **PaO₂/FiO₂ + ventilation status** (Respiratory) — from the finished Ventilator module
    (FiO₂, ventilation mode) + ABG/lab integration (PaO₂).
  - **Lab inputs** (platelets, bilirubin, creatinine, ABG) — from completed/connected Labs,
    including units.
- **The recency window length per input type** (P2) — e.g. labs within N hours,
  observations within M minutes.
- **worst-in-window vs current-latest** (the classic-SOFA-vs-live-bedside distinction) —
  the clinician's decision on what "the SOFA" means for Aurora (possibly both a current and
  a 24h-worst).
- Input availability verified against the real code (as was done for the MAR
  administration data) once the sources exist.

Until then: the engine architecture and the locked principles (§1–§3) stand; the detailed
SOFA numbers wait for real, complete data sources.

---

## 5. Roadmap position
- **Now (recorded):** this engine architecture + locked principles.
- **Prerequisites first:** Labs complete + connected → Ventilator module + ABG → *then* the
  Clinical Scoring Engine build with SOFA's detailed spec.
- **After SOFA:** qSOFA, APACHE II, NEWS2, SAPS II, custom scores — as score definitions on
  the same engine.

---

*End of Clinical Scoring Engine architectural design. Records the engine and its locked
clinical principles; the detailed SOFA scoring rules are deliberately deferred until the
data sources are complete, per the validator's sequencing judgment — so SOFA is built on
real integrated data, not assumptions.*
