<!-- Recorded verbatim as the build specification (project rule: design
     documents are preserved as provided, with attribution). Source:
     USER_MANAGEMENT_DESIGN.md, provided by the project owner 2026-07-15.
     Clinical/operational source: Jaafer Aljanabi (ICU physician, project
     clinical validator). Built by the User Management + Multi-Role Login
     PR; see 02_PROJECT_STATUS.md for the build record. -->

# User Management + Multi-Role Login — Design Document

**Status:** DESIGN — for approval, then hand to Claude Code as the build blueprint.
**Clinical/operational source:** Jaafer Aljanabi (ICU physician, project clinical validator).
**Origin:** the validator identified a **fundamental gap**: there is **no user management at all**.
Users are seeded/hardcoded (`sara.rahman`, `maya.chen`, `yusuf.karim`, …) — there is no way to
**add** a clinician when someone joins, **deactivate** one when they leave (a real safety issue:
a departed clinician's account staying active), or **change a role**. The login page itself
states there is *"no registration or password reset yet"*. For a real HIS this is fundamental —
hospital staff turnover is constant, and without this Aurora cannot onboard a single clinician.

---

## 0. Locked decisions (validator)

| # | Decision |
|---|---|
| 1 | **A NEW `System Administrator` role manages users** — distinct from the *office* Administrator (receptionist/billing/records). |
| 2 | **Deactivate, never delete** — a departed clinician's records, orders, documentation and attribution persist untouched. |
| 3 | **Roles are changeable** after creation, **audited**. |
| 4 | **A person may hold MULTIPLE roles** — resolved via the login role-chooser (§2), **not** by merging permissions. |
| 5 | **The audit records the ACTIVE role** the person acted as. |
| 6 | **No mid-session role switching** — sign out and back in to change role. |
| 7 | **Roles are revealed only after a correct password** — never before (no info leak). |
| 8 | **A single-role user skips the chooser** — signs straight in. |
| 9 | **Credentials — Option A** (§4): per-user, **properly hashed**, admin-set initial password, **forced change on first login**, admin reset. The deeper surface → the recorded **independent security review**. |

---

## 1. Why the role-chooser preserves the locked RBAC model (important)

Aurora's RBAC is locked as: **one JobTitle → one Permission Profile → permissions**, derived
**server-side, never stored**. Naive "multiple roles" would break that — it would force merging
profiles, which would **collapse deliberate separations** (e.g. `results.create` = Ancillary/LIS
authority vs `results.document` = clinical documentation — separated on purpose).

**The validator's design avoids this entirely:** a person **holds** a set of roles, but **acts as
exactly ONE active role per session** (chosen at login). Therefore:
- **Permissions still derive from ONE profile** — the *active* role. **The RBAC model is unchanged.**
- Multi-role becomes an **identity** question ("which roles does this person hold?"), **not** a
  permissions question.
- The `results.create` / `results.document` separation (and every other deliberate split)
  **survives**: you may hold both roles, but you exercise one at a time.
- Every existing RBAC check still asks "what is the active profile?" — **untouched.**

This is the standard hospital pattern for the *"consultant who also supervises the lab"* case.

---

## 2. Login flow (validator's design)

1. User submits **username + password**.
2. Server **authenticates** (hashed compare — §4).
3. **Invalid credentials → a generic failure.** Do **not** reveal whether the username exists, and
   **never** reveal roles (decision 7).
4. **Deactivated account → refused** (cannot sign in). *(Flag the exact message wording — avoid
   leaking account existence; state the chosen behaviour.)*
5. **Valid credentials:**
   - **Exactly one role → sign straight in** with that active role (decision 8 — no chooser).
   - **More than one role → return that person's roles → they choose one** → the session is issued
     **carrying the chosen active role**.
6. **Forced password change** if this is a first login or an admin reset (§4).
7. **No mid-session switching** (decision 6) — changing role = sign out, sign in again.

**Security detail to get right (flag the approach):** on multi-role login the server must not
issue a *usable* session token before a role is chosen. Verify the real auth flow and implement
cleanly (e.g. authenticate → return the role list with a short-lived role-selection step →
issue the session token only once the active role is chosen). **Flag the chosen mechanism.**

---

## 3. The data model

**User record:** identity (username, display name, …) + **a SET of roles (JobTitles)** +
**active/inactive** + credentials (§4).
**Session/token:** carries the **one ACTIVE role** for that session.
**Permissions:** derive from the **active role's** profile — server-side, as today (**unchanged**).
**Audit:** records the **actor AND the active role** they acted as (decision 5) — because
"created this result **as Lab Tech**" vs "**as Consultant**" is a real distinction: it is the
authority they exercised.

**Existing seeded users:** each holds one JobTitle today → becomes a **set of one**. Their
experience is identical (single role → skips the chooser). Additive migration; nothing about
their access changes.

---

## 4. Credentials — Option A (validator: "yes", scope recommended and stated)

**Build now:**
- **Per-user passwords, properly HASHED** (bcrypt/argon2) — never plaintext, never reversible.
  ⚠️ **Verify how auth works today first**: all seeded accounts currently share `Aurora2026!` and
  the app documents a fallback that is *"clearly logged, password not verified"*. **If passwords
  are not currently hashed, that is itself a real security defect to fix in this build.** Report
  what you find.
- **The System Administrator sets an initial password** when creating a user.
- **Forced password change on first login** (and after an admin reset).
- **Admin password reset** — the System Administrator sets a temporary password + forces change.
- **Every credential action audited** (who reset whose password, when).

**Explicitly deferred → the recorded independent security review** (an existing locked human
gate before real patients): password **policy** (length/complexity), **lockout / brute-force**
protection, session expiry/rotation, self-service reset (needs verified identity — e.g. email),
MFA. **State honestly in `02` that credential management is minimum-viable and security-review-
gated — do not imply this is a reviewed auth system.**

---

## 5. The System Administrator role (new — the highest-privilege role in the system)

- **New role, distinct from the office Administrator.** The office Administrator is
  receptionist/billing/records (and per the locked rule **never** gets clinical data). The
  **System Administrator is IT/system** — they manage *who exists and what access they have*.
- **The System Administrator gets NO clinical access** — they never see patient data. They manage
  identities and roles only. *(They control who may access patient data; they do not access it.)*
- **New permission atoms** (e.g. `users.manage`, `users.view`) held **only** by this role.
- **This is the most security-sensitive authority in the system** — whoever holds it controls who
  can reach patient data. Every action is audited (§6).

### 5.1 Bootstrap (must be solved — flag it)
User management requires a System Administrator; if none exists, the system is unmanageable.
→ **A System Administrator must be seeded.** State how, and record it.

### 5.2 Lockout guards (must be enforced)
- A System Administrator **cannot deactivate themselves.**
- **The last active System Administrator cannot be deactivated**, nor have that role removed —
  the system must never be left with no one able to manage users.
- **Flag** whether a System Administrator may create/grant another System Administrator
  (privilege escalation) — state the chosen behaviour explicitly.

---

## 6. Audit (the most sensitive trail in the system)
Every user-management action is audited — **who did what, to whom, when**:
create user · deactivate · reactivate · **assign/remove a role** · reset a password.
Plus (decision 5) **every clinical action records the active role** the actor exercised.

---

## 7. Deactivation semantics (never-destroy — locked rule)
- A deactivated user **cannot sign in**.
- **All of their history persists, fully attributed** — past orders, documentation, results,
  acknowledgments, audit events. Their name continues to render on historical records
  ("documented by Dr. X"). **Nothing is erased or re-attributed.**
- Deactivation is **reversible** (reactivate), audited.
- **Flag (do not silently decide):** what should happen to a deactivated clinician's **active/
  pending orders** (e.g. orders awaiting signature)? These belong to the patient, not the user —
  the safe default is that they persist untouched, but **surface this as a decision** rather than
  inventing a cascade.

---

## 8. The User Management screen
- A new screen, in the nav **for the System Administrator only** (hidden/Access-Restricted for
  everyone else — consistent with the existing pattern).
- **List** users (name, username, roles, active/inactive).
- **Create** user (identity + **one or more roles** + initial password).
- **Deactivate / reactivate** (never delete).
- **Assign / remove roles** (audited; guards per §5.2).
- **Reset password** (temp + forced change).
- Shows **no patient/clinical data** (the System Administrator never sees it).

---

## 9. Scope
**In scope (build now):**
- The **System Administrator** role + `users.manage`/`users.view` atoms; seeded bootstrap admin;
  lockout guards (§5).
- **User record with a set of roles**, active/inactive (additive migration; seeded users → a set
  of one).
- **User Management screen** (§8): create / deactivate / reactivate / assign-remove roles /
  reset password — all audited.
- **Login role-chooser** (§2): auth → (1 role: straight in) / (>1: choose) → session carries the
  **active role**; no mid-session switching; roles revealed only after a correct password.
- **Permissions derive from the active role** (RBAC model unchanged); **audit records the active
  role**.
- **Credentials Option A** (§4): hashing, admin-set initial password, forced first-login change,
  admin reset — all audited.

**Deferred / recorded:**
- The deeper credential surface → **independent security review** (§4): policy, lockout, session
  expiry, self-service reset, MFA.
- Mid-session role switching — deliberately not built (decision 6).
- Merged/simultaneous multi-role permissions — **deliberately never** (§1: it would collapse
  deliberate authority separations).

---

## 10. Build notes / verification
- **Verify the real auth implementation first** and report it — especially **whether passwords are
  hashed today** (§4). Flag if the current model is weaker than assumed.
- Additive user/role model; **seeded users keep identical behaviour** (single role → no chooser).
- **RBAC model unchanged** — permissions still derive server-side from the **one active** profile.
- **Flag** (don't silently decide): the multi-role token mechanism (§2), the deactivated-account
  message (§2.4), System-Admin-creates-System-Admin (§5.2), and the deactivated-clinician's
  pending-orders question (§7).
- Verify: a System Administrator creates a user with **two roles**; that user logs in, **sees the
  chooser only after the correct password**, picks a role, and gets **exactly that role's
  permissions** (test that the other role's permissions are **absent** — e.g. holding both
  Consultant and Lab Tech, acting as Consultant must **not** grant `results.create`); a wrong
  password reveals **nothing** (no roles, no account existence); a single-role user **skips** the
  chooser; **forced password change** fires on first login and after reset; **deactivation blocks
  sign-in while all history stays attributed**; a role change is audited and takes effect on the
  next sign-in; **the audit records the active role** for a clinical action; the **lockout guards
  hold** (can't self-deactivate; can't remove the last System Administrator); the System
  Administrator sees **no clinical data**; non-admins get Access Restricted. Update `02`
  (including the honest statement that credentials are minimum-viable and **security-review
  gated**). Draft PR; rendered verification before merge.

---

## 11. Open items (flag, don't silently decide)
1. Multi-role token/selection mechanism (§2) — state the approach.
2. Deactivated-account sign-in message (§2.4) — honest without leaking account existence.
3. May a System Administrator create/grant another System Administrator? (§5.2)
4. A deactivated clinician's pending/active orders (§7) — safe default is untouched; surface it.
5. Bootstrap: how the first System Administrator is seeded (§5.1).
6. Whether the **active role** should be visible in the UI during a session (e.g. in the header
   next to the user) so a multi-role user always knows which authority they are exercising —
   **recommended**; confirm.

---

*End of User Management + Multi-Role Login design. A new System Administrator role (IT, never
clinical) manages the user lifecycle — create, deactivate-not-delete, assign roles, reset
passwords — all audited. A person may hold multiple roles but **acts as exactly one active role
per session**, chosen at login only after a correct password, which preserves the locked
one-profile-derives-permissions RBAC model and every deliberate authority separation. Credentials
are minimum-viable (hashed, admin-set, forced first-login change) and honestly recorded as
gated on the independent security review. This document is the specification Claude Code builds
from.*
