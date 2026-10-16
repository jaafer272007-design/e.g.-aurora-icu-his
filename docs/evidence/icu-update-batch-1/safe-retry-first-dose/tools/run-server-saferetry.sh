#!/bin/bash
# local synthetic stack for the safe-retry / first-dose checks: a published server dir (arg 1 —
# the build under test, or the pre-change build for the reproduction run) + its staging
# frontend in wwwroot, local PostgreSQL 16, synthetic DB aurora_saferetry
export DOTNET_ROOT=/root/.dotnet PATH=/root/.dotnet:$PATH
export PORT=8080 APP_ENV=staging TZ=Asia/Baghdad AURORA_EDITION=icu AI_PROVIDER=none AI_UNAVAILABLE_REASON="no AI in the ICU product"
export DATABASE_URL=postgres://aurora:${AURORA_LOCAL_DB_PASSWORD}@localhost:5432/${SAFERETRY_DB:-aurora_saferetry}
export JWT_SECRET=$(cat /tmp/claude-0/-home-user-e-g--aurora-icu-his/c677fc5a-2628-5760-a6c5-a453bbda3723/scratchpad/jwt.secret)
export CORS_ORIGINS=https://jaafer272007-design.github.io
export RENDER_GIT_COMMIT=$(git -C /home/user/e.g.-aurora-icu-his rev-parse HEAD)-local
cd "$1" && exec dotnet AuroraIcu.Api.dll
