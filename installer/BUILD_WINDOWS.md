# Building `AuroraSetup.exe` on a Windows laptop

This produces the installer the **vendor's engineer** runs on the hospital
server (the shipping build is password-locked — see *The shipping build*
below; hospitals do not install Aurora themselves). You build it
**once** on a build laptop (with internet + the SDK/Node/Inno toolchain); the
hospital server needs **none** of it. Written for someone who has never compiled
an installer.

> **Smart first move:** do a **no-AI build first** (fast, ~150 MB — proves your
> toolchain works), then the **full build with the model** (~5 GB). If the no-AI
> build succeeds, any failure in the full one is isolated to the AI inputs.

You want **~20 GB free disk** (the model is 4.7 GB and compression needs room)
and a fast internet connection.

---

## The fast path — one command with `build-all.ps1`

`installer/build-all.ps1` does the whole job in one go: (optionally) installs the
toolchain via `winget`, preflight-checks everything, runs the build, and prints
the finished `.exe` and its size. **You don't babysit anything.**

### 1. Get the code

```powershell
cd C:\
git clone https://github.com/jaafer272007-design/e.g.-aurora-icu-his.git aurora
```

(No Git yet? Either install it — see *Manual toolchain* below — or download the
repo as a ZIP from GitHub and extract to `C:\aurora`. Keep the path short:
`C:\aurora` avoids Windows' 260-character path limit.)

### 2. Put the payload inputs somewhere (details in section "Inputs" below)

- **PostgreSQL zip** (required) → e.g. `C:\aurora-build\postgresql-16.4-1-windows-x64-binaries.zip`
- **AI model** (for the full build) → e.g. `C:\aurora-ai\model\` (both `.gguf` split files)
- **llama-server + nssm** (for the full build) → e.g. `C:\aurora-ai\llama\`

### 3. Run it once

**Full build, and let it install the toolchain for you:**

```powershell
powershell -ExecutionPolicy Bypass -File C:\aurora\installer\build-all.ps1 `
  -InstallPrereqs `
  -PgZip    C:\aurora-build\postgresql-16.4-1-windows-x64-binaries.zip `
  -ModelDir C:\aurora-ai\model `
  -LlamaDir C:\aurora-ai\llama
```

**Or the quick no-AI build (toolchain already installed):**

```powershell
powershell -ExecutionPolicy Bypass -File C:\aurora\installer\build-all.ps1 `
  -PgZip C:\aurora-build\postgresql-16.4-1-windows-x64-binaries.zip
```

Notes:
- `-InstallPrereqs` uses `winget` to install the **.NET 8 SDK, Node LTS, Inno
  Setup 6, and Git**, then refreshes this session's `PATH` so it can build
  immediately — no reopening the terminal. Approve any UAC prompt. (If `winget`
  is missing, install *App Installer* from the Microsoft Store, or do the manual
  toolchain below.)
- Omit `-ModelDir`/`-LlamaDir` for an AI-disabled build. Give **both** or
  **neither** — the script refuses just one.
- If Inno Setup isn't at the default path, add `-Iscc "C:\path\to\ISCC.exe"`.
- The `` ` `` at each line end is PowerShell's line-continuation. Or put it all
  on one line.

### What you'll see

Preflight lines, then five build banners, then the result:

```
[build-all] checking the toolchain...
[build-all] AI-ENABLED build: model=... llama=...
== 1. React production bundle ==
== 2. self-contained server publish (win-x64) ==
== 3. private PostgreSQL binaries ==
== 4. AI model + llama-server (the native AI service — PR C) ==
== 5. compile the installer ==
[build-all] DONE  ->  C:\aurora\installer\Output\AuroraSetup-1.0.0-UNPROTECTED.exe   (5.1 GB)
```

**Step 5 compresses ~5 GB at max LZMA2 — expect 20–60 min for an AI build**
(a couple of minutes for no-AI). That's normal, not a hang.

---

## Inputs — where to get them and where to put them

### A. PostgreSQL binaries — **required** (`-PgZip`)
- https://www.enterprisedb.com/download-postgresql-binaries → **PostgreSQL 16.x**,
  **Windows x86-64**, the **"binaries only" ZIP** (e.g.
  `postgresql-16.4-1-windows-x64-binaries.zip`).
- ⚠️ The **ZIP**, not the `.exe` installer — the most common mistake.
- **Do not unzip it.** The build unzips it for you. Just note the path.

### B. The AI model (`-ModelDir`) — for the full build
- From Hugging Face **`Qwen/Qwen2.5-7B-Instruct-GGUF`**, download the **Q4_K_M**
  files. It ships split in two — get **both**:
  - `qwen2.5-7b-instruct-q4_k_m-00001-of-00002.gguf`
  - `qwen2.5-7b-instruct-q4_k_m-00002-of-00002.gguf`
- Put **both** in one folder, e.g. `C:\aurora-ai\model\`. Use the same
  sha256-pinned release the appliance uses (the model already validated in the
  AI eval).

### C. llama-server + NSSM (`-LlamaDir`) — for the full build
Put all of these in one folder, e.g. `C:\aurora-ai\llama\`:
- **llama-server (CUDA):** from
  https://github.com/ggml-org/llama.cpp/releases, the **Windows CUDA** zip
  (`llama-<ver>-bin-win-cuda-cu12.x-x64.zip`) **and** its matching CUDA runtime
  zip (`cudart-llama-bin-win-cu12.x-x64.zip`). Extract **both** so the folder has
  `llama-server.exe`, `llama-bench.exe`, and all the `.dll`s (ggml-cuda.dll,
  llama.dll, cudart64_12.dll, cublas64_12.dll, …).
- **NSSM:** https://nssm.cc/download → `nssm-2.24.zip` → copy **`win64\nssm.exe`**
  into the same folder.

> **Parity caveat:** the appliance pins a *specific* llama.cpp commit (see
> `appliance/llama/Dockerfile`) that was verified to grammar-enforce
> `tool_choice=required`. A recent official CUDA release almost certainly behaves
> the same — and confirming the AI answers with a real tool call is one of your
> second-machine checks anyway — but for strict parity, build llama-server from
> that commit (needs the CUDA toolkit + CMake + MSVC).

---

## Output — where it lands and how big

- **Plain build:** `installer\Output\AuroraSetup-1.0.0-UNPROTECTED.exe`
- **Protected build:** `installer\Output\AuroraSetup-1.0.0-PROTECTED.exe`
- **Size:** **~5–5.5 GB** with the model (the 4.7 GB GGUF is already compressed,
  so it dominates and barely shrinks), or **~150 MB** for the no-AI build.

> 🔴 **The full installer is a SET of files, not one file.** Inno cannot emit a
> single Setup.exe above ~4.2 GB, so the build is **sliced**: the `.exe` plus
> numbered `.bin` files beside it (`AuroraSetup-1.0.0-PROTECTED-1.bin`, `-2.bin`,
> …). **Copy the whole folder** — the `.exe` alone will refuse to install. The
> operator's experience is unchanged: double-click the `.exe`, same wizard, same
> password prompt, payload still encrypted in every slice.
> *(Superseded here: earlier revisions of this document described the output as
> a single ~5 GB `.exe`. That was never build-validated; the first real
> AI-enabled compile, 2026-07-26, hit Inno's ceiling and the installer was moved
> to `DiskSpanning=yes`.)*

- **Update packages** (app-only, `server\` payload):
  `AuroraUpdate-1.0.0-PROTECTED.exe` (shipping, `build-protected.ps1
  -UpdateOnly`) / `AuroraUpdate-1.0.0-UNPROTECTED.exe` (plain
  `build.ps1 -UpdateOnly`, smoke tests only).

The protection state is **in the filename, by construction** — both `.iss`
files name the output from the same condition that turns encryption on, so
a `-PROTECTED` file is always encrypted and an `-UNPROTECTED` file never
is. **An `-UNPROTECTED` file never leaves the build machine; everything
shipped is an encrypted build** (`-PROTECTED`, or `-<hospitalid>` on the
dormant per-hospital path). Update packages are locked with the **same
company password by the same machinery** (owner's ruling, 2026-07-25): an
unprotected update exe would hand out the newest server binaries and
defeat the point of protecting the installer, and under the
engineer-present service model the engineer runs updates anyway.

---

## The shipping build — `build-protected.ps1` (single company password)

The path for anything that leaves the vendor. One **company install
password**, held by the vendor's engineer **alone** — typed on site at every
hospital install. The hospital never receives it, stores it, or writes it
down; any reinstall or disaster rebuild happens with the engineer present.
That is the service model.

```powershell
# full hospital installer -> AuroraSetup-<ver>-PROTECTED.exe
powershell -ExecutionPolicy Bypass -File .\installer\build-protected.ps1 `
  -PgZip   C:\aurora-build\postgresql-16.4-1-windows-x64-binaries.zip `
  -ModelDir C:\aurora-ai\model -LlamaDir C:\aurora-ai\llama

# app-only update package -> AuroraUpdate-<ver>-PROTECTED.exe
# (no -PgZip/-ModelDir/-LlamaDir; same password prompt, same rules)
powershell -ExecutionPolicy Bypass -File .\installer\build-protected.ps1 -UpdateOnly
```

How the password is handled — and where it never goes:

- The script asks for it at a **masked prompt, twice**. It is never a
  command-line argument (nothing lands in PowerShell history or scrollback)
  and it is **never written to disk** — no ledger, no file, nothing to
  delete afterwards.
- It reaches the compiler through ISCC's process **environment**
  (`aurora.iss` reads `GetEnv` at preprocess time), set immediately before
  the compile and removed in a `finally` block. Honest limit: it exists in
  the build processes' memory while the compile runs (and the OS may page
  or crash-dump that memory like any other) — build on a machine you
  trust.
- The script **fails loudly** if the compile did not produce the
  `-PROTECTED` filename, so a build where the password silently failed to
  reach the compiler cannot masquerade as protected.
- Allowed form: 12–64 characters, letters, digits and dashes only — the
  exact charset this pipeline is verified with. 12 is the floor, not the
  target: a short memorable password is offline-guessable by anyone
  holding a leaked `.exe` (PBKDF2 slows that, it does not stop it), so
  use a long random one — the `XXXXX-XXXXX-XXXXX-XXXXX` shape the
  per-hospital generator produces (~98 bits) is the right size.

What the password does (real cryptography, not a patchable check): the whole
payload is **XChaCha20-encrypted** (built into Inno Setup since 6.4.0; the
key is PBKDF2-HMAC-SHA256-derived from the password). Without the password
the `.exe` cannot be installed and its **payload** (server binaries,
database engine, AI model, provisioning scripts) cannot be extracted.
Honest limit: the setup *metadata* (file names, install paths, wizard
messages and the compiled `[Code]` logic) is **not** encrypted and is
readable with standard Inno tools — a leaked installer reveals the
install's *layout*, never its *contents*.

Trade accepted with one company-wide password: a leak burns **every**
shipped installer at once, with no way to tell whose copy leaked. That is
acceptable precisely because the password never leaves the engineer — there
is no hospital-side copy to leak. If it is ever compromised: pick a new
password and rebuild; installers already run in the field are unaffected
(the password gates *installation*, not the running system). Be clear
about what rotation does **not** do: every `.exe` already shipped stays
openable with the old password forever — rotation protects future builds,
it does not retro-protect copies already in the wild.

`-SkipStage` reuses a payload staged earlier the same day.
**`-OutputDir E:\aurora-out`** writes the artifact (and its slices) to
another drive — the staged payload is ~6 GB and the AI build emits ~5.5 GB
more, so the build drive often cannot hold both. The script creates the
folder, passes ISCC's `/O` switch, verifies the `-PROTECTED` artifact
there, and lists every `.bin` slice it produced. The install
password is a **different secret from the backup encryption key**: the
install password belongs to the *vendor* (reissuable by rebuilding); the
backup key belongs to the *hospital*, held in three places (unrecoverable
if lost). Neither substitutes for the other.

---

## Dormant: per-hospital installers — `build-hospitals.ps1`

Kept working but **not the configured path** (owner's decision, 2026-07-25).
It builds one encrypted installer *per hospital*, each with its own random
password plus a ledger CSV to transcribe into per-hospital envelopes — the
right shape once there are too many hospitals to attend every install in
person, because a leak then burns one identifiable build instead of the
whole product. Same cryptography, same honest metadata limit as above.
Hospital ids `protected`/`unprotected` are refused (they are the other
paths' filename markers). See the script header for usage; nothing calls
it today.

The plain `build.ps1`/`build-all.ps1` path still works and stays unencrypted —
its output is named `-UNPROTECTED` and is for build-machine smoke tests only,
never for anything that leaves the vendor.

---

## If a step fails — most likely cause

| Symptom / where | Most likely cause & fix |
|---|---|
| `dotnet`/`node`/`npx` **"not recognized"** | Open a **fresh** terminal after installing (PATH), or use `-InstallPrereqs` which refreshes PATH in-session. |
| **".ps1 cannot be loaded… scripts disabled"** | Launch via `powershell -ExecutionPolicy Bypass -File …` (as shown) — no policy change needed. |
| **winget not found** (with `-InstallPrereqs`) | Install *App Installer* from the Microsoft Store, or install the four tools by hand (Manual toolchain below). |
| **Step 1** (npm/vite) errors | No internet, or Node older than 20. Check `node -v`. |
| **Step 2** "SDK not found" / publish fails | You have the .NET **runtime**, not the **SDK**. Install the .NET 8 **SDK**. First run needs internet (NuGet restore). |
| **Step 3** "-PgZip not found" / unzip error | Bad path, or you downloaded the Postgres **installer `.exe`** instead of the **binaries `.zip`**. |
| **Step 4** "-LlamaDir is missing llama-server.exe / nssm.exe" | Put **both** (plus the CUDA DLLs) in the `-LlamaDir` folder. *Missing CUDA DLLs don't fail the build* — they surface on the server as AuroraAI not starting, so double-check the DLLs. |
| **Step 5** "Inno Setup compiler not found" | Install Inno Setup **6**, or pass `-Iscc "…\ISCC.exe"`. |
| **Step 5** fails partway / "no space left" | Not enough disk for the 5 GB payload + compressed output + temp. Free ~20 GB. |
| Weird "path too long" / file-not-found deep in `payload\model` | Windows 260-char limit — build from a short path like `C:\aurora`. |

---

## Manual toolchain (if you'd rather not use `winget`)

Install these four, then open a **new** terminal, then run `build-all.ps1`
(or `build.ps1` directly):

| Tool | Where | Verify |
|---|---|---|
| **.NET 8 SDK** (the SDK, x64) | https://dotnet.microsoft.com/download/dotnet/8.0 | `dotnet --version` → `8.0.x` |
| **Node.js 20 LTS+** | https://nodejs.org | `node -v`, `npm -v` |
| **Inno Setup 6** | https://jrsoftware.org/isdl.php | `C:\Program Files (x86)\Inno Setup 6\ISCC.exe` exists |
| **Git for Windows** | https://git-scm.com/download/win | `git --version` |

`build-all.ps1` is just a wrapper around `build.ps1`; you can call `build.ps1`
directly with the same `-PgZip / -ModelDir / -LlamaDir / -Iscc` parameters if you
prefer (it skips the winget install + preflight).

---

## Then: the real-Windows verification

Your first successful build feeds straight into the second-machine checklist in
[`README.md`](./README.md) — run `AuroraSetup.exe`, then verify items 1–13
(services come up, **auto-start before login**, **restart on crash**, **AuroraAI**
answers, the GPU concurrency curve via **`llama-bench`**, the GPU-absent honest
path, `127.0.0.1`-only, uninstall) **plus the backup-restore drill**.
