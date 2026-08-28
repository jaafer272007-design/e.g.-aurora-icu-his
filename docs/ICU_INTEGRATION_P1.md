# ICU Integration P1 — one hospital login, read-only ICU

**Status: P1. ICU is READ-ONLY through this path, enforced by the ICU
server on every request — not by hidden buttons.**

P1 does exactly four things: one Aurora/Bahmni login, a secure ICU
session bridge, ICU mounted at `/icu/`, and a safe read-only workspace.
It creates no ICU patient, admission, MRN, transfer, discharge or bed
assignment, and it imports no ICU test data.

## Ownership (approved)

| Owned by Aurora/Bahmni | Owned by ICU |
|---|---|
| users, patient identity, visits/admissions, wards, rooms, beds | ICU clinical workflows, observations, monitoring, ICU orders/MAR, results, timelines, ICU-specific clinical settings |

## The bridge

```
PUBLIC   POST https://<host>/openmrs/aurora-icu-bridge/session
INTERNAL      http://aurora-icu-api:8080/api/icu/auth/bridge
```

**The public path is under `/openmrs` because it has to be.** OpenMRS
runs at Tomcat context `/openmrs`, so its session cookie carries
`Path=/openmrs`; a browser will not send that cookie to `/api/icu/*`.
A bridge outside that path receives no session and answers 401 forever.

**Both sides name the full, exact path.** `ProxyPass` is a prefix map:
a shorter public prefix would append the remainder to the target and
turn `.../session` into `/api/icu/auth/bridge/session`, which does not
exist.

**The rule sits above `Include conf/upstream-bahmni-proxy.conf`.**
Apache takes the first matching `ProxyPass`, and the include carries the
general `/openmrs` rule. Below it, the bridge is dead.

What the bridge does, in order — a token exists only past all five:

1. anti-CSRF: the `X-Aurora-Bridge` header, `Sec-Fetch-Site: same-origin`,
   and `Origin` against `ICU_BRIDGE_ALLOWED_ORIGIN`.
2. environment: an unknown `APP_ENV` mints nothing (503).
3. configuration: no `OPENMRS_INTERNAL_BASE` mints nothing (503).
4. session: the inbound cookie is forwarded to
   `{OPENMRS_INTERNAL_BASE}/ws/rest/v1/session` **and nowhere else**;
   not authenticated → 401.
5. role map: unmapped or ambiguous → 403, **never a default title**.

The token is `iss=aurora-icu`, `aud=<APP_ENV>`, claims `sub`/`jti`/
`name`/`jobTitle`/`aurora_scope=p1-readonly`, **30 minutes**, returned in
the response body only, with `Cache-Control: no-store`.

> The `Origin` check does **not** compare against the request's `Host`.
> Behind Apache, `ProxyPreserveHost` is off by default, so this process
> sees the upstream host and a Host comparison rejects every legitimate
> request. Found by the P1 end-to-end proof. Declare
> `ICU_BRIDGE_ALLOWED_ORIGIN`, or rely on Fetch metadata.

## Enforced read-only

`server/Core/Identity/P1ReadOnly.cs` runs after authentication and before
any endpoint. For a token carrying `aurora_scope=p1-readonly` it allows
only GET/HEAD/OPTIONS plus the one exact path
`POST /api/icu/adt/patients/match` (verified read-only: the whole
identity table's SHA-256 is unchanged across confirmed, repeated and
near-miss matches). Everything else is 403 before the handler runs —
including endpoints added in future, because the rule is about the HTTP
method, not a list somebody must remember to update.

## Role map — deny by default

Configured through `OPENMRS_ROLE_MAP` (a JSON object) or
`OPENMRS_ROLE_MAP_FILE`, **validated at boot**: a job title ICU does not
recognise refuses the boot. With no configuration the map is EMPTY and
the bridge issues no token to anyone.

| Option | Mapping | Grants |
|---|---|---|
| **(a) administrator** — opt in with `ICU_BRIDGE_ALLOW_SYSADMIN_DEFAULT=true` | `System Developer` → `System Administrator` | `users.manage`, `users.view`, `backup.*` — **no clinical permission at all**, and in P1 none of those routes is even published. Safe for a connection test. |
| **(b) clinician** | *hospital decision* | ⚠️ the ICU title's FULL permission set |
| **(c) everyone else** | *(absent)* | nothing — 403 on every ICU endpoint |

> ⚠️ **Mapping a hospital role to an ICU clinical title grants that
> title's whole ICU permission set.** `Consultant` derives SeniorDoctor —
> `observations.correct`, `codestatus.manage`, `beds.manage` and more.
> This map is a privilege-granting artifact with the same weight as
> `Rbac.cs`. **No clinical mapping ships as a default and none may be
> added without explicit hospital approval**; CI refuses a hard-coded
> clinical title.

Multi-role accounts resolve deterministically or not at all: if the
account's mapped roles disagree on a title, access is **denied** with
that reason. Precedence is not invented here — the hospital resolves it
by not mapping two roles to conflicting titles.

## Patient correlation — schema only

`IcuPatientCorrelations` (OpenMRS patient uuid ↔ ICU patientId, with
source, actor, active/retired and dated audit) ships in P1 **empty**.
Nothing in P1 writes a row; CI refuses a write. P1 shows
confirmed / probable / no-match results only. Deliberate staff
confirmation and correlated admission are a later phase.

## Building and mounting

**ONE image serves both the workspace and its API.** `server/Dockerfile`
has always carried the compiled bundle in `wwwroot` beside the API; P1
adds a base path so that bundle can live at `/icu`. Build from the ICU
repository root (the build context is the repo root — the frontend
sources live outside `server/`):

```
docker build -f server/Dockerfile \
  --build-arg VITE_BASE=/icu/ \
  --build-arg VITE_APP_ENV=production \
  -t aurora-his/aurora-icu:p1 .
```

`VITE_BASE` does two things from one value, and the Dockerfile derives
both so they cannot drift: Vite rewrites every asset URL to
`/icu/assets/…`, and the bundle is placed in `wwwroot/icu` with
`FRONTEND_BASE_PATH=/icu/` baked in so the server finds `index.html`
there and scopes its SPA fallback to that prefix. Requests outside the
base get an honest 404 rather than the ICU app.

Omit `VITE_BASE` and everything behaves exactly as before — bundle at the
`wwwroot` root, served at `/`. That is what Render, the appliance, dev
and CI keep doing; nothing about them changes.

`VITE_APP_ENV` **must equal** the `APP_ENV` the container runs with. They
are checked against each other at runtime: a mismatch replaces the whole
app with a full-screen refusal, by design.

The ICU service publishes no host port. It is reachable only through the
approved proxy paths.

## Before a clinician can use ICU

1. Build and load the ICU image (one image — see above).
2. Set `ICU_APP_ENV`, `ICU_DATABASE_URL`, `ICU_JWT_SECRET`,
   `ICU_FORMULARY_SEED`, `ICU_CORS_ORIGINS`,
   `ICU_ADMIN_BOOTSTRAP_PASSWORD`, `ICU_BRIDGE_ALLOWED_ORIGIN`.
3. Grant the OpenMRS privilege `app:icu` to the roles that should see the
   ICU link in Aurora.
4. Decide the role map. Start with (a); every clinical row needs hospital
   approval.
5. Confirm the OpenMRS session cookie's `Path`/`Secure`/`SameSite` once
   in the browser's developer tools (Name/Path/Secure/SameSite columns
   only — never a value).
