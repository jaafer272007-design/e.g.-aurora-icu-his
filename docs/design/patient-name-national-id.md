# Structured Patient Name + National Identity Number — Design Document

**Status:** DESIGN — for approval, then hand to Claude Code as the build blueprint.
**Clinical source:** Jaafer Aljanabi (ICU physician, project clinical validator).

**Origin.** The admission form captures a **single "full name" field**. That does not match how
patients are actually identified in an Iraqi hospital, where the legal name on the national
identity card is **first · second (father) · third (grandfather) · fourth (great-grandfather) ·
family/tribal name**, and the **national identity number** is the identifier that matters.

**Evidence the gap is already causing harm:** patient رضا (P-1191) renders **`214313412`** where
the MRN belongs, while seeded patients render **`MRN-402913`**. The admitting clinician had a
national identity number and nowhere to put it, so it went into the MRN field. **Identity data
is already being stored in the wrong place** (§6).

---

## 0. Locked decisions (validator)

| # | Decision |
|---|---|
| 1 | **Five name fields.** First **(required)**, Second **(required)**, Third *(optional)*, Fourth *(optional)*, **Family (required)**. |
| 2 | **Unidentified patients use the same fields**, named "unknown" by the admitting user — **no special mode**. |
| 3 | **National identity number** — stored **exactly as it appears on the identity card**, **unique**, **searchable**. |
| 4 | **Display name = the three required names**: First + Second + Family. |
| 5 | **One clever search box** — type a **name or a number**, the system shows matches. |

---

## 1. The name model

**Stored on the PATIENT record** (not the encounter). Patient identity is a patient-level fact —
consistent with the locked rule that clinical values (weight, height) are encounter-scoped while
**identity is not**.

Five parts, stored separately. **Never store a concatenated name** — the display name is
**derived at render** (the house pattern: derive, never store computed state).

**Two derived renderings:**
- **Display name** (decision 4) = **First + Second + Family** — used in every compact place: the
  patient rail, bed board, order lists, MAR rows, results, timeline entries, worklists.
- **Full legal name** = all present parts in order (First Second Third Fourth Family) — used on
  the **patient header** and **official documents** (discharge summary, print records), together
  with the national identity number.

**Validation:** First, Second, Family required; Third and Fourth optional and **blank is
honest** — a patient with no recorded grandfather's name renders without one, never a
placeholder.

---

## 2. Unidentified patients (decision 2)

**No special mode.** The unconscious trauma patient with no documents is admitted through the
same five fields, named "unknown" by the admitting clinician (e.g. First: `Unknown`, Second:
`Unknown`, Family: `Unknown`, or whatever provisional identifier the unit uses).

**Consequences that MUST be handled:**
- **The national identity number must be optional** — an unidentified patient has none.
  Uniqueness is therefore **unique-when-present**; multiple patients with no ID must not
  collide.
- **Names are not unique** — two "Unknown" patients must both admit successfully.
- **→ §3 is mandatory, not optional.**

---

## 3. Identity correction — REQUIRED (the direct consequence of decision 2)

**When the family arrives and identifies the patient, someone must be able to enter his real name
and national identity number.** An unidentified patient who can never be identified is a dead end,
so decision 2 *requires* an identity-correction path. Typos in a name must also be fixable.

This does not exist today, and **patient identity is deliberately protected** — the locked rule
is that **DOB returns 409 on change**.

**Design:**
- **Correcting a patient's name and/or national identity number is permitted, and is a serious,
  audited identity event** — actor + active role (#104) + time + **reason**, appended to an
  **append-only history**. **Amend, never erase** — the previous identity is preserved and
  visible, exactly as lab (#80) and imaging (#107) corrections do.
- Rationale for visibility: a record that read "Unknown Male" for six hours and now reads a real
  name is a fact about the record. Orders, results and administrations documented during that
  window were documented **against that identity** — the history must show it.
- **FLAG the authority:** who may correct a patient identity? Options: the office Administrator
  (registration is theirs, and identity is **not** clinical data — it fits their locked scope);
  Consultant-tier; or both. **Recommendation: the office Administrator** — this is registration
  work, and identity data is precisely what their role is for. **State the choice.**
- **FLAG:** does the **DOB 409-on-change** rule relax for an unidentified patient later
  identified? An unknown patient's DOB is a guess and *must* be correctable once known —
  otherwise a wrong age propagates into every score and dose. **Recommend: yes, correctable
  through the same audited identity-correction path, superseding the 409 rule in place with an
  attributed note.**

---

## 4. National identity number (decision 3)

- Stored **exactly as it appears on the identity card** — **no format invention, no
  normalisation**. If the card shows it a certain way, that's the record.
- **Unique when present** (§2) — a duplicate at admission is refused, naming the conflict.
- **Optional** — blank for the unidentified.
- **Searchable** (decision 5, §5).
- **Distinct from the MRN** (§6).

**Capability this unlocks (FLAG — do not silently build):** a unique national identity number
makes a **returning patient recognisable** — admitting someone whose ID already exists means this
is a **re-admission**, and their prior encounters could be linked. That is genuinely valuable
(and the Statistics page's readmission metric currently infers it from "patient with >1
encounter"). **Flag it as a follow-up; do not auto-merge patient records in this build** —
silently linking two records on an ID match is an identity decision with real risk.

**PII:** the national identity number is sensitive personal data. The **office Administrator**
performs registration and legitimately needs it — and identity is **not clinical data**, so this
does not breach their locked exclusion. **FLAG the exact profile set** that may view it.

---

## 5. Search (decision 5)

**One box. Type a name or a number.** It currently reads *"Search name, bed, MRN…"*.

**Matches across:** any of the **five name parts**, the **national identity number**, the **MRN**,
and the **bed**.

**FLAG what "clever" means — state the choice, don't over-engineer.** Recommendation: **substring
match across all name parts** (so typing a grandfather's name finds the patient) plus
**prefix/exact on the numbers**. **No fuzzy/phonetic matching** — a near-miss on a patient
identity is a safety risk, not a convenience.

---

## 6. MRN vs national identity number (FLAG — verify and report)

**These are two different identifiers and are currently being conflated.** Seeded patients render
`MRN-402913` (a hospital-generated format); رضا renders `214313412` — a raw number that is
evidently his **national identity number typed into the MRN field**, because the form had nowhere
else for it.

**Verify and report:** does the admission form let the user **type** the MRN? Should the **MRN be
auto-generated** by Aurora (it is the hospital's own record number — the hospital assigns it, the
patient doesn't bring it) now that the national identity number has its own field? **Flag the
decision; do not silently change existing MRNs.**

---

## 7. Existing patients — NEVER fabricate a decomposition

- **"Ahmed Al-Saadi" → First: Ahmed, Family: Al-Saadi is a GUESS.** "Maria Hansen", "Hans Becker"
  and "Peter Novak" do not decompose into a five-part Iraqi legal name **at all**.
- **Never fabricate a decomposition, and never invent a national identity number.** Existing
  patients keep their current single name **as-is and honestly**; new admissions use the
  structured fields.
- **FLAG:** how a legacy single-name patient renders alongside structured ones (recommendation:
  render the stored name as their display name — it simply *is* their name; do not mark it as
  deficient), and confirm they can be corrected into structured parts later via §3 if desired.

---

## 8. Open question — script (Arabic / English)

**Unanswered by the validator; flagged rather than assumed.** رضا is stored in **Arabic**; every
seeded patient is in **English**. Two readings:
- **(a) One set of free-text fields, any script** — what happens today. **Assumed unless told
  otherwise.**
- **(b) Both** — the Arabic legal name *and* an English transliteration → **ten fields, not
  five**, plus a display/print decision per surface.

**Do not build (b) without an explicit decision.**

---

## 9. Scope

**In scope:**
- Five structured name parts (§1) with the stated required/optional rules; **derived** display
  name (First+Second+Family) and full legal name — never stored concatenated.
- **National identity number** (§4): as-on-card, unique-when-present, optional, searchable, PII
  profile set flagged.
- **Identity correction** (§3): audited, amend-not-erase, append-only history, authority flagged;
  the DOB rule addressed.
- **Search** (§5) across all name parts + national ID + MRN + bed.
- Existing patients preserved honestly, **never decomposed by guess** (§7).
- Every surface that renders a patient name updated to the derived display name; the patient
  header and official documents carry the full legal name + national identity number.

**Deferred / flagged:**
- Re-admission linking via national identity number (§4) — real value, real risk; follow-up.
- MRN auto-generation (§6) — flag and decide.
- Dual-script names (§8) — needs an explicit decision.

---

## 10. Build notes / verification

- **Verify against the real code first** and report: the current admission form fields; whether
  the MRN is typed or generated (§6); every surface that renders a patient name (rail, bed board,
  orders, MAR, results, timeline, print, workspaces, Alerts, Admissions/Discharges); and how the
  search box currently matches.
- **Additive migration.** Existing patients keep their stored name byte-for-byte (§7).
- Derived display name — **never store the concatenation**.
- Identity correction audited with actor + **active role** (#104) + reason, append-only (§3).
- Verify: admission requires First, Second, Family and accepts blank Third/Fourth; an
  **unidentified patient admits with "unknown" names and no national ID**; a **second** patient
  with no national ID also admits (unique-when-present); a **duplicate national ID is refused**
  naming the conflict; the display name renders **First Second Family** everywhere compact; the
  **full legal name + national ID** render on the patient header and print documents; **search
  finds a patient by any name part, by national ID, and by MRN**; **identity correction** updates
  name/national ID with the previous identity **preserved and visible in history**, audited; a
  legacy single-name patient renders honestly and is unaffected; nothing fabricates a
  decomposition or an ID. Update `02`. Draft PR; rendered verification before merge.

---

## 11. Open items (flag, don't silently decide)
1. **Script** — one set of fields (any script) vs Arabic + English transliteration (§8).
2. **MRN** — typed or auto-generated, now that the national ID has its own field (§6).
3. **Identity-correction authority** — office Administrator (recommended) vs Consultant-tier (§3).
4. **DOB correctability** for a later-identified unknown patient (§3) — recommended yes, audited.
5. **PII profile set** for viewing the national identity number (§4).
6. **Search semantics** — substring on names + prefix/exact on numbers, **no fuzzy** (§5).
7. **Re-admission linking** on a national-ID match — flag only, do not auto-merge (§4).

---

*End of Structured Patient Name + National Identity Number design. The admission form's single
"full name" field does not match how Iraqi patients are legally identified, and it is already
causing harm — رضا's national identity number is stored in the MRN field because there was
nowhere else for it. Five structured name parts (first, second, third, fourth, family — first,
second and family required), a national identity number stored exactly as on the card and unique
when present, a display name derived as First+Second+Family, and one search box that matches a
name or a number. Unidentified patients admit through the same fields named "unknown" — which
makes an **audited, amend-never-erase identity-correction path a hard requirement**, because the
family arrives and the patient gets a name. Existing patients keep their names as-is: a
decomposition would be a guess, and this system does not guess. This document is the
specification Claude Code builds from.*
