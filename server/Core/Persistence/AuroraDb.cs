using Aurora.Core.Adt;
using Aurora.Core.Ai;
using Aurora.Core.Identity;
using Aurora.Core.MasterData;
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
    /* AI grounded query chat: the query AUDIT log (a patient-data access
       log — append-only, the PatientAssignment row-is-the-record shape).
       The seeded AiRisks table it replaces is DROPPED by migration: the
       fabricated risk domain is deleted, not disabled. */
    public DbSet<AiQueryRow> AiQueries => Set<AiQueryRow>();
    /* Layer 2 ADT (Aurora Core): Patient persists across visits; Encounter
       is one admission; Bed is a place (occupancy derived, never stored) */
    public DbSet<Patient> AdtPatients => Set<Patient>();
    public DbSet<Encounter> Encounters => Set<Encounter>();
    public DbSet<BedRow> Beds => Set<BedRow>();
    /* Layer 4 Master Data (Aurora Core): the reference layer Pharmacy
       maintains — drugs, the named frequency vocabulary, interaction rules */
    public DbSet<FormularyDrugRow> FormularyDrugs => Set<FormularyDrugRow>();
    public DbSet<NamedFrequencyRow> NamedFrequencies => Set<NamedFrequencyRow>();
    public DbSet<InteractionRuleRow> InteractionRules => Set<InteractionRuleRow>();
    /* Layer 4 phase 2: the lab test catalogue (Laboratory's reference
       layer) and order sets (clinical bundles referencing both) */
    public DbSet<LabTestRow> LabTests => Set<LabTestRow>();
    public DbSet<OrderSetRow> OrderSets => Set<OrderSetRow>();
    /* Code Status governed vocabulary (the free-text SAFETY FIX): the
       per-hospital resuscitation-instruction vocabulary — clinically
       governed (SeniorDoctor), selected never typed */
    public DbSet<CodeStatusRow> CodeStatuses => Set<CodeStatusRow>();
    /* Hospital Identity (the Configuration area's foundation): the
       install's OWN identity — one record, administratively governed
       (office Administrator), amend-never-erase. Unset on a fresh
       install: surfaces render a neutral placeholder, never a default */
    public DbSet<HospitalIdentityRow> HospitalIdentity => Set<HospitalIdentityRow>();
    /* Patient Assignment & Responsibility (Aurora Core): who is
       responsible for a patient right now — encounter-scoped,
       many-to-many, ended-never-deleted; a WORKLIST, never an authority */
    public DbSet<Aurora.Core.Assignments.PatientAssignment> Assignments => Set<Aurora.Core.Assignments.PatientAssignment>();
    /* Stage 11 (design §12 step 1): the GENERIC Observation record plus
       the data-driven Type Catalogue and group enablement — types and
       groups are DATA, never schema */
    public DbSet<Aurora.Core.Observations.ObservationRow> Observations => Set<Aurora.Core.Observations.ObservationRow>();
    public DbSet<Aurora.Core.Nursing.HandoffRow> Handoffs => Set<Aurora.Core.Nursing.HandoffRow>();
    public DbSet<Aurora.Core.Observations.ObservationTypeRow> ObservationTypes => Set<Aurora.Core.Observations.ObservationTypeRow>();
    public DbSet<Aurora.Core.Observations.ObservationGroupRow> ObservationGroups => Set<Aurora.Core.Observations.ObservationGroupRow>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        /* COLLATION PARITY (the architectural review's risk #1): SQLite
           orders strings by raw bytes; PostgreSQL by the database locale.
           Every DB-side ORDER BY on a string column is pinned to collation
           "C" (byte order) so Postgres output is byte-identical to the
           SQLite behavior the wire contract was verified against. These are
           the ONLY string columns ordered in SQL — PatientId (roster),
           LabId (labs), StudyId (imaging); Seq is an int, and the inbox/
           timeline sorts all happen in memory after
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
            /* Stage 11: the chart is ordered by ClinicalTime then
               ObservationId in SQL — both pinned */
            b.Entity<Aurora.Core.Observations.ObservationRow>().Property(o => o.ObservationId).UseCollation("C");
            b.Entity<Aurora.Core.Observations.ObservationRow>().Property(o => o.ClinicalTime).UseCollation("C");
        }
    }
}
