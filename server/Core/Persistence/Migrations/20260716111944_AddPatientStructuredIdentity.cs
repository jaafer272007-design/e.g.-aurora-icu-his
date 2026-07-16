using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AuroraIcu.Api.Core.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddPatientStructuredIdentity : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            /* hand-set (the AddLabResultEditing / AddImagingAmendments
               precedent): existing rows must get a VALID empty JSON array —
               the generated "" would break deserialization of the
               identity-correction history on every legacy patient */
            migrationBuilder.AddColumn<string>(
                name: "IdentityJson",
                table: "AdtPatients",
                type: "text",
                nullable: false,
                defaultValue: "[]");

            migrationBuilder.AddColumn<string>(
                name: "NameFamily",
                table: "AdtPatients",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "NameFirst",
                table: "AdtPatients",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "NameFourth",
                table: "AdtPatients",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "NameSecond",
                table: "AdtPatients",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "NameThird",
                table: "AdtPatients",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "NationalId",
                table: "AdtPatients",
                type: "text",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "IdentityJson",
                table: "AdtPatients");

            migrationBuilder.DropColumn(
                name: "NameFamily",
                table: "AdtPatients");

            migrationBuilder.DropColumn(
                name: "NameFirst",
                table: "AdtPatients");

            migrationBuilder.DropColumn(
                name: "NameFourth",
                table: "AdtPatients");

            migrationBuilder.DropColumn(
                name: "NameSecond",
                table: "AdtPatients");

            migrationBuilder.DropColumn(
                name: "NameThird",
                table: "AdtPatients");

            migrationBuilder.DropColumn(
                name: "NationalId",
                table: "AdtPatients");
        }
    }
}
