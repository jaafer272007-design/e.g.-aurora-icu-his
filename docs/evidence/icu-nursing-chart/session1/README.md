# Evidence — ICU nursing orders + patient chart, Session 1 (nursing orders and shared backend)

Session 1's handoff record for the plan in `docs/design/icu-update-nursing-patient-chart.md` and the
contract in `docs/design/icu-update-nursing-patient-chart-contracts.md`. It was produced on
2026-10-15/16 (UTC) in the implementation container, against **synthetic data only**:
- the seeded demo roster, plus synthetic patients and orders the checks created;
- in the production pairing, individually created synthetic accounts on a clean install.

The checks used only local, disposable PostgreSQL 16 databases. They touched no hospital system, no
deployed service, no installer or EXE build, and no shared Codex preview.

**This folder is review evidence, not product.** It is docs-only: `tsc` compiles `src` only, and
the server project compiles `server/` only. It sits in its own final commit, which can be dropped
before merging.

## Commits

| Branch | Commit | Content |
|---|---|---|
| `claude/icu-nursing-chart-prep` | `59396e7` | approved plan recorded verbatim |
| | `9d68bca` | frozen contracts (§1–§8) |
| | `05e92e2` | contract Amendment 1 (§9): millisecond rounds, retry settlement, I&O admission binding |
| | `ede8358` | contract Amendment 2 (§10): implement answers an absent order 404 before body shape (pure append) |
| `claude/icu-nursing-chart-backend` | `285e00a` | server: nursing schedule, rounds, completion history, implement extension, migration, I&O catalogue types |
| | `ab62b16` | merge of prep `05e92e2` |
| | `081e45a` | server: Amendment 1 |
| | `b3e4550` | `src/lib/api`: contracts, adapters, mock parity, I&O derivation |
| | `1ba548c` | Orders & Medication: New Nursing Order form, Nursing type filter, round Done |
| | `d6f60be` | merge of prep `ede8358` |
| | `5eac744` | server: Amendment 2 + the millisecond-form roundId message (**the source every final check ran on**) |
| | *(this commit)* | this evidence folder |

The upgrade check's base was `2fc317c` (the reviewed base, the head of draft PR #234's branch).

## The final run — one pass, on `5eac744`

Every log below is from a single final pass on a clean worktree of `5eac744`. Fresh databases were
used throughout. The upgrade database was first created and populated by the `2fc317c` build. The
two drivers hold the exact commands:
- `tools/run-staging-sequence.sh`
- `tools/run-production-ui.sh`

| Log | Result | What it covers |
|---|---|---|
| `logs/00-builds-and-gates.log` | all exit 0 | `npx tsc -b --force`; `npx vite build`; the production bundle; the five `ci.yml` node gates; `dotnet build -c Release`. One compiler warning, in a file this branch does not touch (`BootGuards.cs:103`). |
| `logs/01-pre-upgrade-setup.log` | done | **base build `2fc317c`** creates the "existing install" data. Legacy orders: active ORD-101, pending ORD-102, completed ORD-103. Tenant catalogue edits: a `drain_output` range, `restraint_assessment` retired, a custom type, the devices group enabled. |
| `logs/02-upgrade-check.log` | **15/15** | **new build** migrates that database in place. Every pre-existing order and catalogue row is byte-identical, the two I&O types are topped up, and legacy orders carry no nursing data. Legacy implement works with the empty request, a replay is the existing 409, and a pending order is 409. |
| `logs/02a-replay-deployed-orders-e2e.log` | **13/13 steps** | the repo's `deployed-orders-e2e.yml` replayed verbatim against the new build |
| `logs/02b-replay-deployed-observations-e2e.log` | **12/12 steps** | the repo's `deployed-observations-e2e.yml` replayed verbatim |
| `logs/03-api-check-nursing.log` | **63/63** | the nursing order lifecycle on the real API + PostgreSQL (below) |
| `logs/04-api-check-io.log` | **25/25** | the I&O snapshots + admission binding (below) |
| `logs/05-restart-check-pre.log`, `logs/06-restart-check-post.log` | **3/3**, **11/11** | persistence across a server restart, on the new admission (below) |
| `logs/07-prod-setup.log` | **7/7** | a **clean production install** (`APP_ENV=production`, fresh DB): the migration applied from empty, both I&O types in the production seed, the bootstrap admin's forced change, two individually created clinicians, a synthetic admission and a legacy-style task order |
| `logs/08-ui-check.log` | **38/38** | the browser check (Chromium) on that install, **production bundle served same-origin** — the appliance topology (below) |
| `logs/09-narrow-overflow-probe.log` | info | attribution probe for the one narrow-view observation (Limitations, item 5) |

### Nursing orders (`03`, `02`, `05`/`06`, `08`)

- **Create (server):** a nursing draft must be category Nursing, have no medication, set
  `requiresImplementation: true` and have instructions. Its interval must be 1–2880 minutes; 1 and
  2880 are accepted. Invalid drafts are 400 and create nothing.
- **Create (form, `08`):** One-time is the default. The form refuses 0 min, 49 h, 2.5 h and
  2881 min, accepts 48 h and 1 min, and offers Pending as well as Sign & order. The doctor has no
  Done control; the nurse has no order form.
- **Round 1 opens on signing,** due at the signing minute.
- **Precision (Amendment 1), the acceptance example:**
  - recorded `00:14:59.889Z` → next due exactly `00:15:59.889Z`;
  - Done 40 ms early → 409 "not due yet", row byte-identical;
  - Done 3 ms after due → 200.
  - In the browser, the locked "Opens …" control turned into "✓ Done · round 2" **3 ms after the
    due instant, measured in the page, without a reload**.
- **Stale, early and double completion are blocked.** Concurrency:
  - 6 parallel copies of one attempt → 1 completion;
  - 5 parallel different attempts → one 200 and four 409.
- **Late completion creates no extra round,** and the clock never creates rounds.
- **Safe replay** after a lost response is 200 and writes nothing — also after discontinuation,
  after discharge, and after a server restart. The same attempt with a different round is 409.
- **Legacy behaviour is preserved:**
  - one-time orders complete with the empty request;
  - a `roundId` on a legacy order is 400;
  - an empty request on a repeating order is 400;
  - a legacy-style order without nursing data keeps **✓ Implement** in the browser and completes
    as before;
  - the upgraded legacy orders behave as before (`02`).
- **Nursing Done never routes through the MAR:** no `AdministrationsJson` writes, and no nursing
  order appears on the MAR.
- **RBAC:** doctor and pharmacist tokens are 403.
- **Shapes:** unknown fields and malformed ids are 400 on an existing order. An absent order is 404
  whatever the body (Amendment 2).
- **Unresolved save, browser (Amendment 1 §9.2, `08`):** this ran on the real production bundle and
  production server.
  1. The original request was held by the browser harness, so the page got no answer → **Not
     confirmed** + ↻ Retry saving.
  2. The 5 s authoritative re-check left it Not confirmed.
  3. **Retry with an expired session** (the real server answered 401) re-sent the same
     `{ roundId, attemptId }`. The page still showed **Not confirmed — your session has expired —
     sign in again, then retry saving.**, and the server stayed unchanged.
  4. The held **original was then delivered and committed**. The page confirmed it from its
     authoritative read 4.8 s later.
  5. Result: **exactly one** completion, round 3 current.

### I&O manual snapshots (`04`, `05`/`06`, `07`)

- **Catalogue:** both types are served in the nursing group, in mL, and are not score inputs. The
  derived fluid totals don't take them as inputs. They are present after an upgrade (top-up) and on
  a clean production install.
- **Admission binding (Amendment 1 §9.3):**
  - without `expectedEncounterId` → 400; a wrong value → 409; blank → 400; nothing is written in
    any case;
  - existing callers are unchanged (`hr` without the field → 200);
  - **a form loaded for admission A, then discharge + readmission B before the save → 409 naming A
    and B.** Nothing is created in B or added to A, B reads blank, A's values and full history are
    unchanged, and a save bound to B → 200.
- **Values:**
  - replacement 500 → 200 keeps the history;
  - an explicit zero is a value;
  - balance only when both values exist;
  - both values in one save share one clinical time;
  - 20001 and −1 are 400; a pharmacist is 403;
  - self-correction shows the effective value; amending the oldest snapshot never makes it current.
- **The SHIPPED client derivation** (`deriveIoView`, transpiled from `src/lib/api/ioSnapshots.ts`
  by `tools/io-derive.mjs`) computed every expected view from the real API reads.

### Persistence (`05`/`06`)

- A repeating 1-minute order was signed on **the new admission B** and round 1 completed. The
  server process was then restarted.
- All 16 involved orders (legacy included) were identical via the API, and the stored nursing rows
  were byte-identical.
- The current round was re-derived to the millisecond, and both I&O views were identical.
- A pre-restart attempt still replays.
- The order and observation counters continue (ORD-118 > 117, OBS-1028 > 1027; no duplicate keys).
- Round 2 was 409 before its due time, then completed; round 3 is due at completion 2 + 60 000 ms.

## Screenshots (`screenshots/`, Chromium, production bundle)

| File | What to look at |
|---|---|
| `01-doctor-nursing-form-one-time.png` | New Nursing Order, One-time default, Urgent |
| `02-doctor-nursing-form-repeat.png` | Repeat, every 1 minute, the "Due again …" hint |
| `03-doctor-order-list-nursing-filter.png` | the Nursing type filter (doctor; no Done controls) |
| `04-nurse-round-locked-row.png` | after Done: "Opens 03:18:27" (hospital clock, to the second) |
| `05-…-row.png`, `05b-…-page.png` | **Not confirmed** after the expired-session retry, with the notice, ↻ Retry saving and the toast |
| `06-nurse-confirmed-after-original-commits-row.png` | confirmed after the original committed: last done, round 3 opens |
| `07-nurse-orders-dark.png` | dark theme (device preference), Nursing filter |
| `08-doctor-nursing-form-narrow.png`, `09-order-row-narrow.png` | 390 px |

## Re-running

The scripts need `SCRATCH` (the session scratchpad holding `db.pw` and `jwt.secret`; secrets are
never committed). They also need local PostgreSQL 16, the .NET 8 SDK, Node 22 and Playwright's
Chromium. The steps:
1. Publish the base build (`2fc317c`) and the new build (`dotnet publish server -c Release
   -p:SourceRevisionId=<sha>`).
2. Build the production bundle (`VITE_APP_ENV=production npx vite build --base=/`).
3. Run `tools/run-staging-sequence.sh <base app> <base sha> <new app> <new sha> <checkout of new
   sha>`.
4. Run `tools/run-production-ui.sh <new app> <bundle> <new sha>`.

`tools/replay-deployed-suite.py` replays a `deployed-*-e2e.yml` locally. The production pairing
generates its credentials into the scratchpad (`prod-state.json`).

## Limitations

1. **Local and synthetic only.** PostgreSQL 16 on Linux, not the Windows appliance; no installer
   or EXE build; no hospital migration; no deployed suite dispatched. The release boundaries (the
   update-validation write barrier and the failed-health rollback gate) are untouched and still
   open.
2. **Suite replays** skip the checkout step and the hosted freshness gate (it resolves Render's
   served commit). That gate is replaced by an exact local build-identity check (`/healthz` build
   `== 5eac744…-local`), stated in each log. Other deployed suites (MAR, encounter scope, …) were
   not replayed; their endpoints are unchanged by this branch.
3. **How the browser transport was simulated.** The "delayed original" is captured in the browser
   (the page sees no answer). The harness then delivers it with the original headers and body. The
   "expired session" replaces the retry's bearer token with an invalid one, so the real server
   answers 401.
4. **The non-production 401 path follows the MAR adapter's convention.** In a production bundle (the
   appliance), a 401 is a refusal that keeps the save unconfirmed; that is what `08` verified.
   In a *non-production* bundle with an API configured, a 401 falls back to the mock store, exactly
   as `documentAdministration` does. The mock holds no nursing order with a real id, so the retry
   is still refused and stays unconfirmed. Its notice shows the mock's refusal text rather than
   "session expired". This path was reviewed in code, not run in a browser.
5. **The 390 px doctor Orders page has a 58 px page-level horizontal overflow.** Removing this
   branch's UI from the DOM leaves it at 58 px (`09`), and the nurse page has none. This branch's
   card has no internal overflow.
6. **The I&O client adapters were typechecked but not executed.** `getIoSnapshots` and
   `recordIoSnapshot` have no screen in this branch (Session 3's `PatientNurseCarePanel` is their
   first caller). The server contract they call and the shipped `deriveIoView` were exercised. The
   mock-mode nursing parity (`applyNursingImplementation`) was not run in a browser in the final
   pass.
7. **Not done here:** `02_PROJECT_STATUS.md` is deliberately untouched (worker phase). Integration
   into PR #234 waits for the Session 2/3 handoffs.

**Contract change requested and made:** Amendment 2 (prep `ede8358`). It moves a server-internal
check order and changes no shared signature; Sessions 2 and 3 need no change.
