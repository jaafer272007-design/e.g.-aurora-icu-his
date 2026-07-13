using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AuroraIcu.Api.Core.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddEncounterWeightHeight : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<double>(
                name: "HeightCm",
                table: "Encounters",
                type: "double precision",
                nullable: true);

            /* defaultValue hand-set to "[]" (the scaffold emits "") — every
               EXISTING Encounters row gets this value, and Encounter.ToDto
               deserializes it unconditionally; "" would crash every
               encounter read on pre-feature rows (the AddResultAudit /
               AddLabResultEditing precedent). */
            migrationBuilder.AddColumn<string>(
                name: "MeasurementsJson",
                table: "Encounters",
                type: "text",
                nullable: false,
                defaultValue: "[]");

            migrationBuilder.AddColumn<double>(
                name: "WeightKg",
                table: "Encounters",
                type: "double precision",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "HeightCm",
                table: "Encounters");

            migrationBuilder.DropColumn(
                name: "MeasurementsJson",
                table: "Encounters");

            migrationBuilder.DropColumn(
                name: "WeightKg",
                table: "Encounters");
        }
    }
}
