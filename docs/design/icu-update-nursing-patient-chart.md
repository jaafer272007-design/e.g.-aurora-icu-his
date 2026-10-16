*[Recorded verbatim on 2026-10-15: the owner-approved plan for the ICU nursing-orders and
patient-chart update, as reproduced at the end of the Session 1 (coordinator) prompt, built
on reviewed base `2fc317ca4cb923abae1718a9a30ad9af8a7592ba` (draft PR #234's head). Provenance
is exactly that prompt; no separate source file existed to diff against. Everything below the
rule is the plan, unedited: 8,028 bytes, 99 lines, SHA-256
`b371c21eaee11509190b295edff61364706ad0fa41ff8475fffcf32125136d5b`. This note is the only
added text.]*

---

# ICU update: nursing orders and patient-chart changes

## 1. Confirmed behavior

- Keep the ICU interface in English for this update.
- Doctors choose whether a nursing order is **one-time** or **repeating**, and enter the interval in minutes or hours.
- Repeating nursing orders become due again **after the completion time plus the interval**.
- Intake & Output shows the **latest manually entered values**. Entering 200 mL after 500 mL displays 200 mL; earlier values remain in history.
- I&O values do not expire or reset at midnight. A new admission starts blank and preserves the previous admission’s history.
- Changes apply to every role already entitled to that screen, except the explicitly nurse-specific changes below.

## 2. Nursing orders

Add **New Nursing Order** alongside medication, laboratory and imaging entry.

**Form**

- Required free-text instructions.
- Existing Routine/Urgent/STAT priority.
- One-time by default.
- Optional Repeat control with a positive whole-number interval and Minutes/Hours selector. Support 1 minute through 48 hours.
- Existing Pending and Sign & Order workflow, with the same prescribing permissions.
- First round available immediately after signing.

**Implementation and persistence**

- Keep category `Nursing` and the existing Orders to Implement workflow.
- Persist repeat settings and completion records in a dedicated nullable JSON field on the order, with an additive database migration.
- Return the current round’s identity, due time and completion history through the existing order responses.
- Extend the implementation request with round identity and a unique attempt ID. Preserve existing empty requests for legacy one-time orders.
- Complete a one-time order once. Keep a repeating order active until discontinued or its encounter closes.
- After Done, show the next due time and disable completion until then. A delayed round remains outstanding; the clock must not create additional missed rounds.
- Enforce round identity, timing and duplicate protection on the server under the existing order lock. Retrying one attempt must not create another completion.
- Existing nursing orders and order-set items without repeat settings remain one-time.
- Add **Nursing** to the order-type filters. Keep medication timing unchanged.
- Changing an already signed nursing schedule requires discontinuing it and creating a replacement in this batch.

## 3. Patient chart and nurse screens

### Shared patient-chart changes

- Combine the existing observation and ventilator readings into **Latest Charted Observations**. Preserve units, timestamps, sources and set-versus-measured distinctions.
- Remove the separate **Ventilator** and **Hemodynamics** cards. Preserve unique charted hemodynamic readings within the combined observations card, without duplicating readings.
- Make **Weight & Height** compact, with the same values, entry controls and history.
- Replace **Active Infusions** with **Active Medication Orders**, sourced from the patient’s canonical active prescriptions. Include scheduled, PRN and continuous medicines with dose, route and frequency.
- Rename **Laboratory Trends** to **Laboratory Results**, preserving its existing results and trends.
- Add **Imaging Results**, showing the patient’s recorded studies, dates, status and report text, with access to the existing full results screen.
- Remove **Daily Goals**, **Smart Alerts** and **Patient Digital Twin** from the patient chart, including their chart-specific links and unused loading work.

These removals do not remove unrelated unit-level alerts or alter clinical records.

### Nurse-specific changes

- Remove **Nursing Tasks** from Nurse Workspace, together with its Tasks Open counter, loading and toggle behavior. Keep **Orders to Implement**.
- Hide SOFA and NEWS2 throughout the nurse’s patient chart, including score chips, legends and chart-specific score summaries. Preserve the underlying observations.
- Show the selected patient’s medication administration cards inside the chart, with the same Given/Held/Refused controls and daily grouping used in Nurse Workspace.
- Reuse one shared medication-documentation controller across both screens. Preserve first-dose availability, later-round locking, overdue reasons, backdating protection, attempt IDs, uncertain-save handling and retry behavior.
- Clear the displayed patient data immediately when switching patients; late responses must never populate another patient’s chart.

### Intake & Output

- Provide patient-specific entry controls, current intake/output values, calculated balance, timestamps, recorder and history in the nurse’s chart and workspace.
- Entering a value replaces the displayed value; saving creates an auditable historical record.
- Allow zero explicitly. Missing values display **Not recorded**; do not invent zero or calculate balance until both values exist.
- Use dedicated manual snapshot observations, `io_current_intake_ml` and `io_current_output_ml`, through the existing observations API.
- Keep these snapshots separate from interval fluid observations and existing fluid-balance/scoring calculations.
- Scope reads and writes to the current admission. Preserve server permissions, encounter checks and visible failure handling.
- Replace the existing demo-only I&O worksheet behavior with this shared, persisted implementation.

## 4. Three Claude sessions without conflicting edits

First, Session 1 records the owner’s requirements and confirmed decisions in a committed design document and freezes the shared interfaces. All three sessions then work from that same preparation commit in separate branches/checkouts.

| Session | Ownership |
|---|---|
| **1 — Nursing orders and shared backend** | Nursing entry form, order filters, repeating nursing lifecycle, implementation API, shared API types/adapters, database migration and I&O observation definitions. Acts as final integrator. |
| **2 — Patient chart** | Shared chart layout, combined observations, compact measurements, medication summary, laboratory/imaging results, removed cards and nurse score visibility. |
| **3 — Nurse workflows** | Remove Nursing Tasks, update Orders to Implement for repeating rounds, extract the shared MAR controller, and build reusable patient-specific MAR and I&O components. |

- Session 3 exposes a patient-care component accepting `patientId`; Session 2 inserts it into the nurse chart after handoff.
- Only Session 1 edits shared API contracts, persistence mappings and migration files.
- Other sessions request contract changes through the agreed handoff rather than editing those files independently.
- Each session works solo, runs focused checks and supplies its commits, concise results and screenshots.
- Session 1 assembles the reviewed commits into existing draft PR **#234**. Run required final builds and integration checks once after assembly.

## 5. Verification and delivery

Use synthetic data to verify:

- One-time and repeating nursing orders; pending/signing; minute/hour intervals; late completion; exact unlock time; duplicate clicks, retries and concurrent completions.
- Legacy nursing orders, discontinuation and discharge.
- Shared chart changes for existing authorized roles; nurse score removal without losing observations.
- Patient-specific medication controls in both locations, including navigation during an unresolved save and the existing medication timer/retry scenarios.
- I&O replacement **500 → 200**, explicit zero, missing values, history, restart persistence, admission separation and unchanged fluid/scoring calculations.
- Patient switching, polling, loading/error states, keyboard operation, dark/light themes and narrow layouts.

Deliver the combined draft PR, updated design/status notes, concise evidence and a refreshed local preview for review.

**Keep main unchanged. No PR merge, installer/EXE build, hospital deployment or ongoing monitoring. The existing installer rollback release gate remains unresolved.**
