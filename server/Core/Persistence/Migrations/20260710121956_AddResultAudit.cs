using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Aurora.Core.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddResultAudit : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "EncounterId",
                table: "LabDraws",
                type: "text",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "EventsJson",
                table: "LabDraws",
                type: "text",
                nullable: false,
                /* hand-set (Layer 3 lesson): pre-existing rows must come
                   through as a VALID empty history, never an unparseable
                   empty string */
                defaultValue: "[]");

            migrationBuilder.AddColumn<string>(
                name: "EncounterId",
                table: "ImagingStudies",
                type: "text",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "EventsJson",
                table: "ImagingStudies",
                type: "text",
                nullable: false,
                defaultValue: "[]");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "EncounterId",
                table: "LabDraws");

            migrationBuilder.DropColumn(
                name: "EventsJson",
                table: "LabDraws");

            migrationBuilder.DropColumn(
                name: "EncounterId",
                table: "ImagingStudies");

            migrationBuilder.DropColumn(
                name: "EventsJson",
                table: "ImagingStudies");
        }
    }
}
