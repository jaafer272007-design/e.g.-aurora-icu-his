# LIVE DATA — multi-user freshness in Aurora ICU

Design record for the staleness work opened by the owner's question on
2026-08-03: *"Several clinicians use Aurora at once on different devices. If a
doctor admits a patient, does that appear on everyone else's screen
automatically, or must they refresh?"*

The verify-first answer was **no, and nothing said so**. This file records what
was found, what steps 1–2 built, and what steps 3–4 still require — including
the condition the owner set on step 3.

---

## 1. What was found (code-read, 2026-08-03)

There was **no realtime layer of any kind**: no WebSocket, SSE or SignalR
anywhere in `src/` or `server/`; no react-query/SWR; no focus or visibility
revalidation; and the only two `setInterval`s in the codebase
(`src/hooks/useClock.ts:25`, `src/lib/time.ts:342`) tick the displayed wall
clock and touch no network.

Every screen was **fetch-on-mount**, keyed on `[]` or `[patientId]`, with
`reload()`/`refresh` counters that fire only after **the same user's own write
in the same tab**. Navigation re-mounts and therefore re-reads (routes are
plain `<Routes>` elements), so the failure is not "stale until re-login" — it
is **stale while sitting still**, which is exactly the ward monitor and the
chart left open through a shift.

Two consequences were worse than they first appeared:

- The bed board's severity dots come from `useDerivedSeverities`, keyed on the
  **set** of patient ids. Because the bed list itself never re-read, the id set
  could never change, so the dots were computed **once at mount and never
  again** — and `critCount` / the Critical filter derive from that same frozen
  map, so a newly critical patient was absent from the Critical view rather
  than merely mis-coloured.
- The board's sidebar rendered the literal string **`Sync: live`** while
  nothing re-read at all.

## 2. Cost of the obvious fix (why steps are ordered this way)

`fetchPatientScores` (`src/hooks/usePatientScores.ts`) issues **five requests
per patient** — encounters, then labs + full-chart observations + encounter
observations + orders in parallel — and the boards fan that out per occupied
bed. A 20-bed unit already spends ~100 requests on a single board mount.
Polling that loop at 20 s would mean roughly 5 requests/second sustained
against an on-prem server, for a display nobody is touching.

That is the whole reason scoring must move server-side (step 3) **before**
scores can be live, and the reason steps 1–2 deliberately poll only the cheap
single-request list reads.

## 3. Step 1 — data age (BUILT, and permanent)

`<DataAge>` (`src/components/DataAge.tsx`) renders the age of what is on
screen, beside the wall clock via `AppHeader`'s `dataAge` slot (the bed board
places its own pair in the filter bar, next to the census count).

States, chosen so the chip never claims more than it can prove:

| Situation | Renders |
|---|---|
| polled, updating | `Live · 14:32` |
| polled, gone quiet (> `LIVE_STALL_MS`) | `Not updating · last 14:32` (amber) |
| not polled | `As of 14:32` + tooltip: does not refresh itself |
| could not be read at all | `Not read` |
| first load in flight | `loading…` |

No green: green is EARNED by a real clinical score (01 Design System), and a
freshness widget must not borrow that meaning.

**This stays after live refresh exists** (the owner's instruction). A push
channel can drop; a page that says "Live · 14:32" and then silently freezes is
the same failure in a new costume. The chip is what makes the difference
visible either way.

`Sync: live` is deleted. A checkable timestamp replaces an uncheckable
adjective.

## 4. Step 2 — polling the cheap list reads (BUILT)

`usePollTick` (`src/hooks/useLive.ts`) advances a counter every
`LIVE_POLL_MS` (20 s) **while the document is visible**, and once immediately
when a hidden document becomes visible again. A screen adds it to the
dependency array of the load effect it already has, which keeps every existing
loading sentinel, error path and honest-empty state untouched.

Polled: **bed census** (`getBeds` + unit summary), **doctor rounding worklist**
(+ pending orders, result inbox, action queues, consults), **nurse worklist**
(+ MAR rows, implementation queue, tasks, I/O), **alerts board**.

Not polled, by design: the per-patient score fan-out (§2), and the patient
screens (Mission Control, Orders, Observations, Labs & Imaging, Timeline),
which read on open and on the user's own writes and say so via `As of HH:MM`.

Pausing while hidden is not only politeness to the server — a dark ward monitor
has no reader, and browsers throttle background timers unpredictably. The half
that matters clinically is refreshing **on the way back**: the first thing a
returning clinician sees must not be the census from twenty minutes ago.

### Verified (rendered, deterministic clock)

Chromium + `page.clock`, dev server, demo data:

| Assertion | Result |
|---|---|
| polls while visible (+3 min → timestamp advances, stays `Live`) | PASS |
| **pauses while hidden** (+5 min hidden → timestamp frozen) | PASS |
| catches up immediately on return (no extra time advanced) | PASS |
| says "Not updating" once quiet past the stall threshold | PASS |
| correct chip kind on all 9 screens (4 polled / 5 unpolled) | 8/8 + nurse |

Two defects were caught by that verification and fixed: `Get-MissingEnvKeys`'s
sibling problem in `<DataAge>` — an unreadable source rendered `loading…`
forever, indistinguishable from a slow one — and Mission Control initially
basing its age on the score fetch, which read `Not read` whenever only the
observation domain was unreachable even though the rest of the chart had
loaded fine.

## 5. Step 3 — server-side severity (NOT BUILT; conditions recorded)

Moving NEWS2/SOFA computation to the server and returning severity on the
roster payload is the prerequisite for live scores: it turns the board's
N × 5 fan-out into one request.

🔴 **Condition set by the owner, 2026-08-03: the ported engine must be
re-validated VALUE-FOR-VALUE against the current client engine before it is
trusted.** The scoring engine is under the score-lock discipline recorded with
PR #154 (engine files byte-identical; `usePatientScores` /
`useDerivedSeverities` exist so the card, tiles, twin, pill and dot can never
disagree). A port is therefore **not** a code move:

- every score must be compared against the current TypeScript engine on the
  same inputs, across real charts, not spot-checked;
- the input SCOPES must be preserved exactly — NEWS2 reads the FULL chart,
  SOFA reads the OPEN encounter's chart when one exists (else the full chart)
  plus labs / orders / encounter weight;
- the ND-aware and band-gated behaviour, and the no-reassuring-default rule
  ("green is earned or absent"), must hold identically;
- until the comparison passes, the client engine remains the authority.

## 6. Step 4 — push (NOT BUILT)

SSE (`text/event-stream`) or SignalR: the server broadcasts "encounter changed
/ observation charted for patient X" and clients invalidate. Needs JWT auth on
the stream, reconnect/backoff, and — per §3 — an honest degraded state when the
stream drops, which is precisely what `<DataAge>` already provides.

## 7. Still true after steps 1–2

- Scores on the boards recompute when a patient JOINS or LEAVES the list (the
  id set changes, and the list now re-reads, so an admission does re-score the
  board) — but **not** when a new observation is charted for a patient already
  on it. The boards show a separate `Scores as of HH:MM` for exactly this.
- The patient screens do not follow the ward at all; they say so.
- No multi-device test against a live server has been run. The behaviour above
  was verified with a deterministic clock against demo data in one browser.
