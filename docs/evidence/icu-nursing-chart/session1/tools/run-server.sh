#!/bin/bash
# Session 1 local synthetic stack: a published server dir (arg 1) against local disposable
# PostgreSQL 16 (database arg 2, default aurora_nursing1). Synthetic data only; no hospital.
# Secrets come from the session scratchpad (never committed): db.pw, jwt.secret.
S=${SCRATCH:?set SCRATCH to the session scratchpad}
export DOTNET_ROOT=/root/.dotnet PATH=/root/.dotnet:$PATH
export PORT=${PORT:-8080} APP_ENV=${APP_ENV:-staging} TZ=Asia/Baghdad AURORA_EDITION=icu AI_PROVIDER=none AI_UNAVAILABLE_REASON="no AI in the ICU product"
export DATABASE_URL=postgres://aurora:$(cat $S/db.pw)@localhost:5432/${2:-aurora_nursing1}
export JWT_SECRET=$(cat $S/jwt.secret)
export CORS_ORIGINS=${CORS_ORIGINS:-http://localhost:5173}
# a production boot (APP_ENV=production) also needs FORMULARY_SEED, a non-localhost CORS_ORIGINS and,
# on a first boot, ADMIN_BOOTSTRAP_PASSWORD (scratchpad only) — passed through from the caller's env
export RENDER_GIT_COMMIT=${BUILD_COMMIT:?set BUILD_COMMIT to the source commit of the build under test}-local
cd "$1" && exec dotnet AuroraIcu.Api.dll
