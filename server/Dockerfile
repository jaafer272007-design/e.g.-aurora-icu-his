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
RUN npx vite build

FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src
COPY server/AuroraIcu.Api.csproj ./
RUN dotnet restore
COPY server/ .
RUN dotnet publish -c Release -o /app/publish /p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/aspnet:8.0
WORKDIR /app
COPY --from=build /app/publish .
# the same-origin frontend: Program.cs detects wwwroot/index.html and
# serves it with the guarded SPA fallback (/api, /healthz, /build.txt
# never resolve to index.html)
COPY --from=frontend /fe/dist ./wwwroot
# PORT is injected by the platform (Render); 8080 for local runs
ENV PORT=8080
EXPOSE 8080
ENTRYPOINT ["dotnet", "AuroraIcu.Api.dll"]
