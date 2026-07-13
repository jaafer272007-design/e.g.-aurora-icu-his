<!-- Recorded verbatim from the project owner's build instruction of 2026-07-13
     (the Lab Result Editing / Correction design, provided as the build
     blueprint). Clinical source: the project's clinical validator (ICU
     physician). This file is the permanent versioned artifact for the Lab
     Result Editing specification — per the project rule that specs never live
     only in memory or conversation. Built from this design (see
     02_PROJECT_STATUS "Lab Result Editing / Correction (built)"): Tier-1/
     Tier-2 correction mirroring the Stage 11 observation model, §2a
     acknowledgment gating, and the §2b acknowledged-then-edited visibility
     safeguard (whose prerequisite was the #79 display fix). The open items
     were resolved as recorded there: the store took a small additive change
     (DocumentedAt anchor + AmendmentsJson history), and corrected structured
     values RE-DERIVE their flag from the corrected value (the recommended
     option). Changes are new versions recorded with their source. -->

# Lab Result Editing / Correction — Design Document

**Status:** DESIGN — for approval, then hand to Claude Code as the build blueprint.
**Clinical source:** Jaafer Aljanabi (ICU physician, project clinical validator).
**Origin:** hands-on testing surfaced that the lab-entry path (PR #76) has no way to correct a
documented lab result (unlike observations, which have a correction model). The validator
decided lab editing should **mirror the Stage 11 observation correction model**, with
lab-specific rules for how correction interacts with acknowledgment.

---

## 0. What this is

A way to **correct a documented lab result** (a transcription typo, a wrong value). It
reuses the observation correction model the validator already validated (Stage 11), applied
to lab results, plus rules for the lab-specific **acknowledgment** step (labs are signed off
/ acknowledged; observations are not).

**Never destroys data** — a correction amends, preserving the original (amend-not-erase, the
discipline used everywhere in Aurora).

---

## 1. The correction model — mirrors the observation model (validator's decision)

Same two tiers as Stage 11 observations:

- **Tier-1 — self-correction within 5 minutes.** The clinician who documented the result can
  correct it within a **5-minute window**, **no reason required**. Actor, original value, new
  value, and timestamp are **always recorded** (even Tier-1 leaves a trace).
- **Tier-2 — Consultant-tier correction after the window.** After the 5 minutes, only a
  **Consultant-tier / SeniorDoctor** can correct, and a **reason is required**. The result is
  marked **"edited"** on the record.
- **Both amend-not-erase.** The original value is preserved; the correction is recorded
  (who / when / — for Tier-2 — why). A corrected result shows it was corrected, with history.

**What is editable:** the **result value** and the **note**. For a *structured* lab, editing
the value **re-runs the flagging** (e.g. 2.1 → 4.1 may change normal → critical — the flag is
derived from the corrected value). For a *custom* lab (Option A / PR #78), editing the
free-text value / note (custom results stay unflagged).

---

## 2. Acknowledgment rules (lab-specific — the part the observation model didn't cover)

Labs have an acknowledge / sign-off step; observations do not. Two validator decisions:

### 2a. Acknowledgment is only available AFTER the 5-minute window (validator's rule)
A result **cannot be acknowledged while it is still in its 5-minute self-correction window.**
The flow is: **document → 5-minute self-correction window (freely typo-fixable by the
documenter) → window closes → the result becomes acknowledgeable.**

Rationale: the value **stabilises before anyone can sign off on it** — nobody acknowledges a
value that might still be getting a quick Tier-1 fix. This cleanly avoids the
acknowledge-then-Tier-1-correct conflict for the common case.

### 2b. A Consultant (Tier-2) edit of an ALREADY-ACKNOWLEDGED result → mark "edited", keep the original acknowledgment (validator's decision: Option a) — WITH a visibility safeguard
This sequence is still possible: document → 5 min passes → result acknowledged (of the old
value) → later a Consultant does a Tier-2 correction (value changes).

**Validator's decision (Option a):** the result is marked **"edited"** and the **original
acknowledgment is kept** (recorded — who acknowledged, when). Acknowledgment is **NOT** forced
to re-open.

**Required safeguard (so Option a is safe):** the record must **clearly show that the edit
happened AFTER the acknowledgment** — i.e. the state is visibly "acknowledged by Dr. X at T1,
then edited by Consultant Y at T2 (reason)", NOT a blended state that makes the old sign-off
look like it covers the new value. A clinician reviewing the result must be able to see that
the current value **post-dates** the acknowledgment, so the old sign-off is not mistaken for
sign-off on the corrected value.

*(Design note recorded for transparency: Option a keeps the model simple but relies on the
"edited-after-acknowledgment" state being prominent; the safeguard above is what makes the
change transparent rather than silent. The alternative — re-opening acknowledgment on a
post-ack edit — was considered and not chosen; the visibility safeguard is the agreed
mitigation.)*

---

## 3. Display / honesty
- A corrected result shows it was **edited** (with the correction history: original value, new
  value, who, when, and — Tier-2 — the reason). Amend-not-erase — the original is never
  erased from the record.
- Where a correction post-dates an acknowledgment (§2b), the display makes that ordering
  visible ("acknowledged … then edited …").
- Structured corrected values re-derive their flag; custom corrected values stay unflagged.
- Honest-data discipline: nothing hidden, the original and the correction both on the record.

---

## 4. RBAC
- **Tier-1 self-correction (≤5 min):** the clinician who documented the result (nurse / doctor
  / senior doctor who has `results.document`).
- **Tier-2 correction (>5 min):** **Consultant-tier / SeniorDoctor only**, reason required —
  consistent with the observation Tier-2 authority and every other Consultant-tier governance
  decision. Office Administrator profile excluded (the F2/F3 hard constraint).
- Enforced server-side.

---

## 5. Scope
**In scope (build now):**
- Tier-1 (≤5 min, documenter, no reason) + Tier-2 (>5 min, Consultant-tier, reason) correction
  of a documented lab result's value and note; amend-not-erase with recorded history.
- Structured corrected value re-runs flagging; custom corrected value stays unflagged.
- Acknowledgment only becomes available after the 5-minute window (§2a).
- A Tier-2 edit of an already-acknowledged result keeps the original acknowledgment and marks
  the result "edited", with the post-acknowledgment ordering clearly shown (§2b + safeguard).
- Applies to both structured (catalogue) and custom (Option A) results.

**Not changed / not in scope:**
- The acknowledge mechanism itself (beyond the "only after 5 min" timing and the "edited"
  visibility) — the existing acknowledge/unacknowledge lifecycle stays.
- The `results.document` / `results.create` split (PR #76) — unchanged.

---

## 6. Build notes / verification
- Mirror the existing **observation correction model** implementation (Tier-1/Tier-2,
  amend-not-erase, recorded actor/original/new/time/reason) — reuse that pattern for labs;
  verify how observation corrections are implemented and apply the same shape to lab results.
  Flag if the lab-results store can't cleanly carry correction history / an "edited" state
  rather than forcing it.
- **Acknowledgment gating (§2a):** a result in its 5-minute window is NOT acknowledgeable;
  after the window it is. Verify the timing boundary.
- **Post-ack Tier-2 edit (§2b):** keep the original acknowledgment; mark "edited"; show the
  acknowledged-then-edited ordering clearly (do NOT blend so the old sign-off appears to cover
  the new value). Verify the display makes the ordering visible.
- Amend-not-erase; original never destroyed; correction history recorded.
- Structured corrected value re-derives flag; custom stays unflagged.
- RBAC server-side: Tier-1 = documenter ≤5 min; Tier-2 = Consultant-tier >5 min with reason;
  office-admin excluded.
- Verify: documenter self-corrects ≤5 min (no reason, recorded); the result is NOT
  acknowledgeable during the 5-min window and IS after; Consultant Tier-2 corrects >5 min
  (reason required, marked "edited", original preserved); a Tier-2 edit of an already-
  acknowledged result keeps the original ack and clearly shows it was edited afterward;
  structured value-correction re-flags; custom value-correction stays unflagged;
  non-Consultant blocked from Tier-2; office-admin blocked.
- Update `02`. Draft PR; hands-on rendered verification before merge.

---

## 7. Open items (flag, don't silently decide)
1. Store support for correction history + "edited" state on lab results (§6) — confirm the
   store can carry it cleanly; flag if it needs an additive change.
2. Flag-at-render vs at-entry for corrected structured values — pick the honest, consistent
   option (recommended: re-derive from the corrected value) and state it.

---

*End of Lab Result Editing / Correction design. Mirrors the validated observation correction
model (Tier-1 5-min self-correction, Tier-2 Consultant-tier with reason, amend-not-erase),
plus lab-specific acknowledgment rules: acknowledgment only after the 5-minute window, and a
post-acknowledgment Consultant edit keeps the original acknowledgment while clearly showing
the result was edited afterward (validator's Option a, with the visibility safeguard). This
document is the specification Claude Code builds from.*
