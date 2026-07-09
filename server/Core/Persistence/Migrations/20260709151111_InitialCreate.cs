using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Aurora.Core.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class InitialCreate : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "AiRisks",
                columns: table => new
                {
                    PatientId = table.Column<string>(type: "text", nullable: false),
                    Seq = table.Column<int>(type: "integer", nullable: false),
                    BedId = table.Column<string>(type: "text", nullable: false),
                    PatientName = table.Column<string>(type: "text", nullable: false),
                    UpdatedAt = table.Column<string>(type: "text", nullable: false),
                    RisksJson = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AiRisks", x => x.PatientId);
                });

            migrationBuilder.CreateTable(
                name: "ImagingStudies",
                columns: table => new
                {
                    StudyId = table.Column<string>(type: "text", nullable: false, collation: "C"),
                    PatientId = table.Column<string>(type: "text", nullable: false),
                    BedId = table.Column<string>(type: "text", nullable: false),
                    PatientName = table.Column<string>(type: "text", nullable: false),
                    Modality = table.Column<string>(type: "text", nullable: false),
                    Description = table.Column<string>(type: "text", nullable: false),
                    OrderedAt = table.Column<string>(type: "text", nullable: false),
                    PerformedAt = table.Column<string>(type: "text", nullable: true),
                    ReportedAt = table.Column<string>(type: "text", nullable: true),
                    Status = table.Column<string>(type: "text", nullable: false),
                    Report = table.Column<string>(type: "text", nullable: true),
                    Impression = table.Column<string>(type: "text", nullable: true),
                    Flag = table.Column<string>(type: "text", nullable: false),
                    Note = table.Column<string>(type: "text", nullable: true),
                    Acknowledged = table.Column<bool>(type: "boolean", nullable: false),
                    AcknowledgedBy = table.Column<string>(type: "text", nullable: true),
                    AcknowledgedAt = table.Column<string>(type: "text", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ImagingStudies", x => x.StudyId);
                });

            migrationBuilder.CreateTable(
                name: "LabDraws",
                columns: table => new
                {
                    LabId = table.Column<string>(type: "text", nullable: false, collation: "C"),
                    PatientId = table.Column<string>(type: "text", nullable: false),
                    BedId = table.Column<string>(type: "text", nullable: false),
                    PatientName = table.Column<string>(type: "text", nullable: false),
                    Panel = table.Column<string>(type: "text", nullable: false),
                    Label = table.Column<string>(type: "text", nullable: false),
                    CollectedAt = table.Column<string>(type: "text", nullable: false),
                    ResultedAt = table.Column<string>(type: "text", nullable: false),
                    ItemsJson = table.Column<string>(type: "text", nullable: false),
                    Flag = table.Column<string>(type: "text", nullable: false),
                    Note = table.Column<string>(type: "text", nullable: true),
                    Acknowledged = table.Column<bool>(type: "boolean", nullable: false),
                    AcknowledgedBy = table.Column<string>(type: "text", nullable: true),
                    AcknowledgedAt = table.Column<string>(type: "text", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_LabDraws", x => x.LabId);
                });

            migrationBuilder.CreateTable(
                name: "Orders",
                columns: table => new
                {
                    OrderId = table.Column<string>(type: "text", nullable: false),
                    Seq = table.Column<int>(type: "integer", nullable: false),
                    PatientId = table.Column<string>(type: "text", nullable: false),
                    BedId = table.Column<string>(type: "text", nullable: false),
                    PatientName = table.Column<string>(type: "text", nullable: false),
                    Category = table.Column<string>(type: "text", nullable: false),
                    Summary = table.Column<string>(type: "text", nullable: false),
                    MedicationJson = table.Column<string>(type: "text", nullable: true),
                    Priority = table.Column<string>(type: "text", nullable: false),
                    Status = table.Column<string>(type: "text", nullable: false),
                    OrderedBy = table.Column<string>(type: "text", nullable: false),
                    OrderedTime = table.Column<string>(type: "text", nullable: false),
                    RequiresImplementation = table.Column<bool>(type: "boolean", nullable: true),
                    AdministrationsJson = table.Column<string>(type: "text", nullable: true),
                    HistoryJson = table.Column<string>(type: "text", nullable: false),
                    StatusReason = table.Column<string>(type: "text", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Orders", x => x.OrderId);
                });

            migrationBuilder.CreateTable(
                name: "Patients",
                columns: table => new
                {
                    PatientId = table.Column<string>(type: "text", nullable: false, collation: "C"),
                    BedId = table.Column<string>(type: "text", nullable: false),
                    Name = table.Column<string>(type: "text", nullable: false),
                    Mrn = table.Column<string>(type: "text", nullable: false),
                    Age = table.Column<int>(type: "integer", nullable: false),
                    Sex = table.Column<string>(type: "text", nullable: false),
                    Diagnosis = table.Column<string>(type: "text", nullable: false),
                    Los = table.Column<int>(type: "integer", nullable: false),
                    Allergies = table.Column<string>(type: "text", nullable: false),
                    Attending = table.Column<string>(type: "text", nullable: false),
                    CodeStatus = table.Column<string>(type: "text", nullable: false),
                    Rhythm = table.Column<string>(type: "text", nullable: false),
                    Isolation = table.Column<bool>(type: "boolean", nullable: false),
                    Severity = table.Column<string>(type: "text", nullable: false),
                    Sofa = table.Column<int>(type: "integer", nullable: false),
                    Ews = table.Column<int>(type: "integer", nullable: false),
                    FlagsJson = table.Column<string>(type: "text", nullable: false),
                    BedsideVitalsJson = table.Column<string>(type: "text", nullable: false),
                    BedAlertJson = table.Column<string>(type: "text", nullable: false),
                    MapTrendJson = table.Column<string>(type: "text", nullable: false),
                    MonitorVitalsJson = table.Column<string>(type: "text", nullable: false),
                    OrgansJson = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Patients", x => x.PatientId);
                });

            migrationBuilder.CreateTable(
                name: "Users",
                columns: table => new
                {
                    Username = table.Column<string>(type: "text", nullable: false),
                    Name = table.Column<string>(type: "text", nullable: false),
                    JobTitle = table.Column<string>(type: "text", nullable: false),
                    PasswordHash = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Users", x => x.Username);
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "AiRisks");

            migrationBuilder.DropTable(
                name: "ImagingStudies");

            migrationBuilder.DropTable(
                name: "LabDraws");

            migrationBuilder.DropTable(
                name: "Orders");

            migrationBuilder.DropTable(
                name: "Patients");

            migrationBuilder.DropTable(
                name: "Users");
        }
    }
}
