# Approval fixes for the ICU update: MAR refused retry and the New Nursing Order draft (2026-10-16)

Codex reviewed head `72a7894` (last source commit `4f1009d`) and found two blocking defects. Both are fixed here, each in its own source commit on draft PR #234 (branch `claude/amazing-hopper-nwzw1x`).

**This is local synthetic verification for Codex review.** It is not release approval, and it is not hospital or deployed acceptance. `main` is unchanged. Nothing here merges, builds an installer or EXE, or touches a hospital or a hospital database.

| | commit |
|---|---|
| reviewed head | `72a7894` (source `4f1009d`) |
| fix 1: MAR refused retry | `8a0cadc`: `src/features/nurse-care/marController.ts` |
| fix 2: New Nursing Order draft scoped to its patient | `ff08a52`: `src/pages/OrdersMedication/{OrdersMedication,NursingOrderCard}.tsx` |
| **last source commit** | **`ff08a52`**. Every result below ran on this commit (or, for the reproductions, on `72a7894`). Later commits are docs/evidence only. |
| server source | identical to `72a7894` (`git diff --stat 72a7894 ff08a52 -- server` is empty; see log 00) |

## 1. What was wrong, and what changed

**Fix 1: a refused MAR retry reopened an unresolved dose.** In `MarController`, a retry of an unconfirmed attempt that was refused with anything other than 401 counted as definitive. This covered a server 403, the client-side permission check (no status), and the refusal that follows the pinned-minute fallback. The lock moved to `settling`, and the next server read with no fact removed it. The controls reopened, the nurse could document a new attempt, and the held original still committed: two facts for one intended PRN or on-demand dose. A PRN dose has no round, so the server cannot deduplicate it.

Such a refusal can happen before the server's order lock and attempt lookup (RBAC, request validation, the client-side check). It therefore never proves the original failed, and an absent fact proves nothing either. After the fix, a **refused retry leaves the attempt unconfirmed with its stored copy**. Only the record settles it: its own fact, or its round or `once` dose documented by another fact. The rule is the same as the nursing-rounds controller's (Amendment 1 §9.2). In detail:

- The same rule applies to an answer that arrives after sign-out or an account change (`settleOrphan`). The signed-out nurse's stored attempt is kept, and another nurse's storage is never touched.
- The actual reason is shown. Retry refusals now get a "Retry refused" toast with the server's or the client check's reason. A 401 keeps its existing "sign in again, then retry saving" toast, unchanged.
- Every refused retry leaves a row notice: "Retry refused — <reason>. Your original <action> documentation may already be on the record; checking." The notice clears when the record confirms the attempt. No wording advises giving the dose again.
- Unchanged: first-send refusals (definitive, "Not recorded"), successful answers, same-attempt replay, the pinned-minute fallback itself, the rolling timer and the medication exceptions.

**Fix 2: the New Nursing Order draft crossed patients.** The form owned an unkeyed draft, and `handleNursingOrder` used the routed `patientId`. A draft typed on `/orders/A` survived a patient-rail switch to B with Pending and Sign & order enabled, so it could be created as a B order. The page also kept A's header and order list on screen until B's reads landed, and an A read or an A write's refresh could land on B's page. After the fix:

- The editor is keyed by the patient it is shown for and sends that patient's id with its submission. A switch mounts a fresh one-time / Routine editor.
- An A submission in flight keeps A, refreshes only A (and only while A is routed), and its answer cannot clear or re-enable anything under B.
- The roster identity, the order list, the not-found flag and the weight are held with the patient they were read for, and shown only while that patient is routed. The previous patient's header and prescribing body are gone from the first render after a switch, with no clear-after-render effect.
- Order-list reads, including the nursing Done's authoritative refresh, land only for the routed patient and in the order they started. RBAC, schedule rules and the APIs are unchanged.

## 2. Runs (all local, synthetic data)

| log | result | what |
|---|---|---|
| `logs/00-builds-and-gates.log` | all exit 0 | **Once, clean worktree of `ff08a52`:** `tsc -b --force`; `vite build`; the production and staging bundles; the `VITE_APP_ENV` allow-list gate (the mirror check, plus an unknown value refused by the gate's own message); the five `ci.yml` node gates; `dotnet build -c Release` (the one pre-existing CS8602 warning); `dotnet publish`; a server-source diff against `72a7894` (empty). It also built the **pre-fix** production bundle at `72a7894`, used only for the reproductions. *(An earlier pass ran on the local commit `768b109`. That commit was replaced before any push, because the 401 toast was made byte-identical to the shipped one, so that pass was discarded and this log is the only gate run of the final source.)* |
| `logs/01-probe-unchanged-controller.log` | **36 passed, 34 failed: the defect** | `tools/mar-refused-retry-probe.ts` against the **unchanged** published controller at `72a7894` |
| `logs/02-probe-corrected-controller.log` | **70/70** | the same probe, unchanged, against `ff08a52` |
| `logs/03-controller-harness-corrected.log` | **74/74** | Session 3's controller harness (unchanged) on `ff08a52`: MAR M1–M10 (delayed original, out-of-order reads, reload, the pinned 400 fallback, route and patient switch, sign-out, an attempt from the previous build, **the 401 retry**, double click, first dose and round taken), nursing rounds N1–N11, the I&O guard |
| `logs/04-approval-boot-and-setup.log` | 11/11 | one disposable **production** pairing: boot plus `tools/approval-setup.py` |
| `logs/05-legs-pre-fix-reproduction.log` | **18 passed, 16 failed: both defects on the real server** | `tools/approval-legs.mjs pre-fix`, with the `72a7894` production bundle in wwwroot |
| `logs/06-swap-and-restart.log` | ok | the corrected production bundle swapped into wwwroot, then a restart on the **same** database |
| `logs/07-legs-fixed.log` | **34/34** | `tools/approval-legs.mjs fixed`, then the disposable server stopped |
| `logs/08-mar-saferetry-replay-corrected.log` | **41/41** | the affected MAR browser suite, once: Session 3's `saferetry-*.v2` (unchanged; scenarios F, S1, S1b, S2, S3, S4, each ending with an intentional later PRN or continuous documentation). It ran on the corrected **staging** bundle, same origin, on a fresh demo-seeded disposable database; server stopped afterwards |

The 110-check combined integration suite (`../integration/`) was **not** rerun, as instructed. Its one MAR retry assertion (`integration-check.mjs`: a 401 retry gets the "Save not confirmed … session has expired" toast) still describes the corrected code, because that toast is unchanged.

## 3. What each kind of evidence is

- **The probe** (`tools/mar-refused-retry-probe.ts`, built by `tools/run-probe.sh`) is **controlled-transport evidence, not a server test**. It imports the real `MarController` and the shipped mock store (`applyAdministration` and `deriveMarRows`, the client-side mirror of the server's MAR rules) and runs under a fake clock.
  - The 403 has the real server's `Rbac.Deny` answer shape, injected by the probe.
  - The client-side refusal is the **shipped** `documentAdministration` adapter's own permission check. The probe reaches it by having the same display name sign in under a title without `meds.administer`.
  - The probe was written once and run unchanged against both controllers.
- **The legs** (`tools/approval-legs.mjs`) ran on **a genuine same-origin production pairing**: the server publish serving the bundle from wwwroot, `APP_ENV=production`, disposable PostgreSQL 16, and synthetic accounts each taken through its forced first-login change, with the **shipped role profiles (nothing granted)**. Every MAR documentation, order read and order create reached the real server and database. The only test-side control was Playwright routing of the browser's own requests:
  - **response loss:** the first Given was aborted toward the page, kept, and later delivered to the real server with the nurse's own token;
  - **a real 403 before the order lock:** the page's retry was sent to the real server carrying the token of a **disposable Receptionist** account. The real server refused it in RBAC, before the order lock and the attempt lookup. This models "a refusal that precedes the attempt lookup". It does not model a specific field cause, such as a role change in the middle of a shift;
  - **held reads:** A's order and roster reads were held for under the client's 8-second read timeout;
  - **a held create answer:** the real server committed A's create, and the page received the answer later.

  No response was answered by a simulator.

## 4. Results by requirement

**MAR (fix 1)**

| requirement | evidence |
|---|---|
| uncertain original → retry refused 403 / locally → authoritative empty read → still locked, same attempt → delayed original → exactly one fact → unlock only once confirmed | probe R1 (403) and R2 (client-side), 70/70 corrected vs. two facts each unchanged. **Real server:** leg M, 403 from RBAC, a real empty read, still "Not confirmed", Given/Held/Refused disabled, the same attempt stored. The original was delivered late (200) and the database (`Orders.AdministrationsJson`) holds exactly **one** fact, the original attempt. "Saved — confirmed" follows; the controls reopen, and the notice and stored copy are gone. The page sent only the original and its one retry. Pre-fix on the same server: the dose reopened, the nurse documented it again, and the database held **two** facts. |
| both entry points | leg M: the patient chart's care panel, then the Nurse Workspace by client-side navigation. Both show the same attempt locked. |
| pinned-time fallback: original body re-sent after a 400, then refused | probe R3 (unchanged: two facts; corrected: one). The fallback itself still records once when the original body is accepted: harness M4, and saferetry S4 on the real server. |
| sign-out while the refused retry is in flight; another nurse's storage | probe R4: A signs out, B signs in, A's retry is refused. A's stored attempt is kept and B's stored attempt and lock are untouched. When A signs back in, the attempt is restored, unconfirmed, then confirmed with one fact. Unchanged code deleted A's stored attempt. *(Controlled transport only; not a browser leg.)* |
| the actual reason, never "session expired" for a 403 or local refusal, never advising to give again, controls locked | probe R1 and R2, leg M (`Retry refused — Insufficient permissions. Your original given documentation may already be on the record; checking.`), `screenshots/fixed/m1`, `m2` |
| 401 unchanged | probe R5, harness M8, and the same toast text as the integration suite asserts |
| first-send refusal still definitive | probe R5 (409 on a first send → "Not recorded", settled) |
| stale reads, first dose, rolling timer, intentional later PRN / continuous documentation | harness M2, M10 and N1; saferetry F, S1, S1b, S2, S3 and S4 on the real server, each ending with a deliberate later documentation (a new attempt). Probe R1 also records a deliberate later PRN Given as a second fact with its own attempt id. |

**New Nursing Order (fix 2)**, all on the real server (leg N)

| requirement | fixed | pre-fix (`72a7894`) |
|---|---|---|
| A: instructions, Urgent, Repeat 30 min → switch to B: clean one-time / Routine editor, nothing enabled until B has its own valid input | first sample after the switch: no header, no editor. Then B's clean editor, with submit enabled only for B's own text | A's text, Urgent and the repeat interval live under B, with Pending and Sign & order **enabled** |
| switching back revives no A draft | empty Routine one-time editor | A's interval controls still set |
| A's order and roster reads held, released after B is shown with its own draft | B's header, list and draft intact. While A was routed, no B display with an enabled editor appeared | B's display stayed under A's route; A's late order read **replaced B's list** |
| a real A create, answer held; switch to B, type a B draft; release | one order, for A only (database); B's draft and list intact; the toast names patient A | **B's draft cleared**, and **B's list replaced with A's orders** |
| nothing written by the draft probe | no order carries the probe text | same (the reproduction wrote no order) |

## 5. Screenshots

- `screenshots/fixed/`
  - `m1`: chart, refused retry, row locked with the reason
  - `m2`: Nurse Workspace, same lock
  - `m3`: 390 px chart panel. No horizontal overflow (checked), but the 8-second toast covers part of the row in this capture. It also shows the pre-fix run's discontinued PRN order above, with its **two** given facts.
  - `m4`: confirmed
  - `n1`: A's draft and B's clean editor
  - `n2`: B after A's late reads
  - `n3`: B after A's answer, with B's draft kept and the toast naming patient A
- `screenshots/pre-fix/`: the same captures from the reproduction.
- `screenshots/saferetry-replay/`: the replay's own captures.

## 6. Notes, limitations, and what stays open

- **A consequence of fix 1, by design:** an unresolved PRN attempt whose retries are all refused stays locked for that nurse in that tab until its fact appears. This is the same as an unanswered attempt today: an absent fact is not proof. If the original truly never committed and the nurse can no longer document (for example, lost `meds.administer`), the order stays locked in that tab.
- The other Orders & Medication cards (medication, lab, imaging, order sets) were not changed. On a switch, the patient-keyed gate unmounts the whole prescribing body, so they also remount fresh, and their handlers capture the routed id together with the displayed patient's render. Only the nursing form was exercised in the browser.
- Not covered here:
  - the client-side refusal and sign-out-in-flight cases in a browser (probe only);
  - dark mode for the new notice (it uses the existing `.marnotice` style);
  - any deployed or hospital environment.
- **The release gate is still UNRESOLVED and unchanged:** write exclusion during update validation, and a failed-health rollback drill (migration-bearing, since `migrationWillRun` is true for this update). Nothing here builds or tests it.
- **Still open, recorded separately and unchanged by these fixes:** the pre-existing restricted-role chart reads. The patient chart reads orders and lab draws for every role, so the Physiotherapist (no `orders.view`) and the Receptionist (neither `orders.view` nor `results.view`) get 403 and the access overlay. The code is identical on `main`; the owner has not decided on a fix, and no role is granted anything. See `../integration/README.md` and contract §11.3.
- **Deployment accuracy:** pushing this branch triggers `.github/workflows/deploy-pages.yml`, which publishes the **staging frontend** to GitHub Pages; the push of `72a7894` did (run 38888888397, `actions/deploy-pages@v4`, success). That is a staging preview publication. It is not a hospital deployment, and not hospital or deployed acceptance.
- Product-source equality: the evidence and docs commits after `ff08a52` change nothing outside `docs/` and `02_PROJECT_STATUS.md` (checked before the push).
