# AURORA ICU roster service — Stage 10 Phase 1.
# Plain two-stage .NET build: hosting stays swappable (Render today, any
# Docker host tomorrow) per the vendor-neutrality principle.
FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src
COPY AuroraIcu.Api.csproj ./
RUN dotnet restore
COPY . .
RUN dotnet publish -c Release -o /app/publish /p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/aspnet:8.0
WORKDIR /app
COPY --from=build /app/publish .
# PORT is injected by the platform (Render); 8080 for local runs
ENV PORT=8080
EXPOSE 8080
ENTRYPOINT ["dotnet", "AuroraIcu.Api.dll"]
