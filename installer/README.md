# Aurora ICU — hospital installer (native Windows, no Docker)

The **production** installer for a hospital: a single `AuroraSetup.exe` that a
hospital's IT double-clicks — next, next, finish — and ends with Aurora
**installed and running 24/7 as Windows services**, no Docker, no PowerShell,
no internet. This implements Option B of
[`../HOSPITAL_INSTALLER_RUNTIME_DESIGN.md`](../HOSPITAL_INSTALLER_RUNTIME_DESIGN.md).

> Docker (`../appliance/`) remains the **developer / validator testbed only**,
> exactly as the appliance README always planned. This folder is the real
> hospital path.

## What's here

| File | Role |
|---|---|
| `aurora.iss` | the Inno Setup wizard (UI + file layout + invokes provisioning + show-once key) |
| `aurora-provision.ps1` | the Docker-free provisioning engine (DB, services, config, backup, firewall) |
| `aurora-backup.ps1` | the **native** nightly backup (runs the `.exe` directly — the Docker-free sibling of `../appliance/backup.ps1`) |
| `aurora-ai-service.ps1` | shared AI helpers (`Register-AuroraAI` + the surgical `aurora.env` edits) — dot-sourced by provisioning, enable-AI **and** the on-boot auto-wire |
| `aurora-autowire.ps1` | **on-boot AI self-wiring** — the "just works" path: AuroraServer runs it every boot; adds/removes the AI to match the hardware, no command typed (see below) |
| `aurora-enable-ai.ps1` | the **manual** escape hatch to turn the AI on after a GPU is added later — data-safe, one command (now redundant on a normal install; the auto-wire does it) |
| `aurora-update.ps1` | the **app-only updater** engine — verify → version-skew guard → born-verified DB restore point → swap `server\` (carry `aurora.env`) → verify the new build serves → **roll back on any failure** (see below) |
| `aurora-update.iss` | the small self-extracting **`AuroraUpdate-<ver>.exe`** wrapper (transport + progress UI); built by `build.ps1 -UpdateOnly` |
| `build.ps1` | builds the payload (React + self-contained server + private Postgres + model + llama-server) and compiles the installer |
| `build-all.ps1` | **one-shot** wrapper — optionally `winget`-installs the toolchain, preflight-checks, runs `build.ps1`, and reports the finished `.exe` + size |
| `BUILD_WINDOWS.md` | **step-by-step build guide** for a Windows laptop (written for someone who has never compiled an installer) |

The **native AI** (PR C): when the target machine has an NVIDIA GPU and the AI payload shipped, provisioning registers a native **AuroraAI** Windows service — `llama.cpp` **`llama-server`** (CUDA) run under **NSSM** (a thin service host, since llama-server is a console exe). It is Automatic + SCM-recovery like the other services, **bound to `127.0.0.1` only** (only AuroraServer calls it; it is never on the LAN and the firewall never opens its port), and **AuroraServer does not depend on it** — the HIS runs with or without the AI (the AI screen stays honest until the model loads). The concurrency guardrails (design §5.4) are `--parallel 4` + `--ctx-size 16384` by default, **env/param-tunable** (see `llama-bench` below).

### The AI just works when a GPU is fitted (`aurora-autowire.ps1`, on every boot)

A site can install with **no GPU** (AI stays off) and fit an NVIDIA GPU months later. **They fit the card, power the server on, and the AI just works — no command, no script, nothing typed.** On **every** boot AuroraServer runs `aurora-autowire.ps1` (native Windows service only — a no-op on Docker/Render/dev/CI): it probes for an NVIDIA GPU **and** the on-disk AI payload and reconciles the `AuroraAI` service + `aurora.env` to match the hardware — **ENABLE** when a GPU appears (register the service, flip `none→openai`, drop the stale reason), **DISABLE** honestly when a GPU is removed (stop the service, flip back to `none` with an honest reason), **NO-OP** when the state already matches. It reuses the same `Register-AuroraAI` / `Update-AiEnvLines` / `Set-AiDisabledEnvLines` helpers as the manual path, and the change is applied to the *same* boot (the hook runs before the config is read), so no restart is needed.

🔴 **It touches zero database state** (identical to enable-ai — no `initdb`, no role change, no re-seed, no secret rotation, no forced logout), and 🔴 **it fails safe**: the C# hook (`server/Core/Ai/AiAutoWire.cs`) runs the script in a **time-bounded child process wrapped in a catch-all**, and the script always `exit 0`s — *if GPU probing or service registration fails for any reason, Aurora boots normally with the AI in its previous state and an honest message.* The AI turning itself on can never stop the HIS from running.

### Turn the AI on manually (`aurora-enable-ai.ps1`) — the escape hatch

The auto-wire above makes this **redundant on a normal native install**, but the one-command path stays shipped for an operator who wants to force it (or a box whose service path is bypassed). After fitting the GPU, run once as Administrator:

```powershell
powershell -ExecutionPolicy Bypass -File "C:\Aurora\server\scripts\aurora-enable-ai.ps1"
```

It confirms a GPU + the on-disk AI payload, registers **AuroraAI**, makes a **surgical edit to `aurora.env`** (flip `AI_PROVIDER` none→openai, add the endpoint/model/timeout, drop the now-false "no GPU" message), and restarts `AuroraServer`. 🔴 **It touches zero database state** — no `initdb`, no role change, no migration of its own; **no secret is rotated and no clinician is logged out.** (If the install shipped *without* the AI payload — the ~150 MB no-AI build — it says so and stops; lay the payload down first. No data is touched either way.) The install-time "AI unavailable" message is now worded so that **adding a GPU never makes it false** — it speaks to *setup* and points at this command.

### Update the app on a hospital box later (`AuroraUpdate-<ver>.exe`)

Delivering a new application build **without** re-running the 5 GB installer: a small self-extracting `AuroraUpdate-<ver>.exe` (just the `server\` payload — no Postgres/model/llama). IT double-clicks it; the updater (`aurora-update.ps1`) then, in order: **verifies** the package checksums → **guards against version skew** (refuses a downgrade / same-version / DB-ahead / cross-major-without-`-AllowMajor` / non-production package, leaving the system untouched) → takes a **born-verified database backup as the restore point** → stops `AuroraServer` (Postgres + AuroraAI stay up) → moves `server\`→`server.prev\` and lays the new payload, **carrying `aurora.env` (and every secret) across verbatim** → starts and **verifies the new build is actually serving** (`/healthz` `status=ok` **and** `build == packageCommit`).

🔴 **The rollback contract (design §2.5).** EF migrations are forward-only, so the updater computes `migrationWillRun` up front. If the new build does not come up healthy: it restores `server.prev\`, and **if the update advanced the schema it also restores the pre-update database snapshot** (the new `restore` verb — DROP+CREATE the DB and `pg_restore` the snapshot, so no failed-migration object survives) — returning to *exactly* the pre-update state. If automation cannot complete the return, it prints and logs (`installer\update.log`) the exact `server.prev\` path, the verified backup filename, and the one-command manual restore. At every step a known-good binary and a born-verified backup are both on disk. `version.json` (emitted by `build.ps1`) gives the updater the version + migration-set identity it reasons about. See [`UPDATE_AND_ENABLE_AI_DESIGN.md`](./UPDATE_AND_ENABLE_AI_DESIGN.md) §1–§2.

```powershell
# build the update package (same toolchain as the full installer; no -PgZip needed)
cd installer
.\build.ps1 -UpdateOnly            # → installer\Output\AuroraUpdate-1.0.0.exe (small; server payload only)
```

## Build the installer (on a build machine — SDK/Node/Inno/internet)

The **build** machine needs the .NET 8 SDK, Node, [Inno Setup 6](https://jrsoftware.org/isinfo.php), and internet. The **hospital** machine needs none of it.

> **New to this?** [`BUILD_WINDOWS.md`](./BUILD_WINDOWS.md) is a full step-by-step walkthrough, and **`build-all.ps1`** does the whole thing in one command (it can even install the toolchain via `winget`). The raw `build.ps1` steps below are the reference.

```powershell
# 1. a PostgreSQL 16 "binaries only" zip for Windows x64 from
#    https://www.enterprisedb.com/download-postgresql-binaries
# 2. (for the AI) a folder with the .gguf model file(s) — Qwen2.5-7B-Instruct
#    Q4_K_M, the same sha256-pinned release the appliance uses
# 3. (for the AI) a folder with the Windows llama-server build (CUDA):
#    llama-server.exe + its CUDA DLLs, built from the pinned llama.cpp commit
#    (see appliance/llama/Dockerfile for the commit + cmake flags), PLUS
#    nssm.exe (https://nssm.cc) — the service host for the console exe.
#    Include llama-bench.exe from the same build for the §5.6 GPU measurement.
cd installer
.\build.ps1 -PgZip C:\downloads\postgresql-16.x-windows-x64-binaries.zip `
            -ModelDir C:\aurora-ai\model -LlamaDir C:\aurora-ai\llama
# → installer\Output\AuroraSetup-1.0.0.exe
# (omit -ModelDir/-LlamaDir to build an installer that ships with the AI DISABLED)
```

## What the hospital does (the whole deployment)

1. Copy `AuroraSetup.exe` to the **one server** and double-click it.
2. Wizard: install/data locations → **access URL** (the server's LAN address) → **admin password** → **formulary** (starter/empty). Timezone + GPU are auto-detected.
3. Click Install. The installer initialises the private database, registers the **AuroraPostgres** and **AuroraServer** Windows services (Automatic start, SCM auto-restart, Aurora depends-on Postgres), seeds catalogues + the bootstrap admin, shows the **backup key once** (record it in three places), registers the **nightly backup**, and opens the firewall. **When the machine has an NVIDIA GPU** (and the AI payload shipped), it also registers the **AuroraAI** service (llama-server, `127.0.0.1` only) — otherwise the AI screen honestly says "no GPU on this server" and everything else runs unchanged.
4. Finish. From then on, every clinician opens the access URL in a browser. Nobody launches anything; it starts on every boot.

## ✅ Tested (in CI / the Linux sandbox) vs 🔎 code-reviewed-only

Because Windows services, the SCM, `initdb`-for-Windows, and Inno Setup **cannot run in the Linux CI/sandbox**, the split is explicit — this is what to verify on the second (Windows) machine.

**✅ Already verified (Linux):**
- The **self-contained `win-x64` publish** produces a standalone `AuroraIcu.Api.exe` (PE32+) with the CLR bundled (no .NET install needed) and the SPA in `wwwroot`.
- **Config parity** (PR A): the server reads `aurora.env` for everything (PORT/APP_ENV/DATABASE_URL/BACKUP_DIR…); the real env wins; a missing file is a no-op; the backup CLI reads it too.
- The **backup engine** (`AuroraIcu.Api.exe backup`) produces a real born-restore-verified AES-256-GCM backup (proven against Postgres in the #164 verification) — `aurora-backup.ps1` calls exactly that.
- **All PowerShell scripts parse syntax-clean.** `aurora-provision.ps1` (now dot-sourcing the shared helper), `aurora-backup.ps1`, `build.ps1`, `build-all.ps1`, and the three AI scripts (`aurora-ai-service.ps1`, `aurora-enable-ai.ps1`, `aurora-autowire.ps1`) were run through the PowerShell engine's own parser (`System.Management.Automation.Language.Parser.ParseFile`) — **zero syntax errors**. Syntax gate only: it does **not** validate the Windows-only cmdlets or behavior (those stay below). `aurora.iss` is not machine-checkable off Windows (no Linux Inno compiler) — code-reviewed.
- 🔴 **The app-only updater's data-safety core was EXECUTED against REAL Postgres.** The new `restore` verb (the rollback's DB-restore, the correctness crux) was run end-to-end against a live PostgreSQL 16 with the `aurora` role as **CREATEDB-but-NOT-superuser** (exactly the native install after the provision grant): a born-verified backup taken, the live DB then wiped and corrupted (a catalogue emptied, a planted "failed-migration" orphan table added), then `restore <backup> --yes` → the live DB returned to **exactly** the snapshot — **28 tables + `__EFMigrationsHistory` restored with matching counts AND per-table content digests**, the emptied catalogue's rows all back, and the orphan table **gone** (proving DROP+CREATE, not `--clean`, so no migration-replay hazard). The same run proved the **backup born-verify works as a CREATEDB-only role** (the latent native-backup bug, repaired). Separately, the updater's **version-skew guard** (`Compare-SemVer` + `Test-VersionSkew`) was executed in a real PowerShell runspace — **19/19**: numeric semver ordering, and refusals for downgrade / same-version / DB-ahead / cross-major (allowed only with `-AllowMajor`) / non-production.
- 🔴 **The on-boot auto-wire's DISABLE and NO-OP paths were EXECUTED, not just reviewed.** `aurora-autowire.ps1` was run through a real PowerShell runspace (`Microsoft.PowerShell.SDK`) against temp installs — **22/22 assertions passed**: the pure `Set-AiDisabledEnvLines` preserved `JWT_SECRET`/`DATABASE_URL`/`ADMIN_BOOTSTRAP_PASSWORD`/`BACKUP_KEY_FILE`/comment/`TZ` byte-for-byte while flipping to `AI_PROVIDER=none` + an honest reason; the **DISABLE** decision (GPU absent on Linux, `aurora.env` says `openai`) really rewrote `aurora.env` to `none` — secrets intact — and emitted `AUTOWIRE-ENV: AI_PROVIDER=none` + the honest reason and **no** endpoint/model; the **NO-OP** decision (already off) emitted **zero** lines and left `aurora.env` untouched. This proves the degrade-honestly path and the data-safe edit. The **ENABLE** path (live GPU + real service registration) stays Windows-only — verified by code review, on the checklist below. `server/Core/Ai/AiAutoWire.cs` compiles into the server and is inert off Windows (`OperatingSystem.IsWindows()` + `IsWindowsService()` gate).
- 🔴 **The surgical `aurora.env` edit was EXECUTED, not just reviewed.** `Update-AiEnvLines` (the data-safe core of enable-AI) was run against a sample `aurora.env` through a real PowerShell runspace (`Microsoft.PowerShell.SDK`): **11/11 assertions passed** — `JWT_SECRET`, `DATABASE_URL`, `ADMIN_BOOTSTRAP_PASSWORD`, `BACKUP_KEY_FILE`, the comment and `TZ` all preserved byte-for-byte; `AI_PROVIDER` flipped none→openai; endpoint/model/timeout added; the stale `AI_UNAVAILABLE_REASON` removed. This proves enabling the AI later cannot disturb a secret or any other config line.
- **The AI client changes type-check + build** (PR C): the queued/waiting UI text and the single-in-flight guard are TypeScript-clean (`tsc --noEmit`) and no server C# changed — the AI adapter was already provider-agnostic, so the native `llama-server` only swaps the endpoint/launcher.

**🔎 Code-reviewed only — VERIFY ON THE WINDOWS MACHINE (your second-laptop run):**
1. **The wizard** runs and collects the five decisions (double-click → next → finish).
2. **`initdb` + AuroraPostgres service** comes up; the aurora DB/role are created.
3. **AuroraServer service** starts, migrates + seeds (catalogues + bootstrap admin, zero patients), and serves the SPA + API on the access URL.
4. 🔴 **Auto-start before login:** reboot the server and, **without logging in**, open the access URL from another device — Aurora answers. (This is the whole point of Option B and cannot be tested off-Windows.)
5. 🔴 **Auto-restart on crash:** `sc.exe stop AuroraServer` / kill the process → the SCM restarts it within seconds.
6. **Backup-key ceremony:** the key is shown once; the relay file is deleted; the server keeps its ACL-locked copy.
7. **Nightly backup task** is registered (`schtasks /Query /TN AuroraBackup`) and `aurora-backup.ps1` produces a real backup when run.
8. **Firewall** rule opened; the port is reachable from the LAN, `127.0.0.1:5432` (Postgres) is **not** exposed.
9. **Backup restore** (the acceptance test) still works from this native install — fold it into your restore drill.
10. 🔴 **AuroraAI (the AI service) comes up on the GPU box:** `llama-server` loads the model under NSSM; `curl http://127.0.0.1:8081/health` returns OK; the AI screen answers a real question (grounded query + the labeled interpretation). Auto-starts before login and restarts on crash like the others (`sc.exe stop AuroraAI` → SCM/NSSM restarts it).
11. **Concurrency (`--parallel`)** — fire several AI questions at once (a few browser tabs): they **queue and all answer**, none fail. This is the §5.4 guardrail; `llama-bench` (below) measures the real curve.
12. **GPU absent → honest, not broken:** on a box with no NVIDIA GPU, no AuroraAI service is registered, `aurora.env` has `AI_PROVIDER=none` + the actionable *"AI is turned off on this install — no GPU was detected at setup. Add an NVIDIA GPU and run aurora-enable-ai to turn it on."*, and the AI screen says exactly that while every other screen runs.
13. **AuroraAI is `127.0.0.1`-only** (not reachable from another LAN device — only AuroraServer calls it), and **uninstall removes it** (`sc.exe query AuroraAI` → gone).
14. **Enable-AI-later** (`aurora-enable-ai.ps1`): on a box that installed with no GPU, fit an NVIDIA GPU, run the script → **AuroraAI registers, `aurora.env` flips to `openai` (secrets untouched, no re-login), the AI screen answers.** Confirm patient data is undisturbed (it is — the script makes no DB call; the pure `aurora.env` edit is already execution-proven above).
15. 🔴 **On-boot auto-wire — the "just works" ENABLE path** (`aurora-autowire.ps1`, driven by `AiAutoWire.cs`): on a box that installed with no GPU (AI off), **fit an NVIDIA GPU + driver and simply reboot — no command.** On boot, AuroraServer should register `AuroraAI`, flip `aurora.env` to `openai`, clear the stale reason, and the AI screen answers **that same boot** (no second restart). Confirm the reverse: **remove the GPU and reboot** → the AI turns itself off with the honest "GPU is no longer detected" reason and every other screen still runs. Confirm patient data is undisturbed (no DB call; the DISABLE/NO-OP edits are execution-proven above, ENABLE reuses the same proven `Update-AiEnvLines`). And confirm fail-safe: with a **deliberately broken** GPU probe or a missing `llama\`/`model\` payload, the server still boots normally with the AI off — never a blocked HIS. Check `{DataDir}\autowire.log` for the boot's decision line.
16. **App-only update — the happy path** (`AuroraUpdate-<ver>.exe`): build a `1.1.0` update package (`build.ps1 -UpdateOnly`), double-click it on a `1.0.0` box → progress window → **`AuroraServer` stops, `server\`→`server.prev\`, new payload laid down, `aurora.env` carried across unchanged, service restarts, `/healthz` reports the new `build` commit.** Confirm the database, model, Postgres, backup key, AI service and **every secret in `aurora.env`** are untouched, and **no clinician is logged out**. Confirm the version-skew guard by trying to apply the same-or-older package → it refuses and changes nothing.
17. 🔴 **App-only update — the ROLLBACK drill** (the go-live-critical one): apply an update package **rigged to fail its health check** (e.g. a deliberately broken build). Confirm the updater **restores `server.prev\`**, and — for a package that carried a migration — **restores the pre-update database snapshot via the `restore` verb** (proven against Postgres above), returning to exactly `1.0.0` with the pre-update data, service healthy. Then confirm the manual-recovery path: read `installer\update.log`; it must name the `server.prev\` path, the verified backup filename, and the exact one-command restore. This is the whole promise of the updater — **there is always a proven way back.**

### Measure the real GPU (the `llama-bench` step — design §5.6)

The `--parallel 4` / `--ctx-size 16384` defaults match the RTX 4060 + Qwen2.5-7B analysis (design §5); **confirm them on the real card** before go-live. `llama-bench` ships with the same llama.cpp build:

```powershell
# single-stream throughput (tokens/sec) on the bundled model
C:\Aurora\llama\llama-bench.exe -m C:\Aurora\model\<the-first-split>.gguf -ngl 999
```

Read the tok/s against §5.3's table. If VRAM is tight (the 4060's 8 GB is the wall), retune **without a rebuild**: re-run `aurora-provision.ps1 -AiEnabled -AiParallel 3` (or a smaller `-AiCtxSize`), or add `--cache-type-k q8_0 --cache-type-v q8_0` to the AuroraAI service (`nssm edit AuroraAI`) to halve the KV cache. The appliance mirror is `LLAMA_PARALLEL` / `LLAMA_CTX` in `appliance/.env`.

Run these alongside the backup-restore test on the second machine. Anything that fails there is a real bug to fix; everything above the line is already green.
