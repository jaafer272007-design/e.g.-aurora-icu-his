# Aurora ICU — first update batch

Implement the three owner-requested changes below in `jaafer272007-design/e.g.-aurora-icu-his`. Codex handles planning/design and independent review; Claude handles implementation. The owner confirmed on 2026-09-30 that the 30-minute example was illustrative: use existing medication frequencies; minute-based frequencies are outside this batch.

## Source and scope

GitHub is authoritative. Refresh `main` and record your actual working directory, branch and base commit before editing. Codex verified `main` at `f0bf4647c7fb921baf760225bf838f69f655c697`; the hospital's supplied production version is protected setup 1.3.0 at `2c92e913a4bb140d4667f9e0f987097de5441c31`. The intervening commit changes only the shipping ledger. If main has advanced, account for those changes first. Use a fresh branch/isolated checkout and synthetic data. Preserve the ICU-only, no-AI product scope and existing protected Windows update lineage.

Read `CLAUDE.md` and relevant development rules. Start from the affected files identified below rather than rediscovering the repository. Keep this batch reviewable before publishing or packaging: no push, merge, installer build, hospital access, live migration or real clinical-data changes. Do not include the separate timestamp findings, abandoned HIS/Reception work, or unrelated cleanup in this batch.

## 1. Order-type filters

The existing `OrderListCard.tsx` status tabs are All, Pending, Active, Completed and Discontinued. Preserve them and add a separately labeled type-filter row: All types, Medication, Laboratory, Imaging. Laboratory maps to category `Lab`.

The two selections combine with AND. For example, Active + Laboratory shows only active lab orders; Completed + Imaging shows only completed imaging orders. Default to All types. All types includes Nursing and every existing category. Keep status counts meaningful for the selected type, and make empty-state text describe the combined selection. Preserve current sorting, patient scope, refresh behavior, histories, next-dose display, permissions and every sign/modify/discontinue/implement action. Fit the controls into the current design, with clear selected states, keyboard support and sensible wrapping on smaller screens.

## 2. Late medication administration shifts the next repeating dose

The owner explicitly replaces the old rule that a late dose never shifts the therapy-start grid. Update the related design/status documentation with an attributed supersession dated 2026-09-30; the old document is historical context, not a reason to reject this authorized change.

For an active, derivable repeating medication, when a dose is recorded Given and its actual administration time is later than its scheduled time, the next repeating dose must be actual administration time + the prescribed interval. Example: q1h, due 06:00, given 06:05 -> next 07:05, then 08:05. If the 07:05 dose is given at 07:12, next becomes 08:12. Use the recorded actual administration time when supplied, with the existing server-time fallback; the audit/documentation time remains separate.

Apply this to existing interval regimens, including hourly intervals and the current daily/bid/tid/qid interval interpretation. Keep the current reason requirement unchanged: OVERDUE starts immediately, but a delay reason is required after the existing two-hour threshold. A five-minute delay must shift the next interval even though it does not cross that threshold. Preserve the reason validation against the documenting moment and existing actual-time validation; backdating must not bypass the reason rule.

Held/refused, early/on-time Given, once, PRN and underivable/continuous regimens retain their existing scheduling behavior. Preserve completion, discontinuation, encounter scope and administration permissions.

Implement the rule authoritatively in the server's schedule derivation and administration validation, and mirror it in the client scheduler/mock adapter and Orders next-dose display. Use shared helpers within each language so the write endpoint accepts exactly the instances the read side derives. Inspect the MAR print path and due-count consumers so they agree with the new schedule.

Preserve all historical administration values, original scheduled times, actual times, reasons and audit history. Introduce minimal explicit metadata on new schedule-adjusting administration facts, or an equally precise audited mechanism, so installing the update does not silently reinterpret pre-update late administrations and shift every active order. Derive expected doses from facts; do not persist a table of generated future slots.

Retain historical missed doses distinctly from the revised future grid; do not mark them given or erase them. Avoid duplicate future doses, preserve the render horizon/missed summary, and ensure schedules continue across days. Recording an older dose later must not rewind a newer effective schedule. Keep duplicate/conflicting submissions safe, including a second browser posting a now-superseded future instance. Explain any necessary additive data change and its compatibility before release.

## 3. Interactive collapsible section sidebar

The owner wants the primary section sidebar (ICU Beds, Orders & Meds, Lab Entry, etc.) to collapse when the pointer is away and expand to its full labeled width when the pointer is over it. Apply this consistently to the existing ICU screens using the shared `NavSidebar`.

On devices with a mouse, start as an approximately 64px icon rail. Hover anywhere inside the rail to expand to the existing normal labeled width; keep it open as the pointer moves into the expanded area, and collapse on leaving. Keep it expanded while keyboard focus is anywhere inside, even if the pointer leaves. Collapse after both hover and focus have left. Use a short, restrained transition, honor reduced-motion preferences, and prevent flickering at the moving edge. Icons, active-section indication, accessible names and tooltips remain usable while collapsed. Labels and the existing footer are readable when expanded; scrolling must keep every permitted section reachable on a short screen.

For touch/no-hover devices, provide a clearly labeled tap toggle with accurate `aria-expanded` state and visible keyboard focus. Opening the sidebar must not accidentally navigate; tapping a section must still work. Use an appropriate compact treatment on narrow screens without making sections unreachable or forcing desktop hover behavior onto touch users.

Coordinate the sidebar with its parent shell's navigation column so the main content uses the space freed by collapse. Preserve patient rails, bed-detail panels, page scrolling, responsive breakpoints and the current appearance. Current page styles independently define shell columns (often `198px`, then `64px` below 1180px), while `NavSidebar.css` hides labels at that breakpoint; these rules must agree with the new expanded state. Prefer shared sizing/state and minimal adaptations to affected shell definitions. Do not merely narrow the component inside a full-width empty column, overlay clinical controls unexpectedly, or rebuild page layouts. Hover/focus changes must not remount pages, lose form drafts, reset scroll positions or send clinical requests.

Preserve all navigation routes, role permissions, active states, patient-context links, edition/AI gates and existing footer information. Reception, Awaiting Bed and AI remain unavailable in the ICU/no-AI product.

## Focused implementation starting points

- `src/pages/OrdersMedication/OrderListCard.tsx`, `OrdersMedication.css`.
- `server/Core/Mar/MarSchedule.cs`, `MarApi.cs`; administration DTOs in `server/Core/Orders/OrderModels.cs`.
- `src/lib/marSchedule.ts`, `src/lib/api/data/orders.ts`, relevant API types/adapters, `src/pages/NurseWorkspace/MarCard.tsx` and due-count consumers.
- `src/pages/PrintCenter/templates/MarSheet.tsx`, `docs/design/mar-derived-schedule.md`, relevant project-status notes.
- `src/components/NavSidebar.tsx`, `NavSidebar.css`, shared frame styles in `src/styles/tokens.css`, and the navigation-column definitions in ICU page shell styles. Preserve the other columns when adapting these definitions.

## Acceptance evidence

Use synthetic data and deterministic clocks for scheduler/API checks. Verify combined type/status filters, counts, empty states, patient changes and permitted actions in the browser. Verify late q1h and q8h shifts, repeated delays, explicit actual time versus later documentation, the two-hour reason boundary, midnight/multiple-day behavior, historical misses and legacy records. Cover unchanged on-time/early/held/refused/once/PRN behavior, frequency modification compatibility, discontinued/discharged orders, duplicate/stale submissions, and agreement between server MAR, Orders next-dose, due counts and print output.

Verify sidebar collapse/expansion in the browser with pointer entry/exit, movement into the expanded area, keyboard focus and touch emulation. Check two-column and three-column ICU layouts, particularly Beds, Orders, Labs and Lab Entry, plus the available doctor/nurse/administrator/pharmacist/lab navigation variants. Check normal desktop, the existing 1180px breakpoint, a narrow touch viewport and a short viewport. Confirm labels can expand below the old icon-only breakpoint when there is room, all sections remain reachable, content uses the released space, drafts/patient context/scroll are preserved, and forbidden HIS/AI items stay hidden. Include collapsed/expanded screenshots with the viewport and role identified.

Exercise the real API and stored facts; development mock fallbacks alone are insufficient. Reuse the applicable MAR/orders fixtures without contacting the retired hosted test service. Run the required frontend and backend builds on the final source. Report skipped/unavailable checks explicitly. Provide a small set of browser screenshots and exact before/after schedule results for Codex review.

## Usage discipline and handoff

Work solo by default. Reuse this handoff and existing findings/components/fixtures. Search only affected code and callers; expand when evidence shows a dependency or failure. Avoid rereading unchanged files, repeated plans, agent teams, duplicate reviews and unrelated investigations. Reassess repeated failures instead of retrying the same approach. Run focused checks during implementation and required broader checks on the final code; repeat only when later changes/failures justify it. Never skip required verification to conserve usage.

Keep full logs in files and return a concise report with workspace, branch/base/current commit, changed files, exact test commands/results/exit codes, important warnings, evidence paths, compatibility choices and unresolved issues. Stop when these acceptance criteria pass and hand the results back for Codex review.
