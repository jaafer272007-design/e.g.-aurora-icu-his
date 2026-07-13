using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AuroraIcu.Api.Core.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddLabResultEditing : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "AmendmentsJson",
                table: "LabDraws",
                type: "text",
                nullable: false,
                /* hand-set (the AddResultAudit EventsJson lesson): pre-existing
                   rows must come through as a VALID empty amendment list, never
                   an unparseable empty string */
                defaultValue: "[]");

            migrationBuilder.AddColumn<string>(
                name: "DocumentedAt",
                table: "LabDraws",
                type: "text",
                nullable: false,
                defaultValue: "");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "AmendmentsJson",
                table: "LabDraws");

            migrationBuilder.DropColumn(
                name: "DocumentedAt",
                table: "LabDraws");
        }
    }
}
