*[Recorded verbatim on 2026-09-30: the follow-up sent after Codex's review of
draft PR #234 at head `87358f23074045f614b3aa2b2e5d39bbb770dfd5`. Everything
below the rule is the prompt, unedited. This note is the only added text.]*

---

Continue PR #234 on `claude/amazing-hopper-nwzw1x`. Codex reviewed head `87358f23074045f614b3aa2b2e5d39bbb770dfd5`, independently exercised the actual client scheduler/mock adapter, and confirmed all four GitHub CI jobs passed. Confirm the current head and account for newer changes before editing.

One focused timer correction remains. Keep the PostgreSQL locking, one-current-round model, existing frequencies, type filters, sidebar and evidence commits. Keep main unchanged and the PR draft. Installer changes, EXE building and hospital deployment remain deferred until the owner explicitly requests them.

## Reproduced defect

For a synthetic q1h order, on the same day:

1. Round 1 due 06:00 is Given at 06:05 → next due 07:05.
2. Round 2 due 07:05 is Held early at 06:10 → next due 08:05, following the confirmed skipped-dose rule.
3. Round 3 is Given early at 06:50 → next must be **07:50**, but currently remains **08:05**, with `timerRule=skipped` and `timerFrom=07:05`.

Refused instead of Held reproduces the same defect. These are synthetic accepted-record tests, not treatment recommendations. Orders next-dose reproduces it too.

`MarSchedule.CurrentRound` (C# lines 219-224) and `currentRound` (TS lines 120-125) take the largest timer instant. This mixes actual Given times with skipped scheduled times. A prior scheduled 07:05 suppresses a subsequent actual Given 06:50, although that actual time is later than the previous actual Given 06:05 and the skipped action at 06:10.

## Required behavior

After a subsequent valid current-round Given, use its actual administration time plus the prescribed interval, including after Held/Refused. Preserve the separate protection against a genuinely older backdated actual administration rewinding a newer effective timer. Distinguish action/actual chronology from scheduled due identity; do not solve this by dropping backdated protection or treating all timestamps as interchangeable.

Held/Refused must still advance from their own skipped round's scheduled due plus interval. Keep one unresolved round, stable distinct identities, original facts/reasons/audit, duplicate/stale conflict behavior and atomic writes. Do not add an early-dose restriction or reinterpret stored records to hide this defect. Mirror the corrected policy on server/client/mock and ensure API MAR, Orders, counts, audit timer metadata and print agree.

Answer to your legacy question: retain the original first due for an order with no recorded administrations, even if days overdue. That follows the owner's approved rule. Do not reset it automatically to now or fabricate a resolution.

## Focused verification and handoff

Reuse existing harnesses. Add this mixed sequence for both Held and Refused, followed by early/on-time/late Given. Check actual time supplied separately from later documentation, genuine older backdating, repeated refresh/current-round identity, and a fresh read of stored facts/history. Prove the reproduced case on the real local PostgreSQL API and server/client deterministic checks; verify affected MAR/Orders/print outputs with synthetic data. Retain passing concurrency coverage and row locks.

Work solo and conserve usage: inspect affected code only, reuse existing evidence, avoid broad rescans, teams or re-planning. Run focused checks while fixing, then required final builds/checks once; repeat only after a source change or real failure. No full browser matrix or repeat concurrency campaign unless this patch changes those paths. Correct relevant design/status/PR notes and publish the focused proof.

Push the correction to this existing review branch and update draft PR #234; branch pushes for this review are already authorized. Report full head, changed files, exact results and evidence links. Preserve the unresolved update-write/rollback release gate. Stop after the handoff, with no ongoing PR monitoring.
