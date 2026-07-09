using Aurora.Core.Ai;
using Aurora.Core.Identity;
using Aurora.Core.Orders;
using Aurora.Core.LabImaging;
using Aurora.Modules.Icu.Roster;
using Microsoft.EntityFrameworkCore;

namespace Aurora.Core.Persistence;

/* ---------- persistence ----------
   ONE convention-based context spanning every domain (renamed from
   RosterDb — Phase 1 history). SQLite today; the Postgres provider swap
   (the blocking prerequisite for Layer 2 ADT) changes the registration in
   Program.cs and replaces the boot-time reseed with migrations — not this
   class.

   NOTE the Patients set: PatientRow lives in Aurora.Modules.Icu.Roster —
   the SANCTIONED, temporary Core→Module seam (see CLAUDE.md "Platform
   Direction"). It dissolves at Layer 2 (ADT re-founds Patient/Encounter
   in Core) and Stage 11 (Observations absorb the bedside columns). */
class AuroraDb(DbContextOptions<AuroraDb> options) : DbContext(options)
{
    public DbSet<PatientRow> Patients => Set<PatientRow>();
    public DbSet<UserRow> Users => Set<UserRow>();
    public DbSet<LabDrawRow> LabDraws => Set<LabDrawRow>();
    public DbSet<ImagingStudyRow> ImagingStudies => Set<ImagingStudyRow>();
    public DbSet<OrderRow> Orders => Set<OrderRow>();
    public DbSet<AiRiskRow> AiRisks => Set<AiRiskRow>();
}
