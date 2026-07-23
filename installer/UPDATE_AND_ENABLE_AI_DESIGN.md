# Design note — `aurora-update` + `aurora-enable-ai` (surgical, data-safe installer operations)

**Status: §3 `aurora-enable-ai` (+ the message fix) is BUILT (PR 1). §2
`aurora-update` (+ `version.json`) remains DESIGN — the next build (PR 2).**
This note designs two small `installer/` operations that replace *re-running the
5 GB `AuroraSetup.exe`* for two routine tasks. Both follow one discipline.

Read alongside: `installer/README.md`, `HOSPITAL_INSTALLER_RUNTIME_DESIGN.md`
(§2 the always-on runtime, §5 the AI service), `BACKUP_DR_DESIGN.md` (the backup
engine), and `03_DEVELOPMENT_RULES.md` (never-destroy / never-reset; supersede,
don't rewrite; verify-first).

---

## 0. The shared discipline

Today the **only** delivery path is re-running the full installer. For a routine
app update that means: re-shipping the **unchanged 4.7 GB model + PostgreSQL**,
**re-prompting every install decision** (data dir, access URL, admin password,
formulary), and — because `provision.ps1` rewrites `aurora.env` from scratch —
**rotating `JWT_SECRET`, logging every clinician out mid-shift**. That is
unacceptable for routine change.

Both operations here do the opposite: **a surgical, reversible change to exactly
the thing that changed, and nothing else.** Neither re-ships the model or
Postgres. Neither re-prompts. Neither rotates a secret. Each has a defined
worst-case that is always **"we are back where we started."** They reuse what
already exists — boot-time `db.Database.Migrate()`, the born-restore-verified
backup engine, and the release-bundle + `verify-release-bundle.sh` machinery —
rather than inventing new mechanisms.

| | `aurora-update` | `aurora-enable-ai` |
|---|---|---|
| Replaces | re-running the 5 GB installer to ship new app code | re-running the installer to turn on the AI after a GPU is added |
| Size | ~150 MB (self-contained server + SPA) | 0 bytes new (payload already on disk) — a config + service action |
| Touches the DB? | **yes** — migrations run on the new server's boot → needs the full rollback contract (§2) | **no** — zero schema/data change (§3) |
| Backup first? | **yes, mandatory** (the restore point) | not required (cannot alter data); an optional courtesy snapshot |

---

## 1. A prerequisite both need: a real version identity (`version.json`)

Today the app stamps only a git commit (`RENDER_GIT_COMMIT` → `/healthz` +
`/build.txt`). An updater needs a comparable **version** and a **migration-set
identity** to reason about skew. So the build writes one file into the payload:

`server/version.json` (emitted by `build.ps1` at build time):

```json
{
  "schema": "aurora-app-version/1",
  "version": "1.1.0",
  "major": 1,
  "commit": "<git sha, == the /healthz build stamp>",
  "migrationHead": "20260711122853_AddPatientDateOfBirth",
  "environment": "production",
  "builtAt": "<iso8601>"
}
```

- `version` / `major` — semver, bumped per release (the installer's `AppVer`
  becomes the single source; today `1.0.0`).
- `migrationHead` — the **newest EF migration id compiled into this build**
  (`server/Core/Persistence/Migrations/`, sorted; the ids are timestamp-prefixed
  so lexical max = head). This is how the updater knows whether a given package
  *would* migrate the live DB.
- The **installed** version is `{app}\server\version.json`; the **package's** is
  the one inside the update bundle. The **DB's applied head** is read live from
  `__EFMigrationsHistory` (via the bundled `pgsql\bin\psql.exe` + `DATABASE_URL`
  from `aurora.env`): `SELECT "MigrationId" FROM "__EFMigrationsHistory" ORDER BY
  "MigrationId" DESC LIMIT 1`.

This file is additive and harmless to the running app (nothing reads it at
runtime; it exists for the updater). It is the one small server-side change
these operations require.

---

## 2. `aurora-update` — the app-only updater

### 2.1 Delivery format — what the hospital actually gets

**Recommendation: a single self-extracting `AuroraUpdate-<ver>.exe`** — a thin
Inno Setup wrapper (built by the same toolchain as `AuroraSetup.exe`) that
bundles the new `server\` payload + the updater script + a `manifest.json` +
`SHA256SUMS`. IT's experience is identical to the installer they already know:

> **one file, one double-click.** UAC prompt → a small progress window →
> a plain-language result.

The updater engine itself is `installer/aurora-update.ps1` (invoked by the exe,
and runnable standalone by an advanced operator). The `.ps1` is where all the
logic lives; the exe is only the transport + a progress UI.

*(Alternative considered: a zip + `.ps1`. Rejected as the default — it is two
steps and a PowerShell prompt for a clinician-facing hospital. The zip form
stays available for scripted/mass deployment.)*

### 2.2 The happy path — what IT sees

```
Aurora ICU Update — 1.0.0 → 1.1.0
  ✓ Verifying the update package (checksums)…            ok
  ✓ Checking versions (no downgrade, same major)…        ok
  ✓ Backing up the database (restore point)…             ok  — aurora-2026….enc
  ✓ Stopping Aurora (clinicians briefly offline)…        ok
  ✓ Installing the new application…                      ok
  ✓ Starting Aurora (applying any database updates)…     ok
  ✓ Verifying (build 1.1.0 healthy)…                     ok
  UPDATE COMPLETE — Aurora is running version 1.1.0.
```

The database, the model, PostgreSQL, `aurora.env` (and every secret in it), the
backup key, and the AI service are **untouched**. No re-login. Clinician-visible
downtime is the stop→start window (seconds to ~a minute for migrations).

### 2.3 The exact sequence

1. **Verify the package** — run the bundle's `SHA256SUMS` + `manifest.json`
   through the existing `verify-release-bundle.sh` logic (ported to PowerShell,
   or shelled). A package that fails verification is treated as **nonexistent** —
   the updater stops before touching anything. (Transfer channel is untrusted.)
2. **Preflight** (§2.4 version-skew guard) — confirm this is an Aurora install
   (`{app}\server\version.json` + the `AuroraServer` service exist), read the
   installed version + the DB's applied migration head, and **refuse** a
   downgrade / same-version / cross-major / wrong-environment package **before
   any change**.
3. **Record the pre-update facts** — `installedVersion`, `dbHead`,
   `packageVersion`, `packageMigrationHead`, and compute
   `migrationWillRun = (packageMigrationHead ≠ dbHead)`. Write them to a
   `installer\update-state.json` (so a crash mid-run is diagnosable/resumable)
   and an immutable audit row (`AuroraIcu.Api.exe audit app-update start …`).
4. **Take the restore point** — `AuroraIcu.Api.exe backup --actor "update"`
   (§2.6). Confirm it **born-restore-verified** (the engine already proves a
   fresh restore of every backup). If the backup fails or is unverifiable,
   **abort here** — no restore point, no update. Nothing has changed yet.
5. **Stop `AuroraServer`** (leave `AuroraPostgres` **and** `AuroraAI` running —
   the app update touches neither). Now the DB is quiescent: no clinical write
   can land while the server is down.
6. **Swap the binaries** — move the current `{app}\server\` to `{app}\server.prev\`
   (a full copy of the known-good old build, kept for rollback), lay the new
   payload into `{app}\server\`, and **carry `aurora.env` across unchanged**
   (the machine config + every secret is preserved verbatim; it is never in the
   package).
7. **Start `AuroraServer`** — on boot it runs the existing advisory-locked
   `db.Database.Migrate()` (any new migrations apply themselves) and begins
   serving.
8. **Verify** — poll `/healthz` for up to N seconds and require **both**
   `status == "ok"` **and** `build == packageCommit` (the new build is actually
   the one serving — a green health check for the *old* bytes is not evidence,
   per the CI-evidence rule). On success → §2.5 finish. On timeout/failure →
   §2.5 the rollback contract.

### 2.4 The version-skew guard (before any change)

The updater **refuses and exits 0-change** if any of these hold:

- **Downgrade or same version** — `packageVersion ≤ installedVersion`. Going
  backwards is a *rollback*, not an *update*; it goes through the DR restore
  path (§2.6), never through "apply a package," because an older binary against
  the current (newer) schema is exactly the forward-only-migration hazard.
- **DB is already ahead** — `packageMigrationHead` is *older* than the live
  `dbHead`. Same hazard, detected from the database itself.
- **Cross-major jump** — `packageMajor ≠ installedMajor`. A major release may
  carry a **non-additive / data-reshaping** migration whose safe application
  needs the supervised path (the full installer or a guided migration), not the
  routine app-only swap. Refused by default; an explicit `-AllowMajor` flag lets
  a supervised operator proceed knowingly.
- **Wrong environment** — `package.environment ≠ production`. A staging build
  must never be pushed onto a hospital.

Each refusal prints *why* and leaves the system exactly as it was.

### 2.5 🔴 The rollback contract (the correctness crux)

EF migrations here are **forward-only** — there are no down-migrations. So
restoring the old binary alone can leave the **old app running against a newer
schema**. The contract handles this precisely.

**What triggers a rollback**
- The new `AuroraServer` does not reach `status=="ok"` **with the new build
  stamp** within the health-timeout (default ~120 s), **or**
- the swap/start throws before that point.

Anything short of a verified-healthy new build is a failure → rollback.

**Exactly what is restored — this is the whole point**
- **If `migrationWillRun == false`** (the package carried no migration beyond the
  DB's head): restore **`server.prev\`** over `server\` (preserving `aurora.env`)
  and restart. The DB was never schema-changed, so the binary is the only thing
  to undo. Result: byte-for-byte the pre-update system.
- **If `migrationWillRun == true`** (the new server advanced the schema before
  failing): restore **BOTH** — `server.prev\` **and the pre-update database
  snapshot from step 4** (`AuroraIcu.Api.exe restore <that backup> --actor
  "update-rollback"`) — then restart. This returns the schema to match the old
  binary. Because the server was **down** from step 5 until this point, no
  clinical write was lost by restoring the snapshot (the only DB change in the
  window was the migration itself; the brief, unhealthy start in step 7 served
  no successful clinical traffic).

We do **not** guess: `migrationWillRun` was computed in step 3 from the package's
`migrationHead` vs the recorded `dbHead`, so the rollback path is deterministic,
not inferred after the fact.

**How we detect the migration ran** — we don't rely on catching it mid-flight:
the pre-computed `migrationWillRun` tells us whether this package *could* have
advanced the schema. If it could have, we restore the snapshot unconditionally on
rollback (safe: the snapshot is the exact pre-update state). Optionally the
updater also re-queries `__EFMigrationsHistory` after the failed start to *log*
whether the head actually moved, but the restore decision does not depend on that
race-prone read.

**If the rollback itself fails** — the nightmare case, made impossible to leave
unrecoverable:
- `server.prev\` is a **full local copy of the known-good old build**; restoring
  it is a local file move. If even that fails (e.g. disk full mid-move), the
  updater **STOPS** and prints — and writes to `installer\update.log` + an audit
  row — a **loud manual-recovery block**: the exact path of `server.prev\`, the
  exact path of the verified pre-update backup, and the exact commands to restore
  by hand (`AuroraIcu.Api.exe restore <backup>` + `sc start AuroraServer`).
- The **pre-update backup is a real, independently-restorable, born-verified
  artifact** (the DR drill uses exactly it). So the floor under every failure
  mode is: **the old binary (`server.prev\`) and a verified pre-update database
  backup both remain on disk, with the exact recovery commands recorded.** The
  worst case is a *documented manual restore to the pre-update state* — never an
  unrecoverable system, and never a hospital with no way back.

**The guarantee, stated once:** *at every step the pre-update binary and a
verified pre-update database snapshot exist on disk; the update either lands
fully-healthy on the new version, or returns to the pre-update version — and if
automation cannot complete the return, it hands the operator a proven,
documented one-command restore to exactly where they started.*

### 2.6 How the backup ties into the existing engine

No new backup mechanism. Step 4 calls the **same** `AuroraIcu.Api.exe backup`
verb the nightly job uses — AES-256-GCM, born-restore-verified, written to
`BACKUP_DIR` with the ACL-locked key. The rollback restore uses the engine's
`restore` verb. Because the pre-update snapshot is an ordinary backup, it also
lands in the normal retention/rotation and the Backup dashboard — the update's
restore point is visible and auditable like any other. (The updater tags its
backup + audit rows with `--actor "update"` so they're distinguishable.)

### 2.7 Finish + housekeeping

On a verified-healthy update: keep `server.prev\` until the **next** successful
update (so a late-discovered regression can still roll back to the immediately
prior build), record `app-update success` in the audit with old→new versions,
and update `update-state.json` to `complete`. The self-extracting exe closes with
the plain result line.

---

## 3. `aurora-enable-ai` — turn the AI on after a GPU is added

### 3.1 What it is

The no-GPU-then-adds-a-GPU case. GPU is detected only once (at install), the
server reads `AI_PROVIDER` once at boot, and nothing re-probes — so adding a GPU
does nothing on its own. This one command wires it up. **It makes zero database
changes.**

### 3.2 The sequence

1. **Confirm a GPU is present now** (`Get-CimInstance Win32_VideoController` for
   an NVIDIA match, the same probe the wizard uses).
2. **Confirm the AI payload is on disk** — `{app}\llama\llama-server.exe` +
   `nssm.exe` + `{app}\model\*.gguf`.
   - *Present* (the common case — the full AI-capable installer lays the payload
     down **even on a no-GPU box**, since `[Files]` has no GPU condition): proceed.
   - *Absent* (the site installed the ~150 MB no-AI build): stop with a clear
     message — lay the payload down first (an "add-AI" package = the `payload\llama`
     + `payload\model` as a small self-extractor, or a full-installer run), then
     re-run this. No data is touched either way.
3. **Register `AuroraAI`** — the exact step-5b block from `aurora-provision.ps1`
   (NSSM service host, Automatic + SCM recovery, `--parallel`/`--ctx-size`
   defaults, bound to `127.0.0.1`), factored into a shared helper both scripts
   call.
4. **Surgically edit `aurora.env` in place** (§3.4) — flip `AI_PROVIDER` from
   `none` to `openai`, add `AI_ENDPOINT` / `AI_MODEL` / `AI_TIMEOUT_SECONDS`, and
   **remove the now-false `AI_UNAVAILABLE_REASON`**. Every other line — DB URL,
   `JWT_SECRET`, backup config — is left byte-for-byte unchanged. **No secret is
   rotated.**
5. **Restart `AuroraServer`** so it re-reads `aurora.env` (`AI_PROVIDER` is
   read-once at boot). Poll `/healthz`; then confirm `AuroraAI` answers
   (`127.0.0.1:<port>/health`) — the model loads in the background, so the AI
   screen is honest until it's ready, exactly as on a fresh AI install.

### 3.3 "Touches zero database state" — why it needs no rollback contract

`aurora-enable-ai` runs **no** `initdb`, **no** role change, **no** re-seed, and
introduces **no** schema change of its own. The restart in step 5 runs the same
idempotent boot-time `db.Database.Migrate()` that runs on *every* reboot — and
because the server **binary is unchanged**, there are no pending migrations, so
`Migrate()` is a no-op. The operation is therefore **incapable of altering
patient data**. That is why it needs neither a mandatory backup nor the §2.5
rollback contract: its worst case (a mis-registered service or a bad `aurora.env`
edit) is recovered by re-running it or restoring the `aurora.env` line — no data
is ever at risk. (It still writes an audit row and keeps a one-line `aurora.env`
backup for the edit, as cheap insurance.)

### 3.4 The stale-message fix (built with enable-ai)

`AI_UNAVAILABLE_REASON="no GPU on this server"` becomes **false** the moment a GPU
is added but before enable-ai runs. Two-part fix:

1. **`aurora-enable-ai` removes the line** when it flips to `openai` — once the AI
   is on, no unavailability message exists.
2. **Change the install-time wording** in `aurora-provision.ps1` so adding
   hardware never falsifies it. Instead of the absolute *"no GPU on this
   server,"* write a reason that stays true and is **actionable**:
   > `AI_UNAVAILABLE_REASON=AI is turned off on this install — no GPU was detected at setup. Add an NVIDIA GPU and run aurora-enable-ai to turn it on.`

   This is honest whether or not a GPU is later fitted (it speaks to *setup*, not
   *now*), and it tells the operator exactly how to enable it. (The AI screen
   already surfaces this reason verbatim.)

---

## 4. What gets reused vs newly built

**Reused, unchanged:** boot-time `db.Database.Migrate()` (the whole reason the
updater needs no migration tooling); the backup engine (`backup` / `restore` /
`verify-restored`, born-restore-verified); the release-bundle + verify machinery
(`make-release-bundle.sh` / `verify-release-bundle.sh` — the manifest + SHA256SUMS
+ verify-first pattern, now emitting a Windows `server\` payload instead of a
Docker image); NSSM service registration (the step-5b helper).

**New (all small):**
- `server/version.json` emitted by `build.ps1` (+ a `migrationHead` helper that
  reads the newest migration id) — the one server-side addition.
- `installer/aurora-update.ps1` (the engine) + a `build-update.ps1` that emits the
  `server\`-only bundle and wraps it as `AuroraUpdate-<ver>.exe`.
- `installer/aurora-enable-ai.ps1` + the shared `Register-AuroraAI` helper.
- The `aurora-provision.ps1` wording fix (§3.4).
- Docs: `installer/README.md` update flow + enable-AI procedure; `02` record.

---

## 5. Effort, staging, and verify-first split

Two focused PRs (each ~PR-B-sized), buildable independently:

- **PR 1 — `aurora-enable-ai` + the stale-message fix.** The smaller, fully
  self-contained one; no version scheme needed. ✅ Linux-testable: PowerShell
  syntax-parse, the shared `Register-AuroraAI` helper factored cleanly, the
  `aurora.env` surgical edit unit-checked against a sample file, the wording fix.
  🔎 Windows/GPU: the actual GPU probe, service registration, and AI coming up.
- **PR 2 — `aurora-update` + `version.json`.** ✅ Linux-testable: the
  `version.json` emission + `migrationHead` extraction, the version-skew guard
  logic (downgrade / cross-major / DB-ahead → refuse) against sample inputs, the
  bundle verify port, the `.ps1` syntax-parse, and a **dry-run of the rollback
  decision** (feed it "migration would run / would not run" and assert the
  restore set chosen). 🔎 Windows: the real stop→swap→migrate→health→rollback on
  a live install, and the manual-recovery block on a forced rollback failure.

Both keep the established tested-vs-code-reviewed split and land the 🔴 items on
the second-machine checklist.

---

## 6. Open decisions for the owner (flagged, not assumed)

1. **Delivery format** — self-extracting `AuroraUpdate-<ver>.exe` (recommended,
   matches the installer UX) vs zip+`.ps1` (lighter build, scriptable). Default:
   the exe, with the zip available.
2. **Cross-major policy** — refuse by default and require the full installer for a
   major (recommended, safest), or allow `-AllowMajor` for a supervised operator.
3. **`server.prev\` retention** — keep one prior build (recommended: enables a
   late rollback) vs delete on success (saves ~150 MB).
4. **Semver ownership** — the installer `AppVer` becomes the single version
   source (recommended); confirm the bump cadence (per shippable change).
5. **Should `aurora-update` also refresh the AI runtime?** By default it touches
   only `server\`; a llama.cpp version bump would ship as its own small package
   (rare). Confirm that split.

Nothing here is built yet. On your go, I'll build PR 1 (enable-ai + the message
fix) first — it's the smaller, self-contained one — then PR 2 (the updater).
