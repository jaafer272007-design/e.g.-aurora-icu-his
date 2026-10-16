*[Recorded verbatim on 2026-10-04: the owner-approved request sent after Codex's
focused review passed at `def08a90e832f338fc8a50ecf438e73f9ded8245`. Everything
below the rule is the request, unedited. This note is the only added text.]*

---

# Aurora ICU — sidebar navigation and daily medication cards

Implement these two approved changes in the existing draft PR #234 for `jaafer272007-design/e.g.-aurora-icu-his`, on `claude/amazing-hopper-nwzw1x`.

Start from the reviewed commit `def08a90e832f338fc8a50ecf438e73f9ded8245`. Check the branch head and working tree once before editing. If newer work exists, preserve and reconcile it; do not reset it. `main` must remain at `f0bf4647c7fb921baf760225bf838f69f655c697`.

Codex has stopped its synthetic local preview. The owner approved the previous changes and these refinements. Proceed with implementation and verification in this same Claude session.

## 1. Sidebar stays expanded during navigation

Each section mounts a new `NavSidebar`, resetting its local hover state. Correct this within the shared sidebar using small shared in-memory mouse-hover state.

- When navigating Orders → Lab Entry → Observations with the pointer stationary over the sidebar, preserve its full width without requiring another mouse movement.
- Reconcile restored hover with actual pointer containment. Collapse only after the pointer leaves, retaining the existing short closing delay. Check the expanded label area beyond the collapsed icon rail too.
- Preserve existing hover intent, keyboard-focus expansion, touch toggling, narrow-screen drawer behavior, permissions, routes and patient context.
- Clear temporary hover state on sign-out. Do not persist it in local storage or restructure individual pages.

## 2. Nurse MAR: one prescription card per day

Under each patient, group medication rows into one card per **patient + order ID + hospital-calendar date**. Different prescriptions remain separate even when their medication names match.

Card header: medication name, dose, route, frequency and date, shown once. Inside, use compact round rows with scheduled time, round number when available, status, recorded actual administration date/time and reason. For Held/Refused, label documentation time accurately. Keep the existing visual language and make both themes readable.

Use the existing hospital/server clock helpers in `src/lib/time.ts`, including `localYmd`, `localDayNumber`, `localStamp` and the appropriate existing timestamp parser. Do not use the browser timezone or slice a UTC string to obtain the date.

Confirmed grouping and expansion rules:

- Scheduled rounds belong to their scheduled day. A dose scheduled before midnight but Given afterward stays in the earlier day's card; its actual administration date/time remains visible.
- PRN/on-demand documented doses belong to their documentation day. Their current availability and action controls belong to today.
- Today and days containing unresolved rounds stay expanded. Also keep the card containing the current actionable round expanded if that round is scheduled for tomorrow.
- At hospital midnight, today's card appears automatically for a prescription with a current actionable round or PRN/on-demand availability. Reuse the existing shared clock updates.
- If the outstanding round belongs to yesterday, leave its controls in yesterday's expanded card and show a clear reference from today's card. Do not duplicate controls or create a medication round just to populate today's card.
- Completed historical cards remain accessible, newest first, collapsed by default. Preserve the user's historical expansion choices through polling and refreshed server rows, using stable grouping keys.
- Keep undated legacy history accessible under **Date unavailable**. Do not invent dates.
- Show only recorded rounds and the single current round/availability returned by the existing MAR interface. Do not generate the rest of the day's future rounds.
- Historical rows are read-only. Given/Held/Refused controls appear only for the existing actionable round or PRN/on-demand availability.

## 3. Preserve the accepted medication behavior

This is a presentation change: no server API, database schema, migration, wire-format or stored-record changes.

- Preserve the rolling timer: Given anchors the next interval to actual administration time; Held/Refused retain scheduled-time-plus-interval behavior. Unresolved rounds remain the same round, and older backdated facts cannot rewind a newer effective timer.
- Preserve overdue reason validation, backdated-time protection, round identities, concurrency locks and stale/duplicate handling.
- Keep due counts derived from actionable rounds, using the existing predicate, rather than card counts.
- Keep actions bound to the original `orderId` and `adminId`. Preserve the existing reason/time dialog and refresh from the server after successful documentation.
- Keep the previously approved Orders type/status filters intact. Remain ICU-only; no AI or abandoned HIS/reception features.

Relevant starting points: `src/components/NavSidebar.tsx`, `src/pages/NurseWorkspace/MarCard.tsx`, `src/pages/NurseWorkspace/NurseWorkspace.tsx`, `MarRow` in `src/lib/api/types.ts`, and `src/lib/time.ts`. The current MAR UI renders each row separately; build the daily grouping around the existing rows and action flow. Reuse existing helpers and evidence. Do not broaden this into unrelated timestamp, printing or scheduling repairs.

## 4. Focused verification

Use synthetic data only. Verify:

1. Stationary-pointer navigation through Orders → Lab Entry → Observations → Orders stays expanded, including over labels outside the icon rail; actual pointer exit collapses it.
2. Keyboard focus, touch toggling, narrow-screen drawer and sign-out reset remain correct.
3. Several rounds of one prescription on one day produce one card; two prescriptions with the same medication name remain separate.
4. Hospital midnight rollover, a timezone boundary where UTC and hospital dates differ, yesterday's overdue round, tomorrow's current round, and pre-midnight scheduled/post-midnight Given documentation follow the rules above.
5. PRN and continuous/on-demand history and availability, undated legacy history, polling and historical expansion persistence work without duplicate controls or altered due counts.
6. Original action identities and server refresh still work. Existing Given/Held/Refused timer checks continue to pass.
7. Daily cards are readable in dark/light themes and narrow layouts. Capture concise synthetic screenshots showing grouping and the relevant edge cases.

Work solo and conserve usage: inspect the relevant files once, reuse the existing harnesses/evidence, run focused checks during development, and run required final builds once after the source is settled. Repeat checks only to resolve an actual failure or verify a subsequent source change. No broad rescans, parallel agents, speculative review campaigns or repeated full test suites for this UI change.

Update the existing design/status notes and publish concise verification results and screenshots with the existing draft PR. Commit and push the changes to its current branch; update that PR rather than opening another. Report the final head, changed files, checks and any genuine limitations, then stop.

Keep `main` unchanged. No merge, installer/EXE build, installer modification, hospital deployment or ongoing PR monitoring. Preserve the outstanding release/rollback gate for the later release phase; the owner will explicitly request the update installer when all hospital changes are ready.
