using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AuroraIcu.Api.Core.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddCodeStatusVocabulary : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "CodeStatusCode",
                table: "Encounters",
                type: "text",
                nullable: true);

            /* "[]" not "" — the migration default lands on EVERY existing
               Encounters row, and Encounter.ToDto deserializes it
               unconditionally; "" would crash every encounter read on
               pre-feature rows (the AddEncounterWeightHeight precedent). */
            migrationBuilder.AddColumn<string>(
                name: "CodeStatusEventsJson",
                table: "Encounters",
                type: "text",
                nullable: false,
                defaultValue: "[]");

            migrationBuilder.CreateTable(
                name: "CodeStatuses",
                columns: table => new
                {
                    Code = table.Column<string>(type: "text", nullable: false),
                    Label = table.Column<string>(type: "text", nullable: false),
                    Seq = table.Column<int>(type: "integer", nullable: false),
                    Active = table.Column<bool>(type: "boolean", nullable: false),
                    EventsJson = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CodeStatuses", x => x.Code);
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "CodeStatuses");

            migrationBuilder.DropColumn(
                name: "CodeStatusCode",
                table: "Encounters");

            migrationBuilder.DropColumn(
                name: "CodeStatusEventsJson",
                table: "Encounters");
        }
    }
}
