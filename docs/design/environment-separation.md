# Environment Separation — Design Proposal

**Status: PROPOSAL — awaiting project-owner approval. No code, config, or
service changes ship with this document.**

*[Revision 2, 2026-07-11, same PR: the project owner corrected a
foundational input the first draft did not have — **production is not
cloud**. Production runs on-premises, inside the hospital, on the
hospital's own network, and must be offline-first. The first draft's
"production = a second Render service + the paid cloud database" is
withdrawn; that cloud tier is redesignated as STAGING. This revision is
the design.]*

*[Revision 3, 2026-07-11, same PR: four owner amendments — Docker
Compose stated as the v1 reference deployment, not the architectural
endpoint (§4.1); formulary seeding made a choosable install-time policy
rather than a fixed decision (§3.3, §9); the bootstrap-admin credential
story added — no known credential ships in the production image (§3.3);
and the repository-goes-private decision recorded as a pre-deployment
checklist step (§9, §11). The owner has stated the design is complete
for approval after these amendments.]*

This designs the transition from the single-environment prototype
(recorded in 02_PROJECT_STATUS.md as the "single environment — every test
writes to the system of record" constraint, and in 01_ARCHITECTURE.md as
the missing architectural concept) to an operational model in which
**testing cannot touch the system of record** — and in which the system
of record is a hospital-resident, offline-first installation with **no
cloud service in its clinical serving path**.

The governing principle, applied throughout and audited in §13: every
prior problem in this project was solved by converting it into a
**mechanism that prevents recurrence** — the tsc no-op became a mandatory
compile check, warm-up blindness became the content-equality gate, the
frontend/API mismatch became `build.txt` + the render suite. Environment
separation must meet the same bar: **crossing an environment boundary
must be structurally impossible and loudly-failing, never merely
documented.** Anywhere this design would rely on "remember to configure X
correctly," it instead names the gate that replaces the remembering.

---

## 1. Decisions at a glance

| # | Decision | Choice |
|---|---|---|
| D1 | Environment tiers | **DEVELOPMENT (local/cloud) · STAGING (cloud: Render + Pages) · PRODUCTION (on-premises: hospital LAN, offline-first)** (§2) |
| D2 | What today's stack becomes | The entire current stack (Pages site, `icu-cp49` service, current free Postgres with its accumulated artifacts) becomes **the STAGING environment, wholesale**. Production is a new on-prem installation that starts empty of clinical data (§9) |
| D3 | Offline-first, precisely | All core clinical functions (registration/ADT, medications, labs, imaging, printing, physician orders, nursing records) run entirely on the hospital LAN with no internet. Internet, when present, adds only non-critical extras — off-site backup, updates, remote support, central analytics/monitoring — each of which degrades to "paused," never to "clinical function interrupted" (§2.3) |
| D4 | Production runtime | **One Docker Compose stack on hospital infrastructure**: the API container (which also serves the frontend bundle — one image, one origin), the PostgreSQL container with a named volume, and a backup sidecar. Compose is the **v1 reference deployment, not the architectural endpoint** — an HA topology can replace it later without changing the environment model (§4.1) |
| D5 | Production frontend targeting | The frontend ships **inside the API image** and calls its API **same-origin with a relative base** — the production bundle contains **no API hostname at all**, so there is no URL to point at the wrong environment; frontend/API version skew is atomic-image-impossible (§4.2) |
| D6 | Databases | **Three separate PostgreSQL instances** — dev-local, staging-cloud (the current free one), production-on-prem. Non-negotiable (§3.1); production's is additionally unreachable from the internet by network fact |
| D7 | Auth isolation | Separate `JWT_SECRET` per environment (production's generated at install, never leaves the hospital host) **and** an `aud` environment claim validated by the API — two locks on top of the network boundary (§3.2) |
| D8 | Seeds | Seeding is **environment-moded in code**: production seeds non-hospital-specific reference data + ONE bootstrap administrator (installer-generated one-time credential, forced change on first login — no known credential ships in the image) — no demo patients, no demo staff, no `Aurora2026!` — enforced by boot-time tripwires, not convention (§3.3). The **formulary is a choosable install-time policy**, not a fixed decision (§3.3). Production builds also compile the mock/demo data layer **out** (§4.2) |
| D9 | Promotion & updates | Git-based: `main` auto-deploys staging; production receives **versioned, checksummed release bundles** cut from a `production` branch by a gated workflow (ancestor-of-main + equals-what-staging-is-running), installed on-prem by an update script that backs up first and verifies after (§5, §4.4) |
| D10 | Prove-the-right-build, on-prem | `/healthz` + `build.txt` carry commit **and** environment in every tier; on-prem, a shipped **local verify script** replays the content-equality discipline against the release manifest — no cloud needed (§4.5, §7) |
| D11 | CI identity | Every cloud suite asserts `environment == staging` **before any write leg**; write suites have no production target — and cloud CI cannot reach the hospital LAN at all, making that structural twice over (§7) |
| D12 | Config residence | All cloud wiring lives in `render.yaml` + workflow files; all on-prem wiring lives in the versioned compose file + a generated-at-install local env file (secrets only, never routing). No dashboard-resident routing config survives (§6.4) |

---

## 2. The three tiers

### 2.1 Development — local or cloud, for building

Per-developer, disposable, no system of record. The existing local
workflow (Vite dev server, local Postgres or the SQLite fallback, demo
seeds, `Aurora2026!`) is the development tier — already real, now named.
Cloud tooling (GitHub, PR CI, the compile checks) belongs to this tier.
Nothing in development is protected; everything in it is reproducible
from the repo.

### 2.2 Staging — cloud, for verification before release

**The entire current deployed stack is redesignated as staging,
wholesale**: the GitHub Pages site, the `icu-cp49` Render service, and
the current free Postgres with every accumulated E2E artifact
(P-1023…P-1048, suite encounters, e2e drugs, deactivated test accounts).
Those artifacts stop being a wart and become what they always really
were: test data in a test environment.

Staging is where the project's verification machinery lives and keeps
living: the twelve deployed suites, the content-equality gates,
`build.txt`, the render suite, sequential dispatch, the CI-evidence
discipline. **A release can only be cut from bytes staging is currently
running and has verified** (§5). Staging's job is to make the on-prem
release boring.

The first draft asked whether a staging tier was warranted *in addition
to* a cloud production; with production on-prem the question inverts and
answers itself — the cloud tier **is** staging, it already exists, and
it costs nothing new.

### 2.3 Production — on-premises, inside the hospital, offline-first

Production runs on hospital infrastructure on the hospital LAN: local
API, local PostgreSQL, locally-served frontend. **The cloud is a
development-and-testing tool; it is not a runtime dependency of the
clinical system.**

Offline-first, defined precisely:

- **Core clinical functions** — patient registration/ADT, medication
  orders and administration, labs, imaging, printing, physician orders,
  nursing records, user administration, the audit trail — run entirely
  on the internal network. No serving path touches the internet: no CDN,
  no cloud API, no external font/script, no license phone-home, no
  telemetry required to boot. (The frontend is already fully
  self-contained static assets; this design keeps that a rule: **a
  production bundle must reference no external origin**.)
- **Internet-optional extras** — off-site backup upload (§4.3, if
  hospital policy permits), downloading software updates (§4.4), remote
  support, central analytics/remote monitoring (future) — are additive
  and non-critical by construction: each is implemented as a consumer of
  local state (backup files, the update inbox), never as a dependency of
  a clinical write or read. Loss of internet pauses them and interrupts
  nothing clinical.

**Multi-site is the extension path.** Every mechanism below is written
against an environment tuple `(name, code channel, runtime, database,
origin, healthz env)`. A second hospital is not a new tier — it is a
second **installation of the same production release artifact** with its
own tuple row (its own LAN origin, install-generated secrets, empty
database). Nothing redesigns.

```
tuple        code channel         runtime                     database              frontend origin            healthz env
development  any branch           local dev server            local PG / SQLite     localhost:5173             "development"
staging      main (autodeploy)    Render icu-cp49 + Pages     current free PG       github.io Pages            "staging"
production   production releases  hospital host (Compose)     on-prem PG container  http(s)://<hospital-host>  "production"
```

---

## 3. Per-environment isolation

### 3.1 Separate PostgreSQL — non-negotiable

Three independent database instances — not schemas, not shared
instances. Reasons, each sufficient alone:

1. **Our own rules make cross-contamination permanent.** The
   never-destroy and never-reset-the-live-database rules — correct rules
   — mean a test row that lands in production **can never be deleted**.
   There is no cleanup story by design, so **prevention is the only
   control that exists**. Only separate instances with separate
   credentials make a staging write to production a *connection failure*
   rather than a policy violation.
2. **Blast radius.** A migration bug or a suite gone wrong in staging
   must be physically unable to touch production rows.
3. **The current database is already the argument.** It is
   test-contaminated beyond separation — which is precisely why it is
   redesignated as staging's DB and no clinical row in it ever migrates
   anywhere (§9).

The on-prem model makes this stronger than any cloud arrangement could:
**production's database is not reachable from the internet at all.** The
isolation is a fact of network topology, not a credential. Staging keeps
the free cloud tier; its recorded 30-day expiry becomes *acceptable by
redesignation* — when it expires, staging is recreated and reseeded, an
operational note rather than an incident, because nothing in staging is
a record. The first draft's "buy the paid cloud database for production"
is withdrawn: production data lives in the hospital.

### 3.2 Separate JWT secret — plus the `aud` claim

Each environment has its own `JWT_SECRET`. Staging's is
`generateValue: true` in `render.yaml` as today; **production's is
generated by the installer on the hospital host** (§4.4) into a local
env file that never leaves the machine, never touches the repo, and is
never known to the cloud. A staging token therefore fails signature
validation on production — and cannot even be presented to it from
outside the LAN.

Secret separation alone is still "remember to keep them different," so
the token also carries the environment as its **`aud` claim**, and
validation requires `aud == APP_ENV`. Even with identical secrets, a
staging-issued token is structurally invalid on production. Two locks on
top of the network boundary; all three must fail for a
cross-environment token to authenticate.

### 3.3 Seeds — environment-moded in code, enforced by tripwires

The server gains `APP_ENV` (`development` | `staging` | `production`;
any other value → refuse to boot). Seeding splits into two classes:

- **Reference seeds that are not hospital-specific** (lab catalogue,
  order sets, the frequency vocabulary, interaction rules): seeded in
  **every** environment, plus the bed registry as starting configuration
  a hospital adjusts at install. Pharmacy/Laboratory then maintain
  reference data through the existing Layer 4 screens.
- **The formulary — an install-time operational policy, not a fixed
  architectural decision.** Different hospitals will want different
  paths, and the design forces neither. The installer offers a choice,
  recorded in the install configuration:
  - **starter formulary** — seed the reviewable reference formulary,
    explicitly marked as requiring pharmacy/clinical validation before
    clinical use (the marking is surfaced, not a footnote: it rides the
    seeded content until Pharmacy signs it off through the Layer 4
    screens); or
  - **empty formulary** — start with none, for the hospital's pharmacy
    to build or import its own.
- **Clinical + demo-identity seeds** (14 demo patients, encounters,
  orders, results, AI profiles, bedside snapshots, the 20 demo staff):
  **development and staging only. Production starts empty of clinical
  data.**

**The bootstrap moment — how the first admin credential is set on a
fresh offline install.** Production compiles out the demo password and
starts with no clinical data, but one administrator must exist so real
users can be created. The governing principle is the install-time
equivalent of the no-shared-demo-password guarantee: **no known
credential ships in the production image** — nothing baked in, no
default, no vendor password. A default in the image would be a shared
secret across every hospital that ever installs it, which is exactly the
`Aurora2026!` failure reborn. Chosen approach:

- At install, the **installer generates a random one-time password on
  the hospital host**, displays it exactly once to the operator, and
  stores nothing but its bcrypt hash. The value never exists in the
  repo, the image, the cloud, or any file — only in that single console
  output and the operator's hands.
- The bootstrap account is created in a **forced-change state**: until
  the one-time password is replaced, its only permitted action is
  setting a real password (the existing Layer 3 credential flow,
  hardened into a must-change-before-anything gate). **The first
  clinical act of a production install is establishing a real admin
  credential.** Every subsequent account is then created through
  Layer 3 with individual credentials.
- If the one-time value is lost before first login, the installer's
  credential step is re-run at the host console — a local, physical
  operation. There is deliberately **no remote or cloud reset path**.
- T1 is unaffected (a random value cannot match the demo password), and
  the install acceptance checklist (§4.5, §11) verifies the forced
  change actually happened before the install is accepted.

The demo password never exists in production, in any form.

Because "the seeder checks a variable" is itself configuration, two
**boot-time tripwires** back it (loud crash before the service binds,
not a warning):

- **T1 — demo-credential tripwire**: on production boot, verify
  `Aurora2026!` (and `DEMO_PASSWORD` if set anywhere) against every
  active account's bcrypt hash; any match → refuse to serve. This
  catches not only seed misconfiguration but any future human setting
  the shared password on a real account.
- **T2 — demo-config tripwire**: production boot with `DEMO_PASSWORD`
  set, or with no database configured (the SQLite demo fallback path),
  refuses to start. The convenient dev fallback is a security hole in
  production, so production mode simply does not have it.

---

## 4. The on-premises production target

### 4.1 How frontend, API, and PostgreSQL run together (no cloud dependency)

**Docker-based local deployment — stated as the answer.** The server is
already a Docker image (the same Dockerfile Render builds); production
reuses it. One versioned `docker-compose.production.yml` in the repo
defines the whole clinical stack on a single hospital host:

- **`aurora-app`** — the release image: the ASP.NET Core API, which in
  production also serves the compiled frontend bundle as static files
  (§4.2). One container, one origin, one exposed port on the LAN.
- **`aurora-db`** — PostgreSQL (pinned major version) with a named
  Docker volume for the data directory. Not published on the LAN at
  all — reachable only on the compose-internal network by `aurora-app`
  and the backup sidecar. The database is invisible even to the
  hospital LAN, let alone the internet.
- **`aurora-backup`** — a sidecar that runs the scheduled `pg_dump`
  cycle and restore-verification (§4.3), writing to a host-mounted
  backup directory.

Nothing in the stack calls out: no image pulls at runtime, no external
assets, no telemetry. The stack boots and serves with the building's
uplink physically unplugged — and that exact scenario is a named test in
the install verification (§4.5).

*(Considered and rejected: a separate nginx container serving the
frontend and reverse-proxying the API. It adds a second config file that
must agree with reality — a "remember to configure the proxy" surface —
and reopens the frontend/API version-skew class that `build.txt` exists
to catch. Serving the bundle from the API process eliminates both. If
the hospital wants TLS on the LAN, a hospital-managed reverse proxy MAY
sit in front — that is explicitly IT-boundary territory, §10, and the
stack is fully functional without it.)*

**Compose is the reference deployment for v1, not the architectural
endpoint.** It is the baseline that makes the first production install
simple, rehearsable, and verifiable. A more highly-available
architecture — multiple app instances behind a load balancer,
PostgreSQL HA/replication, container orchestration, central
monitoring — can be adopted later **without changing the environment
model, the Core, or any boundary in this document**: every mechanism
here is defined against the environment tuple (§2.3), the release
manifest (§4.5), and the same-origin/no-hostname contract (§4.2) — not
against Compose. What §4.1 fixes is the *contract* (one origin;
app + database + backup; no cloud in the serving path); the topology
underneath it is upgradeable per installation.

### 4.2 Reaching the API on a hospital LAN — the build-time lock, strongest form

The hospital assigns the host one LAN address — an internal DNS name
(e.g. `aurora.hospital.local`) or a static IP. Staff browsers open that
one origin. **The frontend does not need to know it**, because the
production bundle is served by the API process itself and calls the API
**same-origin with a relative base**.

This is the "build-time URL, structurally impossible to point wrong"
principle applied to a LAN — and it lands in its strongest possible
form: **the production bundle contains no API hostname whatsoever.
There is no URL in the artifact to be wrong.** Renaming the host,
re-IP-ing the server, or cloning the install to a second hospital
changes nothing in the bundle, because the bundle's API target is "where
I was served from" by construction. Three further locks ride with it:

- **Atomic versioning**: the frontend ships *inside* the API image, so
  the deployed frontend and API are the same release by identity — the
  stale-Pages class of incident (frontend and API at different commits)
  is structurally impossible on-prem, not gated-against but
  *unrepresentable*.
- **No CORS surface**: same-origin means production configures **zero**
  allowed cross-origins. Any cross-origin caller — including a staging
  frontend somehow pointed at the hospital — fails preflight. (Staging
  keeps its explicit single-origin CORS as today.)
- **No demo fallback in the artifact**: today the frontend treats "no
  API base configured" as mock mode. A relative base makes that
  convention unusable, and production makes it *unrepresentable*: the
  production build mode compiles the mock/demo data layer **out of the
  bundle** (build-time flag → tree-shaken). A production UI that cannot
  reach its API shows an explicit failure — it can never quietly render
  demo patients as if they were the ward. The clinical disaster case
  ("looks like data, is a demo") is removed at compile time, not
  discouraged.
- **Runtime environment cross-check** (the `build.txt` lesson one level
  up): the bundle compiles in its *expected* environment name; on load
  the app compares `/healthz environment` against it; any mismatch
  replaces the app with a full-screen refusal naming both values. A
  staging bundle copied onto the hospital host is unusable, loudly, on
  its first pageview.

### 4.3 Backup — the single-host truth, and its story

A local database on one hospital machine is a single point of failure.
The design does not pretend otherwise; it layers the story and states
who owns each layer (§10):

- **Layer B1 — automated local dumps (software provides, mandatory).**
  The `aurora-backup` sidecar runs scheduled `pg_dump` logical backups
  (daily full, configurable), writes them to a host-mounted backup
  directory with rotation/retention, and — because *a backup that has
  never been restored is theater* — runs a scheduled
  **restore-verification**: restore the newest dump into a scratch
  container, assert row counts and a healthz-level sanity read, record
  the result where §4.5's verify script and the UI's admin surface can
  see it. A dump that fails restore-verification is a loud failure the
  same day it happens, not a discovery during a disaster.
- **Layer B2 — off-host copies (hospital IT provides).** The backup
  directory must leave the machine: a second machine or NAS on the LAN,
  rotated external media — per hospital policy. The software's
  contribution is making this trivially consumable (one directory,
  self-describing filenames, checksums) and making staleness visible
  (§4.5 flags "newest verified backup older than N days").
- **Layer B3 — off-site backup (optional, internet-dependent,
  non-critical by construction).** If hospital policy permits, an
  optional uploader ships **encrypted** dumps off-site when the internet
  is available. It reads finished local dumps; it is not in any clinical
  path; internet loss pauses it and nothing else. Off-site backup is the
  canonical example of D3's "internet adds only non-critical
  capability."
- **Named upgrade path, out of scope now**: WAL archiving for
  point-in-time recovery, and a warm standby on a second hospital
  machine, are the HA follow-ups once a production install exists —
  recorded in §12, not designed here.

The **pre-update dump** (§4.4) is a fourth, event-driven member of B1:
no update proceeds without a fresh verified backup taken first.

### 4.4 How updates reach an on-prem production system

You cannot `git push` to a hospital server. Updates travel as **release
artifacts**, and the path is:

1. **Cut** — promotion stays a deliberate git action: push a validated
   `main` commit to the `production` branch. A **release workflow** on
   that branch (the promotion gate, §5) verifies it and then builds the
   **release bundle**: the app image (API + embedded frontend, migration
   set included), exported both as a registry push **and as a
   `docker save` tarball**, plus the compose file, the update/verify
   scripts, and a **release manifest** (release version, git commit,
   image digests, artifact checksums). The bundle is published as a
   GitHub Release.
2. **Transfer** — internet-optional by design: download the bundle at
   the hospital when internet is available, **or** carry the tarball on
   physical media for an air-gapped install. Either way the artifact is
   verified on arrival against the manifest checksums; the transfer
   channel is untrusted by default.
3. **Apply** — the shipped `aurora-update` script, run by the trained
   operator (§10), executes a fixed order it does not allow skipping:
   verify bundle checksums → **take and restore-verify a pre-update
   backup (hard stop if it fails)** → load images → run EF migrations →
   restart the stack → run post-update verification (§4.5) against the
   new manifest. Any step failing halts with the previous images and the
   pre-update dump still on disk.
4. **Roll back** — re-point compose at the retained previous image and,
   only if the update's migrations require it, restore the pre-update
   dump. The existing migration discipline (hand-audited, empirically
   tested `Down()` paths — the `AddPatientDateOfBirth` precedent) is
   what keeps rollback honest; roll-forward remains the preference.

Update cadence is the hospital's decision; nothing expires. An install
that never updates keeps working — updates are capability, not
lifeline (D3).

### 4.5 "Prove the right build is running," without the cloud

Staging proves it with the content-equality gates, `build.txt`, and the
render suite — all cloud CI. Production cannot depend on cloud CI, so
the same discipline ships **in the bundle**:

- `/healthz` carries `{ status, service, build (git commit),
  environment, version (release tag) }` in every tier; the frontend's
  `build.txt` (served from inside the same image) carries commit +
  environment. Same stamps, same meaning, everywhere.
- The **release manifest is the local source of truth**: the shipped
  `aurora-verify` script compares the *running* `/healthz` build+version
  and the *served* `build.txt` against the manifest of the installed
  release — the content-equality gate, replayed locally, no network
  beyond localhost. It also asserts `environment == production`, DB
  reachability, migration level, backup freshness and last
  restore-verification result, and disk headroom.
- `aurora-verify` runs automatically as the last step of every install
  and update (a failed verify is a failed update, §4.4), and is runnable
  any day by hospital IT as the production analogue of the smoke suite.
  It is strictly read-only — the no-write-legs-in-production rule (§7)
  holds on-prem too.
- The **offline-first proof** is part of install verification: the
  named test "disconnect the uplink, then register → order → administer
  → result → print on the LAN" must pass before an install is accepted.
  Offline-first is asserted behavior, not a brochure claim.

---

## 5. Promotion model — git-based, gated, released

- **Staging** deploys automatically from `main` (unchanged today in all
  but name): merge → Render builds → suites dispatched sequentially per
  the existing discipline.
- **Production** code moves **only** via the `production` branch, and
  the branch's only consumer is the release workflow (§4.4). Promotion
  is one deliberate git action:

  ```
  git push origin <validated-main-commit>:production
  ```

  It cannot happen as a side effect of merging a PR; it is visible in
  `git log production`, attributable, and revertible.

**The promotion gate** (the release workflow's first job) converts
"promote carefully" into a mechanism. No release bundle is built unless:

1. the pushed commit **is an ancestor of `main`** — production never
   ships a commit that didn't go through the normal PR path (no
   cherry-picks, no divergence); and
2. the pushed commit's `server/` tree + frontend build context **equal
   what the STAGING environment is serving right now** (the same
   `git rev-parse "$commit:server"` vs `/healthz build` comparison the
   suites use, pointed at staging, plus the Pages-gate context hash) —
   you can only release bytes staging is currently running, i.e. the
   exact content the last green suite runs validated.

The staging-side gates are unchanged in shape: `/healthz` +
content-equality per suite, `build.txt` + the render suite for the
frontend, CONFIG MISMATCH as the manual-deploy operational branch. The
production-side equivalent is §4.5's manifest verification.

---

## 6. Cross-environment safety — the boundary matrix

Every crossing path, and the locks that make it fail structurally. No
path relies on fewer than two independent locks — and most
production-facing rows now start with a lock no cloud design ever had:
**the hospital LAN is not addressable from outside**.

| Crossing attempt | Lock 1 | Lock 2 | Lock 3 |
|---|---|---|---|
| Production frontend calls a cloud API | The production bundle **contains no API hostname** — relative, same-origin only (§4.2) | Offline-first acceptance test: the stack must serve with no uplink | Staging CORS admits only the Pages origin anyway |
| Staging/dev frontend calls the production API | Hospital LAN unreachable from the internet | Production accepts **zero** cross-origins (no CORS surface exists) | Runtime env cross-check paints the refusal screen |
| Staging JWT used on production | Network boundary | Different `JWT_SECRET` (production's never left the hospital) → signature invalid | `aud: staging` ≠ `production` → rejected even with equal secrets |
| Suite write-legs hit production | Cloud CI cannot reach the LAN | Write suites' target table **contains no production entry** — no input selects it (§7) | Gate asserts `/healthz environment == "staging"` before any write leg |
| Production attached to the wrong DB | The compose-internal network contains exactly one database, not published beyond it | `DATABASE_URL` on-prem is written once by the installer into the local env file — no free-text dashboard field exists | T2 refuses boot with no database configured |
| Demo credentials in production | Seed mode: demo users are never seeded outside dev/staging | T1 boot tripwire: any active account matching the demo password → refuse to serve | T2: `DEMO_PASSWORD` set → refuse to boot |
| Demo **data** shown in production | The mock/demo layer is **compiled out** of production bundles (§4.2) | APP_ENV seed mode never writes clinical seeds | — |
| Wrong-environment build deployed on-prem | Runtime env cross-check: compiled expectation vs `/healthz` → full-screen refusal | `aurora-verify` compares running build to the installed release manifest and fails the install/update | Release bundles are the only path in; checksums bind bundle→manifest→commit |
| Human opens the wrong UI | Staging renders a permanent **STAGING ENVIRONMENT banner** (compiled in) | Distinct origins (github.io vs the hospital host) | Runtime cross-check |

### 6.4 No dashboard state left in the wiring

Today the deployed frontend's API URL comes from a **repo variable**
(`vars.API_BASE_URL`) — dashboard state, invisible to git and to every
gate. This design eliminates the class:

- staging's API URL moves into `deploy-pages.yml` itself (it is not a
  secret);
- staging's service wiring stays in `render.yaml`;
- production's wiring **is** the versioned compose file — and its only
  non-versioned values are secrets (`JWT_SECRET`, the bootstrap admin
  password, the DB password) generated by the installer into a local
  env file on the hospital host. Secrets, never routing.

After this, every environment-defining value is either in a versioned
file inside a gate's comparison set, or is a secret that exists in
exactly one place.

---

## 7. CI environment-identity guarantee

The freshness-gate mechanism, extended by one field, in every tier:

- `/healthz` → `{ status, service, build, environment, version }`
- `build.txt` → commit + environment

Every cloud suite's gate asserts, in order:

1. **Environment identity** — `healthz.environment == "staging"`.
   Asserted FIRST and without retries: a wrong environment is not a
   warming-up condition; it fails immediately and loudly, before any
   login, any write, any retry loop.
2. **Content equality** — the existing build-context comparison, against
   staging's healthz/build.txt.

**Write suites cannot name production.** The eleven data-writing suites
declare `TARGET: staging` in a per-suite table that has no production
row — no dispatch input, variable, or URL makes them run write legs
elsewhere. And even a hypothetically misconfigured suite cannot reach a
network that isn't routable from GitHub's runners. Production's
verification is `aurora-verify` (§4.5): read-only by construction,
local by construction. The render suite (`deployed-print-e2e`) targets
staging only; the on-prem analogue of "does the document actually
render" is part of install acceptance (§4.5's offline-first proof
includes printing).

The twelve existing suites change in exactly one shared way: the gate
gains the environment assert, and each suite reads its target tuple from
the in-file table. Logic, sequential dispatch, and cleanup discipline
are untouched.

---

## 8. What still runs where — summary

| Concern | Development | Staging (cloud) | Production (on-prem) |
|---|---|---|---|
| Purpose | build | verify before release | the system of record |
| Frontend | Vite dev server | GitHub Pages (+ `build.txt`) | served by the app image, same-origin |
| API | local | Render `icu-cp49`, autodeploy from `main` | Docker Compose on the hospital host |
| Database | local PG / SQLite fallback | current free cloud PG (30-day churn now harmless) | on-prem PG container + named volume |
| Seeds | reference + demo | reference + demo | non-hospital-specific reference + formulary per install policy + bootstrap admin (forced change) |
| Auth | dev secret, `aud: development` | generated secret, `aud: staging` | install-generated secret, `aud: production` |
| Verification | compile CI | twelve suites + gates + render suite | `aurora-verify` vs release manifest; install acceptance incl. offline proof |
| Update path | git | merge to `main` | gated release bundle + `aurora-update` |
| Internet | required (tooling) | required (is cloud) | **optional, non-critical** |

---

## 9. What migrates, what starts fresh — honestly

- **Nothing clinical migrates to production.** The current database is
  test-contaminated beyond separation (the recorded finding that
  motivated this design), so it is *redesignated*, not cleaned: the
  entire current stack becomes staging as-is. Zero migration work, zero
  data loss.
- **Production starts empty**: non-hospital-specific reference seeds +
  one bootstrap admin in a forced-change state (§3.3); the formulary
  arrives by the chosen install-time policy (starter-marked-for-
  validation, or empty for the hospital to import its own); the first
  real clinical row arrives through the UI by an authenticated
  individual.
- **The repo stays single-codebase.** No environment forks. Differences
  live in `APP_ENV`, build-time flags, `render.yaml`, workflow files,
  and the compose file — all versioned.
- **Repository visibility — decided**: the repository (and any release
  registry) goes **private before any real hospital install**, as a
  deliberate pre-deployment checklist step (§11, step 5) — not during
  development, since cloud-staging verification relies on the public
  repo until then. Honest consequence to resolve at that step: a
  private repo moves the staging frontend off free GitHub Pages (paid
  plan, or a static-site host for staging) and puts the suites on
  metered private-repo Actions minutes.

## 10. Hospital IT vs. the software — the honest boundary

What the software provides, and what it cannot pretend to provide:

**The software provides:**
- the complete runtime definition (compose file, images, migrations);
- environment identity, tripwires, and every gate in this document;
- backup automation, restore-verification, and backup-freshness
  visibility (B1), plus the optional encrypted off-site uploader (B3);
- the `aurora-update` / `aurora-verify` scripts and the release
  manifest discipline;
- install + update runbooks, the install acceptance checklist
  (including the offline-first proof), and hardware sizing guidance.

**Hospital IT provides (and owns):**
- **server hardware** (and ideally a second machine or NAS for B2
  off-host backup copies) with UPS/power protection;
- **the network**: the LAN itself, a stable internal address or DNS
  name for the host, physical and port-level access control, and — if
  desired — TLS on the LAN via a hospital-managed proxy/internal CA
  (the stack is functional without it; on-LAN TLS is policy, §10 makes
  no pretense of deciding hospital policy);
- **time**: a reliable local time source (NTP on the LAN) — clinical
  timestamps depend on it, and no software gate can conjure correct
  wall-clock time on an offline network *(connects to the recorded
  facility-timezone question — §12)*;
- **physical security and access** to the host;
- **backup transport and custody** (B2): moving the backup directory
  off-host on schedule, media rotation, off-site custody per policy;
- **an operator**: a named, trained person who runs `aurora-update` /
  `aurora-verify` and owns the update cadence;
- **redundancy decisions**: warm standby, second-site failover — the
  software names the upgrade path (§4.3) but the hardware and the
  policy are the hospital's.

Anything on the IT list that a future version can absorb into mechanism
(e.g., standby automation) is future scope; this table is the honest
line today.

## 11. Implementation order (each step lands green before the next)

1. **Environment identity on the current environment** —
   `APP_ENV=staging` on the deployed stack; `/healthz` + `build.txt`
   gain `environment` (+ `version`); the JWT gains/validates `aud`; all
   twelve suites gain the environment assert and the target table. The
   gates exist before the boundary they guard. Verification: suites
   green with the new asserts; a deliberately wrong-target dispatch
   fails loudly at the gate.
2. **Seed modes + tripwires in code** — production mode (reference-only
   seeds, bootstrap admin, T1/T2, refuse-unknown-`APP_ENV`).
   Verification: local Postgres boot in production mode → empty
   clinical tables, bootstrap admin works, each tripwire empirically
   proven to refuse boot.
3. **Production build + serving mode** — same-origin static serving
   from the API image, relative API base, mock layer compiled out,
   runtime env cross-check, staging banner; `vars.API_BASE_URL` moves
   in-file (§6.4). Verification: local compose boot of a
   production-mode stack; the offline proof (no uplink) exercised
   locally; a staging bundle against a production healthz shown to
   refuse.
4. **Release pipeline + on-prem tooling** — the `production` branch,
   the promotion-gated release workflow, the bundle (image + tarball +
   manifest + checksums), `aurora-update` / `aurora-verify`, the backup
   sidecar with restore-verification. Verification: cut a release from
   a suite-validated commit; **rehearse a full install on a clean local
   VM as if it were the hospital** — install, verify, update to a
   second release, roll back, restore a backup. The rehearsal is the
   acceptance test of the tooling, before any real hospital is
   involved.
5. **First production install** — gated by the **pre-deployment
   checklist**, then executed on hospital hardware with hospital IT per
   the §10 split.
   *Pre-deployment checklist (before any hospital resource is
   touched)*: the repository and release registry made **private**
   (§9 — resolving the staging-Pages and Actions-minutes consequences
   at the same step); the formulary install-time policy chosen with the
   hospital (§3.3); the VM rehearsal of step 4 signed off.
   *Install acceptance*: the unplugged-uplink clinical walkthrough;
   bootstrap one-time credential handed over and the forced change to a
   real password verified (§3.3); B2 backup custody agreed and observed
   once end-to-end.
6. **Docs** — 01 gains the environment model as constitution (the
   tiers, the tuple, the boundary matrix, the promotion/release rule,
   offline-first as a binding requirement); 02 supersedes the
   "single environment" recorded constraint and redesignates the
   artifact list as staging data; 03 gains the promotion, release, and
   on-prem update/verify disciplines.

Steps 1–3 are pure code against today's environment, each independently
valuable. Step 4 spends only build-time effort; **no step spends
hospital resources until 5**, by which point every mechanism has been
rehearsed end-to-end on a VM.

## 12. Out of scope, stated

Warm standby / HA and WAL-based point-in-time recovery (named as the
backup upgrade path in §4.3, and adoptable without changing the
environment model per §4.1's reference-deployment statement — the
immediate follow-up design once a production install exists); central
analytics / remote monitoring and remote support tooling (named
internet-optional extras — designed later, under the D3 non-critical
constraint); AD/LDAP or hospital SSO integration; the facility-timezone
question (already recorded; §10 assigns the *time source* to IT, the
*timezone semantics* to that open question); multi-hospital fleet
management (the tuple extension path in §2.3 is the placeholder).

## 13. Design-principle audit — every "remember to…" and its replacing mechanism

| Temptation (checklist item) | Mechanism that replaces it |
|---|---|
| "Remember to point the frontend at the right API" | Production: no API URL exists in the bundle (same-origin relative). Staging: URL compiled in from a versioned file; CORS rejects the wrong origin; runtime env cross-check refuses to render |
| "Remember the hospital's server address when building" | Not needed at all — the bundle's API target is "where I was served from," by construction (§4.2) |
| "Remember to keep frontend and API versions in step on-prem" | They ship in one image — skew is unrepresentable (§4.2) |
| "Remember to use different JWT secrets" | Staging `generateValue`; production installer-generated on-host; **and** the `aud` claim — validated, not remembered |
| "Remember not to run suites against production" | No production row in the write suites' target table; environment asserted before any write leg; and cloud CI cannot route to the LAN |
| "Remember not to seed demo data in production" | Seed mode in code + T1 (demo-password scan refuses to serve) + T2 (demo config refuses to boot) + the mock layer compiled out of the bundle |
| "Remember to change the default admin password" | No default exists — the image ships no credential; the installer generates a one-time value shown once, and the account can do nothing until a real password is set (forced-change gate, §3.3) |
| "Remember the starter formulary needs pharmacy review" | The starter-formulary install mode marks its content as requiring validation before clinical use — the marking rides the data until Pharmacy signs it off (§3.3) |
| "Remember the clinical system must not need the internet" | The offline proof is an install acceptance test (unplugged-uplink walkthrough), and internet extras are consumers of local state by construction (§2.3, §4.3) |
| "Remember to deploy the right code to the hospital" | The only path in is a checksummed release bundle whose manifest binds artifact→commit; the promotion gate binds commit→what-staging-verified; `aurora-verify` binds running-system→manifest |
| "Remember to back up before updating" | `aurora-update` refuses to proceed without a fresh restore-verified pre-update dump — a hard stop in the script, not a step in a runbook |
| "Remember to test the backups" | Scheduled restore-verification; staleness surfaced by `aurora-verify`; a never-restored backup is treated as no backup |
| "Remember to update the repo variable" | Eliminated — no routing config lives outside versioned, gate-covered files (§6.4) |
| "Remember which site you're looking at" | Compiled-in environment name: STAGING banner + runtime cross-check + distinct origins |
| "Remember the free staging DB expires" | Redesignated harmless: staging reseeds; production data lives in the hospital where nothing expires |

Anything discovered during implementation that reduces to "configure X
correctly" gets the same treatment before it merges, per this table's
standard.
