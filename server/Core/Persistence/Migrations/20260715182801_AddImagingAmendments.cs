using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AuroraIcu.Api.Core.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddImagingAmendments : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "AmendmentsJson",
                table: "ImagingStudies",
                type: "text",
                nullable: false,
                /* hand-set (the AddLabResultEditing precedent): pre-existing
                   rows must come through as a VALID empty amendment list,
                   never an unparseable empty string */
                defaultValue: "[]");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "AmendmentsJson",
                table: "ImagingStudies");
        }
    }
}
