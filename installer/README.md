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
| `build.ps1` | builds the payload (React + self-contained server + private Postgres + model) and compiles the installer |

## Build the installer (on a build machine — SDK/Node/Inno/internet)

The **build** machine needs the .NET 8 SDK, Node, [Inno Setup 6](https://jrsoftware.org/isinfo.php), and internet. The **hospital** machine needs none of it.

```powershell
# 1. get a PostgreSQL 16 "binaries only" zip for Windows x64 from
#    https://www.enterprisedb.com/download-postgresql-binaries
# 2. (optional) a folder with the .gguf model file(s) — AI is PR C
cd installer
.\build.ps1 -PgZip C:\downloads\postgresql-16.x-windows-x64-binaries.zip
# → installer\Output\AuroraSetup-1.0.0.exe
```

## What the hospital does (the whole deployment)

1. Copy `AuroraSetup.exe` to the **one server** and double-click it.
2. Wizard: install/data locations → **access URL** (the server's LAN address) → **admin password** → **formulary** (starter/empty). Timezone + GPU are auto-detected.
3. Click Install. The installer initialises the private database, registers the **AuroraPostgres** and **AuroraServer** Windows services (Automatic start, SCM auto-restart, Aurora depends-on Postgres), seeds catalogues + the bootstrap admin, shows the **backup key once** (record it in three places), registers the **nightly backup**, and opens the firewall.
4. Finish. From then on, every clinician opens the access URL in a browser. Nobody launches anything; it starts on every boot.

## ✅ Tested (in CI / the Linux sandbox) vs 🔎 code-reviewed-only

Because Windows services, the SCM, `initdb`-for-Windows, and Inno Setup **cannot run in the Linux CI/sandbox**, the split is explicit — this is what to verify on the second (Windows) machine.

**✅ Already verified (Linux):**
- The **self-contained `win-x64` publish** produces a standalone `AuroraIcu.Api.exe` (PE32+) with the CLR bundled (no .NET install needed) and the SPA in `wwwroot`.
- **Config parity** (PR A): the server reads `aurora.env` for everything (PORT/APP_ENV/DATABASE_URL/BACKUP_DIR…); the real env wins; a missing file is a no-op; the backup CLI reads it too.
- The **backup engine** (`AuroraIcu.Api.exe backup`) produces a real born-restore-verified AES-256-GCM backup (proven against Postgres in the #164 verification) — `aurora-backup.ps1` calls exactly that.
- **The two PowerShell scripts parse syntax-clean.** `aurora-provision.ps1` and `aurora-backup.ps1` were run through the PowerShell engine's own parser (`System.Management.Automation.Language.Parser.ParseFile`) — **zero syntax errors** (no unbalanced braces/quotes, no malformed `param`/pipelines). This is a syntax gate only: it catches typos so the installer will not face-plant on a bracket error, but it does **not** validate the Windows-only cmdlets or any behavior (those stay in the list below). `aurora.iss` is not machine-checkable off Windows (no Linux Inno compiler) — it remains code-reviewed.

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

Run these alongside the backup-restore test on the second machine. Anything that fails there is a real bug to fix; everything above the line is already green.
