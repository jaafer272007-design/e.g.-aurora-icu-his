# Hospital Installer + Always-On Runtime — design (verify-first, no build yet)

**Status:** design/proposal. NO code built. This document records the
verify-first findings, the recommended architecture, and the complete
install-and-run flow. It supersedes the appliance README's "hospitals get a
native Windows installer with no Docker (Phase 3+)" placeholder with a
concrete plan — and it resolves the owner's Docker **Option A** choice
against what is actually reliable (see §1.2, the flagged decision).

Read alongside: `01_ARCHITECTURE.md` (on-prem per hospital; Windows;
fully isolated, no internet; GPU for AI), `02_PROJECT_STATUS.md` (Appliance
Phase 1/2 = the Docker testbed; "turnkey first-run wizard + backup tooling
are Phase 3+"), `appliance/README.md` (the recorded Docker-licence/isolation
constraints), and Backup & DR (#164, the nightly Task Scheduler job).

---

## 0. The goal (restated) and the two hard requirements

1. **Install** = double-click → next → next → finish. No command line, no
   separately installing Docker. One installer does everything the current
   `AURORA_MODE=production ./run.ps1` does — through a wizard.
2. **Run** = Aurora behaves like a lab/PACS server: **always on, starts on
   boot before anyone logs in, restarts itself after a crash, survives
   reboots/power-cuts/Windows updates, headless, zero human action.**

Requirement 2 is the harder one, and it is what decides the architecture.

---

## 1. VERIFY-FIRST FINDINGS

### 1.1 Can a native Windows installer bundle everything "next-next-finish"? — YES.

Both **WiX (MSI)** and **Inno Setup** can bundle a full application stack —
a self-contained .NET server, a private PostgreSQL, the AI model file, and a
wizard that collects install-time answers — and register **Windows
services** as part of installation (WiX `ServiceInstall`/`ServiceControl`;
Inno via `sc.exe`/`pg_ctl register`/NSSM). MSIX is the wrong tool here — it
is sandboxed and cannot cleanly register arbitrary system services or host a
private database service, so it is out.

- **Recommendation: Inno Setup** as the primary authoring tool — one `.exe`,
  a real next-next-finish wizard with custom input pages (Pascal scripting),
  trivial to bundle the Postgres binaries + model + our server, and it runs
  our DB-init and service-registration steps in `[Run]`/`CurrentStepChanged`.
  It is the shortest reliable path to the turnkey experience.
- **Alternative: WiX/MSI** if a hospital's IT mandates MSI for SCCM/GPO mass
  deployment. Same capabilities, more ceremony. Keep as an option; do not
  start here.

Feasible for THIS app because the server already serves the SPA **and** the
API same-origin from `wwwroot` (Appliance Phase 1), reads all its config from
environment/variables (`DATABASE_URL`, `BACKUP_DIR`, `BACKUP_KEY_FILE`,
`APP_ENV`, `CORS_ORIGINS`, `TZ`, `ADMIN_BOOTSTRAP_PASSWORD`, `FORMULARY_SEED`,
`AI_*`), and already has a CLI (`init-key`, migrations run at boot). The
installer just supplies those values and lays down files + services.

### 1.2 🔴 Docker Option A (installer auto-installs Docker) — NOT reliably achievable. FLAGGED.

The owner chose **Option A**: the installer silently installs Docker so the
hospital never knows Docker exists. Verified, and it fails on three counts —
the third is fatal to Requirement 2:

1. **Silent install exists but needs the internet and WSL2.** The command is
   real: `"Docker Desktop Installer.exe" install --quiet --accept-license
   --backend=wsl-2`. But it requires enabling the WSL2 Windows feature (a
   **reboot**), and Docker Desktop's installer/first-run **downloads
   components and images from the internet** — which the recorded
   architecture forbids (01 + README: hospitals are *"fully isolated, no
   internet at all"*). A fully-offline Docker Desktop install is not a
   supported turnkey path.
2. **Licensing.** Docker Desktop requires a **paid, per-user Business
   subscription** for any organization with **>250 employees OR >$10M annual
   revenue** — essentially every hospital — and activation is an online,
   per-seat concern. The repo already recorded this as the reason Docker is
   "the validator's testbed only."
3. **🔴 THE FATAL ONE — Docker Desktop does not run without a logged-in
   user.** Docker Desktop is a per-user desktop application: its own setting
   is *"Start Docker Desktop when you sign in."* On an unattended hospital
   server sitting at the Windows login screen with **nobody logged in**,
   Docker Desktop **is not running**, so neither is Aurora. The only
   "workarounds" are hacks — Task Scheduler `-AtStartup` launching Docker
   Desktop under a **service account with auto-logon enabled** (i.e. a
   permanently logged-in desktop session on the PHI server — a security
   anti-pattern), or brittle script chains. This is the exact wrinkle the
   task called out, and it directly defeats "starts on boot before anyone
   logs in." Critical infrastructure does not run inside someone's desktop
   session.

   (Docker *Engine* as a true Windows service exists for **Windows**
   containers; Aurora's images are **Linux** — Postgres alpine + .NET Linux —
   and Linux containers on Windows require the WSL2/Docker-Desktop stack,
   which reintroduces problems 1–3. So "Docker Engine as a service" does not
   rescue Option A for this app.)

**Verdict: Option A is genuinely not feasible** for an always-on, no-logged-
in-user hospital server, and it conflicts with the recorded no-internet and
licensing constraints. Per the task's own instruction ("Only fall back if A
is genuinely not feasible — flag it if so"), we flag it and recommend the
path that satisfies BOTH requirements natively.

### 1.3 The reliable path — **native Windows services (Option B), Docker removed from production**

Every piece Aurora needs runs as a first-class **Windows Service**, which by
design starts at boot **before any login**, is restarted by the Service
Control Manager on crash, and runs headless — exactly how a hospital's lab or
PACS server runs. Verified feasible for each component:

| Component | Native Windows form | Auto-start before login | Auto-restart on crash |
|---|---|---|---|
| **PostgreSQL** | The official EDB build registers a real **Windows service** (decades-proven); we bundle the binaries + `pg_ctl register` / installer service | ✅ startup type Automatic | ✅ SCM Recovery |
| **Aurora API + SPA** | `dotnet publish` **self-contained** (no .NET install needed) + `Microsoft.Extensions.Hosting.WindowsServices` → a Windows Service; serves SPA **and** API same-origin (already built) | ✅ Automatic, depends-on Postgres | ✅ SCM Recovery |
| **AI (llama.cpp `llama-server`)** | A plain Windows `.exe` registered as a service via `sc.exe`/NSSM; **CUDA works natively on Windows** — no container GPU passthrough | ✅ Automatic (or on-demand) | ✅ SCM Recovery |
| **Nightly backup** | Already a Windows **Task Scheduler** job (#164); `pg_dump`/`pg_restore` ship with the bundled Postgres | ✅ scheduled | n/a |

Verified mechanics:
- **Auto-start before login:** a service with startup type **Automatic**
  loads during boot, before any interactive logon. (Use plain *Automatic*,
  not *Automatic (Delayed Start)*, for the ICU-critical services.)
- **Ordering:** declare the Aurora service **dependent on** the Postgres
  service (SCM `depend=`), so SCM always starts Postgres first and Aurora
  waits — replacing compose `depends_on`.
- **Auto-restart on crash:** SCM **Recovery** actions (`sc.exe failure`):
  restart after 1st failure (e.g. 5 s), 2nd (10 s), subsequent — the
  documented "critical service" configuration; reset the failure count after
  a window. This is native `restart: always` and stronger (it can even
  restart the machine as a last resort).
- **Reboots / power-cuts / Windows updates:** Automatic services come back on
  every boot with no human action.
- **Headless:** a Windows Service has no window/console and needs no
  logged-in user — always running in the background.

**Consequence:** Docker disappears from production entirely. It stays only as
the **developer/validator testbed** (`appliance/` compose, unchanged — that
is exactly what the README already scoped it to). This *simplifies* the GPU
story (no `--gpus all` passthrough / nvidia-container-toolkit) and the
offline story (no image registry, no internet).

### 1.4 One-line recommendation

Ship a **native Windows installer (Inno Setup)** that lays down a
**self-contained .NET service + a private PostgreSQL service + a native AI
service**, all **Automatic-start with SCM auto-restart**, configured through a
next-next-finish wizard. **Drop Docker from production.** This is the only
approach that satisfies "double-click install" **and** "always-on before
login" together, and it aligns with the already-recorded no-Docker /
no-internet / on-prem decisions.

---

## 2. THE COMPLETE HOSPITAL STORY

### 2.1 Install — double-click → next → next → finish

The hospital's IT runs **`AuroraSetup-<version>.exe`** (signed). Everything
below happens inside the wizard; no console, no Docker, no internet.

**Wizard pages (the production install decisions, click-driven):**
1. **Welcome / licence.**
2. **Install location** (default `C:\Aurora`) and **data location** (default
   `C:\Aurora\data` — the Postgres cluster + backups live here; can be a
   separate/RAID volume).
3. **Access address** → `CORS_ORIGINS`: the wizard auto-detects the server's
   LAN IP and pre-fills `http://<ip>:8080`, editable; refuses localhost (the
   existing production rule). This is the URL staff will open.
4. **First administrator password** → `ADMIN_BOOTSTRAP_PASSWORD`: hidden +
   confirm, cannot be the demo password, "you must change it at first login"
   (existing rule).
5. **Formulary policy** → `FORMULARY_SEED`: *starter* (reference list,
   deactivated) or *empty* (existing rule).
6. **Timezone:** auto-detected from Windows → IANA (existing run.ps1 logic),
   shown for confirmation → `TZ`.
7. **AI/GPU:** auto-detect an NVIDIA GPU. GPU present → AI enabled (native
   `llama-server`, CUDA); absent → AI disabled with the honest reason
   (existing "warn and disable, never refuse" rule). The model file is
   bundled on the install media (offline).
8. **Ready to install → Install.**

**What the installer does on Install (all silent, no prerequisites to fetch):**
1. Copy the **self-contained** Aurora server (`dotnet publish -r win-x64
   --self-contained`), the React bundle (into `wwwroot`), the **private
   PostgreSQL** binaries, `pg_dump`/`pg_restore`, and the **AI model file**.
2. **Initialize the database cluster** in the data location (`initdb`),
   register **`AuroraPostgres`** as a Windows service (Automatic), start it.
3. Write the install answers to a protected machine config
   (`C:\Aurora\config\aurora.env`, ACL-locked) — the same variables the
   server already reads (`DATABASE_URL` → the local Postgres, `APP_ENV=
   production`, `CORS_ORIGINS`, `TZ`, `FORMULARY_SEED`, `ADMIN_BOOTSTRAP_
   PASSWORD`, `BACKUP_DIR`, `BACKUP_KEY_FILE`, `AI_*`).
4. **Register `AuroraServer`** (the .NET service): Automatic, **depends-on
   `AuroraPostgres`**, SCM Recovery = restart/restart/restart. Start it. On
   first start the server runs EF **migrations + the production seed**
   (catalogues + configuration + the ONE bootstrap admin, ZERO patients, ZERO
   demo credentials) — the existing boot path, unchanged.
5. **Backup key ceremony:** generate + ACL-lock `backup.key`, **display the
   key once** in a wizard page (record-in-three-places), exactly as the CLI
   `init-key` does today.
6. **Register the nightly backup** (#164) — as part of install, no separate
   command (this is the natural home for #164's Fix 1, now driven by the
   installer instead of run.ps1).
7. If AI enabled: register **`AuroraAI`** (`llama-server`) as a service
   (Automatic), pointed at the bundled model; wire `AI_ENDPOINT` to it.
8. Open the **Windows Firewall** inbound rule for the chosen port.
9. **Finish** page: shows the access URL + a "the system is now running and
   will start automatically on every boot" confirmation.

After Finish: Aurora is installed, seeded, backing up nightly, and **running
as services set to start on every boot**. Nobody ran a command or touched
Docker.

### 2.2 Run — always-on, headless, self-healing

- **On boot** (server powers on, or reboots after a power-cut / Windows
  update): the SCM starts **`AuroraPostgres`** (Automatic) → then
  **`AuroraServer`** (Automatic, depends-on Postgres) → then **`AuroraAI`** if
  present — **before any user logs in**. Staff can walk up to a server sitting
  at the login screen and Aurora is already serving.
- **On crash:** the SCM Recovery actions restart the failed service
  automatically (5 s / 10 s / …). A wedged process is killed and restarted; a
  repeatedly failing service can, as a last resort, restart the machine.
- **Headless:** no window, no console, no logged-in user — the services run in
  the background 24/7.
- **Health visibility:** the in-app **Backup dashboard** (#164) already shows
  live health; the server's `/healthz` is the SCM/watchdog probe. (Optional
  follow-up: a tiny system-tray/status page for IT, not required for run.)

### 2.3 Daily use

Staff open a browser (any device on the hospital LAN, iPad included) to
`http://<server-ip>:8080` — the dashboard is **always there**. No one ever
launches Aurora. Sign-in is the bootstrap admin on day one (forced password
change), then the accounts IT creates from the Users screen.

---

## 3. WHAT THIS MEANS FOR THE CODE (effort, staged — NOT built here)

The server is already host-agnostic (config from env, SPA served same-origin,
provider-agnostic AI). The work is additive and stages cleanly:

- **PR A — service-host parity (small, testable on Linux).** Add
  `builder.Host.UseWindowsService()` (`Microsoft.Extensions.Hosting.
  WindowsServices`) — a no-op off-Windows, so CI stays green — and confirm the
  server reads its config identically from a machine `aurora.env` file as it
  does from compose env today. Zero behavior change; provable with the
  existing suites + a Postgres run like the one used to verify #164.
- **PR B — the installer (Inno Setup).** Author the wizard + `[Files]` +
  service registration (`AuroraPostgres`, `AuroraServer`, `AuroraAI`) +
  Automatic start + SCM Recovery + dependency + DB init + seed + key ceremony
  + nightly-backup registration + firewall. **Windows-only**; CI can build the
  installer artifact, but true auto-start-before-login is provable only on a
  Windows host/VM — flag this as a Windows-runner/VM verification item (the
  Package CI already builds Windows-facing artifacts).
- **PR C — native AI service + GPU-native path.** Package `llama-server`
  (CUDA) as a Windows service; keep the CPU fallback. The AI adapter is
  already provider-agnostic — only the endpoint/launcher changes.
- **Docs.** Supersede the README's "no Docker (Phase 3+)" placeholder with
  this design; keep `appliance/` compose as the explicitly-labelled
  dev/validator testbed.

**Cross-cutting invariants preserved:** the born-restore-verified backup
engine, the boot tripwires (production refuses demo credentials/config), the
one-build-serves-SPA-and-API topology, RBAC, and the four-code error
convention are all unchanged — this changes *how Aurora is hosted and
started*, not *what Aurora is*.

---

## 4. Flags / open decisions for the owner

1. **🔴 Docker Option A → Option B (native services).** This reverses the
   owner's stated Option A because A cannot run always-on without a logged-in
   user and needs internet + a paid licence a fully-isolated hospital can't
   satisfy (§1.2). Recommend adopting B. *(If the owner still wants Docker in
   production despite this, the only way to get auto-start would be a
   dedicated auto-logon service account — a permanently logged-in desktop
   session on the PHI server. We do not recommend it and would flag it as a
   security regression; documented here only for completeness.)*
2. **Installer tool: Inno Setup (recommended) vs WiX/MSI.** Pick Inno for the
   fastest reliable turnkey; switch to/add WiX only if the hospital mandates
   MSI/SCCM mass deployment.
3. **PostgreSQL packaging:** bundle the EDB binaries + `initdb` at install
   (recommended — full control, offline) vs chaining the EDB installer
   silently. Recommend the former (one installer, no nested UI).
4. **Compose `restart:` policy (testbed only):** the dev appliance uses
   `restart: unless-stopped`; consider `always` there for parity, but it is
   moot for production (no Docker).
5. **Windows Server edition & updates:** confirm the hospital's Windows
   edition; schedule OS updates for a maintenance window (services auto-return
   after the reboot regardless).
