using Aurora.Core.Adt;
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
    /* Layer 2 ADT (Aurora Core): Patient persists across visits; Encounter
       is one admission; Bed is a place (occupancy derived, never stored) */
    public DbSet<Patient> AdtPatients => Set<Patient>();
    public DbSet<Encounter> Encounters => Set<Encounter>();
    public DbSet<BedRow> Beds => Set<BedRow>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        /* COLLATION PARITY (the architectural review's risk #1): SQLite
           orders strings by raw bytes; PostgreSQL by the database locale.
           Every DB-side ORDER BY on a string column is pinned to collation
           "C" (byte order) so Postgres output is byte-identical to the
           SQLite behavior the wire contract was verified against. These are
           the ONLY string columns ordered in SQL — PatientId (roster),
           LabId (labs), StudyId (imaging); Seq is an int, and the inbox/
           timeline/AI-ranking sorts all happen in memory after
           AsEnumerable(). First fluent config in the project — provider
           correctness only, guarded because SQLite has no "C" collation. */
        if (Database.IsNpgsql())
        {
            b.Entity<PatientRow>().Property(p => p.PatientId).UseCollation("C");
            b.Entity<LabDrawRow>().Property(p => p.LabId).UseCollation("C");
            b.Entity<ImagingStudyRow>().Property(p => p.StudyId).UseCollation("C");
            /* Layer 3: the user list is ordered by Username in SQL */
            b.Entity<UserRow>().Property(u => u.Username).UseCollation("C");
            /* ADT's DB-side ordered/joined string keys get the same pin */
            b.Entity<Patient>().Property(p => p.PatientId).UseCollation("C");
            b.Entity<Encounter>().Property(e => e.EncounterId).UseCollation("C");
            b.Entity<Encounter>().Property(e => e.PatientId).UseCollation("C");
            b.Entity<BedRow>().Property(x => x.BedId).UseCollation("C");
        }
    }
}
