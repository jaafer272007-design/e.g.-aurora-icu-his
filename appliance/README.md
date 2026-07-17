# AURORA On-Premises Appliance — Phase 2 (the validator's testbed)

One command brings up the full AURORA HIS — API + frontend at one origin,
PostgreSQL persistence, and the local AI model — in the same topology a
hospital will run: **the server on the premises, devices on the network.**

> **⚠ NOT HOSPITAL-READY (design §2.4).** This appliance **seeds demo
> data**. There is no first-run wizard, no production seed split, no
> backup — those are Phases 3–4. It is the clinical validator's testbed
> in the hospital *topology*, not a hospital *product*. **A hospital must
> not receive this build.**

## Target machine

Windows 11 Pro with an NVIDIA RTX 4060 (the validator's machine) and
[Docker Desktop](https://www.docker.com/products/docker-desktop/) with the
WSL2 backend. Linux/macOS work with `run.sh`.

> **Docker Desktop licensing (recorded decision):** Docker Desktop
> requires a **paid licence** at a hospital's organization size, and its
> activation **needs internet** — which a fully isolated hospital cannot
> do. Docker Compose is therefore the **validator's testbed only**;
> hospitals get a native Windows installer with no Docker (Phase 3+).

## Run it

```powershell
cd appliance
.\run.ps1        # Windows (PowerShell)
```
```bash
cd appliance
./run.sh         # Linux / macOS
```

The script: checks Docker → generates local secrets into `appliance/.env`
(never committed, never baked into an image) → downloads the **official**
Qwen model into `appliance/models/` and **sha256-verifies every byte**
against the pinned upstream digests (for a fully offline install, copy the
two `.gguf` files there from install media first — nothing is fetched) →
detects the GPU → starts everything → prints the URLs.

Open `http://localhost:8080` on the server, or `http://<server-ip>:8080`
from any device on the network — iPad included. Demo sign-in:
`sara.rahman / Aurora2026!` (demo data; see the warning above).

## The AI and the GPU (design §2.3 — warn and disable, never refuse)

| GPU | Behaviour |
|---|---|
| NVIDIA GPU visible to Docker | ✓ Full AI — llama.cpp `llama-server` (CUDA) serves the bundled Qwen 2.5 7B Instruct model |
| No GPU | ⚠ **AI disabled — everything else works.** The AI screen says exactly why: *"AI unavailable: no GPU on this server."* |

**The HIS never stops because of the AI.** A GPU-less machine (or VM) is a
legitimate AI-less install. *(This supersedes the earlier "refuse without
a GPU" lean — the correction was adopted from the design's second-opinion
review; recorded in 02_PROJECT_STATUS.md.)*

**The GPU requirement is real:** the grounded-query eval measured a cold
question at **60–63 s on a 4-vCPU CPU** (≈7–14 s warm). On the 4060 the
same call is expected in low single-digit seconds. CPU inference is for
testing only: `AURORA_AI=cpu ./run.sh` forces it, honestly slow, with
`AI_TIMEOUT_SECONDS` raised to 180 by default.

**Why llama-server and not Ollama (verified, not assumed):** the AI
provider requires an OpenAI-compatible `/chat/completions` that *enforces*
`tool_choice:"required"` — the model must emit a tool call, never prose.
llama.cpp `llama-server --jinja` was verified to grammar-enforce exactly
that (the #122 eval); Ollama's runner segfaulted reproducibly in the build
environment and its enforcement could not be verified, so it is not wired.
The model file is the same sha256-pinned official release either way.

## What's inside

| Service | Image | Persistence |
|---|---|---|
| `aurora` | built from `server/Dockerfile` — ASP.NET API + React build, one origin | — |
| `postgres` | `postgres:16-alpine` | named volume `aurora-pgdata` — **data survives restarts and updates; the hospital never installs Postgres** |
| `llama` | built from `appliance/llama/Dockerfile` (CUDA or CPU target) | model mounted read-only from `appliance/models/` |

The model ships **alongside as a file** (4.7 GB), never as a Docker image
layer — the package contains it either way, so the offline guarantee
holds, and the image stays small enough to rebuild and update freely.

## Environment flavor

`APPLIANCE_ENV` defaults to **staging**: demo seed, the staging banner,
and the staging bundle — bundle and server environment must always match
(the EnvironmentGate refuses a mismatch, by design). A **production**
flavor preview exists (`APPLIANCE_ENV=production` plus the extra env vars
the boot tripwires demand) and boots honestly — but the production bundle
carries **no mock layer**, so the screens whose domains are still
Stage-11 scope refuse with a full-screen overlay, and the seed contains
no demo data at all. The complete refusal inventory is recorded in
02_PROJECT_STATUS.md; Phase 3+ closes it.

## Recorded hospital decisions (for later phases, not this one)

- Hospital OS: **Windows**. A GPU is bought if absent.
- **Physical and VM both supported** — the HIS runs fine on a VM; the AI
  needs a GPU it can reach. A GPU-less VM is a legitimate AI-less install.
- Administered by hospital IT; **fully isolated, no internet at all** —
  hence the bundled model and the no-Docker installer requirement above.
