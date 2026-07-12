# Print Center Contract — Version 1.0

**Source: confirmed by the project's clinical validator (the ICU
physician) and recorded verbatim from the project owner's instruction of
2026-07-12.** This document is the permanent, versioned artifact for the
Print Center's template list — per the project rule that clinical
specifications must live in the repository with a clear source, never
only in memory or conversation. Changes to this list are new contract
versions (v1.1, v2.0, …) recorded in this file with their source; the
binding rendering architecture every template must follow is in
`01_ARCHITECTURE.md` § Print Center.

## Implemented / Buildable now (10)

| # | Document | Content intent | Status |
|---|----------|----------------|--------|
| 1 | **Patient Face Sheet** | Registration-style identity + encounter summary; the file-open / transfer banner document | implemented (`face-sheet`) |
| 2 | **ICU Daily Progress Sheet** | Daily status: diagnosis, assessment, plan, key results, active problems | implemented (`daily-progress`, Phase 1 — titled "Daily Progress Note") |
| 3 | **Active Orders Sheet** | All active physician orders (incl. non-medication), from the persisted order record | implemented (`active-orders`) |
| 4 | **Medication Orders** | Current medication prescriptions with full detail | implemented (`medication-orders`) |
| 5 | **Laboratory Report** | All lab results with dates, encounter-scoped, acknowledgment status | implemented (`lab-report`) |
| 6 | **Imaging Report** | Radiology/echo/etc. reports with impressions, acknowledgment status | implemented (`imaging-report`) |
| 7 | **Nursing Notes / SBAR** | Nursing handoff/receive notes with S/B/A/R structure | implemented (`sbar`) — see honest-source note below |
| 8 | **Consultation Report** | All specialist consultations, chronologically ordered | implemented (`consult-report`) — see honest-source note below |
| 9 | **Transfer / Referral Summary** | For moving the patient to another unit or hospital | implemented (`transfer-summary`) |
| 10 | **Discharge Summary** | Final discharge summary | implemented (`discharge-summary`, Phase 1) |

## Deferred to Stage 11 (3) — depend on the real Observation Model

| # | Document | Why deferred |
|---|----------|--------------|
| 11 | **Medication Administration Record (MAR)** | Depends on actual dose-administration data — the printed MAR is a legal administration record and must render real administrations, which the Stage 11 Observation model owns |
| 12 | **Vital Signs / Observation Flowsheet** | Temp, BP, HR, RR, etc. over time — depends on the Observation model (the current bedside snapshot is a single point-in-time roster view; a flowsheet without stored observations would be fabrication) |
| 13 | **Ventilator & Device Report** | Ventilator, infusion pumps, hemodynamics, devices — device data arrives with Stage 11 device integration; the placeholder `panels.ts` data is never printed (locked rule) |

## Future Extensions (noted, not scheduled)

- **Medication Reconciliation** — deferred by clinical decision: most
  relevant at admission/discharge/transfer; may become its own document
  or fold into the Discharge Summary in a later contract version.

## Reconciliation with Phase 1 (recorded 2026-07-12)

- Contract #10 and #2 were already implemented by Phase 1
  (`discharge-summary`; `daily-progress` — the existing "Daily Progress
  Note" title is retained, mapped to contract entry #2).
- Phase 1 also implemented an **ICU Admission Note**
  (`admission-note`) which is NOT part of this contract's enumeration.
  It is retained as an implemented additional document — flagged here
  for the clinical validator's next review (fold into a future contract
  version, or retire), not silently deleted.

## Honest-source notes (per the honest-data discipline)

- **#7 Nursing Notes / SBAR and #8 Consultation Report**: the system has
  **no canonical nursing-notes or consultation store yet** — those are
  the Timeline's recorded still-mock feeds (they migrate with the
  ADT/Nursing work). These documents therefore render the REAL
  identity/encounter/medication context plus whatever consultation /
  nursing events the aggregated timeline feed carries, and provide ruled
  write-in areas for the narrative. In dev/staging the feed includes the
  demo consult/nursing events; in production those feeds do not exist
  yet, so the sections honestly render "none recorded" + write-in —
  never fabricated content. When the real stores arrive, these templates
  pick them up through the same feed with no template change.
- Every template renders from the persisted clinical record only —
  never the live formulary (the byte-stability guarantee), missing data
  prints as a dash, charted `HH:mm` / `D-n HH:mm` times carry the †
  footnote, and identity resolves through the canonical resolver
  (roster record → Core patient-identity read → encounter snapshot,
  with the snapshot case labeled on the document).
