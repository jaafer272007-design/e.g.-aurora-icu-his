# Building `AuroraSetup.exe` on a Windows laptop

This produces the single `AuroraSetup.exe` a hospital double-clicks. You build it
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
[build-all] DONE  ->  C:\aurora\installer\Output\AuroraSetup-1.0.0.exe   (5.1 GB)
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

- **Path:** `installer\Output\AuroraSetup-1.0.0.exe`
- **Size:** **~5–5.5 GB** with the model (the 4.7 GB GGUF is already compressed,
  so it dominates and barely shrinks), or **~150 MB** for the no-AI build.

Copy that one `.exe` to the hospital server and double-click it.

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
