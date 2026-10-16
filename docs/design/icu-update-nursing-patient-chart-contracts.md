# ICU update — nursing orders + patient chart: frozen interfaces (Session 1)

*Engineering contract for the owner-approved plan recorded verbatim in
`docs/design/icu-update-nursing-patient-chart.md` (the "plan"). Written 2026-10-15 by Session 1
(coordinator) on `claude/icu-nursing-chart-prep`, from reviewed base
`2fc317ca4cb923abae1718a9a30ad9af8a7592ba` (draft PR #234's head; `main` = `f0bf464`, unchanged).*

*This file freezes shapes, names, ownership and timing precision so three sessions can build in
parallel without touching each other's files. It does not change any owner decision. Where the
plan leaves an engineering choice open, the choice is stated here in **§8 Engineering choices** so
the owner can review it. A later change to this contract is a dated amendment appended at the end
(supersede, don't rewrite).*

---

## 1. Branches, base and handoff

| Branch | Owner | Starts from |
|---|---|---|
| `claude/icu-nursing-chart-prep` | Session 1 | `2fc317c`; **fixed** at the contract commit, never receives implementation |
| `claude/icu-nursing-chart-backend` | Session 1 | the prep commit |
| `claude/icu-nursing-chart-patient-chart` | Session 2 | the prep commit |
| `claude/icu-nursing-chart-nurse-workflows` | Session 3 | the prep commit |
| `claude/amazing-hopper-nwzw1x` (draft PR #234) | Session 1, integration only | existing history preserved; reviewed commits are merged in after handoff |

- Each session works solo, runs focused checks, pushes only its own branch, and opens **no PR**.
- Handoff = pushed branch + exact commits + concise results + screenshots, recorded in that
  session's evidence directory (§7). Nobody edits `02_PROJECT_STATUS.md` until integration
  (Session 1).
- A session that needs a contract change records it under **"Contract requests"** in its own
  evidence README and reports it in its handoff. It never edits another session's files to work
  around the contract.

## 2. File ownership

**Rule:** a file not listed for a session is read-only for that session. New files go inside the
owning session's directories.

**Session 1 — nursing orders, shared backend, integrator**
- `server/**`: `Core/Orders/*`, `Core/Observations/ObservationCatalog.cs`,
  `Core/Persistence/AuroraDb.cs`, `Core/Persistence/Migrations/*` (incl. the model snapshot),
  and any server test tooling.
- `src/lib/api/types.ts`, `src/lib/api/index.ts`, `src/lib/api/data/orders.ts` (mock parity),
  new `src/lib/api/ioSnapshots.ts`, new `src/lib/nursingRounds.ts`.
- `src/pages/OrdersMedication/**` (New Nursing Order form, Nursing type filter, the Order List's
  ✓ Implement control for nursing rounds).
- `.github/workflows/deployed-*.yml` only where a suite's expectation is changed by this contract.
- `docs/design/icu-update-nursing-patient-chart*.md`, `docs/evidence/icu-nursing-chart/session1/**`,
  `docs/evidence/icu-nursing-chart/integration/**`; `02_PROJECT_STATUS.md` at integration only.

**Session 2 — patient chart**
- `src/pages/MissionControl/**` (layout, the role-dependent chart, Latest Charted Observations,
  compact Weight & Height, Active Medication Orders, Laboratory Results, Imaging Results, the
  removed cards and their links/loading, nurse score visibility). New chart helpers live here too.
- `src/hooks/usePatientScores.ts` and any new score/observation presentation hook it adds under
  `src/hooks/`.
- The insertion of `PatientNurseCarePanel` into the nurse's chart (§6), as its **own final commit**
  that is built only on top of Session 3's handed-off commits.
- `docs/evidence/icu-nursing-chart/session2/**`.

**Session 3 — nurse workflows**
- New `src/features/nurse-care/**`: `PatientNurseCarePanel.tsx` (§6), the shared nurse-care
  provider/controller, the patient-specific MAR cards and I&O components, and their CSS. MAR card
  code and `marDays.ts` may move here from `src/pages/NurseWorkspace/`.
- `src/pages/NurseWorkspace/**` (remove Nursing Tasks + Tasks Open; Orders to Implement for
  repeating rounds; replace the demo I&O worksheet; consume the shared MAR controller).
- `src/App.tsx` — provider wiring only.
- `docs/evidence/icu-nursing-chart/session3/**`.

**Read-only for everyone (request changes through Session 1):** `src/lib/marSchedule.ts`,
`src/lib/time.ts`, `src/lib/session.ts`, `src/lib/api/bedside.ts`, `src/lib/scoring/**`,
`src/components/**`, `server/**` (except Session 1). Session 2 needs no API change for the chart:
`getPatientOrders`, `getLabDraws`, `getImagingStudies`, `getObservations`, `getEncounters` and the
existing projections already serve it; presentation helpers it needs are written inside
`src/pages/MissionControl/`. Adapters that become unused after Sessions 2/3 (e.g. the demo
`getIoEntries`/`recordIoEntry`, `getNursingTasks`/`toggleNursingTask`) are left in place by them;
Session 1 decides at integration (the mock Timeline still reads the demo stores).

## 3. Nursing orders — wire contract

All stamps are the application's existing UTC wire form **`yyyy-MM-dd HH:mm`** (minute precision),
displayed through the existing hospital-clock helpers (`displayStamp`, `displayFullStamp`,
`datedEpoch` in `src/lib/time.ts`). Server refusal messages carry UTC wire stamps; clients localise
them the way the MAR does (the `localizeStamps` regex in today's `NurseWorkspace.tsx`).

### 3.1 Create (`POST /api/icu/orders`, unchanged endpoint and permissions)

`NewOrderDraft` gains one optional field (additive; `[Disallow]` keeps rejecting unknown fields):

```ts
export interface NursingOrderDraft {
  /** absent = one-time; else whole minutes, 1 … 2880 (1 minute through 48 hours) */
  intervalMinutes?: number
}
// NewOrderDraft
nursing?: NursingOrderDraft
```

- The New Nursing Order form sends `{ patientId, category: 'Nursing', summary: <instructions>,
  priority, requiresImplementation: true, nursing: {} }` for one-time (the default) and
  `nursing: { intervalMinutes: N }` for repeating. Hours are converted by the client
  (`hours × 60`); the server stores minutes only.
- Server validation (400, before any insert): `nursing` only on a `Nursing` draft, with
  `requiresImplementation: true`, no `medication`, no `testId`/`studyId`/`region`/`contrast`;
  `intervalMinutes` a whole number 1–2880; `summary` (instructions) required non-blank, ≤ 2000.
- Pending / Sign & Order and `orders.create` / `orders.sign` are unchanged. Drafts without
  `nursing` (legacy callers, order sets) behave exactly as today and create **legacy one-time**
  orders. Order-set templates do not gain a nursing field in this batch.
- There is no modify path: `PUT /api/icu/orders/{id}` already refuses non-medication orders (400).
  Changing a signed schedule = discontinue + new order (plan §2).

### 3.2 Order responses (every existing order read and mutation response)

`Order` gains one optional field, **absent on every order created without `nursing`** (legacy wire
bytes unchanged):

```ts
export interface NursingRound {
  /** "<due as yyyy-MM-ddTHH:mm>~r<number>", e.g. "2026-10-15T08:00~r1" (the MAR's round form) */
  roundId: string
  number: number
  /** UTC wire stamp; the round is completable from this instant (:00.000) onward */
  dueTime: string
}
export interface NursingCompletion {
  round: number
  roundId: string
  dueTime: string
  /** server clock at completion, truncated to the minute (UTC wire) */
  completedTime: string
  /** the token's name claim */
  completedBy: string
  /** present when the completion was made with the round/attempt contract */
  attemptId?: string
}
export interface NursingOrderDetails {
  intervalMinutes?: number             // stored; absent = one-time
  completions: NursingCompletion[]     // stored; oldest first; append-only
  currentRound?: NursingRound          // DERIVED by the server at read; never stored
}
// Order
nursing?: NursingOrderDetails
```

**Server persistence:** a new nullable text column `Orders.NursingJson` (additive EF migration +
snapshot; existing rows stay `NULL`). It stores `{ intervalMinutes?, completions[] }` only.

### 3.3 Round semantics (server-derived; the mock mirrors them)

- **`currentRound` exists only while the order is `active`.** Pending (unsigned), completed and
  discontinued orders carry no current round. Discharge already discontinues an encounter's active
  orders, so a closed encounter never shows one.
- **Round 1** is due at the order's **signing minute** (the `signed` history event): open
  immediately on signing (plan: "First round available immediately after signing").
- **Next round** (repeating only) = **recorded completion time + interval**:
  `number = n + 1`, `dueTime = completions[last].completedTime + intervalMinutes`. Because
  `completedTime` is the server clock truncated to the minute, the next round unlocks exactly at
  that stamp + interval, `:00.000`, which may be up to 59 s less than a full interval after the
  click. This is the stated precision; there is no seconds field.
- **The clock never creates a round.** A late round keeps its number and `dueTime` until it is
  completed, however late. No missed/skipped rounds are generated. Overdue display is the
  client's comparison of `dueTime` against now.
- **One-time with nursing data:** completing round 1 stores the completion and sets the order
  `completed` (stored, as the implement action does today). **Repeating:** stays `active` after
  each completion until discontinued or its encounter closes.
- `currentRound` depends only on stored facts (signed stamp, completions, interval, status), never
  on the clock, so every reader sees the same identity.

### 3.4 Implement (`POST /api/icu/orders/{orderId}/implement`, `orders.implement`, unchanged URL)

Optional JSON body:

```ts
export interface NursingImplementRequest {
  roundId: string     // must equal the order's currentRound.roundId
  attemptId: string   // ^[A-Za-z0-9_-]{8,64}$ — one id per deliberate Done, reused by a retry
}
```

- **No body, an empty body, or `{}`** = the existing empty request. Accepted for **one-time**
  orders (legacy and new). Legacy behaviour is byte-identical: `implemented` + `completed` history,
  status `completed`, a replayed empty request is the existing 409 "already completed".
- **Repeating orders require** `roundId` + `attemptId`; an empty request is 400.
- `roundId` and `attemptId` travel together (one without the other is 400). Unknown fields 400.
- A `roundId` on an order without nursing data is 400 (a legacy order has no rounds).

Check order, all under the existing order row lock (`OrderLogic.LockOrder`):

1. RBAC `orders.implement` → 403 · body shape → 400.
2. Order absent → 404 · not `requiresImplementation`, or Lab/Imaging → 400 (unchanged).
3. **Safe replay, before any state check:** a completion already carrying this `attemptId`
   → same `roundId`: **200 with the order as it is now, nothing written** (also after the order
   completed, was discontinued or the encounter closed); different `roundId`: 409.
4. Round-contract shape (400s above).
5. Encounter must be open → 409 (unchanged) · status must be `active` → 409 (unchanged wording).
6. `roundId` ≠ current round → 409 naming who completed that round and when, or "not the current
   round". Now < `dueTime` → 409 "not due yet — opens at `<UTC stamp>`" with nothing written.
7. Write: append the completion (`completedTime` = now truncated to the minute, `completedBy` =
   token name, `attemptId`); history `implemented` (detail `round N` for repeating rounds);
   one-time also `completed` + status `completed`. One commit, then the updated `Order`.

Concurrency: competing requests serialise on the row lock; the second sees the advanced round
(409) or, if it is the same attempt, the replay (200). **N copies of one attempt → 1 completion,
1 history entry.**

Nursing Done never touches `AdministrationsJson`, the MAR endpoints, `MarSchedule` or any
medication timer. The implement queue (`GET /api/icu/orders?implement=true`) is unchanged and keeps
listing an active repeating order (with its `currentRound`) between rounds.

### 3.5 Client exports (Session 1; consumed by Sessions 2/3)

`src/lib/api/index.ts`:

```ts
export type NursingWriteResult =
  | { kind: 'ok'; order: Order }
  | { kind: 'rejected'; error: string; status?: number }   // the server answered: nothing recorded
  | { kind: 'uncertain'; error: string }                   // no answer / 5xx: may be recorded
export function implementNursingOrder(
  orderId: string, actor: string, jobTitle: JobTitle, request?: NursingImplementRequest,
): Promise<NursingWriteResult>
// unchanged, still used for legacy one-time orders by existing callers:
export function completeImplementation(orderId: string, actor: string, jobTitle: JobTitle): Promise<Order | null>
export function getImplementationQueue(patientIds?: string[]): Promise<Order[]>
```

Mock mode (no API configured) and a tokenless dev session (401) apply the same rules to the mock
store, as `documentAdministration` does. In production a 401 is `rejected` ("session expired —
sign in again; nothing was recorded").

`src/lib/nursingRounds.ts` (pure, mirrors §3.3; no network):

```ts
export const NURSING_INTERVAL_MIN_MINUTES = 1
export const NURSING_INTERVAL_MAX_MINUTES = 2880
export type NursingRoundState =
  | { kind: 'legacy' }                                        // no nursing data: one-time, empty request
  | { kind: 'inactive' }                                      // nursing data, no current round
  | { kind: 'open'; round: NursingRound; dueMs: number }      // Done enabled now
  | { kind: 'locked'; round: NursingRound; dueMs: number }    // Done disabled until dueMs exactly
export function nursingRoundState(order: Order, nowMs: number): NursingRoundState
export function isRepeatingNursing(order: Order): boolean
export function lastNursingCompletion(order: Order): NursingCompletion | undefined
export function formatNursingInterval(minutes: number): string   // "every 45 min" · "every 2 h" · "every 1 h 30 min"
export function parseNursingRoundId(id: string): { dueMs: number; number: number } | null
export function newNursingAttemptId(): string                    // 32 hex chars, crypto.getRandomValues
```

### 3.6 Client completion behaviour (Done)

- One attempt id per deliberate Done; an immediate per-order guard; controls disabled through the
  save and the refresh that follows.
- `ok` → hold until a read started after the answer; show "Next due `<hospital time>`" and keep Done
  disabled until exactly `dueMs` (a timer opens it without reload).
- `rejected` → show the server's reason (localised) on the row.
- `uncertain` → keep the attempt **unconfirmed**; settle it only from a server read: a completion
  carrying the attempt id (confirmed), or the round completed by another completion / the order no
  longer active without it (not saved). Elapsed time or an absent completion never settles it.
  "Retry saving" re-sends the same `{ roundId, attemptId }`.
- Orders to Implement (Session 3) persists unconfirmed nursing attempts in `sessionStorage` key
  `aurora.nursingUnconfirmed:<session.name>` (shape
  `{ attemptId, orderId, roundId, label, clickedAt }[]`). The Order List's ✓ Implement (Session 1)
  keeps its attempt in page memory only. Either way the server's round identity makes a duplicate
  completion impossible.
- Legacy one-time orders keep the existing empty-request ✓ Done.

## 4. Medication documentation (MAR) — shared controller contract

The MAR rules, server, wire format and timers are **unchanged**: first dose open on signing,
later-round locking and exact unlock, overdue delay reasons, backdating window, `attemptId` safe
retry, pinned-minute retry with its 400 fallback, the rolling timer, daily grouping
(`marDays.ts`). Session 3 extracts today's page-local logic in `NurseWorkspace.tsx`
(`MarAttempt`, `MarLock`, `settleFrom`, `sendAttempt`, `retryMar`, the read sequence) into one
shared controller. Frozen invariants:

1. **One controller per tab**, created by Session 3's provider mounted in `src/App.tsx` inside
   `<BrowserRouter>` and outside `<Routes>`. It outlives route changes between `/nurse` and
   `/patients/:id`, patient switching, and unmounting of either screen. Both Nurse Workspace and
   `PatientNurseCarePanel` consume it; neither owns locks.
2. **Locks are per `orderId`, global across screens**: one documentation per order at a time, an
   immediate (ref) guard plus disabled controls, wherever the click came from.
3. **In-flight requests complete into the controller**, never into an unmounted component.
   Outcomes (toast + the per-order notice kept until that order's next documentation) are shown by
   whichever consumer is mounted.
4. **Persistence:** unconfirmed attempts are stored under the **existing** key
   `aurora.marUnconfirmed:<session.name>` with the **existing** `MarAttempt[]` JSON shape, so
   attempts written by the current build are restored after the update reload. `settling` is not
   persisted.
5. **Sign-out / re-authentication:** the controller follows `getSession()`. When the signed-in
   name changes, the previous nurse's attempts leave memory unsettled and stay stored under that
   nurse's key; signing back in as the same nurse restores them; another nurse never sees or
   sends them. A 401 on a retry leaves the attempt unconfirmed with "sign in again, then retry
   saving" (today's behaviour).
6. **Settlement only from the record:** only `getMarRowsAuthoritative(ids)` results settle, applied
   in the order the reads **started**; a read older than one already applied is discarded whole
   (display and verdict). `ids` must include the patient of every lock being settled, not only
   the patient on screen. `settling` is released only by an authoritative read that started after
   the answer **and covers that order's patient**. An absent fact never settles `unconfirmed`;
   elapsed time never settles anything.
7. **Refresh cadence:** the shared poll (`usePollTick`, 20 s) plus the 5 s recheck while any lock
   is not `saving`, regardless of which screen is mounted.
8. **Patient switching (display):** a view clears its patient's rows immediately on `patientId`
   change and ignores responses keyed to another patient. This affects display only; the
   controller still applies authoritative reads to settlement.

## 5. Intake & Output — manual snapshot contract

### 5.1 Catalogue definitions (Session 1)

Two types appended to `ObservationCatalog.Types` (the existing **seed-if-missing per typeCode
top-up**): a fresh install seeds them; an existing install gains exactly these two rows on its next
boot; existing rows, including any tenant edits, retirements and group enablement, are never
rewritten.

| typeCode | group | displayName | unit | valueType | plausibility |
|---|---|---|---|---|---|
| `io_current_intake_ml` | `nursing` | Current Intake (manual snapshot) | mL | numeric | 0–20000 |
| `io_current_output_ml` | `nursing` | Current Output (manual snapshot) | mL | numeric | 0–20000 |

Not derived, not score inputs (the lock list is unchanged), no flagging ranges. They are **not**
in the `fluid` group, so no interval fluid total, the bedside fluid-balance strip, the printed
flowsheet's fluid section or any score reads them (all of those use explicit code lists or that
group). No separate I&O table exists.

### 5.2 Reads and writes (existing observations API, existing permissions)

- **Scope:** the patient's **open encounter**, resolved with the real-only
  `GET /api/icu/adt/encounters?patientId=…&status=open` (never the mock encounter fallback). Reads
  use `GET /api/icu/observations?patientId&encounterId&typeCode`, one per type. Writes use
  `POST /api/icu/observations` (the server derives the encounter and stamps time, source `manual`
  and recorder; a closed episode is 409).
- **Current value per type** = the **latest snapshot by entry** (`enteredAt`, then the numeric
  suffix of `observationId`), shown with its **effective** value: the last amendment's `newValue`
  when amendments exist, else `value` (amend-not-erase). An amendment changes that snapshot's
  value; it never makes an older snapshot current.
- **Replacement:** entering 200 after 500 creates a new snapshot; 200 is displayed and 500 stays
  in history. Values never expire and never reset at midnight.
- **Zero** is a real value. **Missing** = no snapshot of that type in the open encounter →
  "Not recorded". **Balance** = intake − output, only when both current values exist; otherwise
  no balance is shown.
- **New admission:** a new encounter has no snapshots, so both values read "Not recorded". The
  previous admission's snapshots stay stored and readable under its `encounterId`.
- **Permissions:** read `patients.view`; write `observations.record` (any doctor or nurse).
  403/409/400 are shown with the server's reason. There is **no mock or demo fallback**: in mock
  mode or when the server is unreachable the panel says I&O is unavailable, and a save is refused
  visibly.
- **Uncertain save** (no answer / 5xx): the panel says "not confirmed", re-reads, and asks the
  nurse to check history before entering again. It never resends automatically. A deliberate
  re-entry is a new save; if both landed, both are real auditable records and the latest is
  displayed.

### 5.3 Client exports (Session 1; consumed by Session 3)

`src/lib/api/ioSnapshots.ts` (pure, re-exported by `src/lib/api/index.ts`) and `index.ts`:

```ts
export const IO_INTAKE_TYPE = 'io_current_intake_ml'
export const IO_OUTPUT_TYPE = 'io_current_output_ml'
export const IO_SNAPSHOT_TYPE_CODES: readonly string[]      // [IO_INTAKE_TYPE, IO_OUTPUT_TYPE]
export const IO_SNAPSHOT_MAX_ML = 20000
export type IoSnapshotKind = 'intake' | 'output'
export interface IoSnapshot {
  observationId: string
  kind: IoSnapshotKind
  typeCode: string
  valueMl: number           // effective (amendment-aware)
  originalValueMl: number   // as first charted
  clinicalTime: string      // UTC wire, server-stamped
  enteredAt: string         // UTC 'yyyy-MM-dd HH:mm:ss'
  recordedBy: string
  amendments: ObsAmendment[]
}
export interface IoView {
  patientId: string
  encounterId: string
  intake: IoSnapshot | null
  output: IoSnapshot | null
  balanceMl: number | null  // null unless both exist
  history: IoSnapshot[]     // both kinds, newest entry first, this encounter only
}
export function deriveIoView(patientId: string, encounterId: string, observations: Observation[]): IoView

export type IoRead =
  | { kind: 'ok'; view: IoView }
  | { kind: 'no-open-encounter' }
  | { kind: 'unavailable'; error: string; forbidden: boolean }
export function getIoSnapshots(patientId: string): Promise<IoRead>

export interface IoSnapshotDraft { intakeMl?: number; outputMl?: number }   // ≥ 1 present; whole mL 0…20000
export type IoWriteResult =
  | { kind: 'ok'; observations: Observation[] }
  | { kind: 'rejected'; error: string; status?: number }
  | { kind: 'uncertain'; error: string }
export function recordIoSnapshot(patientId: string, draft: IoSnapshotDraft, jobTitle: JobTitle): Promise<IoWriteResult>
```

Both values in one save are one `POST` (one shared clinical time). Session 2's combined
observations card does not show these two codes (they belong to the I&O panel); use
`IO_SNAPSHOT_TYPE_CODES` to exclude them if the card ever iterates codes generically.

## 6. `PatientNurseCarePanel` (Session 3 builds; Session 2 places)

```ts
// src/features/nurse-care/PatientNurseCarePanel.tsx — named export
export function PatientNurseCarePanel({ patientId }: { patientId: string }): JSX.Element
```

- Renders, for one patient: that patient's medication administration cards (same Given / Held /
  Refused controls, dialogs, locks and daily grouping as Nurse Workspace, through the shared
  controller of §4) and the I&O panel (§5): current intake, output, balance, timestamps, recorder,
  history and entry controls.
- Self-contained: no props besides `patientId`; it reads the session and the provider itself,
  renders its own `<DataAge>` chips (one per independently refreshed source, per
  `03_DEVELOPMENT_RULES.md`), loading/error/empty states, and its own CSS. It adapts to the width
  it is given (narrow layouts) and both themes.
- On `patientId` change it clears immediately and drops late responses for the previous patient.
- It shows the patient regardless of the nurse's opt-out worklist (a nurse may document any
  patient's dose).
- **Session 2** owns where it sits and the role-dependent layout. The nurse's chart is
  `profileOf(session.jobTitle) === 'Nurse'`. Score hiding (SOFA/NEWS2) applies to that same chart.
- **Session 3** owns the provider and its `App.tsx` wiring; the panel must be built against the
  provider before Session 2's final wiring commit is built.

## 7. Evidence and verification

- Evidence directories: `docs/evidence/icu-nursing-chart/session1/`, `…/session2/`, `…/session3/`,
  and `…/integration/` (Session 1). Each holds a README naming commits, commands actually run with
  their source commit, results, screenshots and limitations.
- Synthetic data only; local disposable PostgreSQL is authorised for migration/persistence checks.
  No hospital database, installer, EXE, deployment or monitoring.
- Final builds and combined acceptance checks run **once** on the assembled committed source
  (Session 1), repeating only a failing or affected check.

## 8. Engineering choices made by this contract (for owner review)

1. **Round identity and precision.** `"<due yyyy-MM-ddTHH:mm>~r<n>"`, minute precision, UTC,
   matching the MAR round form and the application's existing wire stamps. Next due = recorded
   completion minute + interval, unlocking at `:00.000`.
2. **Round 1 due at signing**, derived from the `signed` history event, so a pending order has no
   round until signed.
3. **New one-time orders carry nursing data** (`nursing: {}`) so they get round identity and safe
   retry; **legacy** orders (no data) keep the empty request and their exact wire bytes.
4. **History detail** for repeating rounds is `round N` (no time stamp, so nothing unlocalised is
   shown in the audit view); due/completion times live in `completions`.
5. **Order-set templates** do not gain repeat settings in this batch; applied sets create legacy
   one-time nursing orders, as today.
6. **I&O snapshots live in the `nursing` observation group**, not `fluid`: the fluid group holds
   per-interval amounts that the print flowsheet lists and the bedside strip sums, so keeping the
   snapshots out of it is the structural separation the plan asks for. A hospital that disabled the
   Nursing Clinical Assessment group gets a visible 409 on save.
7. **Plausibility 0–20000 mL**, the same bound as the existing derived Total Input/Output.
8. **Latest = by entry order** (`enteredAt`, then id suffix), not by clinical minute, so two saves
   in the same minute resolve deterministically.
9. **No automatic resend** of an uncertain I&O save (observations carry no attempt id); the nurse
   is told to check history.
10. **Session branch names** for Sessions 2 and 3 are the ones in §1.

---

## 9. Amendment 1 — 2026-10-15 (Codex review of prep commit `9d68bca`)

*Appended; §1–§8 above are unchanged text. Where this section conflicts with them, **this section
wins**. Sessions 2 and 3 start from the commit that adds it. The approved plan is unchanged.*

### 9.1 Nursing rounds keep the full interval (supersedes the minute precision in §3.2, §3.3, §3.5 and §8 item 1)

The rule is completion time **plus the chosen interval**. Truncating completion to the minute let a
Done at 10:00:59 reopen at 10:01:00. Corrected:

- **New nursing stamp form:** UTC with milliseconds, **`yyyy-MM-ddTHH:mm:ss.fffZ`**
  (e.g. `2026-10-15T10:00:59.900Z`; `Date.parse` reads it directly). It is used **only** for
  `NursingRound.dueTime`, `NursingCompletion.dueTime`, `NursingCompletion.completedTime` and the
  round identity. Medication stamps, MAR rounds, history/audit stamps (`OrderEvent.time`,
  `orderedTime`) and every existing timer keep the minute form `yyyy-MM-dd HH:mm`, unchanged.
- **Round identity:** `"<dueTime>~r<number>"` in the new form, e.g.
  `2026-10-15T10:01:59.900Z~r2`.
- **`completedTime`** = the server clock at completion, **rounded up** to the whole millisecond
  (so the recorded time is never before the actual one).
- **Next round** (repeating): `dueTime = completedTime + intervalMinutes` exactly, to the
  millisecond. It is completable when `now ≥ dueTime` (server: 409 before; client: disabled before,
  a timer opens it at that instant).
- **Round 1** is due at the signing minute from the `signed` history event, written in the new
  form (`…T08:00:00.000Z~r1`); that is never after the signing, so round 1 is open on signing.
- **Acceptance:** Done at 10:00:59.900 with a 1-minute interval → next round due
  `10:01:59.900Z` or later (later only by sub-millisecond rounding); a request at 10:01:59.899 is
  409, one at 10:01:59.900 or after is accepted.
- **Server refusal texts** for nursing rounds carry stamps in the new form; clients localise them
  with `localizeNursingStamps` (below), not the MAR's minute regex.

Revised `src/lib/nursingRounds.ts` exports (additions and changed meanings; the rest of §3.5
stands):

```ts
/** 'yyyy-MM-ddTHH:mm:ss.fffZ' → epoch ms; null for any other form (the minute form included) */
export function parseNursingStamp(stamp: string): number | null
/** epoch ms → 'yyyy-MM-ddTHH:mm:ss.fffZ' */
export function nursingStampOf(ms: number): string
/** hospital clock, to the second, 12h/24h aware: "10:01:59" today, "D-1 10:01:59" earlier */
export function displayNursingTime(stamp: string): string
/** a server refusal text with nursing stamps converted to hospital time */
export function localizeNursingStamps(text: string): string
/** "<yyyy-MM-ddTHH:mm:ss.fffZ>~r<n>" → { dueMs, number }; null when malformed */
export function parseNursingRoundId(id: string): { dueMs: number; number: number } | null
// NursingRoundState is unchanged in shape; dueMs is now millisecond-exact and
// nursingRoundState() is open exactly when nowMs >= dueMs.
```

### 9.2 An unresolved nursing save stays unconfirmed after a refused retry (supersedes the `rejected` line of §3.6)

A retry that receives 401, 403 or any other refusal while its attempt is still unresolved does not
prove the original request failed: the original may still be in flight and commit later.

- **First send of an attempt:** `ok` → confirmed (held until a read started after the answer);
  `rejected` → the server refused the only request: **not saved**, shown with its reason (401
  included: nothing was written); `uncertain` → **unconfirmed**.
- **Retry of an unconfirmed attempt** (same `{ roundId, attemptId }`): `ok` → confirmed;
  `rejected` (401, 403, 400, 404, 409, …) → the reason is **shown** (for 401: "sign in again, then
  retry saving") but the attempt, its lock and its stored copy are **kept unconfirmed**; an
  authoritative re-read is started. `uncertain` → stays unconfirmed.
- **Settlement comes only from an authoritative read of the order** (applied in start order,
  stale reads discarded whole):
  - **confirmed** — a completion on that order carries the attempt's `attemptId`;
  - **not saved (terminal)** — the order is present and either a completion of the attempt's
    `roundId` carries a different (or no) `attemptId`, or the order is no longer `active`
    (completed, discontinued, encounter closed) and no completion carries the attempt. The server
    replays a recorded attempt before any state check and refuses a stale round, so in both cases
    the original can never commit afterwards;
  - otherwise — the order absent from the read, the read unavailable, or the attempt's round still
    current — it **stays unconfirmed**. Elapsed time and an absent read prove nothing.
- **The authoritative read is the per-patient order list**, which keeps completed and
  discontinued orders. The implementation queue drops them, so a missing queue row proves nothing.
- **Required checks** (whoever implements a Done control): a delayed original request; an
  expired-session (401) retry that leaves the attempt unconfirmed; the original subsequently
  committing → confirmed with exactly one completion.
- The MAR's own retry handling (§4) is not changed by this amendment.

Revised shared exports:

```ts
// src/lib/api/index.ts — the settling read: the server's own rows, or null when the server
// cannot be read (a mock fallback would settle nothing); in mock mode the mock store is the record
export function getPatientOrdersAuthoritative(patientId: string): Promise<Order[] | null>

// src/lib/nursingRounds.ts — one settlement rule for every Done control
export interface NursingPendingAttempt {
  attemptId: string
  orderId: string
  patientId: string
  roundId: string
  label: string
  /** nursing stamp form, when Done was clicked */
  clickedAt: string
}
export type NursingSettlement =
  | { kind: 'confirmed'; completion: NursingCompletion }
  | { kind: 'not-saved'; reason: string }
  | { kind: 'unconfirmed' }
/** `orders` = one authoritative per-patient read; never call it with a fallback/mock list in API mode */
export function settleNursingAttempt(attempt: NursingPendingAttempt, orders: Order[]): NursingSettlement
```

The stored shape for Orders to Implement (§3.6, key `aurora.nursingUnconfirmed:<session.name>`) is
`NursingPendingAttempt[]` (`patientId` added so the settling read can be made).

### 9.3 I&O saves are bound to the admission shown in the form (supersedes the write rules of §5.2 and `recordIoSnapshot` in §5.3)

- **Server:** `POST /api/icu/observations` gains an optional field,
  `ChartObservationsRequest { patientId, entries, expectedEncounterId? }` (additive; unknown fields
  still 400; every existing caller is unchanged).
  - **Required** (400 when absent) when any entry is `io_current_intake_ml` or
    `io_current_output_ml`; optional for every other type.
  - When present, it is checked **inside the write transaction**: the transaction locks that
    encounter's row (`SELECT … FOR UPDATE`; discharge updates the same row, so the two
    serialise), then requires the patient's current open encounter to be exactly
    `expectedEncounterId`. A mismatch (discharged, readmitted, unknown or another patient's) is
    **409 with nothing written**. The existing no-open-encounter 409 is unchanged.
- **Client:**

  ```ts
  // src/lib/api/index.ts — replaces the §5.3 signature
  export function recordIoSnapshot(
    patientId: string, encounterId: string, draft: IoSnapshotDraft, jobTitle: JobTitle,
  ): Promise<IoWriteResult>
  ```

  `encounterId` is the loaded `IoView.encounterId`; the adapter sends it as
  `expectedEncounterId`. `chartObservations` is unchanged.
- **Editor state** is keyed to `patientId` + `encounterId`. When a read returns a different
  encounter or `no-open-encounter`, or a save is refused with the mismatch 409, the typed values are
  cleared and the view re-read. The old admission's values are never resent into the new one.
- **Required check:** a form loaded for admission A, then discharge and readmission B before
  submission → the stale save is 409 and creates no observation in B (or in A).

---

## 10. Amendment 2 — 2026-10-16 (found by Session 1's local replay of the deployed orders suite)

*Appended; §1–§9 above are unchanged text. Where this section conflicts with them, **this section
wins**. No shared TypeScript signature, wire field or client behaviour changes; Sessions 2 and 3
need no change. The approved plan is unchanged.*

### 10.1 Implement answers an absent order 404 before any body problem (supersedes steps 1–2 of the check order in §3.4)

The existing deployed orders suite (`.github/workflows/deployed-orders-e2e.yml`, FOUR-CODE step)
probes `POST /api/icu/orders/ORD-0000/implement` with a generic body `{"reason":"x"}` and requires
**404**: the endpoint before this change ignored any body. §3.4 put "body shape → 400" ahead of
"order absent → 404", so that probe would be answered 400 — a regression for an existing caller.
The check order becomes:

1. RBAC `orders.implement` → 403 (unchanged).
2. Order absent → **404, whatever the body** (malformed JSON, unknown fields, half a round
   contract).
3. Body shape → 400 (unknown fields, `roundId` / `attemptId` not together, malformed ids) · not
   `requiresImplementation`, or Lab/Imaging → 400 (unchanged).
4. Steps 3–7 of §3.4 follow unchanged (as amended by §9.1).

Unknown fields on an existing order are still 400; "no body, an empty body, or `{}`" is still the
empty request. Only the order in which the verdicts are reported changes.

## 11. Integration record — 2026-10-16 (Session 1 assembly on draft PR #234)

*Appended; §1–§10 above are unchanged text. Where this section conflicts with them, **this section
wins**. No shared TypeScript signature, wire field, server rule or stored shape changes.*

The three sessions' branches are merged into `claude/amazing-hopper-nwzw1x` (merge commits
`7845d26` Session 1 backend `2fb4eb8` / product `5eac744`, `4fbddc5` Session 2 patient chart
`c88b3dc` / product `5315769`, `0cc9264` Session 3 nurse workflows `681198a` / product `9e87e5b`);
the assembled source uses Session 1's shared API exports, nursing helpers, admission-bound I&O
adapter and server, and Session 2's committed `PatientNurseCarePanel` insertion — no stand-in or
harness-only insertion ships. Two corrections were applied on top, each in its own commit:

### 11.1 Data-age chips convert to the hospital clock once (`0f56e8a`)

`src/components/DataAge.tsx` rendered `displayStamp(localStamp(at))`. `localStamp` already yields
hospital wall time and `displayStamp` converts again, so a UTC+3 hospital read three hours ahead
(reported by Sessions 2 and 3). It now hands `displayStamp` the UTC wire form of `at` — one
conversion, 12h/24h per preference, "D-n" for an earlier hospital day. Verified on the production
pairing with the device in America/Los_Angeles and the hospital in Asia/Baghdad, 24h and 12h (chips
and tooltips); nursing times stay to the second in both preferences, and server refusal stamps read
`yyyy-MM-dd HH:mm:ss` hospital time in both (full-date stamps are 24h by the app's existing
`displayFullStamp` convention; short times follow the preference).

### 11.2 Nursing rounds have no OVERDUE state (`4f1009d`; supersedes Session 3's 30-minute cutoff)

Session 3 labelled an open nursing round OVERDUE 30 minutes after its due instant, borrowing the
MAR's due-soon constant. No source defines a nursing deadline, so the label is removed: a round is
**DUE** from its exact due instant (open, or a legacy one-time order), **UPCOMING** before it, and a
late round stays DUE and actionable with the elapsed time shown as a fact ("Due 13:13:00 (7 min
since due)"); recorded due and completion times stay on the row and in its completion history. The
header and KPI count actionable (DUE) rounds; the exact unlock timer, repeating behaviour and every
medication threshold (DUE SOON, the 120-minute late-dose reason) are unchanged.

### 11.3 Recorded, not changed

- **Pre-existing:** restricted roles cannot open a patient chart in production. A Physiotherapist
  (no `orders.view`) or Receptionist (no `orders.view` / `results.view`) gets 403 on the chart's
  orders (and labs) reads — `usePatientScores` and `getPatientDetail` read them for every role — and
  the access refusal replaces the chart. Identical on `main` `f0bf464` and reproduced on `2fc317c`;
  this update's composites (I&O, MAR panel, nursing queue) make no reads for those roles. Needs an
  owner decision on what SOFA/NEWS2 show to such roles; no permission was granted. Evidence:
  `docs/evidence/icu-nursing-chart/integration/README.md` §5.
- Session 2's request to prune `getPatientDetail`'s now-unused orders read is not taken here (it
  belongs with the fix above).

## 12. Approval corrections — 2026-10-16 (Codex review of `72a7894`)

Two blocking defects found in Codex's approval review, each fixed in its own source commit on the
same branch. Evidence: `docs/evidence/icu-nursing-chart/approval-fixes/README.md`.

### 12.1 A refused MAR retry never settles an unresolved attempt (`8a0cadc`; amends the MAR controller of §4, by the rule of §9.2)

§4 extracted the MAR controller "without changing a rule", which carried over one rule from the
earlier page: a refused retry of an unconfirmed attempt counted as definitive unless it was a 401.
That covered a server 403, the client-side permission check (no status), and the refusal after the
pinned-minute fallback re-sends the original body. Such a refusal can come before the server's order
lock and attempt lookup, and an absent fact proves nothing, so a held original could still commit
after the controls had reopened. That produced two facts for one PRN or on-demand dose. The MAR
controller now follows the same rule as the nursing rounds (§9.2):

- a **first send** that is refused is definitive: "Not recorded", released by the next server read;
- a **refused retry** (any status, including a client-side refusal and the fallback's) leaves the
  attempt **unconfirmed with its stored copy**. Only the record settles it: its own fact, or its
  round or `once` dose documented by another fact;
- an answer that arrives after sign-out or an account change follows the same rule (`settleOrphan`):
  a refused retry never removes the signed-out nurse's stored attempt, and storage stays per nurse;
- the reason shown is the actual one. A 401 keeps its existing "sign in again, then retry saving"
  toast. Other refused retries show a "Retry refused" toast with the server's or the client check's
  reason. Every refused retry leaves the row notice "Retry refused — <reason>. Your original
  <action> documentation may already be on the record; checking.", cleared once the record confirms
  the attempt. The controls stay locked, and no wording advises giving the dose again.

Same-attempt replay, successful answers, the pinned-minute fallback, the rolling timer and the
medication exceptions are unchanged.

### 12.2 The New Nursing Order draft belongs to the patient it is shown for (`ff08a52`; amends the form of the owner's design §2)

On `/orders/:patientId`, the nursing editor and its submission are scoped to the patient displayed:

- the card is keyed by that patient, so a switch mounts a fresh one-time / Routine editor;
- a submission carries the displayed patient's id, never the routed id at the time the click lands
  or the answer returns;
- an in-flight submission keeps its patient, refreshes only that patient (and only while it is
  routed), and cannot clear or re-enable anything on another patient's page;
- the page's roster identity, order list, not-found flag and weight are held with the patient they
  were read for and shown only while that patient is routed, so a stale display never offers a
  submit under another patient's route;
- order-list reads land only for the routed patient, in the order they started.

No API, permission or schedule rule changes.

### 12.3 Recorded, not changed

- The pre-existing restricted-role chart reads (§11.3) remain open, separately from these fixes.
- The update-write / failed-health rollback release gate remains UNRESOLVED (migration-bearing:
  `migrationWillRun` is true for this update).
