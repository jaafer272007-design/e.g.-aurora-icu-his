# AI Assistant — running a real local model (dev / commissioning guide)

The grounded query chat (01 § "AI Assistant — grounded query architecture")
needs a translation model. Production is **on-premises per hospital** — the
model runs locally and patient data never leaves the building; staging
(Render) deliberately has **no model** (`AI_PROVIDER=none` → an honest 503).
This guide stands a real model up behind the EXISTING provider adapter —
nothing in Aurora changes per model, and the model never gains a voice:
its entire output is one structured tool call.

## The adapter contract (what any runtime must speak)

`server/Core/Ai/AiApi.cs` sends an **OpenAI-compatible**
`POST {AI_ENDPOINT}/chat/completions` with `tools`, `tool_choice:"required"`
and `temperature: 0`, and reads
`choices[0].message.tool_calls[0].function.{name,arguments}`. Any runtime
that honors that shape plugs in via environment only:

```
AI_PROVIDER=openai
AI_ENDPOINT=<runtime base URL ending in /v1>
AI_MODEL=<model name the runtime expects>
AI_API_KEY=<only if the runtime requires one — local ones usually don't>
AI_TIMEOUT_SECONDS=<default 60; RAISE ON CPU-ONLY HOSTS — the measured
  cold first call of the full tool catalog was 60–63 s on a 4-vCPU box
  (exactly astride the default), warm calls ~5–15 s with prefix caching>
```

- **`tool_choice:"required"` is load-bearing.** A runtime that ignores it
  may let the model answer in prose; the adapter then finds no
  `tool_calls` and fails as a 502 provider error — honest (nothing
  invented, nothing executed) but useless. Prefer runtimes that
  grammar-enforce the tool call.
- **llama.cpp `llama-server`** enforces `tool_choice:"required"` when
  started with `--jinja` — **VERIFIED with the real Qwen2.5-7B-Instruct
  Q4_K_M GGUF** (2026-07-17 eval run: every response was a structured
  tool call, `finish_reason: tool_calls`, zero prose). An earlier probe
  with a synthetic model and the BASE-qwen2 test tokenizer did not
  constrain output (the instruct `<tool_call>` special tokens were
  absent) — that combination is not representative; use instruct GGUFs.
  Either way a prose answer surfaces as an honest 502, never as data:
  ```
  llama-server -m Qwen2.5-7B-Instruct-Q4_K_M.gguf --jinja -c 8192 --port 12434
  # then: AI_ENDPOINT=http://localhost:12434/v1  AI_MODEL=anything (single-model server)
  ```
- **Ollama** is the low-friction option on a dev machine (the validator's
  RTX 4060 fits Qwen 2.5 7B Q4 in its 8 GB VRAM):
  ```
  ollama pull qwen2.5:7b-instruct
  # Ollama serves OpenAI-compatible /v1 on :11434
  # AI_ENDPOINT=http://localhost:11434/v1  AI_MODEL=qwen2.5:7b-instruct
  ```
  Caveat (verify on first run): Ollama's OpenAI compatibility has
  historically accepted `tools` but not *enforced* `tool_choice` — with
  temperature 0 and this feature's system prompt Qwen 2.5 reliably calls
  tools anyway, but a prose answer surfaces as a 502, never as invented
  data. If 502s appear, switch to llama-server above.

  *[Appliance note, 2026-07-17 (Phase 2 — supersedes the `ollama pull`
  suggestion FOR THE APPLIANCE): the packaged appliance wires
  llama-server, not Ollama. The enforcement caveat above could not be
  cleared: in the Phase 2 build environment Ollama 0.32's embedded
  runner segfaulted reproducibly loading this exact model (full
  AVX-512 CPU, 14 GB free — the same box where source-built
  llama-server ran the entire eval), so `tool_choice` enforcement
  remained unverifiable there. The appliance ships the verified
  runtime (`appliance/llama/Dockerfile`, pinned to the eval's
  llama.cpp commit). Ollama stays a legitimate MANUAL dev option on
  real hardware — verify it with `scripts/ai-translation-eval.mjs`
  before relying on it.]*

## Model recommendation

**Qwen 2.5 7B Instruct, Q4_K_M** (per the AI design §5): strong structured
output at 7B, ~4.7 GB quantized — fits an 8 GB GPU and a 16 GB-RAM
CPU-only host. Pull it from an official source only (Ollama registry,
`Qwen/Qwen2.5-7B-Instruct-GGUF` on Hugging Face, or Docker Hub's `ai/qwen2.5:7B-Q4_K_M`
OCI artifact) — never a third-party re-upload; verify the digest.

## Exercising it (translation quality)

With Aurora's server running against the model:

```
node scripts/ai-translation-eval.mjs            # defaults to http://localhost:8080
```

The question set (`scripts/ai-translation-questions.json`) carries the
validator's real questions, ambiguous/out-of-scope cases, and the
MUST-REFUSE block (write attempts + injections). The harness prints an
honest per-question table + latency stats and exits non-zero only when a
MUST-REFUSE case translated to a tool. It is an **evaluation for the
clinical validator, not a CI gate** — staging has no model, so this runs
wherever one exists: a dev machine, or the hospital server during
commissioning (record the results with the install).

## Hardware

- **Hospital servers: UNKNOWN** (recorded flag). The dev testbed is an
  RTX 4060 (8 GB) + i7 + 16 GB RAM; hospital procurement must not assume
  a GPU until someone answers this.
- CPU-only sizing guidance and measured latencies live in the 02 record
  for this work item — measure on the real hardware with the harness
  before buying anything.
