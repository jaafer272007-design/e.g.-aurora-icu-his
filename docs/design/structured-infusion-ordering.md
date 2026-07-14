<!-- Recorded from the project owner's build instruction of 2026-07-14
     (the Structured Infusion Ordering design, provided as a PDF —
     STRUCTURED_INFUSION_ORDERING_DESIGN.pdf — and transcribed here
     verbatim; the PDF is the source document). Clinical source: Jaafer
     Aljanabi (ICU physician, the project's clinical validator). This file
     is the permanent versioned artifact for the specification — per the
     project rule that specs never live only in memory or conversation.
     Built from this design (see 02_PROJECT_STATUS "Structured Infusion
     Ordering (built)"). Open item 1 resolved: the order model carries the
     structured dose CLEANLY as an additive nested object inside the
     medication JSON (value + mass unit + time basis; per-kg fixed) — no
     migration. Open item 3 resolved as the design recommends: structured
     REPLACES free text for continuous mass-dosed infusions; free-text/
     preset dosing stays for everything else. ONE FLAGGED DEVIATION:
     vasopressin (listed among the vasopressors) is dosed in U/min, which
     the design's µg/mg structure cannot represent — it keeps the
     free-text preset path, recorded as an open item (a units-based entry
     mode; SOFA's vasopressin band is any-dose, readable from drug
     identity). Changes are new versions recorded with their source. -->

# Structured Infusion Ordering — Design Document

**Status:** DESIGN — for approval, then hand to Claude Code as the build blueprint. **Clinical
source:** Jaafer Aljanabi (ICU physician, project clinical validator). **Origin:** the Clinical
Scoring Engine data-source assessment found the SOFA **cardiovascular** component's
vasopressor input was a free-text dose string (not reliably readable) with no structured
weight-based rate. Patient weight is now captured (encounter-scoped). This builds
**structured infusion ordering** — the last SOFA cardiovascular data-source prerequisite —
and, per the validator, as a **general infusion capability** (vasopressors AND other infusions
like sedation), not a narrow SOFA-only field.

---

## 0. The core decisions (validator's judgment)

- **Structured, not free-text (Q1/Q3):** an infusion is ordered as a **structured drug +
  numeric dose + weight-basis (per kg) + time-basis (per min / per hour) + mass unit
  (microgram / milligram)** — replacing the free-text dose string. Doses are weight-based
  (per kg), using the encounter weight already captured.

- **Two unit systems, with conversion (Q1):** doses come in **microgram/kg/min
  (µg/kg/min)** AND **milligram/kg/hour (mg/kg/hour)** — each with its own entry. The
  system stores the entered value+unit AND can **convert** between them (so a score or
  comparison can normalise; SOFA's bands are in µg/kg/min).

- **SOFA uses the ORDERED dose (Q2):** SOFA is mainly calculated in the **early hours of
  admission**, so the **physician's ordered infusion dose** is the input SOFA reads — NOT a
  continuously-titrated minute-to-minute live rate. This is a deliberate simplification
  grounded in how SOFA is actually used: we do NOT need to build live titration-rate
  tracking for SOFA; the structured ordered dose suffices.

- **General infusion form (Q3):** the same structured form serves **vasopressors** (SOFA's
  need) AND **other infusions** (e.g. sedation) — vasopressors are built/prioritised first
  (they unblock SOFA), and the same structure extends to other infusion drug classes.

## 1. What we are building

A **structured "infusion" order mode** in the ordering flow (Orders & Meds / medication
ordering). When a physician orders an infusion, instead of a free-text dose they get a
structured form:

- **Drug** — selected from the formulary, filtered/grouped by infusion drug class:
  - **Vasopressors:** adrenaline (epinephrine), noradrenaline (norepinephrine), dopamine,
    dobutamine, phenylephrine, vasopressin.
  - **Other infusions:** e.g. sedation (and other continuous-infusion drugs) — same
    structured form.
- **Dose** — numeric value.
- **Weight basis** — per **kg** (weight-based; uses the encounter weight — PR #83 encounter-
  scoped).
- **Time basis** — per **minute** or per **hour**.
- **Mass unit** — **microgram (µg)** or **milligram (mg)**. → so the dose is expressed as e.g.
  **0.3 µg/kg/min** or **2 mg/kg/hour** — each a valid, distinct structured entry.
- Plus the usual order fields (route = IV infusion, frequency = continuous, urgency, etc.),
  consistent with how medications/labs are ordered.

The order is created as a proper order in the canonical order list, with the full lifecycle and
audit (like medication/lab orders), but carrying a **structured dose** (value + weight basis +
time basis + unit) instead of free text.

## 2. Unit handling & conversion (Q1)

- Store the dose **as entered** (value + mass unit + time basis + weight basis) — faithful to
  what the physician ordered (µg/kg/min or mg/kg/hour).
- Provide **conversion** so doses can be **normalised to a common unit** (e.g. µg/kg/min) for
  comparison / scoring. (mg/kg/hour → µg/kg/min: ×1000 for mg→µg, ÷60 for hour→min,
  applied to the weight-based rate.) The conversion is computed (not a lossy overwrite) —
  the original entry is preserved, the normalised value is derived.
- Weight-based rates use the **encounter weight**; if weight is missing, the absolute rate
  can't be weight-normalised — handle honestly (see §5: SOFA treats missing inputs per
  its INCOMPLETE rule).

## 3. SOFA cardiovascular input (Q2)

- SOFA's cardiovascular component reads the **active ordered vasopressor(s) and their
  structured dose(s)**, normalised to µg/kg/min, for the patient — at the time SOFA is
  computed (early admission).
- Because the dose is now **structured** (drug identity via formulary class + numeric
  value+unit), the score can reliably read "is there an active vasopressor, which one, at
  what µg/kg/min" — no fragile free-text parsing.
- The SOFA cardiovascular **bands themselves** (which vasopressor + dose → which score)
  are part of the deferred detailed SOFA scoring spec (see the Clinical Scoring Engine
  design) — this build provides the **structured data** the bands will read; it does not yet
  implement the bands.

## 4. General infusion capability (Q3)

- The structured form is **not vasopressor-specific** — it is the infusion-ordering form for
  any continuous infusion. Vasopressors are the first/prioritised drug class (they unblock
  SOFA); **sedation and other infusion drugs use the same structured form**.
- Drug identity/class comes from the formulary (the formulary already tags drug class,
  e.g. Vasopressor). Extending to sedation etc. is populating/using the relevant drug
  classes in the same form — not a new form per class.

## 5. Honesty / safety

- Structured dose is faithful to what was ordered (value+unit preserved); conversions are
  derived, not lossy overwrites.
- If weight is missing, weight-based normalisation can't be done — handled honestly (no
  fabricated rate); SOFA treats a missing required input per its **INCOMPLETE** rule (missing
  data never assumed normal — Clinical Scoring Engine P1).
- Ordering an infusion is a physician order (RBAC consistent with existing ordering — see
  §7).

## 6. Scope

**In scope (build now):**

- Structured infusion order mode in the ordering flow: drug (formulary, infusion classes) +
  numeric dose + per-kg + per-min/per-hour + µg/mg unit; created as a proper order with
  full lifecycle/audit; structured dose stored (value+unit+bases).
- Unit support for µg/kg/min AND mg/kg/hour, with conversion/normalisation (original
  preserved, normalised derived).
- Vasopressors as the first drug class (adrenaline, noradrenaline, dopamine, dobutamine,
  phenylephrine, vasopressin); the same form usable for other infusions (sedation, etc.).
- Weight-based rates use the encounter weight (PR #83).
- The structured vasopressor dose is readable by the future SOFA cardiovascular
  component (this build provides the data, normalised to µg/kg/min).

**Deferred / not in scope:**

- **Live titrated infusion-rate tracking over time** — explicitly NOT built (validator: SOFA
  uses the ordered dose, early-admission). If continuous rate-charting is ever wanted,
  that's a separate observation-model addition — record as a possible future item.
- **The detailed SOFA cardiovascular scoring bands** (which drug+dose → which score)
  — part of the deferred detailed SOFA scoring spec (Clinical Scoring Engine); this build
  provides the structured data those bands will read.
- Full expansion of every non-vasopressor infusion drug's specifics — the form is general;
  populating all drug classes/defaults can extend over time.

## 7. Build notes / verification

- Build the structured infusion mode onto the EXISTING ordering/medication system and
  formulary — verify how medication orders + the formulary drug-class tags are
  structured, and add the structured infusion dose onto them; **flag if the order model
  can't cleanly carry a structured dose (value + weight basis + time basis + unit)
  rather than forcing it** (it's currently free-text — likely needs additive structured fields,
  like prior additive store changes).
- Surface it in the canonical ordering flow (Orders & Meds), consistent with
  medication/lab ordering; created orders get the full lifecycle/audit.
- Unit conversion (µg/kg/min ↔ mg/kg/hour) — derived, original preserved; state the
  formula.
- Weight-based rates use the encounter weight (PR #83); missing weight handled
  honestly.
- RBAC: infusion ordering consistent with existing physician ordering authority; server-
  side.
- Honest-data discipline; encounter-scoped; identity via canonical resolver.
- Verify: a physician orders a vasopressor infusion (e.g. noradrenaline 0.3 µg/kg/min, and
  one in mg/kg/hour) via the structured form → it creates a proper order with the
  structured dose stored (value+unit+bases), full lifecycle/audit; the dose normalises to
  µg/kg/min correctly (incl. the mg/kg/hour → µg/kg/min conversion); the same form
  orders a non-vasopressor infusion (e.g. a sedative); weight-based rate uses the
  encounter weight and is handled honestly when weight is absent; existing free-
  text/other ordering unaffected.
- Update `02` (structured infusion ordering built; live-rate-tracking and the SOFA
  cardiovascular bands recorded as deferred). Draft PR; hands-on rendered verification
  before merge.

## 8. Open items (flag, don't silently decide)

1. Order-model change to carry a structured dose (§7) — confirm it can hold value +
   weight basis + time basis + unit cleanly; flag if additive fields are needed.
2. Which non-vasopressor infusion drugs/classes to surface first beyond sedation — can
   extend over time; the form is general.
3. Interaction with the existing free-text medication dose — does structured infusion
   replace free-text for infusions, or sit alongside? (Recommended: structured for
   infusions; free-text/other for non-infusion meds as today.) State the chosen approach.

---

*End of Structured Infusion Ordering design. A structured infusion order form (drug + dose +
per-kg + per-time + µg/mg unit, supporting µg/kg/min and mg/kg/hour with conversion) for
vasopressors and other infusions, feeding the future SOFA cardiovascular component from
the ordered dose (early-admission) — the last SOFA cardiovascular data-source
prerequisite. This document is the specification Claude Code builds from.*
