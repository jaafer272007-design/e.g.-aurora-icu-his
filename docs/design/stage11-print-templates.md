<!-- Recorded verbatim from the project owner's instruction of 2026-07-13
     (the Stage 11 print-templates design document, provided with the
     build instruction). Clinical source: the project's clinical
     validator (ICU physician). This file is the permanent versioned
     artifact for the Stage 11 print-templates specification — per the
     project rule that specs never live only in memory or conversation.
     Changes are new versions recorded here with their source. -->

# Stage 11 Print Templates — Design Document

**Status:** DESIGN — for approval, then hand to Claude Code as the build blueprint.
**Clinical source:** Jaafer Aljanabi (ICU physician, project clinical validator).
**Context:** The 3 Print Center templates deferred until Stage 11 existed (they consume
Observations, which now exist). Recorded in the Print Center Contract v1.0 as
Stage-11-deferred. This completes the Print Center Contract's implemented set.

These build on the **proven Phase-1 Print Center pattern** (already live for 11 templates):
read-only rendering from the persisted record; the shared print layout; honest-data
discipline (missing → dash / "not charted", never fabricated); the † charted-time
footnote; identity via the canonical resolver (the PR #63 path, not a fork/mock store);
no parallel data sources. Everything below is *content/layout* on that proven foundation.

---

## 0. Two cross-cutting principles established during design

### P1 — Adaptive layouts (not one fixed design per template)
Templates are **layouts** (what data is shown); the presentation adapts to the data/
settings rather than being a single frozen design. Concretely for the flowsheet: the
time window drives orientation (24h → landscape; 12h → portrait or landscape); dense data
shrinks columns or **paginates** across pages. This avoids needing dozens of near-
duplicate templates — the layout flexes. Build the flowsheet adaptive from the start.

### P2 — Print Center Engine (RECORDED FUTURE FEATURE — not built now)
The validator's vision: Print Center as an **engine** (like an Office print system), with
templates as *layouts* and the engine managing *how* it prints. A future **Print Center
Engine** phase would add an interactive Print Preview where the user sets: paper size
(A4/Letter/Legal), orientation (Portrait/Landscape), margins, font size, show/hide
sections (QR code / signature / logo), and columns / time-window for the flowsheet — then
prints or saves PDF. **This is a distinct, substantial future feature — deliberately NOT
built now** (it would balloon "3 templates" into "a print platform"). Build the 3
templates now as adaptive layouts, *architected so the engine can wrap them later without
rework* (same discipline as the Observation model being device-ready without the Device
Adapter). Record "Print Center Engine" in `02` under Known Feature Gaps / roadmap, to be
designed in its own session when it is its turn.

---

## 1. Template — Vital Signs / Observation Flowsheet

**Purpose:** the core bedside observation trend — the most-used flowsheet. Read across a
row for a parameter's trend; down a column for a moment in time.

- **Layout:** a grid — **rows = observation types, columns = timepoints.** ADAPTIVE (P1):
  24h of hourly columns is wide, so default orientation is landscape and it paginates when
  dense.
- **Which observations (TRADITIONAL SPLIT — validator's decision):** the flowsheet carries
  the **core bedside observations — Vital Signs + Neurological Assessment + Fluid Balance**
  (the "nursing observation" set). It does **NOT** carry the detailed ventilator settings —
  those live on Template 3 (Ventilator & Device Report), to keep each document focused.
  (POC labs and Nursing Clinical Assessment: include if they fit the flowsheet's core-
  observation intent; the primary three groups are vitals/neuro/fluids. Confirm at build
  whether POC/Nursing-assessment belong on the flowsheet or elsewhere — flag, don't
  assume.)
- **Time window & interval:** **24 hours, hourly columns** (24 columns). Real charted
  values placed at/near their hour; honest blank ("—") where nothing was charted that hour.
  Off-cycle entries (e.g. 08:37) placed honestly by charted time — the build handles the
  hour-grid-vs-actual-time convention following the honest-data discipline.
- **Derived rows (computed per column — validator's decision):** Net Balance, Total Input,
  Total Output, and GCS Total **compute and display per timepoint** (e.g. a "Net Balance"
  row summing each hour's fluids). Derived values are computed at render (never charted,
  never stored) — consistent with the Observation model.

---

## 2. Template — Ventilator & Device Report

**Purpose:** current respiratory/device status — "how is this patient ventilated right
now," plus device parameters (mostly future).

- **Ventilator — SNAPSHOT (validator's decision):** the **current** ventilator setup
  (latest charted ventilator settings), point-in-time, NOT a 24h trend. Shows: mode, FiO₂,
  PEEP, set RR, measured RR, tidal volume (set / exhaled), Ppeak, Pplat, minute
  ventilation, I:E ratio — the current values from the latest charted timepoint.
- **Derived respiratory values (computed — validator's decision):** Driving Pressure
  (Pplat − PEEP) and Minute Ventilation **compute and display** (computed at render).
- **Devices — SECTIONS LAID OUT NOW (validator's decision):** even though the Devices
  group is currently **disabled** (ECMO / CRRT / ICP / infusion pumps not yet chartable),
  lay out the device sections now, **honestly showing "— not charted" / "not monitored"**
  until those observations exist and the group is enabled. Same forward-structuring as the
  Face Sheet's "NOT RECORDED BY THE SYSTEM" fields. **Expectation to confirm:** the device
  sections will appear on the report but be visibly empty for essentially every patient
  today (Devices group disabled) — sections always present, honestly empty until devices
  exist. (If instead the validator wants device sections hidden-when-empty, that is the
  alternative; "laid out right now" is taken as always-present-honestly-empty.)

---

## 3. Template — MAR (Medication Administration Record)

**Purpose:** the record of doses **administered** (given/held/refused) — distinct from what
was *ordered*.

- **Layout:** a grid — **rows = medications, columns = administration times**, cells = the
  administration status. The classic MAR.
- **Time window & columns (validator's decision):** **24 hours; columns are the SCHEDULED
  administration times per drug** (a q8h drug → 3 columns/day, a q4h drug → 6) — not a
  uniform grid. Each medication's schedule drives its own columns.
- **Each administration cell shows (validator's decision):** GIVEN status, the actual TIME
  given, the NURSE who administered, and a REASON if NOT given (held / refused).

### DATA DEPENDENCY — CONFIRMED by validator; verify shape before building (Q4)
A MAR displays **administration events** ("dose given at 08:05 by Nurse Chen"), which are
**different from medication orders** (the prescription). The cells (given/time/nurse/
reason) require *administration-event* data.

- **The validator confirmed: Aurora DOES record medication administrations** — a nurse
  marks a specific dose as given (or held/refused), with time and nurse. So the MAR is
  **buildable from real administration data**, and there is a `mar` concept/suite in the
  system consistent with this.
- **Claude Code must still verify the exact SHAPE of the administration-event data against
  the real code before building** (which fields the administration record carries —
  given/held/refused status, actual time, administering nurse, reason-if-held) so the MAR
  cells are built to the real data structure. This is structural verification of a
  confirmed-existing capability, not a question of whether it exists.
  - Build the MAR cells (given / time / nurse / reason-if-not-given) from that real
    administration-event data.
  - If the real data shape lacks any of the Q3 cell fields (e.g. no "reason" captured on a
    held dose), **flag that specific gap** (show it honestly as "not recorded") rather than
    fabricating it — but the MAR as a whole builds from the confirmed administration data.

---

## 4. Build notes (all three)
- Build on the Phase-1 Print Center pattern (one selector + one component + one registry
  entry each, per the existing templates).
- All read-only from the persisted record; observations read via the Stage 11 chart-read
  path; identity via the canonical resolver; never the live formulary.
- Honest-data discipline throughout: dashes / "not charted" for missing, never fabricated;
  derived values computed at render; the charted-time convention with footnote.
- **Adaptive layout (P1)** for the flowsheet (orientation + pagination driven by the
  24h-hourly data).
- Verify each renders with real data for an admitted patient (and, where applicable, a
  discharged patient via the identity read) — the flowsheet with charted observations, the
  ventilator report with charted ventilator settings, the MAR per the Q4 verification
  outcome.
- Update the Print Center Contract (mark these 3 as implemented) and `02` per the freshness
  rule. **Record the Print Center Engine (P2) as a future feature.**
- Each as its own draft PR on the proven method; hands-on rendered verification before
  merge.

---

## 5. Open items (flag, don't silently decide)
1. **MAR administration data (§3)** — CONFIRMED to exist by the validator (nurses record
   administrations); Claude Code verifies the exact data *shape* before building and flags
   any missing Q3 cell field (e.g. reason-if-held) as honestly "not recorded" rather than
   fabricating it.
2. Whether POC labs and Nursing Clinical Assessment belong on the Flowsheet or elsewhere
   (§1) — primary three groups are vitals/neuro/fluids; confirm the rest.
3. Ventilator Report device sections: always-present-honestly-empty (taken as the
   decision) vs hidden-when-empty (§2) — confirm.

---

*End of Stage 11 Print Templates design. This document — not any single sentence — is the
specification Claude Code builds from. The Print Center Engine (P2) is a separate future
feature, recorded but not built here.*
