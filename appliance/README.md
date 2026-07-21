# AURORA On-Premises Appliance — Phase 2 (the validator's testbed)

One command brings up the full AURORA HIS — API + frontend at one origin,
PostgreSQL persistence, and the local AI model — in the same topology a
hospital will run: **the server on the premises, devices on the network.**

> **⚠ DEMO BY DEFAULT (design §2.4).** A plain `./run.sh` **seeds demo
> data** — the clinical validator's testbed in the hospital *topology*.
> **Do not hand a hospital a demo build.** For a real deployment run the
> **production install** (below): `AURORA_MODE=production ./run.sh` boots
> with catalogues + configuration + one bootstrap administrator and **zero
> patients, zero demo credentials**. A turnkey *product* — a first-run UI
> wizard and backup tooling — is still Phase 3–4.

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
(never committed, never baked into an image) → **detects this machine's
timezone** into `TZ=` in `appliance/.env` (Aurora stores UTC and displays
the server's local time — a container defaults to UTC, so the host's IANA
zone is handed in; if detection fails the script says so and tells you the
exact line to add, e.g. `TZ=Asia/Baghdad` — it never guesses) → downloads
the **official** Qwen model into `appliance/models/` and **sha256-verifies
every byte** against the pinned upstream digests (for a fully offline
install, copy the two `.gguf` files there from install media first —
nothing is fetched) → detects the GPU → starts everything → prints the
URLs.

Open `http://localhost:8080` on the server, or `http://<server-ip>:8080`
from any device on the network — iPad included. Demo sign-in:
`sara.rahman / Aurora2026!` (demo data; see the warning above).

## Production install (a real hospital — no demo data)

A hospital deployment is a **production install**: run it once with

```bash
AURORA_MODE=production ./run.sh          # Linux / macOS
```
```powershell
$env:AURORA_MODE="production"; .\run.ps1   # Windows
```

The script collects the three install decisions the server refuses to boot
without and writes them to `appliance/.env`, so every later `./run.sh`
reboots the same way with no prompts:

- **Bootstrap admin password** (`ADMIN_BOOTSTRAP_PASSWORD`) — the first
  account (`admin`, a System Administrator). Entered hidden, cannot be the
  demo password, and you are **forced to change it at first login**. Every
  other account is created from the Users screen afterwards.
- **Formulary policy** (`FORMULARY_SEED`) — `starter` seeds a reference
  drug list **deactivated** (pharmacy reactivates each drug after review),
  or `empty` to build it from scratch.
- **Access URL** (`CORS_ORIGINS`) — the LAN address clinicians open (e.g.
  `http://192.168.1.50:8080`); the appliance is one origin, so this is
  belt-and-suspenders, but production refuses a missing or localhost value.

Then the server seeds **catalogues + configuration only** (beds, the lab and
imaging catalogues, every vocabulary, interaction rules, order sets) with
**zero patients** and **zero demo credentials**. The boot tripwires make the
shared demo password and demo config *structurally impossible* under
`APP_ENV=production` (T1/T2 — a refusing instance is a config error to fix,
never a silent degradation). An automated CI job (`production-seed` in
`ci.yml`) boots this exact mode on every change and asserts the clean slate.

> A data volume that already holds **demo** data cannot be served in
> production — T1 refuses the demo credential. Start from a clean volume:
> `docker compose down -v`, then run the production install.

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
(the EnvironmentGate refuses a mismatch, by design). The **production
install** above sets `APPLIANCE_ENV=production` (persisted in
`appliance/.env`) and moves bundle and server together. The production
bundle carries **no mock layer**, so the few screens whose domains are
still Stage-11 scope degrade honestly, and the seed contains no demo data
at all. The complete refusal inventory is recorded in 02_PROJECT_STATUS.md;
a turnkey first-run wizard and backup tooling are Phase 3+.

## Recorded hospital decisions (for later phases, not this one)

- Hospital OS: **Windows**. A GPU is bought if absent.
- **Physical and VM both supported** — the HIS runs fine on a VM; the AI
  needs a GPU it can reach. A GPU-less VM is a legitimate AI-less install.
- Administered by hospital IT; **fully isolated, no internet at all** —
  hence the bundled model and the no-Docker installer requirement above.
