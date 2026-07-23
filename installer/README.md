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
| `aurora-ai-service.ps1` | shared AI helpers (`Register-AuroraAI` + the surgical `aurora.env` edit) — dot-sourced by provisioning **and** enable-AI |
| `aurora-enable-ai.ps1` | **turn the AI on after a GPU is added later** — data-safe, one command (see below) |
| `build.ps1` | builds the payload (React + self-contained server + private Postgres + model + llama-server) and compiles the installer |
| `build-all.ps1` | **one-shot** wrapper — optionally `winget`-installs the toolchain, preflight-checks, runs `build.ps1`, and reports the finished `.exe` + size |
| `BUILD_WINDOWS.md` | **step-by-step build guide** for a Windows laptop (written for someone who has never compiled an installer) |

The **native AI** (PR C): when the target machine has an NVIDIA GPU and the AI payload shipped, provisioning registers a native **AuroraAI** Windows service — `llama.cpp` **`llama-server`** (CUDA) run under **NSSM** (a thin service host, since llama-server is a console exe). It is Automatic + SCM-recovery like the other services, **bound to `127.0.0.1` only** (only AuroraServer calls it; it is never on the LAN and the firewall never opens its port), and **AuroraServer does not depend on it** — the HIS runs with or without the AI (the AI screen stays honest until the model loads). The concurrency guardrails (design §5.4) are `--parallel 4` + `--ctx-size 16384` by default, **env/param-tunable** (see `llama-bench` below).

### Turn the AI on after a GPU is added later (`aurora-enable-ai.ps1`)

A site can install with **no GPU** (AI stays off) and fit an NVIDIA GPU months later. The GPU is detected only once (at install) and the server reads `AI_PROVIDER` once at boot, so **adding a GPU does nothing on its own.** After fitting the GPU, run once as Administrator:

```powershell
powershell -ExecutionPolicy Bypass -File "C:\Aurora\server\scripts\aurora-enable-ai.ps1"
```

It confirms a GPU + the on-disk AI payload, registers **AuroraAI**, makes a **surgical edit to `aurora.env`** (flip `AI_PROVIDER` none→openai, add the endpoint/model/timeout, drop the now-false "no GPU" message), and restarts `AuroraServer`. 🔴 **It touches zero database state** — no `initdb`, no role change, no migration of its own; **no secret is rotated and no clinician is logged out.** (If the install shipped *without* the AI payload — the ~150 MB no-AI build — it says so and stops; lay the payload down first. No data is touched either way.) The install-time "AI unavailable" message is now worded so that **adding a GPU never makes it false** — it speaks to *setup* and points at this command.

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
- **All PowerShell scripts parse syntax-clean.** `aurora-provision.ps1` (now dot-sourcing the shared helper), `aurora-backup.ps1`, `build.ps1`, `build-all.ps1`, and the two AI scripts (`aurora-ai-service.ps1`, `aurora-enable-ai.ps1`) were run through the PowerShell engine's own parser (`System.Management.Automation.Language.Parser.ParseFile`) — **zero syntax errors**. Syntax gate only: it does **not** validate the Windows-only cmdlets or behavior (those stay below). `aurora.iss` is not machine-checkable off Windows (no Linux Inno compiler) — code-reviewed.
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

### Measure the real GPU (the `llama-bench` step — design §5.6)

The `--parallel 4` / `--ctx-size 16384` defaults match the RTX 4060 + Qwen2.5-7B analysis (design §5); **confirm them on the real card** before go-live. `llama-bench` ships with the same llama.cpp build:

```powershell
# single-stream throughput (tokens/sec) on the bundled model
C:\Aurora\llama\llama-bench.exe -m C:\Aurora\model\<the-first-split>.gguf -ngl 999
```

Read the tok/s against §5.3's table. If VRAM is tight (the 4060's 8 GB is the wall), retune **without a rebuild**: re-run `aurora-provision.ps1 -AiEnabled -AiParallel 3` (or a smaller `-AiCtxSize`), or add `--cache-type-k q8_0 --cache-type-v q8_0` to the AuroraAI service (`nssm edit AuroraAI`) to halve the KV cache. The appliance mirror is `LLAMA_PARALLEL` / `LLAMA_CTX` in `appliance/.env`.

Run these alongside the backup-restore test on the second machine. Anything that fails there is a real bug to fix; everything above the line is already green.
