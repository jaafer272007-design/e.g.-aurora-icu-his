*[Recorded verbatim on 2026-10-05: the owner correction sent after Codex verified
head `dacab4e40bc469d6edf7ca262be7f8aae8675559`. Everything below the rule is the
request, unedited. This note is the only added text.]*

---

Continue on the existing branch and draft PR #234. Codex verified head `dacab4e40bc469d6edf7ca262be7f8aae8675559`. Check once for newer work and preserve it.
Implement this owner correction:
One action per medication round. After Given, Held or Refused, all three buttons lock until the next round’s scheduled time arrives. Then that round allows one action. Recording a dose must never immediately enable another future round.
Fix

* Disable all three actions before the exact scheduled time. Show when they will unlock and update automatically. The existing 30-minute “due soon” reminder must not permit early documentation.
* Enforce the same restriction on the real server, inside the existing order lock, against the freshly derived round and server time. Reject early submissions without adding administration facts or audit entries. Preserve duplicate/stale-round conflicts.
* Add immediate submission protection covering Given, Held, Refused and dialog confirmation. Keep controls disabled during saving and authoritative refresh. Handle failures visibly; reconcile uncertain outcomes before retrying.
* Mirror eligibility in the mock adapter.
* Preserve the approved timer: Given → actual administration time + prescribed interval; Held/Refused → skipped scheduled time + interval. Preserve backdating protection, overdue reasons, identities and concurrency locks. An already-due next round remains eligible; do not add an arbitrary cooldown.
* Preserve daily cards, hospital dates, midnight references, historical records, sidebar and filters. Distinguish a current round from one eligible for action now. No generated future rounds.

Relevant files: `MarCard.tsx`, `NurseWorkspace.tsx`, `marDays.ts`, `src/lib/time.ts`, `src/lib/api/data/orders.ts`, `src/lib/marSchedule.ts`, `server/Core/Mar/MarApi.cs` and `MarSchedule.cs`.
Address the screenshot explicitly
It shows continuous Insulin (Actrapid), 2.5 U/h, with three Given records at the same minute and immediately reusable ON DEMAND controls.
Currently, continuous medication has no derived repeat interval. Do not mistake U/h for a repeat frequency or claim scheduled locking fixes this screenshot.
Check for an existing prescription/protocol source defining its next documentation round and use it if present. If none exists, report that exact missing source and the smallest proposed change needed to define it. Do not invent an interval, once-per-day policy or permanent ban on PRN/infusion documentation. Complete the scheduled lock and submission protection, and clearly identify any unresolved continuous/PRN behavior.
Verify and finish
Use synthetic data and focused checks:

* A q1h dose Given at 06:05 produces a next round at 07:05. All actions stay unavailable before 07:05; one action succeeds when due.
* Cover Given/Held/Refused, rapid mixed clicks, dialog confirmation, direct early API attempts, stale pages, concurrent requests, refresh/polling, midnight and once orders.
* Confirm rejected submissions leave facts/audit unchanged. Preserve timer replay checks; update API tests that previously allowed future rounds early.
* Account explicitly for the continuous screenshot.

Work solo, reuse existing helpers/harnesses, avoid broad rescans and repeated full suites. Run required final builds once after source settles.
Update design/status notes, commit and push to the same branch, and update draft PR #234 with concise results and screenshots. Report final head, checks and unresolved decisions, then stop.
Keep main unchanged. No merge, installer/EXE work, hospital access/deployment, AI/HIS expansion or ongoing PR monitoring. Preserve the outstanding release/rollback gate.
