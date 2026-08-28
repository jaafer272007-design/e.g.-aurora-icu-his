# AURORA image — API + same-origin frontend (appliance Phase 1).
# Extended from the Stage 10 Phase 1 two-stage .NET build: a THIRD stage
# now compiles the React frontend and the final image carries it in
# wwwroot, so ONE origin serves the app and its /api (Program.cs's §11
# step 3 serving mode — present since PR #60, receiving a bundle for the
# first time here). Hosting stays swappable (Render today, the Docker
# Compose appliance next) per the vendor-neutrality principle.
#
# BUILD CONTEXT IS THE REPO ROOT (render.yaml: dockerfilePath
# server/Dockerfile, no rootDir) — the frontend sources live outside
# server/, so the old server/-scoped context could never see them.
#
# VITE_APP_ENV is the bundle's compiled-in environment identity (§11
# step 3): staging by default (Render). The Phase 2 appliance build
# passes production. The API BASE is NOT baked either way — the bundle
# resolves it at runtime from /runtime-config.js, whose shipped default
# is same-origin '' (exactly this image's topology).

FROM node:22-alpine AS frontend
WORKDIR /fe
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html vite.config.ts tsconfig.json tsconfig.app.json tsconfig.node.json ./
COPY public ./public
COPY src ./src
ARG VITE_APP_ENV=staging
ENV VITE_APP_ENV=$VITE_APP_ENV
# ICU Integration P1 — the PUBLIC PATH this bundle is built for. Default
# "/" is every existing deployment (Render, the appliance, dev, CI),
# byte-for-byte what this stage produced before. "/icu/" builds the
# bundle for the Bahmni sub-path mount: Vite rewrites every asset URL to
# /icu/assets/..., which is what the browser will actually request once
# the proxy publishes the app there.
ARG VITE_BASE=/
RUN npx vite build --base=$VITE_BASE

FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src
COPY server/AuroraIcu.Api.csproj ./
RUN dotnet restore
COPY server/ .
RUN dotnet publish -c Release -o /app/publish /p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/aspnet:8.0
WORKDIR /app
# PostgreSQL 16 client tools (Backup & DR — the hard go-live gate).
# The backup CLI (`docker exec aurora dotnet AuroraIcu.Api.dll backup`)
# shells out to pg_dump/pg_restore; they must be version >= the
# postgres:16-alpine server, and the base aspnet image (Debian bookworm)
# ships only client 15 by default. Add the official PGDG repo and pull
# client 16 — postgresql-client-common installs version-dispatching
# /usr/bin/pg_dump + pg_restore wrappers, so they land on PATH.
# (On-prem the appliance host has no Postgres install; these tools live
# inside the container, exactly like the nightly dump does — design §2.)
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl gnupg ca-certificates \
 && install -d /usr/share/postgresql-common/pgdg \
 && curl -sSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc \
 && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends postgresql-client-16 \
 && apt-get purge -y --auto-remove gnupg \
 && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/publish .
# the same-origin frontend, served with the guarded SPA fallback (/api,
# /healthz and /build.txt never resolve to index.html).
#
# ONE VALUE, TWO PLACES, AND THEY MUST MATCH: the bundle is built for
# VITE_BASE and must then LIVE at that path under wwwroot, because the
# request path mirrors the directory (/icu/assets/x.js is served from
# wwwroot/icu/assets/x.js). FRONTEND_BASE_PATH tells Program.cs the same
# thing so it can find index.html and scope the SPA fallback. Both are
# derived from VITE_BASE here so a caller cannot set one and forget the
# other — a mismatch would be a loud 404, but it should be impossible.
ARG VITE_BASE=/
ENV FRONTEND_BASE_PATH=$VITE_BASE
COPY --from=frontend /fe/dist ./wwwroot/_base
RUN set -eu; base="$(printf %s "$VITE_BASE" | sed 's#^/##; s#/$##')"; \
    if [ -z "$base" ]; then \
      mv /app/wwwroot/_base/* /app/wwwroot/ && rmdir /app/wwwroot/_base; \
    else \
      mkdir -p "/app/wwwroot/$base" \
      && mv /app/wwwroot/_base/* "/app/wwwroot/$base/" && rmdir /app/wwwroot/_base; \
    fi; \
    test -f "/app/wwwroot/${base:+$base/}index.html"
# PORT is injected by the platform (Render); 8080 for local runs
ENV PORT=8080
EXPOSE 8080
ENTRYPOINT ["dotnet", "AuroraIcu.Api.dll"]
