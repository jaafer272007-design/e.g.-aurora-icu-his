# Hospital Shell — Design Document

**Status:** DESIGN — approved by the project owner; hand to build.
**Operational source:** Jaafer Aljanabi (ICU physician + system owner): four findings
from the owner's first real use of the merged Reception screen, the GROUP BY
OWNERSHIP rule, one overrule, one confirmation, one addition, and four carries —
all delivered in the owner's review of the 2026-08-19 shell report.
**Provenance, stated exactly as strong as it is:** this document was authored by
Claude Code from the owner's brief and the owner's approval rulings, at the owner's
direction that the four carries be recorded "in your own words" — it is NOT a
verbatim transcription of a single source file, and no such file exists to diff
against. What CAN be checked is every mechanism claim: each one was verified
against the repository before being written down, with the file and line named.
**Module:** the shell — cross-module chrome (navigation, wordmark, the disabled-control
convention, patient search). It precedes the Ward build, deliberately: Ward copies
whatever conventions exist when it starts.

---

## 0. Why the shell, and why now

The owner used Reception for the first time and could not tell how the system
worked. Four findings, one diagnosis: the shell is still an ICU shell and must
become a hospital shell before module #2 ships. The four findings:

1. The navigation is one flat ICU-era list; nothing says what belongs to what.
2. A disabled control explains nothing — the owner hit a field that could not
   be filled and was given no reason and no remedy.
3. Two admission entries sit adjacent in one sidebar with the same icon.
4. Finding an existing patient requires a separate search box; typing a name
   composed across fields returns a false "no patient found" — the path to a
   duplicate registration.

Reception passed CI, gates, and screenshot review before any of this was found.
Ten minutes of human use found all four. That lesson is already recorded in the
project discipline; this design is its output.

---

## 1. Navigation by module — the ownership rule

**THE RULE (owner's ruling, and it answers every placement question): GROUP BY
OWNERSHIP. A screen owned by one module sits under that module. A screen the
whole hospital uses sits in a hospital-wide group.** That is the whole rule, and
every future screen is placed by asking it.

### 1.1 The structure

| Group | Rows | Ownership |
|---|---|---|
| *(ungrouped, top)* | Dashboard | role-personalized landing — unchanged |
| **Patient Flow** | Reception · Discharges & Transfers | hospital-wide — the entrance and the exit. Reception opens episodes for the whole hospital; Discharges & Transfers closes encounters and moves beds for ANY patient, the Ward design reuses it unchanged (ward.md §3.4/§3.5), and nurses reach transfer only from there |
| **Ward** | *(none yet)* | module — appears when the Ward build ships its first screen (the awaiting-bed list) |
| **ICU** | ICU Beds · Bed Admission · Statistics | module — the bed board with the ICU bedside snapshot; the admit-into-an-ICU-bed flow; the ICU analytics dashboard whose measures are computed over ICU encounters |
| **OR** | *(none yet)* | module — appears when OR exists |
| **Patient Chart** | Observations · Orders & Meds · Labs & Imaging · Lab Entry · Timeline · AI Assistant · Alerts | hospital-wide — the chart follows the PATIENT, not a module; the day Ward ships, ward patients open in these same screens |
| **Records** | Discharged Patients · Print Center | hospital-wide |
| **Administration** | User Accounts · Backup & Recovery · Formulary · Lab Catalogue · Order Sets · Configuration · Settings | hospital-wide |

**The overrule, recorded with its reason:** the report proposed Discharges under
ICU ("true today — every bedded patient is an ICU patient"). The owner overruled:
it is shared ADT, putting it under ICU makes a hospital-wide screen look
module-owned, and it guarantees the row MOVES between releases when Ward ships —
which a hospital notices. Screens are placed by ownership, never by today's
population.

**The confirmation:** Patient Chart as its own group is the same ownership test
applied — four modules are the anchors, not a quota. Strict four-bucket nav was
considered and rejected.

**The Discharges row is renamed "Discharges & Transfers"** — the owner's own
name for it, twice, and the honest one: transfer lives only on that screen
(`/discharges`, actions `adt.discharge` / `adt.transfer`), and a nurse scanning
a sidebar for "transfer" currently finds nothing.

### 1.2 Mechanics

- `NavSidebar` gains group headers (small-caps labels). Every row keeps its
  existing per-row permission gate unchanged.
- **A group with zero visible rows renders nothing — no header, no gap.** Each
  profile sees only the modules it works in; Ward and OR are invisible until
  their first screens ship rather than advertised as coming. Every profile's
  sidebar is the SAME rows it sees today, grouped by this table — no row
  appears or disappears for anyone except the one whose gate §3 changes (Bed
  Admission).
- Below the 1180px icon-only collapse (labels already `display:none`), headers
  render as thin separators so grouping survives without text.
- No route, no permission, and no RBAC atom changes in this design. Navigation
  VISIBILITY changes; reachability by URL does not (see §4 for the one row
  whose visibility gate changes).

### 1.3 The wordmark and the do-not-rename ledger

**Renamed to AURORA HIS / Aurora HIS:**

| site | today |
|---|---|
| `src/components/AppHeader.tsx:82` | `AURORA ICU<small>{subtitle}</small>` — the shared header |
| `src/pages/MissionControl/MissionControl.tsx:333` | a second, hand-rolled copy of the same brand block |
| `src/pages/Login/Login.tsx:148` | `AURORA ICU · Hospital Information System` |
| `index.html` `<title>` | `AURORA ICU · Mission Control` → `Aurora HIS` |

The sidebar footer already reads `AURORA HIS v4.2` (`src/lib/version.ts`) — the
version string was renamed at some point and the product's face was not. This
closes that gap. No deployed suite asserts the wordmark or the title (checked);
`PrintDocument.tsx` sets its own per-template `document.title` and is unaffected.

**Deliberately NOT renamed, each with its verified reason:**

| identity | why it must not move |
|---|---|
| `/api/icu/*` route strings | byte-locked convention (01): renaming breaks the deployed frontend and all 16 deployed suites |
| `AuroraIcu.Api` assembly / namespaces | the SCM ImagePath is baked at first install and `aurora-update.ps1` resolves the install directory FROM the registered service (`installer/aurora-update.ps1:178`, `:270-296`) and never re-registers it — a renamed assembly means no existing install can take another update |
| the `AuroraServer` / `AuroraAI` / `AuroraPostgres` services | same fact; the updater stops/starts them by these names (`:535`, `:582`) |
| installer `AppName "Aurora ICU"` (`installer/aurora.iss:14`) | uninstall identity and version-skew comparison key on the hospital server; renaming leaves an updated hospital with two disagreeing names |
| **ICU Day** (`MissionControl.tsx:386`) · **Avg ICU Stay** (`BedOverview.tsx:298`, `beds.ts:98`) · **ICU Mortality** (`Statistics.tsx:106`) | computed over ICU encounters — renaming them would make the product lie |
| "ICU Beds", "ICU Preferences" (Settings), the ICU group label | correct under module structure, not residue |
| installer script comment headers ("AURORA ICU — …") | comments in installer identity files, not UI |

---

## 2. A disabled control names its blocker

**THE CONVENTION (binding on this screen now, and copied by Ward and OR): a
disabled submit control is accompanied by the list of reasons it is disabled,
rendered AT the control, naming each field by its on-screen label.** A disabled
button with no reason is the owner's finding 2, and it is what this section
ends.

### 2.1 The shape

`formOk` stops being a boolean computed in one expression. The form derives a
**blockers list**; the boolean survives only as `formOk = blockers.length === 0`
(the submit wiring is unchanged). Each blocker is:

```
{ kind: 'unfilled' | 'unfillable', text: string }
```

**The two kinds are the point.** *Unfilled* means the user has not filled a
field they can fill — the remedy is on this screen. *Unfillable* means the field
CANNOT be filled from this screen — the remedy is somewhere else, and the
blocker names where. The owner's case was the second: "fill in Service" would
have been a false instruction when the remedy was Configuration. A convention
that conflates the two instructs users to do the impossible.

### 2.2 The Reception blockers, enumerated

*Unfillable* (each names its remedy, never the field alone):

- Any of the three required vocabularies with no active entries — "Departments
  has no active entries — add them in Configuration → Hospital" (today's banner
  case, now also stated at the button it disables).
- The chosen department has no active services — "{Department} has no active
  services — add one in Configuration → Hospital, or choose another department"
  (the owner's case).
- The ward-doctor list unreachable (`wardDoctors === null`) — "Admitting doctor
  cannot be chosen — the live server is unreachable."
- **The ward-doctor list reachable and EMPTY (`wardDoctors` loaded as `[]`) —
  "No doctor accounts exist yet — create them in User Accounts."** This case is
  first-class, not a footnote: today it renders a bare "Select…" with zero
  options and NO surface anywhere says why (`Reception.tsx:493` handles only
  `null`), and it is reachable on any real install before doctor accounts are
  created — exactly the class of silence this convention exists to end.
- The session lacks `admissions.create` — view-only, stated (today's note,
  joined to the button).

*Unfilled* (by on-screen label): "Type of admission has not been chosen" ·
"Department has not been chosen" · "Service has not been chosen" · "Admitting
doctor has not been chosen" · "Admission date/time is blank or not
yyyy-MM-dd HH:mm" · the identity fields when registering (first/father's/family
name, date of birth, sex, allergies) · a referrer choice left half-completed
("Referring doctor: pick the doctor, or switch back to Not recorded").

### 2.3 The render contract

At the submit button: a `role="status"` region with a stable `id`; the button
carries `aria-describedby` pointing at it and stays `disabled` while any blocker
stands. Unfillable blockers render before unfilled ones — the ones the user
cannot fix from here are the ones they most need told. Built as a shared
component (`SubmitBlockers`, `src/components/`) with this shape documented on
it, because Ward and OR copy the component, not the idea.

### 2.4 The CI gate moves in the same PR — and is never loosened

`scripts/reception-required-fields-gate.mjs` anchors on `const formOk` and
`disabled={!formOk` and requires the five §3.2 state identifiers inside that
expression. The restructure moves the five identifiers into the blockers
computation, so **the gate is repointed at the blockers computation in the same
PR**, still requiring all five identifiers and the disabled wiring, and its
teeth are re-measured the way they were measured the first time: each of the
five deleted in turn, the gate failing each time, the file restored
byte-identical.

**BINDING, recorded here because it would be invisible in a diff: if the gate
fails after the restructure, the GATE is fixed to match the new shape — it is
never loosened to pass.** A gate weakened to make CI green is a false green
with extra confidence attached, the exact failure this project's evidence rules
exist for. The five required fields are the product's only enforcement of
design §3.2; the gate guards that enforcement; weakening the gate deletes the
requirement invisibly.

### 2.5 Where the convention applies next — before Ward

The ICU Admissions form (`/admissions`) has the same traps today: a consultant
list stuck on "Loading…", a bed list with every bed occupied, `formOk` silent
at the button (`Admissions.tsx:271`). **It receives `SubmitBlockers` as its own
follow-up PR, placed BEFORE the Ward build** (owner's ruling): Ward copies
whatever convention exists when it starts, and a half-applied convention is
what produced two admission entries in the first place.

---

## 3. One sidebar, one admission entry per authority

Today `NavSidebar.tsx:70-71` shows Reception (`admissions.create`) and
Admissions (`patients.view`) adjacent, **with the same icon** (`IconAdmit`
both). Eight profiles see the Admissions row; two can admit (the recorded
evidence in 02). The changes:

- **The Admissions nav row is gated on `adt.admit`** — visible to Doctor and
  SeniorDoctor, the two profiles that can actually use it. **The ROUTE gate is
  unchanged at `patients.view`**, so deep links still resolve to the honest
  read-only census, never a redirect.
- **The row is renamed "Bed Admission"** — the by-bed discriminator the
  Inpatient Reception design already chose ("the split is by BED, not by
  endpoint"; the requirement follows the bed). The screen admits into an ICU
  bed and sits under the ICU group; Ward's bed assignment is a different path
  with its own atom and never this screen.
- **Distinct icons:** Reception keeps `IconAdmit`; Bed Admission gets a new
  glyph (bed + arrow) added to `icons.tsx`. `IconBed` stays ICU Beds'.
- **The Decision C pointer is deleted deliberately** (`Admissions.tsx:298-306`,
  the "use Reception" note shown to `admissions.create` holders). After the nav
  gate, its only possible audience — an office Administrator without
  `adt.admit` — can arrive solely by typed deep link; the pointer would be an
  orphan and orphaning it silently is worse than removing it on the record.
  The "View only" note itself stays (the honest state for a deep-linked
  reader). `canCreateAdmission` goes with the pointer; the `admcancelre` CSS
  class stays — it is shared with the cancel-readmit button (`:323`), so
  nothing is orphaned.

---

## 4. Inline patient search — and the endpoint is fixed first

### 4.1 The endpoint rewrite (server, its own PR, before any client change)

`GET /api/icu/adt/patients/search` (`AdtApi.cs:261-322`) was written for a
click and is already fired every 200ms by two shipped screens. Verified shape:
it materialises the ENTIRE patients table and the ENTIRE encounters table per
call (`:279-281`), filters and sorts in memory, applies `limit` after the scan
(`:312`), and then `ToMatchCard` (`:1441`) re-queries encounters per returned
card plus a dispositions lookup per card — ~2 follow-up queries × page size on
top of the two full-table reads. Shipping an inline search onto that is a known
problem delivered to a hospital. The rewrite:

- **Filtering moves into SQL.** `ToLower().Contains(q)` per searched column —
  operators both providers (Npgsql 8, SQLite) translate; whether a given
  provider emits `LOWER(col) LIKE '%q%'` or an equivalent (`strpos`), the
  BEHAVIOUR is what the verification matrix asserts, including that a literal
  `%` or `_` in the query never acts as a wildcard. Same columns as today,
  PLUS a SQL-composed full-name expression (COALESCE the five parts,
  space-join, collapse double spaces with two `Replace` passes, TRIM) so
  cross-part substrings keep matching exactly as the in-memory
  `FullLegalName` did.
- **Scope, ordering, and `Take(limit)` pushed into SQL**; `total` from a COUNT
  query; discharged-scope recency via a MAX(DischargedAt) subquery over closed
  encounters.
- **Cards batched:** ONE encounters query for the page's patient ids and ONE
  dispositions read replace the per-card queries; `ToMatchCard` gains a
  preloaded-lookup overload, and `/patients/match` (the other caller) keeps
  byte-identical behaviour through it.
- Net: ~4 bounded queries per call, no table materialisation, the limit
  applied before the work instead of after it.

**Verification:** old-vs-new **byte diff** of responses across a matrix — both
scopes × Arabic/Latin/partial/cross-part/legacy-single-name queries, queries
containing `%` and `_` (the wildcard-escape probe: a literal `%` must not
become match-all), short-national-id masking, empty q on scope=discharged —
run against **PostgreSQL, the engine that ships** (03's rule), plus the
deployed ADT suite after merge. One stated residual: SQL name ordering follows
column collation where the old code used in-memory string comparison; checked
against the suites before merge and recorded if it shifts.

### 4.2 🔴 The residual the rewrite does NOT remove: the search is still not indexed

**Stated plainly so nobody reading "the endpoint was fixed" concludes the
search is indexed** (owner's addition): `LOWER(col) LIKE '%q%'` cannot use a
btree index — PostgreSQL sequential-scans the patients table on every call.
The rewrite removes the table materialisation and the N+1, which is the large
win — a seq scan over one table's indexed-width columns at this hospital's
patient volumes is milliseconds, where the old shape was two full-table
materialisations plus ~2N queries — but **the scan itself remains, and grows
linearly with the patient registry forever.**

**The indexed option, costed, for whoever adopts it later:** a trigram GIN
index (`pg_trgm`, `gin_trgm_ops`) on the searched columns — or on one computed
composed-name column — makes `LIKE '%q%'` indexed.

- **Extension dependency:** `pg_trgm` is a PostgreSQL contrib module. Both
  shipping engines bundle contrib: the appliance's `postgres:16-alpine`
  (`appliance/docker-compose.yml:134`) and the EDB "binaries only" zip the
  Windows installer stages (`installer/build.ps1:22`, `:209` — `bin\ share\
  lib\` are copied into the payload). On PG13+ `pg_trgm` is a **trusted**
  extension, so `CREATE EXTENSION IF NOT EXISTS pg_trgm` in a migration runs
  as the `aurora` database owner with no superuser step. **Honest limit:**
  contrib presence in both bundles is asserted from the distributions'
  contents, not measured here — the adopting PR must prove it on both real
  engines (03: test on the engine that ships), and its migration must fail
  loudly, not silently skip, if the extension is absent.
- **Other costs:** index storage and write amplification on patient writes
  (negligible at registration rates), one migration per indexed expression,
  and the SQLite demo path has no trigram support — the demo stays seq-scan,
  which is acceptable and must be stated in the adopting PR rather than
  papered over.
- **Not adopted in the rewrite PR.** The rewrite is behaviour-preserving; an
  index changes the plan, not the answers, and deserves its own change when
  registry growth warrants it. This section exists so that decision is made
  with the residual in view instead of rediscovered.

### 4.3 The inline search (client, after the endpoint)

The separate search box on Reception is **replaced** by inline surfacing: as
the clerk types in any single identity field (first name, father's name,
family name, national ID, file number), matching patients appear beside the
form. Three binding constraints, each from a real failure mode:

1. **The query is the SINGLE field being typed — never a composition.** The
   server ORs substring matches per name part and per composed full name
   (`AdtApi.cs:293-300`), so "Ali Al-Janabi" — first + family, skipping the
   father's name — is a substring of nothing and returns zero. A composed
   query manufactures a false "no patient found", and a clerk who believes it
   creates a duplicate. Two or more characters, 200ms debounce, one field's
   raw value per query.
2. **No sentence meaning "no such patient exists" is ever rendered inline.**
   Zero inline matches render NOTHING — the region is simply absent. Only the
   submit-time match (`/patients/match` + `MatchDialog`) may conclude a
   patient is new, because only it runs the exact-identity check. **The
   current sentence — "No patient matches '…'. Register them below"
   (`Reception.tsx:388`) — leaves with the search box it belongs to. That
   removal is a DECISION of this design, not an accident of the refactor:**
   it is precisely the false statement constraint 2 forbids, delivered today
   by the box being replaced.
3. **A monotonic request id.** Each query is stamped from a counter; a
   response is applied only if its stamp is still the latest. Neither shipped
   debounce guards ordering — `DischargedRecords.tsx:43-47` and
   `PrintCenter.tsx:41-44` both apply whichever response lands — and on a
   name field an out-of-order response means the PREVIOUS query's patients
   rendered beside the CURRENT name: the wrong-patient shape. Because closing
   one instance of a defect class is not closing the class (03), the same
   guard lands at both shipped sites in the same PR, via one shared helper.

The inline rows reuse the existing machinery whole: the same
`searchPatients` read, the same row guards (admitted / deceased /
discharged-with-admit-action), the same `setPicked` re-admission path, the
same submit-time `MatchDialog`. No second find-or-register flow exists —
that fork is forbidden by the Reception design's §1 and stays forbidden.

---

## 5. What Ward must clear — recorded where Ward will look

Two shipped surfaces state or enforce an ICU-only scope that becomes false the
day Ward ships. Both are TRUE today and are corrected **in the Ward build,
not before and not silently after**; they are appended to
`docs/design/ward.md` as amendment A7 alongside this design so the Ward build
cannot start without seeing them:

1. **`PatientHistory.tsx:154-156`** — "Aurora holds no external, pre-Aurora or
   non-ICU records." The day a ward admission exists, Aurora holds a non-ICU
   record and the scope statement lies.
2. **Both AI prompts are ICU-scoped** — the translator (`AiApi.cs:101`:
   "questions about ICU patients… non-ICU data → unanswerable") and the
   interpreter (`AiApi.cs:355`: "the interpretation layer of an ICU
   information system"). A clinician asking about a ward patient can be
   refused as out of scope by a correctly-functioning model following its
   instructions.

---

## 6. RBAC

**No atom is added, removed, or re-assigned by this design.** The only
permission-adjacent change is navigation VISIBILITY: the Bed Admission row's
nav gate moves from `patients.view` to `adt.admit` (§3) while its route gate
stays `patients.view`. Every other row keeps its gate; every route keeps its
guard; `Rbac.cs`, `session.ts`, and the 01 matrix are untouched.

---

## 7. Build order

One work item per branch per PR, one PR merged at a time, per 03.

1. **This document** (+ the ward.md A7 amendment, + the 02 record) — the
   versioned source; no build before it merges.
2. **The endpoint rewrite** (server only, §4.1–4.2) — byte-parity verified on
   PostgreSQL before merge; deployed ADT suite after.
3. **The shell PR** — grouped navigation (§1), wordmark + browser title
   (§1.3), and the admission-entry fixes (§3). One PR because they all live in
   `NavSidebar`/`App`/`Admissions` and are one coherent change to the chrome.
4. **The blockers PR** — `SubmitBlockers` + Reception (§2), the CI gate moved
   and re-measured in the same PR (§2.4).
5. **The inline-search PR** — Reception's inline surfacing + the request-id
   class fix at both shipped debounce sites (§4.3).
6. **The Admissions-form blockers PR** (§2.5) — after the convention exists,
   **before the Ward build starts.**

Every build PR carries its 02 record and ends with a written walkthrough a
person can actually follow — and a person follows it before the screen is
called done. That requirement is the origin of this whole design and it is not
waived for the design's own build.

## 8. Open items

None. The two grouping questions raised in the report were ruled by the owner
and are recorded in §1 with the rulings and their reasons.

---

*End of Hospital Shell design — the chrome becomes a hospital's: navigation
grouped by ownership under Reception / Ward / ICU / OR with hospital-wide
groups beside them, the wordmark says what the product is, a disabled control
names its blockers and where the remedy lives, one admission entry per
authority with the bed as the discriminator, and patient search that is inline,
honest about what it cannot conclude, ordered under race, and running on an
endpoint that reads four bounded queries instead of two tables — with the
unindexed-scan residual on the record for the day the registry outgrows it.*

---

## Amendments

*Appended with the endpoint-rewrite build. Everything above this line is the
approved design, byte-unchanged (original 24,776 bytes hash-verified before
and after this append; 0 deletions in the diff).*

### A1 · §4.1's "behaviour-preserving" was MEASURED against three engine shapes — and it holds everywhere except one class, which is recorded rather than papered over (2026-08-19)

§4.1 promised the rewrite behaviour-preserving and §4.1's verification plan
promised the byte diff on the shipping engine; the owner then required it on
BOTH engines, with Arabic in the matrix, and divergence stated plainly rather
than resolved by picking the engine that agrees with the old code. That
instruction turned out to be the load-bearing one. The committed harness
(`scripts/search-parity.sh`) ran old-vs-new on THREE engine shapes:

| leg | ctype reality | result |
|---|---|---|
| PostgreSQL, `C.UTF-8` (a stock Linux cluster) | full-Unicode `LOWER()` | **byte-identical, zero masks** — every matrix line |
| PostgreSQL, `--locale=C` (**the hospital initdb**, `aurora-provision.ps1:256`) | ASCII-only `LOWER()` | identical **except** the two cased-non-ASCII cases |
| SQLite (the demo path local dev and CI run) | ASCII-only `lower()` | identical **except** the same two cases, after the two stated per-boot masks (discharge stamps + random MRNs) |

**THE MECHANISM, so the next reader does not re-derive it.** The old code
lowered BOTH sides in-process (`ToLowerInvariant`) — engine-independent, and
it folds É→é even under `InvariantGlobalization`. The rewrite lowers the
QUERY in-process but the COLUMNS by the engine's `LOWER()` — which is
full-Unicode on `C.UTF-8` and ASCII-only under plain `C` and on SQLite. So
`émile`/`ÉMILE` found the stored "Émile" under the old code everywhere, and
under the new code only on `C.UTF-8`.

**WHAT IS PROVEN UNAFFECTED, because it is the population that matters here:**
Arabic is caseless — every Arabic probe (partial, exact, cross-part span) is
byte-identical on all three shapes — and ASCII case-folding is identical
everywhere. The divergent class is cased accented Latin (É, Ñ, Cyrillic, …)
in stored names.

**THE RULING SOUGHT FROM THE OWNER VIA THIS PR: accept the delta, and assign
its closure to the §4.2 follow-up.** The engine-independent fix is a stored
.NET-lowered shadow search column — which is EXACTLY the computed column the
§4.2 trigram index wants to sit on, so building it now would pull half the
indexing step into a PR whose whole claim is behaviour-preservation, and
building it twice would be worse. Until then the harness carries the delta as
teeth, not as blindness: `--known-divergence` names the two measured cases,
a diff confined to them reports DIVERGENCE-AS-RECORDED, and a diff touching
ANY other case still fails.

**Two harness facts recorded because they are evidence, not embarrassment:**
its first run failed on the OLD side because the 400-message assertion did not
account for JSON `'` escaping (the message rule catching its own
assertion), and its second run was stopped by the `/healthz` build gate when
the OLD server's wrapper-subshell kill left the OLD process holding the port —
this repo's #204 failure shape, refused this time by the gate built from it.

Nothing in §§0–8 is altered by this entry.
