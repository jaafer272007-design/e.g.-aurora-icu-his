# 03_DEVELOPMENT_RULES — Aurora HIS: the working discipline

*[Docs split note (2026-07-10): unmarked lines were moved verbatim from the
pre-split CLAUDE.md. Lines styled like this one, and the bullets explicitly
marked as codified-from-practice or standing practice, are organizational —
each cites where the underlying claim is recorded.]*

## Build Methodology (follow in order, do not skip)
1. UI only, dummy data, HTML/CSS/JS first (already done for screens 1–3 —
   see /reference, treat as the exact visual spec, do not redesign).
2. Convert to a real Vite + React + TypeScript project. Extract shared
   tokens/components once — never re-derive per screen.
3. Review each screen against: UX, ease of use for doctor/nurse, fit with
   real ICU workflow, API-readiness, performance/code organization.
4. Only after a screen is approved, move to the next one in the roadmap.
5. Mock data adapters must be shaped exactly like a future real API response
   (field names, nesting) so swapping in ASP.NET Core endpoints later is a
   data-layer change only, never a UI rewrite.
6. No real API, no auth, no backend until Stage 9 below.

## Branching & pull requests

- One work item per branch, one branch per PR — every new screen or fix-set
  starts from a fresh branch off the latest main with its own PR; never
  continue new work on a branch that already has an open PR (the locked
  Branching decision — verbatim in 01_ARCHITECTURE.md § Locked Decisions).
- *[Standing practice, per project owner: Claude Code opens every PR as a
  DRAFT and never merges — the project owner reviews and merges.]*

## Documentation discipline

- *[Codified from existing practice (the pre-split file's own "SUPERSEDED
  by …" notes are the pattern): supersede, don't rewrite — a corrected or
  replaced claim keeps its original text with a note naming what superseded
  it; records are never silently rewritten or deleted. Doc-vs-code
  contradictions found while editing docs are flagged for the project
  owner, never silently "fixed".]*
- Seed files under `server/Data/` are GENERATED from the mock stores —
  never hand-edit them (stated on every seeded domain's record in
  02_PROJECT_STATUS.md).
- **02_PROJECT_STATUS.md is updated AS PART OF completing each
  significant piece of work** (a feature, a fix-set, a verification
  round) — the status record rides the same PR, or an immediate
  follow-up docs PR when the verification happens post-merge — so the
  file never drifts from the live state. Completing work without
  recording it is incomplete work. *(Codified 2026-07-11 per project
  owner; the "Last updated / current through" marker at the top of 02
  is refreshed with each such update.)*

## CI evidence — skipped ≠ passed (codified rule)

*[Docs split note: moved verbatim from the "CI Evidence" section, whose
incident and audit record stay in 02_PROJECT_STATUS.md.]*

**CODIFIED RULE — a skipped check and a passed check are visually
identical.** A run whose gated jobs are skipped still concludes SUCCESS
and shows green on the commit. Green CI is NOT evidence unless the job
carrying the assertions actually EXECUTED — before treating any check as
evidence (in review, in a verification report, in "CI is green"), open
the run and confirm the asserting job ran and reached its assertion
steps. The same rule covers local commands (a command that can exit 0
without evaluating anything is not a check) and two corollaries:
ABSENCE of a check is equally silent (manual-dispatch suites produce
evidence only when someone dispatches them), and an assertion whose
failure is swallowed by its surrounding construct (`cmd && echo` lists,
`read VAR <<<"$(…assert…)"`) gated nothing.

## Test on the engine that ships (added 2026-08-01)

**CODIFIED RULE — a test that passes on a different runtime than the one
customers run has tested nothing.** `installer/aurora-update.ps1` shipped
with PowerShell 7 ternary syntax (`$a ? $b : $c`). Its pure functions were
unit-tested on Linux under pwsh 7, where they passed. But `aurora.iss` and
`aurora-update.iss` launch their scripts with **`powershell.exe`** — Windows
PowerShell 5.1 on every hospital server — and 5.1 rejects that syntax at
**parse** time, which kills the whole file at load before a single statement
executes. Every hospital update would have failed. Nothing caught it because
CI ran no PowerShell at all and the tests ran on the wrong engine.

Consequences, binding:

- **No PowerShell 7-only syntax anywhere in `installer/*.ps1`** — no `? :`
  ternary, no `??` / `??=`, no `?.` / `?[]`. Write `if`/`else`.
- The `installer-powershell` CI job (windows-latest, `shell: powershell`)
  parses **every** installer script with the real 5.1 engine and runs
  `installer/test-update-pure.ps1` there. It asserts `PSVersion.Major -eq 5`
  first, because a gate that silently ran pwsh 7 would be indistinguishable
  from a gate that passed — the CI-evidence rule applied to the runtime
  itself.
- Generalise beyond PowerShell: when a script's production interpreter,
  shell, or runtime version differs from the one used in testing, the
  difference is the risk, and the test must move to the shipping engine.

## 🔴 Never squash migrations while a hospital may be behind (added 2026-08-01)

**CODIFIED RULE — existing EF migrations are append-only once any install
exists.** Squashing, renaming, deleting or re-timestamping a migration that
has already shipped is forbidden, however tidy it would be.

An app-only update carries the **whole** migration set, and a hospital may
skip releases (4.2 → 4.4 in one step is supported — see
`installer/UPDATE_AND_ENABLE_AI_DESIGN.md` §2.4a). A hospital that took every
release would survive a squash; the one that skipped a release would find
`__EFMigrationsHistory` rows with no matching migration in the assembly,
`Database.Migrate()` would throw at boot, the health check would fail and the
update would roll back. Nothing detects it in advance — `migrationHead` is
just the newest migration filename, so a squashed build still stamps a
plausible-looking head.

If a squash ever becomes genuinely unavoidable, it is not an app-only update:
that release becomes a supervised full-installer hop, and every hospital
behind it must be brought forward **before** the squashed build is cut.

## Deployed E2E suite disciplines

*[Docs split note: the two codified blocks below moved verbatim from the
Database-persistence and Formulary records in 02_PROJECT_STATUS.md; the
WARNING the first one references stays with the persistence record there.]*

- **Codified rule — finite seeded resources**: an E2E suite that
  CONSUMES a finite seeded resource is not idempotent against a durable
  database, no matter how careful the picking logic — the well
  eventually runs dry. Future suites must either CREATE the resources
  they consume (MAR/Timeline/Orders create their own orders; ADT admits
  and discharges its own patient) or assert READ-SIDE ONLY (auth, AI).
  Audit of the other six suites (2026-07-09): none consumes a finite
  seed. One related latent exposure — see the WARNING below.

- **CODIFIED TEST-COVERAGE LESSON (the general form of this miss)**: a
  SELF-SUFFICIENT suite that creates the entities it then uses will
  NEVER test the "entity does not exist" path unless that case is
  written explicitly — self-sufficiency (the finite-seeded-resources
  rule) systematically hides absence paths. Every suite must probe its
  REFERENCE LOOKUPS with ids that resolve to nothing, not only the ids
  it created. Audit (2026-07-10): the orders suite EXERCISES unknown
  drugIds (frequency legs, drugId 'x') but asserts acceptance-by-design,
  never rejection; the labs suite creates results only for its OWN
  admitted patient — create-with-unknown-patientId is never probed
  (the server validates it; nothing asserts it); MAR adds no
  independent reference (the drug rides on the order) and its own
  order/dose absence paths are probed; the formulary suite probes
  absent drugIds on MANAGEMENT endpoints but its order legs use only
  drugs it created. The missing absence probes SHIPPED with the
  safety-enforcement PR (unknown drugId/testId → 400 asserted in the
  orders/formulary/labcatalog suites; unknown-patientId result creation
  → 400 in the labs suite).

Cross-references (each rule recorded verbatim at the cited site):

- Build-gate content equality — every suite's warm-up gate compares the
  server build context (git tree/blob hashes of `server/` + `render.yaml`)
  between the dispatched ref and the deployed build: 01_ARCHITECTURE.md
  § Verification-gate content equality.
- Sequential dispatch — suites are never dispatched concurrently; all share
  `concurrency: group: deployed-e2e` and are still dispatched one at a
  time (GitHub keeps at most one pending run per group): the persistence
  and CI-hardening records in 02_PROJECT_STATUS.md.
- Failure-path cleanup — suites end with `if: always()` cleanup steps that
  release run resources and ASSERT each outcome: the CI-hardening record in
  02_PROJECT_STATUS.md.
- Absent-id probes must carry the token AUTHORIZED for the mutation (RBAC
  runs before the lookup; the generic 403 is no existence oracle): the
  four-code application record in 02_PROJECT_STATUS.md.

## Never destroy, never reset

- Deactivation/discontinuation, never deletion — anything ever referenced
  by a clinical or audit record stays resolvable forever: the Observation
  override rule in 01_ARCHITECTURE.md (Stage 11 section), and the Layer 3,
  results-audit, and formulary records in 02_PROJECT_STATUS.md.
- The do-NOT-reset-the-live-database rule stands: the spent-well record in
  02_PROJECT_STATUS.md (Database persistence).
- Every test write lands permanently in the single live environment — see
  02_PROJECT_STATUS.md § Single environment and 01_ARCHITECTURE.md §
  Environment separation.

## Live verification

- *[Codified from existing practice — the pattern every "(built)" record in
  02_PROJECT_STATUS.md documents: a server-side work item ships with local
  verification (behavior matrix + byte-parity sweep where applicable)
  before the PR, and its deployed E2E suite is dispatched against the live
  service after merge + deploy. A change is not done at merge; live
  findings are recorded (or fixed forward), never papered over.]*
