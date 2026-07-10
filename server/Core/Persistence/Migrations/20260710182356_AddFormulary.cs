using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace AuroraIcu.Api.Core.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddFormulary : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "FormularyDrugs",
                columns: table => new
                {
                    DrugId = table.Column<string>(type: "text", nullable: false),
                    Seq = table.Column<int>(type: "integer", nullable: false),
                    Name = table.Column<string>(type: "text", nullable: false),
                    BrandNamesJson = table.Column<string>(type: "text", nullable: false),
                    DrugClass = table.Column<string>(type: "text", nullable: false),
                    Form = table.Column<string>(type: "text", nullable: false),
                    StrengthsJson = table.Column<string>(type: "text", nullable: false),
                    DosesJson = table.Column<string>(type: "text", nullable: false),
                    DefaultDose = table.Column<string>(type: "text", nullable: false),
                    DoseLimitsJson = table.Column<string>(type: "text", nullable: true),
                    RoutesJson = table.Column<string>(type: "text", nullable: false),
                    FrequenciesJson = table.Column<string>(type: "text", nullable: false),
                    PrnCapable = table.Column<bool>(type: "boolean", nullable: false),
                    AllergyBlockJson = table.Column<string>(type: "text", nullable: false),
                    AllergyWarnJson = table.Column<string>(type: "text", nullable: false),
                    Active = table.Column<bool>(type: "boolean", nullable: false),
                    EventsJson = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_FormularyDrugs", x => x.DrugId);
                });

            migrationBuilder.CreateTable(
                name: "InteractionRules",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    A = table.Column<string>(type: "text", nullable: false),
                    B = table.Column<string>(type: "text", nullable: false),
                    Severity = table.Column<string>(type: "text", nullable: false),
                    Note = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_InteractionRules", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "NamedFrequencies",
                columns: table => new
                {
                    Value = table.Column<string>(type: "text", nullable: false),
                    Seq = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_NamedFrequencies", x => x.Value);
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "FormularyDrugs");

            migrationBuilder.DropTable(
                name: "InteractionRules");

            migrationBuilder.DropTable(
                name: "NamedFrequencies");
        }
    }
}
