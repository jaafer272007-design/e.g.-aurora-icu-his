<!-- Recorded verbatim as the build specification (project rule: design
     documents are preserved as provided, with attribution). Source:
     IMAGING_RESULT_ENTRY_DESIGN.md, provided by the project owner
     2026-07-15. Clinical source: Jaafer Aljanabi (ICU physician, project
     clinical validator). Built by the Imaging Result Entry PR; see
     02_PROJECT_STATUS.md for the build record. -->

# Imaging Result Entry — Design Document

**Status:** DESIGN — for approval, then hand to Claude Code as the build blueprint.
**Clinical source:** Jaafer Aljanabi (ICU physician, project clinical validator).

**Origin — and an important correction.** This was first framed as *"imaging order→result linkage
doesn't exist"* (recorded on PR #86). The validator corrected it: **there is no way to enter an
imaging result at all.** The imaging results visible on staging (CXR/Echo/CT reports) are
**seeded/mock** — no human path creates one. So the gap is larger than linkage, and linkage
cannot be built first: **you cannot link an order to a result that cannot be created.**

**This is exactly where labs were before PR #76.** Labs had results in the system, but the only
way in was `results.create` via API (E2E-only, no human path) — so the **Lab Entry** screen was
built, where clinicians document paper results. **Imaging is at that same pre-#76 stage.** This
design does for imaging what #76 did for labs, and linkage falls out of it.

---

## 0. Locked decision (validator)

**Doctor and nurse document the imaging report** — mirroring the lab model exactly.

Rationale/consequences:
- The hospital is **paper-based**: radiology performs the study and writes a report; a clinician
  transcribes it into Aurora. Same workflow as central-lab results today.
- **No new JobTitle is needed now.** A **Radiologist** title (and/or a future RIS/PACS
  integration) can be added later **without changing this design** — it would simply hold the
  producing-service authority, exactly as `results.create` is reserved for Ancillary/future-LIS
  while clinicians hold `results.document`.

---

## 1. The key simplification (why no imaging catalogue is needed for v1)

Labs link order↔result by **testId**, because every lab test has a **coded identity in the Lab
Catalogue**. Imaging has **no coded study identity** — which is why linkage was thought to need an
Imaging Catalogue first.

**It doesn't.** Because the report is **documented against a pending imaging order for that
patient**, the person entering **picks the order they are reporting on** — so the study identity
**comes from the order itself.** No code matching, no auto-match ambiguity (e.g. "which of two
pending CXRs does this report fulfil?"), and **no coded imaging catalogue for v1.**

→ **Linkage is solved by the entry flow**, not by a matching algorithm.
*(A managed Imaging Catalogue — coded, add/retire, mirroring the Lab Catalogue — remains a
sensible future step if/when a RIS/PACS integration or auto-matching is wanted. Recorded, not
built.)*

---

## 2. What an imaging report contains

- **The order it reports on** (selected from that patient's pending imaging orders) → supplies the
  **study type** and links the two. *(Or "no order" — see §3.)*
- **Study performed at** — the date/time the study was done (a real dated stamp, per PR #95).
- **Findings** — narrative text.
- **Impression / conclusion** — narrative text. *(Kept separate from Findings: that is how
  radiology reports are actually structured, and the impression is the clinically actionable
  part. **Confirm.**)*
- **Reporting radiologist** — **free text**, transcribed from the paper report (§5).
- **Clinician-marked critical finding** — optional flag (§4).
- **Note** — optional.

Imaging is **narrative, not numeric** — there are no analytes, units, or reference ranges, so
none of the lab structure applies.

---

## 3. Unlinked reports are allowed (honest)

A report **may be entered with no order** — e.g. an emergency CXR shot before anyone ordered it,
or an outside film. In that case the person picks the **study type** directly.

- The report renders **honestly as unlinked** — never blocked, and **never fabricating an order**
  to attach it to.
- Consistent with the honest-data discipline (cf. the "custom · unflagged" lab tag: unusual
  things are labelled, not forced into a shape they don't have).

---

## 4. Critical findings — clinician-marked, honestly labelled

Labs auto-flag critical values against **catalogue thresholds**. **Imaging has no numeric
thresholds — so nothing can be auto-flagged.** But some findings genuinely are critical (tension
pneumothorax, large haemorrhage).

→ The documenting clinician can **manually mark the report as a critical finding**, and it must
be **labelled as clinician-marked, not system-derived** — the same honesty as the lab
"custom · unflagged" tag. **Never imply the system detected it.**

*(A clinician-marked critical imaging result is a legitimate source for the Alerts "Clinical
Attention Center" — flag whether it should surface there, consistent with critical labs.)*

---

## 5. Provenance — the documenting clinician is NOT the reporting radiologist

The project's locked provenance pattern (`results.document` vs `results.create`: the documenting
clinician ≠ the producing service) applies directly:

- **Documented by** = the system user (doctor/nurse) who transcribed it — recorded with a dated
  stamp and **source: manual**, exactly as lab documentation does.
- **Reporting radiologist** = **free text** from the paper report — a person who is *not* a system
  user. The report is attributed to them **as reported**, without pretending they authored it in
  Aurora.

This keeps the record truthful and makes a future Radiologist role / RIS integration a clean
*added source*, not a rework.

---

## 6. Fulfilling the order (the linkage)

- Documenting a report **against a pending imaging order fulfils that order** — closing the loop
  that has been open since PR #86.
- **Verify the real imaging-order lifecycle first** and fulfil it through the existing canonical
  path (status/audit) — do **not** invent a parallel state. **Flag** if imaging orders lack a
  fulfilment state rather than forcing one.

---

## 7. Scope

**In scope (build now):**
- An **imaging result entry path** (mirroring **Lab Entry**), authority: **doctor + nurse**.
- Report content per §2; **unlinked reports allowed** (§3); **clinician-marked critical** (§4);
  **provenance** per §5; **fulfils the pending order** (§6).
- Entered reports render alongside the existing (seeded) imaging results on **Labs & Imaging**,
  honestly attributed (documented-by + source manual + reporting radiologist as text).
- **Flag/verify:** whether imaging results already have an **acknowledgment** path (they appear to
  on Labs & Imaging) — if so, entered reports flow into the **existing** acknowledgment, **not** a
  parallel one (the same "one truth" rule the Alerts build followed).

**Deferred / recorded:**
- **Correction/amendment of an imaging report** — a mis-transcribed report is as dangerous as a
  mis-transcribed lab, so this **must** follow. Recommend it as the **next** PR, **mirroring the
  proven PR #80 lab model** (Tier-1 self-correction ≤5 min; Tier-2 Consultant-tier after the
  window with a reason, marked "edited"; amend-not-erase). *(Labs did exactly this sequencing:
  #76 entry → #80 correction. Same, deliberately.)*
- **A coded Imaging Catalogue** (managed, add/retire, mirroring the Lab Catalogue) — only needed
  for auto-matching / RIS-PACS integration (§1).
- A **Radiologist** JobTitle and/or **RIS/PACS integration** — the future producing-service
  authority; this design accommodates both without change (§0, §5).

---

## 8. Build notes / verification
- **Verify against the real code first:** how imaging results are stored/rendered today (they are
  seeded — confirm the store can take a documented report additively); the **imaging order
  lifecycle** and its fulfilment state (§6); whether an **acknowledgment** path exists (§7); and
  **whether the existing `results.document` atom covers imaging or imaging needs its own atom** —
  **state which and why.**
- Mirror **Lab Entry**'s proven shape (a screen/path where the clinician documents a paper
  result), the **encounter scoping**, the **dated stamps** (#95), and the **manual provenance**.
- Honest-data throughout: unlinked reports labelled (§3); critical **clinician-marked, never
  system-derived** (§4); reporting radiologist recorded **as text**, distinct from the documenting
  user (§5).
- **RBAC: doctor + nurse** document (validator's decision); confirm the exact profile set and that
  the office Administrator/System Administrator are excluded (clinical).
- Verify: a doctor and a nurse each document a report **against a pending imaging order** → the
  report renders on Labs & Imaging with correct attribution (documented-by + manual + reporting
  radiologist) **and the order is fulfilled**; an **unlinked** report (no order) is allowed and
  renders honestly as unlinked; a **clinician-marked critical** report is labelled as
  clinician-marked (never as system-detected) and, if applicable, surfaces in Alerts alongside
  critical labs; seeded imaging results are unaffected; profiles without the authority are 403.
  Update `02` (imaging entry built; **correction recorded as the next step**, catalogue and
  Radiologist/RIS recorded as future). Draft PR; rendered verification before merge.

---

## 9. Open items (flag, don't silently decide)
1. **Findings + Impression as separate fields** (§2) — recommended; confirm.
2. Shared `results.document` atom vs a dedicated imaging atom (§8) — state which.
3. Imaging-order fulfilment state (§6) — flag if none exists.
4. Existing acknowledgment path for imaging (§7) — reuse it; never a parallel state.
5. Whether clinician-marked critical imaging surfaces in **Alerts** (§4) — recommended, consistent
   with critical labs; confirm.

---

*End of Imaging Result Entry design. Imaging results currently have **no human entry path** — the
same stage labs were at before PR #76. Doctor and nurse document the paper radiology report
(validator's decision), against a pending imaging order — which **supplies the study identity and
closes the order↔result loop without needing a coded imaging catalogue**. Unlinked reports are
allowed and labelled honestly; critical findings are **clinician-marked, never system-derived**
(imaging has no thresholds); and the documenting clinician is kept distinct from the reporting
radiologist (free text), so a future Radiologist role or RIS/PACS becomes a clean added source.
Correction follows next, mirroring the proven PR #80 lab model. This document is the
specification Claude Code builds from.*
