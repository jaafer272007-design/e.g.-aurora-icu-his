# 03_DEVELOPMENT_RULES — Aurora HIS: the working discipline

*[Docs split note (2026-07-10): unmarked lines were moved verbatim from the
pre-split CLAUDE.md. Lines styled like this one, and the bullets explicitly
marked as codified-from-practice or standing practice, are organizational —
each cites where the underlying claim is recorded.]*

## Build Methodology (follow in order, do not skip)
1. UI only, dummy data, HTML/CSS/JS first (already done for screens 1–3 —
   see /reference, treat as the exact visual spec, do not redesign).
2. Convert to a real Vite + React + TypeScript project. Extract shared
   tokens/components once — never re-derive per screen.
3. Review each screen against: UX, ease of use for doctor/nurse, fit with
   real ICU workflow, API-readiness, performance/code organization.
4. Only after a screen is approved, move to the next one in the roadmap.
5. Mock data adapters must be shaped exactly like a future real API response
   (field names, nesting) so swapping in ASP.NET Core endpoints later is a
   data-layer change only, never a UI rewrite.
6. No real API, no auth, no backend until Stage 9 below.

## Branching & pull requests

- One work item per branch, one branch per PR — every new screen or fix-set
  starts from a fresh branch off the latest main with its own PR; never
  continue new work on a branch that already has an open PR (the locked
  Branching decision — verbatim in 01_ARCHITECTURE.md § Locked Decisions).
- *[Standing practice, per project owner: Claude Code opens every PR as a
  DRAFT and never merges — the project owner reviews and merges.]*

## Documentation discipline

- *[Codified from existing practice (the pre-split file's own "SUPERSEDED
  by …" notes are the pattern): supersede, don't rewrite — a corrected or
  replaced claim keeps its original text with a note naming what superseded
  it; records are never silently rewritten or deleted. Doc-vs-code
  contradictions found while editing docs are flagged for the project
  owner, never silently "fixed".]*
- Seed files under `server/Data/` are GENERATED from the mock stores —
  never hand-edit them (stated on every seeded domain's record in
  02_PROJECT_STATUS.md).
- **02_PROJECT_STATUS.md is updated AS PART OF completing each
  significant piece of work** (a feature, a fix-set, a verification
  round) — the status record rides the same PR, or an immediate
  follow-up docs PR when the verification happens post-merge — so the
  file never drifts from the live state. Completing work without
  recording it is incomplete work. *(Codified 2026-07-11 per project
  owner; the "Last updated / current through" marker at the top of 02
  is refreshed with each such update.)*
- *[Recorded 2026-08-19 per the project owner (the 02 marker drift flagged in
  the Hospital Shell design PR, #214): **POSITION WITHIN 02's BODY IS NOT A
  RELIABLE RECENCY SIGNAL — the recency index is the marker at the VERY TOP of
  the file plus the dated record headers.** Records are prepended at the top,
  but historical "Last updated" strata remain embedded mid-file where the top
  once was; a "Last updated" line found anywhere below the top is a stratum,
  not the file's state. Every handover in this project says "the newest marker
  is at the top" and the owner has already inherited a month-stale snapshot
  from a mid-file marker read as current — 02's ordering is load-bearing, which
  is why this is a stated convention rather than a formatting nit. Two binding
  consequences: the TOP marker (and only it) is refreshed with each update per
  the rule above; and drift is never "fixed" by reordering the file — an
  11,000-line reshuffle destroys readability and blame for no gain, and a
  superseded-in-place note on the stale line is the honest repair.]*

## 🔴 A design is recorded before it is built — no versioned source, no build (added 2026-08-17)

**CODIFIED RULE — a design document is committed VERBATIM to `docs/design/`
BEFORE implementation starts, and a build whose design has no versioned source
does not begin.** Verbatim means as received from the clinical/operational
source: no reformatting, no heading changes, no tidying, no "while I'm here"
edits. It lands in its own commit, alone.

**This was already the practice for 20 design files** — the observation model,
SOFA, NEWS2, the MAR schedule, the print templates and fifteen more — and
02_PROJECT_STATUS.md describes it about thirty times, in those words:
"recorded verbatim", "committed verbatim", "transcribed verbatim from the
clinical source".

**And it still did not hold, because it lived only in the record.** 02 is the
CHANGING RECORD: it documents what was done, design by design, after the fact.
Nothing in THIS file — the working discipline, the one consulted to know what
must happen — required it, and CLAUDE.md's documentation map does not mention
`docs/design/` at all. Twenty precedents in a status log do not stop the
twenty-first build; a rule does. So when the **Inpatient Reception** design was
never committed, nothing objected, and the Ward module's step 3 stood one step
from being built out of a chat log. **A practice evidenced thirty times and
required zero times is a habit, not a discipline** — that gap is the general
lesson, and it is why this rule is here rather than in 02 with the others.

Why it matters, stated as the failures it prevents:

- **A design that exists only in a conversation cannot be diffed, cited, or
  superseded.** The supersede-don't-rewrite rule above has nothing to operate
  on — there is no original text to keep. Every later decision silently BECOMES
  the design, and no reader can separate what a clinician approved from what
  was assumed on their behalf.
- **It cannot be verified against.** "Built per the design" is unfalsifiable
  when the design is not a file. This is the CI-evidence rule applied to
  specifications: a claim nobody can check is not evidence.
- **Reconstruction is worse than absence.** A design rebuilt from memory, from
  a conversation, or from the code meant to implement it is a FABRICATED RECORD
  in the one folder whose whole convention is that its contents came verbatim
  from a clinical source. It would be indistinguishable from a real one, and
  the physician whose name is on it never saw it. **If the source cannot be
  found, stop and ask for it. Never rebuild it.**

Binding consequences:

- **Provenance is stated exactly as strong as it is, and no stronger.** Say
  where the copy came from and what was actually verified about it. If it could
  not be diffed against a source file, say that — never let "verbatim" imply a
  comparison that did not happen. Publishing a hash and a byte count lets
  someone else make the stronger claim later.
- **Later decisions are APPENDED, never merged into the approved text.** An
  `Amendments` section that quotes each item it resolves, so the diff is a pure
  append and the approved document stays byte-identical — provable by hashing
  the original's byte range and by `0` deletions in the diff.
  `docs/design/inpatient-reception.md` is the worked example.
- **Open items stay open where they were written.** Resolving one edits the
  amendment, not the item.
## CI evidence — skipped ≠ passed (codified rule)

*[Docs split note: moved verbatim from the "CI Evidence" section, whose
incident and audit record stay in 02_PROJECT_STATUS.md.]*

**CODIFIED RULE — a skipped check and a passed check are visually
identical.** A run whose gated jobs are skipped still concludes SUCCESS
and shows green on the commit. Green CI is NOT evidence unless the job
carrying the assertions actually EXECUTED — before treating any check as
evidence (in review, in a verification report, in "CI is green"), open
the run and confirm the asserting job ran and reached its assertion
steps. The same rule covers local commands (a command that can exit 0
without evaluating anything is not a check) and two corollaries:
ABSENCE of a check is equally silent (manual-dispatch suites produce
evidence only when someone dispatches them), and an assertion whose
failure is swallowed by its surrounding construct (`cmd && echo` lists,
`read VAR <<<"$(…assert…)"`) gated nothing.

## 🔴 A check that never ran reads as a check that passed — look at WHICH workflow answered (added 2026-08-17)

The twin of the rule above, and the sharper one, because the existing rule
assumes a run happened at all.

**`ci.yml` triggers on `pull_request` and on pushes to `main` — and nothing
else.** A commit pushed to a feature branch *before its PR exists* is therefore
evaluated by **nothing**. The branch still shows activity: other workflows
(Pages `deploy`, `check`) do fire on the push and report **success**. Query
"the latest run on this branch" without scoping it to `ci.yml` and a green
comes back that was never about the change.

**CODIFIED RULE — a green is only evidence if you can name the workflow, the
job and the commit sha that produced it.** "The branch is green" is not a
claim; "`ci.yml`'s `server` job passed on `<sha>`" is.

**THE STAKES INVERT WHEN THE PROOF IS A RED RUN.** This is why it needs its own
rule rather than a footnote. A gate demonstrated by deliberately breaking it —
the discipline this file already requires — depends on seeing the failure. If
the run never happened, the absence of a failure is indistinguishable from the
defect being impossible, and the conclusion drawn is the exact opposite of the
truth: **a red that never ran reads as a green.** Found 2026-08-17 while proving
the generic vocabulary mapper (#197): the deliberate wrong-`DbSet` commit was
pushed with no PR open, `ci.yml` did not run, an unrelated workflow reported
success, and that success was very nearly read as "the compile-time guarantee
holds". Opening the PR is what made CI evaluate the commit; it then failed with
the expected `CS0029`. The proof was intact only because the run was checked
per-workflow rather than per-branch.

## 🔴 A status code is not evidence when the failure under test shares it with an unrelated failure — assert the MESSAGE (added 2026-08-19)

The third member of the CI-evidence family. The two rules above ask whether the
check RAN and whether it ran on the RIGHT COMMIT. This one asks the next
question: **it ran, it was red-then-green, and it still may not have touched the
thing under test.**

**CODIFIED RULE — when a leg asserts a non-2xx, assert the `{error}` MESSAGE, not
only the status code.** A code-only assertion is evidence exactly when that code
has one possible cause on that endpoint. It almost never does.

**THIS IS STRUCTURAL, NOT AN EDGE CASE.** It follows directly from the four-code
rule in `01`, which is deliberately a COMPRESSION: every "the resource exists but
its current state forbids this" collapses into one 409, and every "malformed, or
can never succeed against this resource" collapses into one 400. That
compression is right — it is what makes error handling uniform across the API —
but the same property that makes four codes easy to consume makes them
**lossy as assertions**. The information distinguishing one refusal from another
survives only in the `{error}` string, which is why the four-code rule requires
every non-2xx to carry a precise one. A suite that asserts the code and discards
the message is throwing away the only discriminating half. **This applies to
every 409 and 400 assertion in every suite**, not to the examples below.

*(The generic 403 is the deliberate exception and needs no message assertion —
it explains nothing by design. But note the second worked example: 403 is
precisely the code that lets a leg pass without ever reaching the code under
test.)*

### Three worked examples, all from one PR (the bedless-transfer refusal, 2026-08-19)

**1 · Two different refusals, one code.** `/adt/encounters/{id}/transfer` returns
**409** for a bedless encounter (`AdtApi.cs:1361`, the guard under test) and
**409** for a target bed that is already occupied (`AdtApi.cs:1376`, unrelated and
pre-existing). A leg asserting only `= "409"` therefore **passes identically
whether or not the guard it was written to prove exists at all** — and the trap
is live, because the natural bed to reuse in that job is already occupied by an
earlier leg. The assertion must grep `"nothing to transfer from"`.

**2 · A 403 that never reaches the code under test.** `adt.transfer` is held by
**exactly one profile — Nurse** (`Rbac.cs:161`; it appears once in the file).
`production-seed` already mints a Consultant (`SeniorDoctor`) and an office
Administrator, and **neither holds it**. A leg written with either token gets
403 at the RBAC line, never reaches the guard, and — if it asserted only
"non-2xx", or asserted 409 and was then "fixed" to match the 403 it observed —
goes green having tested the permission system instead of the bug. The leg must
mint an account of the profile that can actually reach the code.

**3 · A die message that cannot distinguish its own causes.** The first version
of that leg used
`curl -sf … || die "could not create the CI nurse"`. It failed in CI and printed
exactly that: **true, useless, and indistinguishable from a bad payload, a
duplicate username, a missing justification, or the 401 it actually was** —
caused by using `$TOKEN` where that job's admin session is `$ADM`. `curl -sf`
discards the status and the body, so the leg destroyed the evidence of its own
failure.

### The reporting half

**A failure message that cannot distinguish its own causes costs more than the
bug it reports.** The bug is one fix; the message is paid again by every person
who hits it and has to bisect to learn what the log should have said.

**PRACTICE, binding on every assertion leg:**
- assert the **message** alongside the code for every 409 and 400
- prefer a substring unique to the guard under test, not one shared with its
  neighbours ("when a bed is named", "nothing to transfer from")
- **`die` prints the HTTP code AND the body.** Never `curl -sf … || die "<prose>"`
  — capture with `-w '\n%{http_code}'` and print both halves
- before writing a leg, ask **which other causes return this same code on this
  endpoint** — if the answer is "one or more", the code alone cannot be the
  assertion
- and ask **can the actor this leg uses actually reach the code under test** — a
  403 is a green-looking way of testing nothing

## 🔴 ACCEPTORS NARROW, GUARDS WIDE — the direction of a validation pattern is decided by what its match GATES (added 2026-08-19, owner's ruling)

**CODIFIED RULE — before changing what a validation pattern matches, name the
branch its match feeds. A pattern whose match gates ACCEPTANCE is kept as
narrow as the system can honour (`[0-9]`, exact codes, closed lists). A
pattern whose match gates a REFUSAL is kept as wide as what a human could
read as the refused thing (`\d`, look-alikes included). Widening an acceptor
admits what the system cannot handle; narrowing a guard admits what the guard
exists to refuse. The same edit is a fix on one side and a hole on the other.**

This is general — it applies to every validation pattern in the codebase, not
to the two sites that taught it. It earned its place by producing two
OPPOSITE changes in one sweep (the `\d` class fix, 2026-08-19), and a future
mechanical sweep would have broken a safety guard precisely because the rule
was not written down:

**Worked example 1 — an acceptor, narrowed.** The identity-correction MRN gate
(`AdtApi.cs`) matched a typed MRN against `^MRN-\d{6}$` and its match gated
ACCEPTANCE — a matching value was stored. .NET's `\d` is Unicode-wide, so
`MRN-٠٠٠١٢٣` was accepted: an MRN the generator never produces, MRN search
(exact ASCII `==`) never finds, and the uniqueness guard never collides with.
The acceptor is now `[0-9]{6}` — the system only accepts what every consumer
of the value can honour.

**Worked example 2 — a guard, kept wide.** The named-frequency create's q<n>h
collision guard (`VocabApi.cs`) matches a proposed vocabulary value against
`^q\d+h$` and its match gates a REFUSAL — a matching value is rejected
because MAR derives dose schedules by parsing q<n>h structurally, and a NAMED
'q6h' would shadow the built-in meaning. `\d` stays, deliberately: `q٦h`
reads as q6h to the humans the guard protects while deriving no schedule, so
the guard must refuse everything a human could read as structural, not only
what the parser accepts. Its acceptor twin (`FormularyLogic.
IsStructuredFrequency`, `[0-9]{1,2}`) is NARROWER than the guard — the
asymmetry is the point, and the paired comments at both sites say so: do not
unify them.

**The test the rule compresses to:** ask "if this pattern matches MORE, who
wins — the user or the defect?" On an acceptor, the defect wins (bad data
gets in). On a guard, the user wins (more look-alikes get refused). Then ask
the same question for matching LESS, and check the answer inverts. If it does
not invert, the pattern is doing two jobs and should be split before it is
edited.

## 🔴 Closing one instance of a defect class is not closing the class (added 2026-08-17)

**CODIFIED RULE — before declaring a class of defect closed, enumerate the ways
IN and say which ones the fix covers.** A fix that removes the route you
happened to find, while another route to the identical outcome stays open, is a
fix — but calling it a closed class converts a known hole into an unknown one,
because nobody looks again at something recorded as solved.

**Worked example — #195, declared closed, was not.** `VocabApi.MapVocab`'s
create path switched on a tenant string and ended `_ => db.Shifts.Add(...)`, so
a vocabulary registered without editing that switch silently wrote `ShiftRow`s:
wrong table, HTTP 200, nothing thrown. #195 made the row factory a REQUIRED
parameter, so **omission** became a compile error, added a static gate proven
against the real historical line, and recorded the class as shut.

It was not. The factory returned `Func<object>` and the row types shared no
interface, so a **copy-pasted** factory naming another tenant's `DbSet`
compiled cleanly and produced the identical wrong-table write. Two routes to
one outcome; one was closed and the class was declared closed. The owner asked
the question that surfaced it — *does the return type let a copy-paste return
the wrong row type and still compile?* — and the answer was yes. #197 closes it
by construction (`MapVocab<TRow>` owns the insert; the caller supplies a `DbSet`
selector, never an `Add`), proven by a deliberate wrong-`DbSet` commit failing
to compile in CI before the fix commit made it green.

The enumeration that should have accompanied #195: a tenant may reach the wrong
table by (1) omitting the factory, (2) supplying a factory for another tenant,
(3) supplying the right factory with the wrong `DbSet`, (4) registering without
pinning the row type so inference silently accepts a mismatched `DbSet`. #195
closed (1). #197 closes (2), (3) and (4) — (4) via the registration gate, since
an omitted `<TRow>` lets C# infer the type from whatever `DbSet` was pasted in
and the mismatch disappears.

## Test on the engine that ships (added 2026-08-01)

**CODIFIED RULE — a test that passes on a different runtime than the one
customers run has tested nothing.** `installer/aurora-update.ps1` shipped
with PowerShell 7 ternary syntax (`$a ? $b : $c`). Its pure functions were
unit-tested on Linux under pwsh 7, where they passed. But `aurora.iss` and
`aurora-update.iss` launch their scripts with **`powershell.exe`** — Windows
PowerShell 5.1 on every hospital server — and 5.1 rejects that syntax at
**parse** time, which kills the whole file at load before a single statement
executes. Every hospital update would have failed. Nothing caught it because
CI ran no PowerShell at all and the tests ran on the wrong engine.

Consequences, binding:

- **No PowerShell 7-only syntax anywhere in `installer/*.ps1`** — no `? :`
  ternary, no `??` / `??=`, no `?.` / `?[]`. Write `if`/`else`.
- The `installer-powershell` CI job (windows-latest, `shell: powershell`)
  parses **every** installer script with the real 5.1 engine and runs
  `installer/test-update-pure.ps1` there. It asserts `PSVersion.Major -eq 5`
  first, because a gate that silently ran pwsh 7 would be indistinguishable
  from a gate that passed — the CI-evidence rule applied to the runtime
  itself.
- Generalise beyond PowerShell: when a script's production interpreter,
  shell, or runtime version differs from the one used in testing, the
  difference is the risk, and the test must move to the shipping engine.

### Amendment, 2026-08-05 — parsing is not running

The rule above was written from a **parse**-time defect and its gate was
built to match. That gate is necessary and not sufficient, and a second
defect of the same family proved it: `installer/build.ps1` used
`[IO.Path]::GetRelativePath`, which is **.NET Core 2.1+ only**. Windows
PowerShell 5.1 runs on .NET Framework, where that method does not exist — so
the line **parses** perfectly and throws `MethodNotFound` when it executes.
It broke `build-protected.ps1 -UpdateOnly` outright at step 3u (SHA256SUMS)
on a real 5.1 build box, after the React bundle, the server publish and
`version.json` had all succeeded. Every gate in CI was green.

Two things follow, both binding:

- **The 5.1 incompatibility surface is bigger than syntax.** It includes
  every .NET API added after .NET Framework 4.8 (`[IO.Path]::GetRelativePath`
  and `::Join`, `[Convert]::ToHexString`, `[Environment]::ProcessPath`,
  `[Random]::Shared`, `[TimeZoneInfo]::TryConvertWindowsIdToIanaId`, the
  `System.Text.Json` namespace, .NET-Core-only overloads of otherwise-old
  methods) and every PowerShell 6/7-only cmdlet or parameter
  (`ForEach-Object -Parallel`, `ConvertFrom-Json -AsHashtable`, `Test-Json`,
  `Join-String`, `-Encoding utf8NoBOM`, `Get-Content -AsByteStream`, …).
  None of these are visible to a parser. When a newer API is genuinely
  wanted, feature-detect it and degrade honestly — `appliance/run.ps1`'s
  `TryConvertWindowsIdToIanaId` reflection probe, which warns with the exact
  line to add instead of guessing a timezone, is the pattern to copy.
- **CI must EXECUTE the shipping scripts on 5.1, not merely parse them.**
  The `installer-powershell` job now runs the real update-package staging
  (`build.ps1 -UpdateOnly -SkipCompile` — npm ci, vite build, `dotnet
  publish`, `version.json`, `SHA256SUMS`) on windows-latest under 5.1, then
  replays `aurora-update.ps1`'s own verification loop against the result, so
  a package that would not verify on a hospital server fails the build.
  There is deliberately **no test-only branch** in `build.ps1`: a gate that
  runs a different code path than the shipping one is the very thing this
  rule exists to forbid.

Stated boundary, so the coverage is not overclaimed: the runtime gate covers
build.ps1's **update** path. The full-installer steps (Postgres, model and
llama staging) need multi-GB inputs CI has no copy of, and the ISCC compile
needs Inno Setup plus the company password. Those remain proven only by an
engineer running a real build.

### Amendment, 2026-08-05 (second) — a hidden console must never wait on stdin

The first field run of `aurora-update.ps1` hung forever and the installer
window could not be closed. Root cause, from the owner's own reproduction:

```
& $psql $dbUrl -tAc 'SELECT "MigrationId" FROM "__EFMigrationsHistory" ...'
```

psql's Windows `getopt` **does not permute** — the first non-option argument
ends option parsing. With the connection URI first, `-tAc` and the SQL became
*positional* arguments, psql printed `extra command-line argument ... ignored`,
never saw a `-c`, and opened an **interactive session**. `aurora-update.iss`
runs the script via `Exec(..., SW_HIDE)`, so the `aurora=>` prompt was
invisible and unanswerable: psql waited on stdin, PowerShell waited on psql,
Inno waited on PowerShell. (Second, independent bug in the same line: Windows
PowerShell strips embedded double quotes when building a native command line,
so `"MigrationId"` arrived unquoted — and Postgres folds unquoted identifiers
to lower case while EF created the table case-sensitively.)

Binding consequences:

- **Any child process launched with a hidden console must be incapable of
  blocking on stdin.** For psql that means `-w` / `--no-password` on every
  invocation — it then *fails* instead of waiting. CI asserts this on every
  psql call in `installer/*.ps1`, and the check refuses to pass vacuously if it
  finds none. The same reasoning applies to any future tool that can prompt.
- **Pass options before positionals, and prefer `-d`/`-f` over positional
  arguments and inline SQL.** `aurora-provision.ps1:388` always did this
  correctly; the updater is what drifted. SQL containing quoted identifiers
  goes in a **file**, which no argument parser can corrupt.
- **An operator message must never assert an outcome the code cannot vouch
  for.** Every failure used to exit 1, and the installer reported *"rolled back
  to the previous version, it is running normally"* — for refusals where
  nothing had happened, and for a swap failure that leaves the service stopped.
  Exit codes are now one-meaning-each (0 applied · 1 refused, untouched ·
  2 between states · 3 rolled back and healthy), and an unrecognised code says
  the outcome is **unknown** rather than claiming catastrophe, because a false
  catastrophe drives someone to restore a database that was never touched.
- **An update must never ask where the product is installed.** The wizard's
  directory page is gone; `aurora-update.ps1` resolves the install directory
  from the registered `AuroraServer` service, with `-InstallDir` only as
  fallback and explicit override.

### 🔴 Amendment (2026-08-06) — both rules above shipped INERT. A rule the code does not execute is not a rule.

The first field run of the fixed updater failed, and the log showed **neither
rule had ever taken effect**. Three defects, all in the failure path, all
invisible to every existing test:

1. `$ErrorActionPreference = 'Stop'` makes a bare `Write-Error` a **terminating**
   error, so the `exit N` after it in `Fail` / `FailBetweenStates` /
   `FailRolledBack` never ran. Every failure exited **1**. Codes 2 and 3 were
   unreachable, so the wizard showed the *most reassuring* text — "NOT applied …
   Nothing needs to be recovered" — for a swap that died with the service down.
2. Worse in the other direction: `FailRolledBack` is called from **inside** the
   rollback `try{}`, so its terminating error hit that block's `catch{}` and a
   **successful** rollback reported *"CRITICAL: the automatic rollback could not
   complete"* (exit 2) — driving an operator toward a database restore on a
   healthy system. Exactly the false catastrophe the rule above forbids.
3. `aurora-update.iss` always passed `-InstallDir`, which the script read as a
   supervised override, so the service lookup was **dead code in the only path
   that ships**. Any install not at `C:\Aurora` was refused, and `update.log`
   was written into the guessed directory.

**The lesson is about the shape of the test, not the bugs.** `test-update-pure.ps1`
dot-sources and calls functions in-process: it can never observe an exit code, and
the helpers sat below its early-return boundary so it could not even see them. A
guard whose only caller always defeats it, and an exit code that never executes,
are both **runtime-only** facts that parse cleanly and review cleanly.

**CODIFIED RULE — an exit code that the operator's message depends on must be
asserted by running the real code in a real process.** `installer/test-update-exitcodes.ps1`
spawns child processes, invokes the **real** definitions, and asserts the **real**
process exit code, including the `FailRolledBack`-inside-`try{}` shape. It also
asserts the `.iss` ↔ `.ps1` argument contract, because defect 3 lived in the gap
*between* two files that each looked correct alone. The suite was verified to FAIL
against the pre-fix code before being trusted — with the exit-code fix reverted in
isolation it reports `expected 2, got 1` and `expected 3, got 99`, so its teeth are
measured rather than asserted.

**And then the 5.1 leg immediately earned its keep, on the test itself.** The new
suite passed 13/13 on pwsh 7 locally and died on its *first* assertion on
`windows-latest`. Windows PowerShell 5.1 turns a **native command's stderr** into
a `NativeCommandError` record, which under `EAP='Stop'` is **terminating** — and
`2>$null` does not help, because the preference fires before the redirection can
discard it. PowerShell 7 does not do this at all. The same quirk was then found
**in the product**: the rollback's `& $pkgExe restore …` had no stderr
redirection, and `pg_restore` is chatty on stderr by design — one such line would
have thrown from inside the rollback `try{}` and been reported by its `catch{}`
as *"CRITICAL: the automatic rollback could not complete"*, on a restore that
succeeded.

**CODIFIED RULE — under `$ErrorActionPreference = 'Stop'`, every native command
call must sit inside a `try{}catch{}` that absorbs the throw, or have the
preference explicitly relaxed around it.** Its exit code, not its chatter,
decides whether it failed — captured immediately, because anything between the
call and the test can overwrite `$LASTEXITCODE`.

**Redirection is NOT the mitigation.** `2>&1`, `2>$null` and `2>file` are the
same mechanism and none of them prevents the terminating error; this repo has
measured that twice on real installs (`aurora-provision.ps1:544-547`,
`aurora-ai-service.ps1:87-89`) and closed both by relaxing the preference. The
first draft of *this very fix* used a bare `2>&1` and a lint that accepted it —
which would have **certified the unfixed rollback restore as safe**. An
adversarial audit caught it by noticing the repo contradicted itself in three
places and that only the redirection claim carried no measurement. A false green
is worse than a red: it is the skipped-check-looks-like-a-passed-check failure
with extra confidence attached.

A static lint in `test-update-exitcodes.ps1` enforces the corrected rule across
`aurora-update.ps1`, with a vacuity guard (the scan must find calls), a
comment-line skip (the file deliberately quotes the old broken `psql` invocation
in prose), and proof that it rejects the `2>&1`-only form. This is the third
distinct 5.1-only defect class after the PS7 ternary and `GetRelativePath`:
**parse-clean, review-clean, and wrong only when it runs, only on the engine that
ships.**

### 🔴 Amendment 2 (2026-08-06, later) — the fixed updater then died on its HAPPY path, and the first regression test for it was worthless

The next field run proved the two rules above (the resolution and the log relay
both worked, on a real `D:\auroa\Aurora` install). It then failed at
`package verified` with
`[System.Object[]] does not contain a method named 'Trim'`.

`-replace` **does not return `''` for an empty left-hand side — it returns an
empty `System.Object[]`.** The updater formatted psql's stderr with an inline
`((Get-Content -Raw $headErr) -replace '\s+',' ').Trim()`, and a *successful*
psql writes nothing, so the file is zero bytes and `Get-Content -Raw` emits no
objects at all. Every step had gone right; the operator was told the update was
not applied. **No update could ever have completed, on any machine.**

**CODIFIED RULE — never call a method on the result of `-replace` unless the
left-hand side is cast to `[string]` first.** `[string]$null` is `''`, and
`'' -replace …` is a `String`. Prefer a named helper (`ConvertTo-SingleLine`)
over an inline chain, so the reasoning lives in one place.

**The more important lesson is about the test.** The obvious regression test —
call the helper with the offending value and assert `''` — is **vacuous**, and
it took reverting the fix to discover that. The hazard is `AutomationNull` (the
"no objects at all" value), and PowerShell **converts `AutomationNull` to a
plain `$null` when binding it to a parameter**. So the defect cannot survive a
function call: the unit tests stay green with the fix removed. They are now
labelled contract tests, and say so in the file.

**CODIFIED RULE — a regression test must be shown to fail with the fix
reverted, and when it cannot, say so in the test file and build a gate that
can.** Here that gate is static: a lint across every shipping
`installer\*.ps1` rejecting a method call on an uncast `-replace` result,
pinned non-vacuous by asserting it matches the two **real historical lines**
and clears their fixed forms — so the regex silently ceasing to match is itself
a failure — plus a child-process proof that the inline form really throws.
Reinstating both defects fails the suite with 2 named offenders.

**Corollary — a refusal must never exit 0.** The same pass found that a
version-skew refusal exited 0, which `aurora-update.iss` maps to an empty branch
whose finished page then announced *"The Aurora update has been applied."* The
one code path whose entire purpose is to refuse said the opposite. Exit 0 now
means **applied, and nothing else**; every wizard-facing message, including the
finished page, is derived from the code rather than assumed, with an explicit
"the updater never ran" state because Pascal initialises integers to 0 — and 0
was the success code.

## 🔴 Verification proves the tree you rendered, not the tree you pushed (added 2026-08-17)

The sibling of "Test on the engine that ships" above, and the same mistake one
layer over: that rule is about testing the wrong RUNTIME, this one is about
testing the wrong TREE.

**CODIFIED RULE — verification by rendering verifies the tree you rendered; only
a clean checkout of the pushed commit proves that is the tree you pushed.**

**A claim in a commit message is an assertion about the tree that commit
CONTAINS**, not about the working tree it was written in. Those are the same
thing only when everything was staged, and "everything was staged" is an
assumption until it is read.

**Evidence produced from the working tree proves nothing about the pushed
commit.** Screenshots, browser probes, measured computed values, a passing local
script — every one of them describes files on disk at that moment. When such
evidence IS the justification for a fix, take it from a clean checkout of the
commit that carries the fix, or say plainly that it came from the working tree.

**WORKED EXAMPLE — `ad769e0` → `9651930`, in this repo's own history.** A render
pass across both themes found a real defect: `Configuration.css` styled
section-blurb emphasis with `var(--ink)`, a token meaning "dark ink ON A BRIGHT
ACCENT FILL" that FLIPS between themes, so on the blurb's transparent surface it
painted dark-on-dark in dark and white-on-white in light. Every section blurb's
bold emphasis was invisible in BOTH themes, including the Observations blurb's
"NEWS2/SOFA score inputs are locked". The fix was applied, the render was
re-run, the corrected colours were MEASURED — `rgb(233,241,251)` dark,
`rgb(21,37,56)` light — and the commit message described all of it accurately.

**The commit did not contain the CSS file.** It was staged by explicit path list
and that path was not in it. Every measured value in the message was true of the
working tree and false of the commit; the screenshots showed a fix that was not
being shipped. `9651930` is the follow-up that actually carries the two-line
change. Both commits stay in the history, because the pair is the evidence.

**CI WAS GREEN EITHER WAY, AND THAT IS THE POINT WORTH NAMING.** A CSS custom
property is invisible to `tsc` and to the bundle build: the wrong token compiles,
bundles, and ships. `ci.yml` runs **no browser at all**, so this layer had no
gate — not a weak one, none. **The absence of a failing check is not coverage.**
Green told the truth about what it measures and nothing about what broke; the
defect had survived in a shipped surface for months precisely because nothing
was looking.

Practice, binding on any commit whose message cites rendered or measured
evidence:

- **Stage with `git add -A`**, not a path list, unless there is a stated reason
  to exclude something. A path list is a second chance to forget a file, and it
  fails silently.
- **Read `git diff --cached` against every claim in the message before
  committing.** Not the working diff — the staged one. If the message says a
  file changed, that file is in the staged diff or the message is wrong.
- A `git status` that still shows modified files after the commit you believed
  was complete is the signal; do not explain it away.

### The second face: it also only proves the PROCESS that answered (added 2026-08-18)

The rule above is about verifying the wrong TREE. The same mistake has a second
face one layer further out, and it was found by the rule's own author on the
first run that applied it: **verification also only proves the process that
answered you.** A checkout can be correct, built, and migrated, and the
assertions can still be describing a DIFFERENT running program.

**WHAT HAPPENED (step 5, #204).** A clean detached worktree at the commit under
test was built and booted against a fresh database, to satisfy the rule above.
The boot **crashed** — the previous server still held the port. But `/healthz`
answered **200**, from the OLD binary, while the new database sat migrated and
idle. The suite then ran: HTTP assertions hit the old process, SQL assertions
read the new database, and eight of them came back **empty**. They read as eight
ordinary assertion failures.

**The trap is that re-running is the natural response and it would have
succeeded**, against the same wrong process, with the empty results explained
away as flakiness. What actually resolved it was reading the failures instead of
repeating the run: *empty* is not the shape a real regression makes here. Had
the run happened to be green, it would have been evidence about a program that
was not the one under test — and it would have been recorded as proof.

**A 200 FROM `/healthz` IDENTIFIES A LISTENER, NOT A BUILD.** It answers "is
something serving on this port", which is not the question any verification run
is asking.

**THE MECHANISM TO CATCH THIS ALREADY EXISTS, AND WAS BUILT FOR EXACTLY THIS
SHAPE.** `/healthz` reports `build` — the commit of the code **in the running
process** — and `Program.cs:ResolveRunningBuild` takes it from the loaded
ASSEMBLY rather than from a file beside the exe, with the reason stated at the
site: *"server\version.json can be replaced while the OLD process is still
serving."* That is this failure, written down in 2026-07-26, in the updater's
context. All 16 deployed suites already gate on it before asserting
anything — resolving `/healthz`'s `build` and requiring the deployed server's
CONTENT to equal the dispatched ref's (tree/blob hashes of the build context,
not commit identity: the honest form, arrived at after commit identity broke
twice — see the gate's own comment in `deployed-adt-e2e.yml`).
**Local verification never adopted any form of it** — which is why the very
hazard the updater and the deployed suites are both protected from reached a
local run unchallenged.

**PRACTICE — binding on any local verification run that boots a server:**

- **Assert `/healthz`.`build` equals the commit under test BEFORE running a
  single assertion**, and abort if it does not match. Not after, and not as a
  closing sanity check: every assertion before that comparison is unattributed.
- **A `build` of `dev`, or absent, fails the check.** It means the stamp is
  unavailable, so the process cannot be identified — which is the condition the
  check exists to refuse, not a pass with a caveat.
- **An EMPTY assertion result is a question about which process answered, not a
  failure to re-run.** Empty is the signature of pointing at the wrong thing.
  Re-running is how a wrong-process run gets promoted to evidence.
- Verified rather than assumed while writing this: in a git checkout the .NET
  SDK stamps the current HEAD into `InformationalVersion` on its own, so
  `/healthz` reports the real commit with no extra flags, and
  `-p:SourceRevisionId=<sha>` (what `build.ps1` passes for installs) only needs
  naming where the SDK cannot resolve it. **Honest limit:** the stamp is the
  commit that was BUILT, so it proves the running process corresponds to that
  commit — it does not prove the working tree was clean. That is the rule above
  and it still has to be satisfied separately.
- The check was **demonstrated firing**, not merely reasoned about: a server
  built with `-p:SourceRevisionId=1111…` and booted, then compared against
  `git rev-parse HEAD`, reports the mismatch and aborts before any assertion —
  which is precisely the run that produced eight "ordinary failures" above.

### The third face: through what LENS you read it (added 2026-08-18)

The first face asks which TREE the evidence came from. The second asks which
PROCESS answered. This one asks **through what VIEW you read it** — and it is
the one that can defeat its own correction, which is why it is stated
separately rather than as a footnote to the other two.

**CODIFIED RULE — a confirmation that passes through the transform which
introduced the error cannot detect that error.**

**WHAT HAPPENED (step 6 prep, 2026-08-18).** `ci.yml` was inspected with a
command that piped the file through `sed 's/^/  /'` to indent it for reading.
The indentation on screen was therefore two spaces deeper than the file's. An
exact-match anchor was written from what was on screen, and the edit failed to
match. The natural next move — *check the indentation* — was run **through the
same pipeline**, which added the same two spaces again and confirmed the wrong
value. Two independent-looking observations agreed, because they were not
independent: both had been through the transform that caused the mistake.
`repr()` on the raw line settled it in one call — six spaces, not eight.

**WHY THIS IS NOT MERELY CARELESSNESS.** The transform is INVISIBLE IN ITS OWN
OUTPUT. A two-space indent prefix looks exactly like a file indented two spaces
more. Nothing in the rendering says "something was added here", so there is no
signal to be careful about — the reader is not ignoring a warning, they are
reading a faithful-looking picture of something that is not there. That is what
makes re-reading useless as a correction: the second look is as faithful, and
as wrong, as the first.

**THE TRANSFORMS ARE EVERYWHERE, AND MOSTLY UNNOTICED:**

| transform | what it silently adds or changes |
|---|---|
| `sed 's/^/  /'`, `column -t`, indenting a quote by hand | leading whitespace |
| `grep -n`, `cat -n`, editor gutters, most diff views | a line-number prefix |
| `git diff` and review UIs | a leading `+`/`-`/space on EVERY line |
| syntax highlighting, prettifiers, `jq`, log viewers | whitespace, quoting, key order |
| a terminal at narrow width | wrapping that reads as a line break |

**PRACTICE — binding whenever an EXACT MATCH is at stake** (an anchor for a
scripted edit, a byte comparison, a hash, an assertion string):

- **Verify the anchor against RAW BYTES, never a rendering.** `repr()`, `od -c`,
  `cat -A`, or reading the file through no pipeline at all. The question is
  never "what does it look like" but "what bytes are there".
- **Never build an anchor from output that was formatted for reading.** If a
  command was run to *display* something, its output is a picture of the thing,
  not the thing.
- **When a match fails, change the LENS before changing the anchor.** A failed
  exact match is evidence that the picture and the file disagree; re-reading
  through the same picture cannot say which one is wrong.
- **Prefer anchors that cannot be broken by indentation** — anchor on
  distinctive inner text where the tool allows it. An anchor immune to the
  transform beats one verified carefully every time.

**THE THREE FACES TOGETHER.** Evidence is only as good as the tree it came from,
the process that produced it, and the lens it was read through. Each is
invisible in the output when it goes wrong, and each has now cost this repo a
real error: a file missing from a commit, a stale binary answering `/healthz`,
and a display prefix baked into an anchor.

*[Recorded 2026-08-18: this rule was written on the same day its own mistake
was made twice — once building the anchor, once "confirming" it. The second
occurrence is the evidence for the rule, not an embarrassment beside it: it
shows the failure survives an ordinary re-check, which is exactly the claim.]*


## 🔴 Never squash migrations while a hospital may be behind (added 2026-08-01)

**CODIFIED RULE — existing EF migrations are append-only once any install
exists.** Squashing, renaming, deleting or re-timestamping a migration that
has already shipped is forbidden, however tidy it would be.

An app-only update carries the **whole** migration set, and a hospital may
skip releases (4.2 → 4.4 in one step is supported — see
`installer/UPDATE_AND_ENABLE_AI_DESIGN.md` §2.4a). A hospital that took every
release would survive a squash; the one that skipped a release would find
`__EFMigrationsHistory` rows with no matching migration in the assembly,
`Database.Migrate()` would throw at boot, the health check would fail and the
update would roll back. Nothing detects it in advance — `migrationHead` is
just the newest migration filename, so a squashed build still stamps a
plausible-looking head.

If a squash ever becomes genuinely unavoidable, it is not an app-only update:
that release becomes a supervised full-installer hop, and every hospital
behind it must be brought forward **before** the squashed build is cut.

## 🔴 The release routine — bump AppVer, or the release ships and never runs (added 2026-08-04)

**CODIFIED RULE — no two shipping artifacts may ever carry the same version.**
`#define AppVer` in `installer/aurora.iss` is the single source of the version:
`build.ps1` stamps it into `server/version.json`, `build-protected.ps1` names
the artifact with it, and `aurora-update.ps1` compares it against the installed
version on the hospital server.

The failure a forgotten bump causes is **silent, not loud**. `Test-VersionSkew`
refuses any package that is not newer than what is installed (refusal 2). So a
release built at an already-shipped version does not error at the hospital — the
update runs, reports that the server is already up to date, rolls nothing back
because nothing changed, and the new code never executes. The engineer sees a
successful run. Nothing anywhere says the release did not land. This is the
worst class of defect the project has: green that was never earned.

**The routine, in order, for every shipping build:**

1. **Bump `#define AppVer` in `installer/aurora.iss`** — patch for a fix,
   minor for a feature, major only for a break. This is a required step, not
   a courtesy.
2. Build with `installer/build-protected.ps1` (never `build.ps1` — that
   produces the `-UNPROTECTED` smoke artifact, which never ships).
3. **Commit the appended line in `installer/SHIPPED_VERSIONS.txt`.** The build
   writes it and prints the exact `git` commands; it cannot commit for you.
4. Ship the whole `Output` folder — the installer is disk-spanned, and the
   `.exe` alone will not install.

**Two gates enforce it so it does not rest on memory:**

- **Build time.** `build-protected.ps1` reads `installer/SHIPPED_VERSIONS.txt`
  before it prompts for the install password and before ISCC starts, and
  refuses if the version has already shipped, is below the high-water mark
  across both artifact kinds, or is malformed. Deliberately re-cutting a release
  that was already recorded is possible but never silent:
  `-RebuildVersion -RebuildReason "<why>"`, recorded in the ledger. Any
  recorded release of that kind, not only the newest (amended 2026-08-06: the
  "newest only" rule blocked the re-cut of a withdrawn, defective 1.1.0 while
  permitting 1.2.0, leaving the broken package the only buildable one). The
  mandatory reason is what makes a rebuild deliberate; the version ordering is
  guarded separately and a rebuild introduces no version.
- **CI.** The `installer-powershell` job runs the gate's unit tests on Windows
  PowerShell 5.1, validates the committed ledger (semver, no duplicates,
  strictly increasing per kind, forward-only across kinds), asserts
  `aurora.iss` AppVer is not *behind* what has already shipped, and then
  **actually runs `build-protected.ps1`** at an already-shipped version to
  prove the refusal fires before the password prompt. A gate that cannot be
  seen failing proves nothing (the CI-evidence rule).

**Honest limit, stated rather than papered over:** the ledger is a file in
git, so the build-time gate is only as strong as step 3. A build whose ledger
line is never committed is invisible to a later clone — though not to the
clone it was built on, where the appended line is right there. Nothing in the
tooling can close that last gap; committing the line is the discipline.

## Data on screen must state its own age (added 2026-08-03)

**CODIFIED RULE — a stale screen and a current screen must never look
identical.** Aurora is used by several clinicians on several devices at
once. Until this rule, every screen was fetch-on-mount with no
revalidation of any kind, and nothing on screen said WHEN it was read: a
ward monitor showing a bed as empty after another device admitted to it
was pixel-identical to a correct one.

- **Every screen that reads clinical data renders `<DataAge>`.** A screen
  that reads nothing (Login, Settings) renders none — inventing an age is
  its own small lie.
- **One chip per independently-refreshed source.** Where a screen mixes a
  polled read with an unpolled one — the bed board's census and its
  severity scores — it shows BOTH ages. A single combined "as of" lets the
  fresher number vouch for the staler one, which is the failure this rule
  exists to prevent.
- **The chip never claims more than it can prove.** Polled and updating →
  "Live · HH:MM"; polled but gone quiet → "Not updating · last HH:MM";
  unpolled → "As of HH:MM" plus a tooltip saying it does not refresh
  itself; unreadable → "Not read". Never green: green is EARNED by a real
  clinical score (01 Design System) and a freshness widget must not borrow
  that meaning.
- **Decorative liveness words are banned.** The bed board's sidebar
  carried the literal `Sync: live` while nothing re-read at all. A
  timestamp that can be checked replaces any adjective that cannot.

## Deployed E2E suite disciplines

*[Docs split note: the two codified blocks below moved verbatim from the
Database-persistence and Formulary records in 02_PROJECT_STATUS.md; the
WARNING the first one references stays with the persistence record there.]*

- **Codified rule — finite seeded resources**: an E2E suite that
  CONSUMES a finite seeded resource is not idempotent against a durable
  database, no matter how careful the picking logic — the well
  eventually runs dry. Future suites must either CREATE the resources
  they consume (MAR/Timeline/Orders create their own orders; ADT admits
  and discharges its own patient) or assert READ-SIDE ONLY (auth, AI).
  Audit of the other six suites (2026-07-09): none consumes a finite
  seed. One related latent exposure — see the WARNING below.

- **CODIFIED TEST-COVERAGE LESSON (the general form of this miss)**: a
  SELF-SUFFICIENT suite that creates the entities it then uses will
  NEVER test the "entity does not exist" path unless that case is
  written explicitly — self-sufficiency (the finite-seeded-resources
  rule) systematically hides absence paths. Every suite must probe its
  REFERENCE LOOKUPS with ids that resolve to nothing, not only the ids
  it created. Audit (2026-07-10): the orders suite EXERCISES unknown
  drugIds (frequency legs, drugId 'x') but asserts acceptance-by-design,
  never rejection; the labs suite creates results only for its OWN
  admitted patient — create-with-unknown-patientId is never probed
  (the server validates it; nothing asserts it); MAR adds no
  independent reference (the drug rides on the order) and its own
  order/dose absence paths are probed; the formulary suite probes
  absent drugIds on MANAGEMENT endpoints but its order legs use only
  drugs it created. The missing absence probes SHIPPED with the
  safety-enforcement PR (unknown drugId/testId → 400 asserted in the
  orders/formulary/labcatalog suites; unknown-patientId result creation
  → 400 in the labs suite).

Cross-references (each rule recorded verbatim at the cited site):

- Build-gate content equality — every suite's warm-up gate compares the
  server build context (git tree/blob hashes of `server/` + `render.yaml`)
  between the dispatched ref and the deployed build: 01_ARCHITECTURE.md
  § Verification-gate content equality.
- Sequential dispatch — suites are never dispatched concurrently; all share
  `concurrency: group: deployed-e2e` and are still dispatched one at a
  time (GitHub keeps at most one pending run per group): the persistence
  and CI-hardening records in 02_PROJECT_STATUS.md.
- Failure-path cleanup — suites end with `if: always()` cleanup steps that
  release run resources and ASSERT each outcome: the CI-hardening record in
  02_PROJECT_STATUS.md.
- Absent-id probes must carry the token AUTHORIZED for the mutation (RBAC
  runs before the lookup; the generic 403 is no existence oracle): the
  four-code application record in 02_PROJECT_STATUS.md.

## Never destroy, never reset

- Deactivation/discontinuation, never deletion — anything ever referenced
  by a clinical or audit record stays resolvable forever: the Observation
  override rule in 01_ARCHITECTURE.md (Stage 11 section), and the Layer 3,
  results-audit, and formulary records in 02_PROJECT_STATUS.md.
- The do-NOT-reset-the-live-database rule stands: the spent-well record in
  02_PROJECT_STATUS.md (Database persistence).
- Every test write lands permanently in the single live environment — see
  02_PROJECT_STATUS.md § Single environment and 01_ARCHITECTURE.md §
  Environment separation.

## Live verification

- *[Codified from existing practice — the pattern every "(built)" record in
  02_PROJECT_STATUS.md documents: a server-side work item ships with local
  verification (behavior matrix + byte-parity sweep where applicable)
  before the PR, and its deployed E2E suite is dispatched against the live
  service after merge + deploy. A change is not done at merge; live
  findings are recorded (or fixed forward), never papered over.]*
