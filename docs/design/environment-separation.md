# Environment Separation — Design Proposal

**Status: PROPOSAL — awaiting project-owner approval. No code, config, or
service changes ship with this document.**

This designs the transition from the single-environment prototype
(recorded in 02_PROJECT_STATUS.md as the "single environment — every test
writes to the system of record" constraint, and in 01_ARCHITECTURE.md as
the missing architectural concept) to an operational model in which
**testing cannot touch the system of record**.

The governing principle, applied throughout and audited in §12: every
prior problem in this project was solved by converting it into a
**mechanism that prevents recurrence** — the tsc no-op became a mandatory
compile check, warm-up blindness became the content-equality gate, the
frontend/API mismatch became `build.txt` + the render suite. Environment
separation must meet the same bar: **crossing the test/production boundary
must be structurally impossible and loudly-failing, never merely
documented.** Anywhere this design would rely on "remember to configure X
correctly," it instead names the gate that replaces the remembering.

---

## 1. Decisions at a glance

| # | Decision | Choice |
|---|---|---|
| D1 | Environment tiers | **TEST + PRODUCTION** now; staging deferred (§2) |
| D2 | What today's stack becomes | The entire current stack (Pages site, `icu-cp49` service, current free Postgres with its accumulated artifacts) becomes **the TEST environment, wholesale**. Production is built new and starts empty of clinical data (§8) |
| D3 | Databases | **Two separate PostgreSQL instances** — non-negotiable (§3.1). Production = the paid database; test keeps the free tier |
| D4 | Auth isolation | Separate `JWT_SECRET` per service **and** an `aud` (environment) claim validated by the API — two independent locks (§3.2) |
| D5 | Services | Two Render web services + one Render **static site** for the production frontend; GitHub Pages remains the test frontend (§3.3) |
| D6 | Seeds | Seeding is **environment-moded in code**: production seeds reference data + ONE bootstrap administrator only — no demo patients, no demo staff, no `Aurora2026!` — enforced by boot-time tripwires, not convention (§3.4) |
| D7 | Promotion | Git-based: test auto-deploys from `main`; production deploys **only from the `production` branch**, advanced by an explicit push that a promotion gate verifies (ancestor-of-main + equals-what-test-is-running) (§4) |
| D8 | Cross-environment locks | Compiled-in API URL + per-environment CORS + runtime environment cross-check + environment-asserting suites — the full boundary matrix in §5 |
| D9 | CI identity | `/healthz` and `build.txt` gain an `environment` field; every suite asserts the environment it intends **before any write leg**; write suites have no production target at all (§6) |
| D10 | Config residence | **All environment wiring lives in `render.yaml` and workflow files** — versioned, reviewed, and already inside every gate's comparison set. No dashboard-only or repo-variable wiring survives this design (§5.4) |

---

## 2. Environments: test + production, staging deferred

**Decision: two tiers.** TEST is where all development lands and all
suites write; PRODUCTION is the system of record.

**Why no staging tier now.** Staging earns its cost when it answers a
question test cannot: integrating multiple developers' work, rehearsing
release trains, or soak-testing under production-like load. None of those
exist today — one developer, one module, and a promotion model (§4) in
which production deploys a **git tree that test was literally running when
its suites passed**. Content-equality promotion means staging would
re-verify bytes already verified; it would add a service + database + a
third set of gates and produce no new information. Deferred, not
rejected.

**The no-rework path to staging later.** Everything in this design is
parameterized by an environment *name* carried in one tuple:

```
(name, git branch, Render service, database, frontend origin, healthz env)
test        main        ICU (icu-cp49)   aurora-db (free)   github.io Pages     "test"
production  production  ICU-prod         aurora-db-prod     Render static site  "production"
```

Adding staging = adding one row: a `staging` branch, one more
service+database pair in `render.yaml`, one more origin, and the suites'
target table (§6) gains a `staging` entry. No mechanism changes — the
gates, the `aud` claim, the seed modes, and the promotion workflow are all
written against the tuple, not against the pair. The single code change
staging would ever need (accepting a third valid `APP_ENV` value) is a
one-line whitelist.

---

## 3. Per-environment isolation

### 3.1 Separate PostgreSQL — non-negotiable

Two independent database instances (not two schemas, not two databases on
one instance). Three reasons, each sufficient alone:

1. **Our own rules make cross-contamination permanent.** The
   never-destroy and never-reset-the-live-database rules — correct rules —
   mean a test row that lands in production **can never be deleted**.
   There is no cleanup story by design, so **prevention is the only
   control that exists**. Only a separate instance with separate
   credentials makes a test write to production a connection failure
   rather than a policy violation.
2. **Blast radius.** A migration bug, a discharge-cascade bug, or a suite
   gone wrong on test must be physically unable to touch production rows.
   Shared-instance separation (schemas) leaves one mis-set
   `DATABASE_URL` between test traffic and production data; separate
   instances make the credential itself environment-specific.
3. **The current database is already the argument.** Today's durable DB
   contains P-1023/P-1024/P-1034/P-1040/P-1047/P-1048, dozens of suite
   encounters, e2e drugs, and deactivated test accounts — irreversibly,
   per rule 1. It is a *test* database in every meaningful sense already
   (§8 just makes that official).

Production takes the **paid** database (no 30-day expiry — the recorded
free-tier deletion policy is an absurd risk for a system of record). Test
keeps the free tier; its 30-day churn becomes *acceptable by
reclassification*: when the free DB expires, test is recreated and
reseeded — an operational note, not an incident, because nothing in test
is a record.

### 3.2 Separate JWT secret — plus the `aud` claim (two locks)

Each service gets its own `JWT_SECRET` (`generateValue: true` per service
in `render.yaml` — never shared, never in the repo). A test token then
fails signature validation on production.

Secret separation alone, however, is "remember to keep them different" —
a copy-paste away from silently collapsing. So the token also carries the
environment as its **`aud` claim**, and validation requires
`aud == APP_ENV`. Even with identical secrets, a test-issued token is
structurally invalid on production. Two independent locks; both must fail
for a cross-environment token to authenticate.

### 3.3 Separate services and frontends

- **Test API**: the existing `ICU` service (`icu-cp49.onrender.com`),
  `branch: main`, autoDeploy — unchanged.
- **Production API**: new Render web service, `branch: production`,
  paid instance (a system of record should not cold-start for 60 s).
- **Test frontend**: the existing GitHub Pages site. Its quirk —
  work-branch pushes with open PRs redeploy it — is *re-legitimized* by
  this design: previewing in-progress work **is** what a test frontend is
  for, and it can only ever reach the test API (§5).
- **Production frontend**: a Render **static site** in the same
  blueprint, built from the `production` branch with the production API
  URL baked in from `render.yaml`. (GitHub Pages allows one site per
  repo, and that site is spoken for; a blueprint-managed static site also
  keeps production's frontend wiring in the same reviewed, gated file as
  everything else.)

### 3.4 Seeds — environment-moded in code, enforced by tripwires

The server gains `APP_ENV` (`test` | `production`; any other value →
refuse to boot). Seeding splits into two classes:

- **Reference seeds** (bed registry, formulary, frequencies, interaction
  rules, lab catalogue, order sets): seeded in **both** environments —
  a production ICU needs its bed layout and formulary as starting
  configuration, which Pharmacy/Laboratory then maintain through the
  Layer 4 screens.
- **Clinical + demo-identity seeds** (14 demo patients, encounters,
  orders, results, AI profiles, bedside snapshots, the 20 demo staff, the
  `system` principal's demo-era peers): seeded in **test only**.
  **Production starts empty of clinical data.**

Production users: the seeder creates exactly **one bootstrap
administrator** whose password comes from a required
`ADMIN_BOOTSTRAP_PASSWORD` env var (`generateValue: true` — random, read
once from the dashboard by the owner, rotated via Layer 3 after first
login). Every real account is then created through the existing Layer 3
user administration with individual credentials. The demo password never
exists in production.

Because "the seeder checks a variable" is itself configuration, two
**boot-time tripwires** back it (loud crash, not a warning, before the
service binds):

- **T1 — demo-credential tripwire**: on production boot, verify
  `Aurora2026!` (and `DEMO_PASSWORD` if set anywhere) against every
  active account's bcrypt hash; any match → refuse to serve. This
  catches not only seed misconfiguration but any future human setting the
  shared password on a real account.
- **T2 — demo-config tripwire**: production boot with `DEMO_PASSWORD`
  set, or with `DATABASE_URL` unset (the SQLite demo path), refuses to
  start. The convenient dev fallback is a security hole in production, so
  production mode simply does not have it.

---

## 4. Promotion model — git-based, gated, auditable

- **Test** deploys automatically from `main` (unchanged): merge → Render
  builds → suites dispatched sequentially per the existing discipline.
- **Production** deploys **only** from the `production` branch. Promotion
  is one deliberate git action:

  ```
  git push origin <validated-main-commit>:production   # or an annotated tag first
  ```

  It cannot happen as a side effect of merging a PR; it is visible in
  `git log production`, attributable, and revertible.

**The promotion gate** (a workflow on `push: branches: [production]`)
converts "promote carefully" into a mechanism. It fails the push's deploy
readiness loudly unless:

1. the pushed commit **is an ancestor of `main`** — production never runs
   a commit that didn't go through the normal PR path (no cherry-picks,
   no divergence); and
2. the pushed commit's `server/` tree + `render.yaml` blob **equal what
   the TEST environment is serving right now** (the same
   `git rev-parse "$commit:server"` vs `/healthz build` comparison the
   suites use, pointed at test) — you can only promote bytes that test is
   currently running, i.e. the exact content the last green suite runs
   validated.

**Per-environment gates, unchanged in shape.** Every existing mechanism
operates per environment with the same logic:

- `/healthz build` + content-equality gate → each suite compares the
  dispatched ref against *its target environment's* healthz (§6).
- `build.txt` → both frontends stamp it; the render suite's Pages gate
  runs against the test frontend, and a production render smoke asserts
  the production static site's stamp against the `production` branch.
- CONFIG MISMATCH → `render.yaml` now defines both environments, stays in
  every comparison set, and the documented manual-deploy operational step
  applies per service.

**Rollback**: point `production` at the previous commit (a second
deliberate git action) → Render redeploys it. Policy stays roll-forward
by preference; schema changes complicate rollback, which is exactly why
the migration discipline already requires hand-audited, empirically
tested `Down()` paths (the `AddPatientDateOfBirth` precedent).

---

## 5. Cross-environment safety — the boundary matrix

Every crossing path, and the locks that make it fail structurally. No
path relies on fewer than two independent locks.

| Crossing attempt | Lock 1 | Lock 2 | Lock 3 |
|---|---|---|---|
| Production frontend calls test API | API URL is **compiled into the bundle** from `render.yaml` (no runtime setting exists to repoint it) | Test API CORS allows only the test origin → preflight fails | Runtime env cross-check (below) paints the interstitial |
| Test frontend calls production API | Same compiled-URL lock, mirrored | Production CORS allows only the production origin | Runtime env cross-check |
| Test JWT used on production API | Different `JWT_SECRET` → signature invalid | `aud: test` ≠ `production` → rejected even with equal secrets | — |
| Suite write-legs hit production | Write suites' target table **contains no production entry** — there is no input that selects it (§6) | Gate asserts `/healthz environment == "test"` before any write leg | Production credentials differ (demo logins don't exist there — the suites' login step itself fails) |
| Production service attached to test DB (or vice versa) | Wiring is `fromDatabase` inside one reviewed `render.yaml` — no free-text connection strings, no dashboard edits | `render.yaml` sits in every gate's comparison set → an unreviewed/undeployed wiring change trips CONFIG MISMATCH | — |
| Demo credentials in production | Seed mode: demo users are never seeded outside test | T1 boot tripwire: any account matching the demo password → refuse to serve | T2: `DEMO_PASSWORD` set in production → refuse to boot |
| Human opens the wrong UI | Each build compiles in its environment name; the test frontend renders a permanent **TEST ENVIRONMENT banner** | The runtime cross-check below | Distinct origins/URLs |

**The runtime environment cross-check** (the `build.txt` lesson applied
one level up): each frontend build compiles in its *expected* environment
name alongside the API URL. On load, the app compares `/healthz
environment` against the compiled expectation; a mismatch replaces the
app with a full-screen refusal naming both values — a
mis-wired build is unusable, not quietly wrong. (Mock/offline mode is
unaffected: no healthz, no clinical system of record.)

### 5.4 No dashboard state left in the wiring

Today the test frontend's API URL comes from a **repo variable**
(`vars.API_BASE_URL`) — dashboard state, invisible to git and to every
gate. This design eliminates that class: the test API URL moves into
`deploy-pages.yml` itself (it is not a secret), and production's URL
lives in `render.yaml`. After this, **every environment-defining value is
in a versioned file inside the gates' comparison sets**; the only
dashboard-resident values are secrets (`JWT_SECRET`,
`ADMIN_BOOTSTRAP_PASSWORD`, `DATABASE_URL`), all `generateValue`/wired by
blueprint, none of them routing.

---

## 6. CI environment-identity guarantee

The freshness-gate mechanism, extended by one field:

- `/healthz` → `{ "status", "service", "build", "environment" }`.
- `build.txt` → two lines: commit, environment.

Every suite's gate asserts, in order:

1. **Environment identity** — `healthz.environment == the suite's
   declared target`. Asserted FIRST and without retries: a wrong
   environment is not a warming-up condition; it fails immediately and
   loudly, before any login, any write, any retry loop.
2. **Content equality** — the existing build-context comparison, against
   that environment's healthz/build.txt.

**Write suites cannot name production.** The eleven data-writing suites
declare `TARGET: test` in a per-suite table that simply has no production
row — there is no dispatch input, variable, or URL that makes them run
write legs elsewhere. Production gets its own **read-only smoke suite**:
healthz environment + build assertions, unauthenticated 401s, CORS
origin, the static site's `build.txt`, the login screen and the locked
NotFound rendering — and structurally no write legs to mis-aim. (A
production render check of a real clinical document is deliberately out:
it would require production clinical data or writing some — the boundary
this whole design exists to protect.)

---

## 7. What the existing suites become

Unchanged in logic; each gains the environment assert (one gate step
extension shared across all twelve) and reads its target tuple from the
in-file table. The render suite (`deployed-print-e2e`) targets test only.
The sequential-dispatch discipline is per environment; the production
smoke is so light it can also run on a schedule without competing for the
`deployed-e2e` group.

---

## 8. What migrates, what starts fresh — honestly

- **Nothing clinical migrates to production.** The current database is
  test-contaminated beyond separation (that is the recorded finding that
  motivated this design), so it is *reclassified*, not cleaned: the
  entire current stack — Pages site, `icu-cp49`, the free Postgres with
  every accumulated artifact — becomes the test environment as-is. Zero
  migration work, zero data loss, and the accumulated artifacts stop
  being a wart and become what they always really were: test data.
- **Production starts empty**: reference seeds + one bootstrap admin.
  First real clinical row arrives through the UI by an authenticated
  individual. (Formulary/catalogue content seeded from the current
  reference data is a starting configuration for Pharmacy/Laboratory to
  curate — flagged for the owner: if even that is unwanted, production
  can start with empty master data and be populated through the Layer 4
  screens; decide at implementation review.)
- **The repo stays single-codebase.** No environment forks; differences
  live entirely in env vars declared in `render.yaml` and the two
  frontend build definitions.

## 9. Cost — honestly

- **Production database (paid)**: the whole point — no 30-day expiry.
  Render's smallest paid Postgres tier (order of ~$6–7/month at last
  check; confirm current pricing at purchase).
- **Production web service**: a paid instance (order of ~$7/month) is
  strongly recommended — a system of record that cold-sleeps 15 minutes
  after use isn't operationally credible. (It *can* start on free tier
  to stand the environment up, with the paid upgrade as the go-live
  step.)
- **Production static site**: free on Render.
- **Test**: unchanged, free; accepts the 30-day DB churn by design
  (reseed on recreation — now harmless).
- Total steady state: **on the order of $13–15/month**, all of it
  production.

## 10. Implementation order (each step lands green before the next)

1. **Environment identity on the current single environment** —
   `APP_ENV=test` everywhere; `/healthz` + `build.txt` gain
   `environment`; the JWT gains/validates `aud`; all twelve suites gain
   the environment assert. The gates exist before the boundary they
   guard. Verification: suites green against test with the new asserts;
   a deliberately wrong-target dispatch fails loudly.
2. **Seed modes + tripwires in code** — production mode (reference-only
   seeds, bootstrap admin, T1/T2 tripwires, refuse-unknown-`APP_ENV`).
   Verification: local Postgres boot in production mode → empty clinical
   tables, bootstrap admin works, tripwires each proven to refuse boot
   (set `DEMO_PASSWORD`; plant a demo-password account).
3. **Blueprint + promotion gate** — `render.yaml` gains the production
   service, paid DB, static site (branch `production`); per-environment
   CORS; the repo-variable API URL moves in-file (§5.4); the promotion
   gate workflow ships. Verification: YAML review + the gate's
   ancestor/content checks exercised against a dry-run branch.
4. **Stand production up** — create the `production` branch at a
   suite-validated main commit; Blueprint sync creates the service/DB/
   site; first promotion runs the gate; production smoke suite green;
   owner retrieves the bootstrap credential and creates real accounts;
   paid tiers confirmed.
5. **Docs** — 01 gains the environment model as constitution (the tuple,
   the boundary matrix, the promotion rule); 02 supersedes the
   "single environment" recorded constraint and the artifact-list framing
   (test artifacts stop being exceptional); 03 gains the promotion and
   per-environment dispatch disciplines.

Steps 1–2 are pure code against today's environment and independently
valuable (the identity gate alone would already prevent a whole class of
mis-aimed dispatch). Step 4 is the only step that spends money.

## 11. Out of scope, stated

Staging (§2); multi-region/HA; backup/restore policy for the production
DB (needs its own short design — flagged as the immediate follow-up once
production exists, since a system of record without tested restores is
theater); production observability beyond healthz; the facility-timezone
question (already recorded separately).

## 12. Design-principle audit — every "remember to…" and its replacing mechanism

| Temptation (checklist item) | Mechanism that replaces it |
|---|---|
| "Remember to point the frontend at the right API" | URL compiled into the bundle from reviewed files; CORS rejects the wrong origin; runtime env cross-check refuses to render |
| "Remember to use different JWT secrets" | Per-service `generateValue` **and** the `aud` claim — validated, not remembered |
| "Remember not to run suites against production" | Write suites have no production target to select; gate asserts environment before any write leg; demo logins don't exist on production anyway |
| "Remember not to seed demo data in production" | Seed mode in code + T1 (demo-password scan refuses to serve) + T2 (`DEMO_PASSWORD`/SQLite mode refuses to boot) |
| "Remember to deploy the right branch to production" | The service is bound to `production` in `render.yaml`; the branch only moves by an explicit push; the promotion gate verifies ancestry + test-content equality |
| "Remember to update the repo variable" | Eliminated — no routing config lives outside versioned, gate-covered files |
| "Remember which site you're looking at" | Compiled-in environment name: TEST banner + runtime cross-check |
| "Remember the free test DB expires" | Reclassified harmless: test reseeds; production is on the paid tier where the failure mode doesn't exist |

Anything discovered during implementation that reduces to "configure X
correctly" gets the same treatment before it merges, per this table's
standard.
