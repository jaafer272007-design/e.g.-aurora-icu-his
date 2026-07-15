<!-- Recorded verbatim from the project owner's build instruction of 2026-07-15
     (the Settings + In-App Back Button design document, provided as
     SETTINGS_AND_BACK_BUTTON_DESIGN.md — transcribed here unchanged; that
     file is the source document). Clinical source: Jaafer Aljanabi (ICU
     physician, the project's clinical validator). This file is the
     permanent versioned artifact for the specification — per the project
     rule that specs never live only in memory or conversation. Settings is
     the LAST dead nav item (Statistics ✅ → Alerts ✅ → Settings); on merge
     the ICU module's navigation is complete. The in-app back button is a
     distinct app-wide chrome control shipped alongside. -->

# Settings + In-App Back Button — Design Document

**Status:** DESIGN — for approval, then hand to Claude Code as the build blueprint.
**Clinical source:** Jaafer Aljanabi (ICU physician, project clinical validator).
**Origin:** two deferred items, now due:
1. **`Settings`** — the **last** of the three dead nav items (Statistics ✅ → Alerts ✅ →
   **Settings**). Building it closes the ICU module's nav: no more non-working nav items.
2. **In-app back button** — the validator noted long ago that the app has **no back control of
   its own** (the only way back is Chrome's browser back button), and asked to do it "when we
   reach the Settings screen." We've reached it.

**Note:** these are **two distinct pieces of work** — Settings is a *page*; the back button is
an **app-wide navigation control** (it lives in the app chrome/header on every screen, not
inside Settings). They ship together only because they were deferred together.

**Built against the verified data-model audit** — every item classified against real code.

---

# PART 1 — SETTINGS PAGE

## 1.0 Core principle
**Never display any value not backed by real data.** Every item is real, or an explicit
**"not tracked yet"** placeholder (the validator's chosen treatment, as on Statistics/Alerts) —
never fabricated.

## 1.1 Structure — three layers (validator's design)

### A. User Preferences 🆕 (needs a small new preferences store)
**Audit finding: no user-preferences store exists anywhere** (storage holds only session
identity + the patient context). So these need a **small new preferences module** — the only new
capability in this build.

| Item | Decision |
|---|---|
| **Theme** | **BUILD.** Options: **Follow system** (default — matches the device's dark/light setting: laptop/PC/phone, which was the validator's main ask), **Light**, **Dark**. *(Time-based auto-switching deliberately NOT built — a 24/7 ICU makes clock-driven switching fight the user; the device setting is the better signal, with a manual override.)* |
| **Time format** | **BUILD** (12h/24h) — a display preference over the existing dated stamps. |
| **Language** | **"Not tracked yet"** — no i18n layer exists; listing it as a real toggle would be fabrication. Recorded as future. |
| **Notification preferences** | **"Not tracked yet"** — there are **no notifications** (D6: alerting is v2). A preference for a thing that doesn't exist would be fabrication. |
| **Default workspace** | **"Not tracked yet"** as a *preference* — note the audit: the landing route is **RBAC/profile-derived today**, not a user choice. Making it a preference is new behaviour; don't imply it exists. |
| **Default rounding template** | **"Not tracked yet"** — no rounding-template concept exists at all. |

**Scope of the preferences store:** small, client-side, per-user/session-scoped (consistent
with the existing storage discipline), holding **theme** and **time format** only. Cleared/
respected consistently with the session (and, like the patient context, cleared on sign-out).

### B. ICU Preferences — mostly read-only (by design)
| Item | Decision |
|---|---|
| **Bed layout** | **Display only** (real — the beds table is real, seeded). **Editing = "not tracked yet"** (no management endpoint exists). |
| **NEWS2 version** | **Read-only display** — "standard NEWS2 v1" + its parameters/thresholds. |
| **SOFA version** | **Read-only display** — "classic SOFA v1" + its component thresholds. |
| **Configuring the scores** | **Deliberately OUT — not a "not tracked yet" gap but a design decision.** Making thresholds configurable **contradicts the locked versioning discipline**: per the validator, a variant is a **new score definition/version** (ICU-EWS v2, modified SOFA), *never* a knob that mutates the standard score. Settings therefore **shows** the active versions; it does not let anyone edit a validated instrument. State this explicitly in the UI. |
| **Units (SI / conventional)** | **"Not tracked yet"** — units are fixed in the catalogue/spec (mg/dL etc., validator-confirmed) and **no conversion layer exists**. A toggle would be fabrication. |

### C. System Information — real
| Item | Decision |
|---|---|
| **App version** | ✅ Real (the app version constant). |
| **Build** | ✅ Real on **both halves** — the frontend `build.txt` (commit SHA, written by the Pages deploy) and the server's `/healthz` build. **Show both** (they deploy separately — a real and useful distinction; the project has a locked rule that frontend/backend deploy separately and must be verified independently). |
| **Environment** | ✅ Real — `/healthz` reports environment (e.g. staging). |
| **API / service health** | 🟡 Real — a truthful "API reachable / unreachable, environment X, build Y, service Z" panel from `/healthz`. **Honest when unreachable** (the free-tier server sleeps — the panel must say "unreachable", never imply healthy). |
| **Database status** | **"Not tracked yet"** beyond what `/healthz` reports — no deeper DB-status source exists. |
| **Connected services** | **"Not tracked yet"** — no service registry exists. *(Future: the Integration Layer / LIS would populate this.)* |
| **License** | **"Not tracked yet"** — no licence concept exists anywhere. |
| **Backup status** | **"Not tracked yet"** — backup exists only as an operational workflow; **nothing the app can query.** |

## 1.2 RBAC
- Settings contains **no patient-identifiable clinical data** → it is reachable by all profiles,
  **including the office Administrator** (system info/preferences are not clinical).
- **But:** if any layer is deemed sensitive (e.g. score definitions, bed layout), gate it
  appropriately. **Flag the exact profile set at build** and confirm nothing clinical leaks to
  the office Administrator.

---

# PART 2 — IN-APP BACK BUTTON (app-wide, not a Settings feature)

## 2.1 The need (validator)
The app has **no back control of its own** — the only way back is Chrome's browser back button.
That's a real gap: on a kiosk/tablet/fullscreen clinical workstation the browser chrome may not
be present, and a clinical app should own its navigation.

## 2.2 Design
- Add an **in-app back control** in the app chrome/header, present across screens.
- **Behaviour:** navigate back to the previous in-app view (browser-history-based back within
  the app), consistent with how the app's routing works.
- **Honest/predictable edges — flag rather than guess:**
  - What happens at the **first screen** (nothing to go back to) — disable/hide rather than a
    dead control.
  - Don't let back escape the app into unrelated history or the login page in a confusing way;
    **respect the session** (back must never appear to "undo" a sign-out into an authenticated
    view).
  - It complements — does not replace — the **persistent patient context** (going back should
    not silently switch patients; the patient in the route stays the truth).
- **Placement:** in the app header, consistent across all screens; must not collide with the
  existing header content, and must survive the responsive/short-viewport layout (the
  `app-frame`/`shell` grid — the layout that caused the earlier clipping bug; verify at a small
  viewport).

---

# PART 3 — ONE HONESTY DEBT TO CLOSE (flagged during the Alerts build)
- **The AppHeader bell shows a hardcoded count** on some screens — a **fabricated number** still
  sitting in the UI (the same category as the Alerts nav badge's hardcoded "5", now fixed).
  **Close it here:** make the bell's count **real** (it should reflect the same real attention
  count Alerts now computes) **or remove the bell** — never a fabricated number.
- *(Recorded as a pre-existing artifact during the Alerts build; folding it in here keeps the
  "no fabricated numbers" rule complete across the nav/header.)*

---

## 4. Scope
**In scope (build now):**
- **Settings page** (the last dead nav item) with the three layers (§1.1): a **small new
  preferences store** for **theme** (Follow system / Light / Dark) and **time format**; read-only
  ICU info (bed layout display, SOFA/NEWS2 versions + thresholds, with the "scores are versioned,
  not configurable" statement); real System Information (app version, **both** builds, environment,
  health) — everything else as **"not tracked yet"** placeholders naming the missing capability.
- **Theme actually applied app-wide** (Follow system by default — respects the device's dark/
  light setting; manual Light/Dark override).
- **In-app back button** (§2) — app-wide chrome control, with honest edges.
- **The AppHeader bell's hardcoded count** made real or removed (§3).
- The `Settings` nav item works → **no dead nav items remain; the ICU module's nav is complete.**

**Deferred / recorded as future:**
- i18n/language, notification preferences (needs D6 v2 alerting), default-workspace preference,
  rounding templates, bed-layout **editing**, units conversion, deeper DB status, a service
  registry (→ Integration Layer), licence, in-app backup status.
- **Score configurability — deliberately never** (versioning discipline: a variant is a new
  definition, not a knob).

---

## 5. Build notes / verification
- Build `Settings` behind the existing (currently dead) nav item; **no fabricated values** —
  real or "not tracked yet" (visually distinct, naming the missing capability), consistent with
  the Statistics/Alerts treatment.
- **Preferences store:** small, session/user-scoped, consistent with the existing storage
  discipline (like the patient context: tab/session-scoped, cleared on sign-out). **Flag** the
  chosen scope.
- **Theme:** default **Follow system** (`prefers-color-scheme`), plus Light/Dark override;
  applied app-wide. **Verify it doesn't break the existing styling/contrast** — this is a real
  visual-regression risk across 18 screens; **flag if the app's CSS isn't structured for a
  light theme** rather than shipping a broken light mode. (If light mode would need substantial
  restyling, say so — better to flag than to ship something unreadable.)
- **Back button:** app-wide header control; honest edges (§2.2); **verify at a small viewport**
  (the `app-frame`/`shell` grid — the earlier clipping bug's territory).
- **Bell count:** real or removed (§3).
- RBAC per §1.2 — **flag the profile set**; nothing clinical to the office Administrator.
- Verify: Settings navigates (no longer dead); every real value traces to its source (both
  builds, environment, health — and health honestly says "unreachable" when the server sleeps);
  "not tracked yet" renders distinctly for every unsupported item; theme persists and follows
  the system by default, with Light/Dark override applied app-wide **without breaking contrast/
  readability on any screen**; time format applies; score versions display read-only with the
  not-configurable statement; the back button works across screens with honest edges and doesn't
  break the small-viewport layout; the bell shows a real count or is gone; **no fabricated
  numbers anywhere in the nav/header**; office Administrator sees Settings with nothing clinical.
  Update `02` (**all three dead nav items now closed — the module's nav is complete**). Draft PR;
  rendered verification before merge.

---

## 6. Open items (flag, don't silently decide)
1. **Light-theme viability** (§5) — if the app's CSS (built dark-first across 18 screens) would
   need substantial restyling for a readable light mode, **flag it** rather than shipping a
   broken theme; possibly ship Follow-system/Dark first and Light after a styling pass.
2. Preferences store scope (§5) — per-tab/session vs per-user-persisted; state the choice.
3. Back-button edges (§2.2) — first-screen behaviour, session/sign-out interaction, and
   interaction with the persistent patient context; state the chosen behaviour.
4. RBAC profile set for Settings (§1.2).
5. Whether the bell should show the Alerts attention count or be removed (§3) — state which.

---

*End of Settings + In-App Back Button design. Settings — the last dead nav item — with a small
new preferences store (theme following the device setting by default, plus time format),
read-only score versions (deliberately not configurable: a variant is a new version, never a
knob), real system information (both builds, environment, honest health), and "not tracked yet"
placeholders for every capability that doesn't exist. Plus the app-wide in-app back button the
validator asked for, and closing the AppHeader's hardcoded bell count. On merge, **no dead nav
items remain and no fabricated numbers sit in the nav/header — the ICU module's navigation is
complete.** This document is the specification Claude Code builds from.*
