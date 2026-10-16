*[Recorded verbatim on 2026-10-05: the follow-up sent after Codex verified the
one-action-per-round head `d66c6cf2c1bd2e84bd66446f0281c460b3e8f1ca` — the owner's confirmed
decisions on the questions left open in `mar-derived-schedule.md` ### E, and the correction
of the uncertain-save settlement. Everything below the rule is the request, unedited. This
note is the only added text.]*

---

Continue in existing draft PR #234, branch `claude/amazing-hopper-nwzw1x`, from reviewed head `d66c6cf2c1bd2e84bd66446f0281c460b3e8f1ca`. Check once for newer work and preserve it.
Codex verified the scheduled lock: 36/36 client/mock checks passed in each of two timezones, and all four GitHub CI jobs executed successfully. Implement these follow-ups.
1. Apply the owner’s confirmed decisions

* Continuous medicines are an exception: documentation remains available when needed. Do not add a recording interval.
* PRN stays as needed: do not turn its hidden frequency into a minimum interval.
* First dose is available immediately after signing, including once orders. Subsequent scheduled rounds remain locked until their due time.
* Preserve existing administration history, truthful identities/day grouping and unresolved legacy orders. Do not silently reset their schedules.
* Keep submission and safe-retry protection for every medication type.

Append these decisions to the existing design/status record, superseding the open questions without deleting their history.
2. Correct uncertain-save settlement
`NurseWorkspace.tsx` currently declares “Dose NOT recorded” and unlocks after an empty server read taken at least 15 seconds after failure. An original POST may still be processing and commit later.
Codex reproduced two failures using your unchanged production handlers with simulated transport and a controlled clock:

1. At failure +15,501 ms, the original save was still pending. An empty read unlocked controls and accepted another on-demand attempt. A later original commit produces two records.
2. A newer read had already applied a committed fact. An older settlement read then arrived. `applyMar` ignored its stale payload, but `settleMar` still used it to declare “Dose NOT recorded” and unlock.

Fix both:

* Discard stale settlement verdicts as well as stale display updates.
* Correlate confirmation to the specific round/save attempt.
* Elapsed time plus an absent snapshot must not be treated as proof of failure.
* Make retries safe if the original request commits later. Preserve the original attempt identity/payload and enforce server deduplication where round identity alone is insufficient, especially PRN/on-demand.
* Intentional later documentation must remain possible as a new attempt.
* Retry wording must concern saving the existing documentation; never suggest administering an uncertain dose again.

Use the smallest robust implementation under the existing order lock. Document any necessary additive API/JSON metadata and its compatibility accurately.
Verification and handoff
Use focused synthetic checks for:

* delayed original commit beyond 15 seconds;
* out-of-order settlement responses;
* safe retry producing exactly one fact/audit entry;
* intentional later PRN/continuous documentation;
* immediate first-dose/once availability;
* unchanged locking and timer behavior for subsequent rounds.

Work solo, reuse existing harnesses, avoid broad rescans and repeated full suites. Run required final builds once after source settles.
Update design/status notes, commit and push to the same branch, and update draft PR #234 with concise evidence. Report final head, checks and limitations, then stop.
Keep main unchanged. No merge, installer/EXE work, hospital access/deployment or ongoing monitoring. Preserve the unresolved release/rollback gate.
