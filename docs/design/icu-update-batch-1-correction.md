# Follow-up for Claude — correct PR #234

**Ready to send: updated for the owner's rolling-timer clarification and confirmed Held/Refused rule on 2026-09-30. This replaces the earlier correction prompt's late-only scheduling instructions.**

Continue in the existing ICU session and branch `claude/amazing-hopper-nwzw1x`. The reviewed head is `2d14aa0ead0dccf09077b82f959bd5c33cc73320`; confirm the current head and account for any newer changes before editing. Codex inspected the application diff and published evidence, independently exercised the actual client scheduler, and confirmed all four GitHub CI jobs passed on that reviewed head. Keep the evidence commit. Preserve the current order-type filters and sidebar behavior.

The owner has explicitly deferred the update EXE: the hospital wants more changes. **Do not build an installer or deploy to the hospital until the owner explicitly requests it.** Keep this PR draft and main unchanged.

## 1. Make medication documentation and re-timing atomic

The handler reads administrations, validates and calculates the anchor, replaces `AdministrationsJson`, appends history and saves without concurrency protection. Two overlapping submissions can both return success and lose a fact/audit entry/anchor. Sequential duplicate checks are insufficient. Although the persistence gap predates this batch, the new schedule depends on these writes being safe.

Implement a minimal database-backed concurrency/atomic-write mechanism covering the complete read/validate/append/anchor/audit operation and relevant competing mutations on the same order. A plain read-committed transaction or process-local lock alone is insufficient. Use existing repository error conventions; a stale/conflicting action should return an explanatory 409 or be safely revalidated against fresh facts. Keep saved facts, audit events and the effective schedule consistent. Explain any model/schema compatibility change.

Prove it with synchronized overlapping requests on local PostgreSQL and synthetic data: the same current instance; a second action made stale by a competing Given that starts a new round; and a relevant order-state change. If historical documentation allows two distinct valid facts on one order, prove that both successful writes remain durable. Also show that independent orders can proceed safely. Check response codes and the durable post-request facts/history/timer after a fresh read. Do not rely only on sequential requests or unsynchronized stress loops.

## 2. Replace the fixed repeating grid with the owner's rolling timer

The owner clarified on 2026-09-30: "basically the timer of the next round will start after the first has been given (not something fixed)". This supersedes the first handoff's late-only shift, unchanged-early-Given rule and continuing fixed-grid future/missed rounds. It is a workflow correction, not just a patch to the previous floor predicate. Keep the existing medication frequencies; minute-based frequencies remain outside scope.

For an active, derivable repeating medication, each current dose's actual Given time starts one new interval: **next due = actual Given time + the prescribed interval**, whether that administration was early, on time or late. Until the current dose is resolved as Given, Held or Refused, it remains the same dose as it becomes due/overdue; advancing the clock alone must not create additional future rounds or a stack of automatically generated missed rounds.

Keep the initial first-dose calculation unless a required compatibility adaptation is explained. Once a Given starts the next round, that round remains stable and actionable across refreshes, midnight and multi-day delay. The old 24-hour summary horizon must not make the only current overdue round impossible to document. Use the supplied actual administration time when present, with the existing server-time fallback and validations; the audit/documenting time remains separate. Preserve the two-hour reason rule, judged against the documenting moment. Once, PRN and underivable/continuous regimens retain their existing behavior.

Examples using the existing q1h frequency:

- Current 06:00 dose Given at 06:05 -> next due 07:05. At 08:30 with no further Given, 07:05 remains the sole current overdue round; do not also create 08:05 or 09:05 rounds.
- That 07:05 dose Given at 08:30 -> next due 09:30.
- Current 07:05 dose Given early at 06:50 -> next due 07:50.
- Current dose Given on time at 07:05 -> next due 08:05.

Separate actual-administration chronology from scheduled identity. A genuinely older backdated actual time must not rewind a newer effective timer. The already-approved synthetic compatibility case remains: preserve an existing 07:00 slot Given at 06:50 and an outstanding 06:00 slot subsequently Given at 06:55; next future round must be 07:55. Treat out-of-order old slots as a compatibility/history scenario, not as permission to create multiple new current rounds.

**Held/Refused — owner-confirmed rule:** keep the existing skipped-dose behavior: next due = the current skipped dose's scheduled time + the interval, not its Held/Refused documenting time. Example: a q1h dose due 07:05 marked Held or Refused at 07:20 -> next due 08:05. Preserve the required reason, original status and audit entry. Each such resolution advances to one next current round; if that next due is already in the past, it is overdue, not silently skipped or automatically documented. It does not pause the order. A subsequent Given starts its next interval from its own actual administration time.

Preserve original scheduled/actual times, reasons, statuses and audit history of every stored administration. Do not fabricate catch-up administrations or silently mark unresolved doses Given/Held/Refused. Distinguish stored legacy facts from old clock-derived grid rows; do not keep the obsolete fixed-grid generation merely to preserve unpersisted predictions. Explain how existing active orders enter the new policy without silently changing historical facts or unexpectedly using an old late event to start a new timer. Use minimal explicit metadata where needed and document compatibility.

Make dose identity stable across refresh and specific to the round; historical facts and sequential rounds must remain distinguishable even if due timestamps coincide. Keep same-round duplicate/stale submissions meaningful and safe. Mirror the policy on server and client, including the mock adapter, Orders next-dose, MAR, due counts and print. Update design/status notes with an attributed supersession of the old segmented-grid rule.

Reuse the existing deterministic and real-API checks, adapting their expected outcomes to this policy. Cover late/early/on-time Given, an unresolved dose while the clock advances, multi-day overdue actionability, repeated rounds, explicit actual time versus later documentation, older backdated records, legacy activation, frequency modification, stopped/discharged orders and the confirmed Held/Refused behavior (early, on-time and late documentation; next scheduled time still calculated from the skipped slot). Include a focused UTC-storage/Asia-Baghdad-display check of the new timer and actual time; do not expand into the separately excluded timestamp repairs.

## 3. Correct the rollback guarantee in the documentation

The statement that automatic rollback happens before any new fact can exist is unsupported. `aurora-update.ps1` starts the new service before its health/build checks, with no inspected clinical-write barrier; its database restore is conditional on `migrationWillRun`, which is false for this JSON-only data change.

Correct the PR description/status/design notes wherever this guarantee appears. State the downgrade risk accurately and record an unresolved release gate for write exclusion during update validation and a failed-health rollback drill with anchor-bearing facts. Keep installer implementation and EXE creation deferred; do not implement installer changes in this correction batch or claim the existing staging tests prove this gate.

## Verification, usage and handoff

Reuse existing findings, helpers, scenarios and evidence. Work solo, inspect affected callers only, and keep the correction small. Run focused regression/concurrency checks while fixing, then required builds/checks once on the final source; repeat only for later changes or actual failures. Keep logs in files and return concise results. Confirm the corrected sidebar/filter controls remain readable in the dark theme as a small browser regression check; real touch hardware may remain explicitly unverified.

Update the current draft PR with the corrected commits, review findings resolved, durable focused evidence and accurate remaining limits. Branch pushes for this review are authorized; merging, installer building and hospital deployment are not. Report the PR link, full final head, changed files, compatibility choices and exact checks/results/evidence paths. Stop after the handoff, with no ongoing PR monitoring.
