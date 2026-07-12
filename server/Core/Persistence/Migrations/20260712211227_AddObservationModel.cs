using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AuroraIcu.Api.Core.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddObservationModel : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "ObservationGroups",
                columns: table => new
                {
                    GroupCode = table.Column<string>(type: "text", nullable: false),
                    DisplayName = table.Column<string>(type: "text", nullable: false),
                    Seq = table.Column<int>(type: "integer", nullable: false),
                    Enabled = table.Column<bool>(type: "boolean", nullable: false),
                    ChangedBy = table.Column<string>(type: "text", nullable: true),
                    ChangedAt = table.Column<string>(type: "text", nullable: true),
                    EventsJson = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ObservationGroups", x => x.GroupCode);
                });

            migrationBuilder.CreateTable(
                name: "ObservationTypes",
                columns: table => new
                {
                    TypeCode = table.Column<string>(type: "text", nullable: false),
                    GroupCode = table.Column<string>(type: "text", nullable: false),
                    DisplayName = table.Column<string>(type: "text", nullable: false),
                    Unit = table.Column<string>(type: "text", nullable: false),
                    ValueType = table.Column<string>(type: "text", nullable: false),
                    Min = table.Column<double>(type: "double precision", nullable: true),
                    Max = table.Column<double>(type: "double precision", nullable: true),
                    AllowedValuesJson = table.Column<string>(type: "text", nullable: true),
                    ComponentsJson = table.Column<string>(type: "text", nullable: true),
                    IsDerived = table.Column<bool>(type: "boolean", nullable: false),
                    DerivationInputsJson = table.Column<string>(type: "text", nullable: true),
                    Optional = table.Column<bool>(type: "boolean", nullable: false),
                    Seq = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ObservationTypes", x => x.TypeCode);
                });

            migrationBuilder.CreateTable(
                name: "Observations",
                columns: table => new
                {
                    ObservationId = table.Column<string>(type: "text", nullable: false, collation: "C"),
                    PatientId = table.Column<string>(type: "text", nullable: false),
                    EncounterId = table.Column<string>(type: "text", nullable: false),
                    TypeCode = table.Column<string>(type: "text", nullable: false),
                    Value = table.Column<string>(type: "text", nullable: false),
                    Unit = table.Column<string>(type: "text", nullable: false),
                    ClinicalTime = table.Column<string>(type: "text", nullable: false, collation: "C"),
                    Source = table.Column<string>(type: "text", nullable: false),
                    DeviceId = table.Column<string>(type: "text", nullable: true),
                    RecordedBy = table.Column<string>(type: "text", nullable: false),
                    EnteredAt = table.Column<string>(type: "text", nullable: false),
                    VerifiedBy = table.Column<string>(type: "text", nullable: true),
                    AmendmentsJson = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Observations", x => x.ObservationId);
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ObservationGroups");

            migrationBuilder.DropTable(
                name: "ObservationTypes");

            migrationBuilder.DropTable(
                name: "Observations");
        }
    }
}
