using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Aurora.Core.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddAdt : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "AdtPatients",
                columns: table => new
                {
                    PatientId = table.Column<string>(type: "text", nullable: false, collation: "C"),
                    Mrn = table.Column<string>(type: "text", nullable: false),
                    Name = table.Column<string>(type: "text", nullable: false),
                    Age = table.Column<int>(type: "integer", nullable: false),
                    Sex = table.Column<string>(type: "text", nullable: false),
                    Allergies = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AdtPatients", x => x.PatientId);
                });

            migrationBuilder.CreateTable(
                name: "Beds",
                columns: table => new
                {
                    BedId = table.Column<string>(type: "text", nullable: false, collation: "C"),
                    Area = table.Column<string>(type: "text", nullable: false),
                    Seq = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Beds", x => x.BedId);
                });

            migrationBuilder.CreateTable(
                name: "Encounters",
                columns: table => new
                {
                    EncounterId = table.Column<string>(type: "text", nullable: false, collation: "C"),
                    PatientId = table.Column<string>(type: "text", nullable: false, collation: "C"),
                    BedId = table.Column<string>(type: "text", nullable: false),
                    Diagnosis = table.Column<string>(type: "text", nullable: false),
                    Attending = table.Column<string>(type: "text", nullable: false),
                    Status = table.Column<string>(type: "text", nullable: false),
                    AdmittedAt = table.Column<string>(type: "text", nullable: false),
                    AdmittedBy = table.Column<string>(type: "text", nullable: false),
                    DischargedAt = table.Column<string>(type: "text", nullable: true),
                    DischargedBy = table.Column<string>(type: "text", nullable: true),
                    EventsJson = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Encounters", x => x.EncounterId);
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "AdtPatients");

            migrationBuilder.DropTable(
                name: "Beds");

            migrationBuilder.DropTable(
                name: "Encounters");
        }
    }
}
