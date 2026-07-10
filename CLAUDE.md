# AURORA ICU — Adult ICU Mission Control (HIS Module)

## Goal
Best-in-class Adult ICU UI + workflow inside a Hospital Information System:
fast decisions, low cognitive load, easy for doctors/nurses, ready to wire to
real APIs and medical devices later. AURORA ICU is the FIRST MODULE of the
broader Aurora HIS platform — see "Platform Direction — Aurora Core +
Modules" below.

*[Docs split note: "Platform Direction — Aurora Core + Modules" now lives
in `01_ARCHITECTURE.md`.]*

## Documentation map (docs split, 2026-07-10)
This file is an index only. The project documentation lives in three files,
all equally binding:

- **`01_ARCHITECTURE.md` — the stable constitution.** Platform structure
  (Aurora Core + Modules), binding architecture rules, the three-layer RBAC
  model with the full permission matrix, canonical data domains, the
  aggregate root and encounter lifecycle invariants, the four-code error
  convention, cross-cutting server conventions (CORS, JWT, PostgreSQL
  persistence), the verification-gate content-equality rule, locked
  decisions, the design system, and accessibility requirements. Rules that
  are specified but not yet built (the Stage 11 Observation model, the
  Print Center, environment separation) are labeled as such there.
- **`02_PROJECT_STATUS.md` — the changing record.** Current status, the
  screen roadmap, every completed layer/stage/PR's build + verification
  record, the remaining build order, in-flight work, the
  single-environment artifact list, recorded open questions, and the PR
  history. New work gets recorded here.
- **`03_DEVELOPMENT_RULES.md` — the working discipline.** Build
  methodology, branching and pull-request rules, documentation discipline
  (supersede, don't rewrite), the CI-evidence rule (a skipped check and a
  passed check are visually identical), and the deployed-E2E suite
  disciplines (finite seeded resources, the coverage lesson, sequential
  dispatch, failure-path cleanup).

All content was moved verbatim from the pre-split CLAUDE.md; lines styled
*[Docs split note: …]* and the three subsections in 02 explicitly marked as
attributed additions are the only new text (see the split PR's description
for the audit notes and flagged pre-existing artifacts).
