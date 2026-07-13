using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AuroraIcu.Api.Core.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddPatientWeightHeight : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<double>(
                name: "HeightCm",
                table: "AdtPatients",
                type: "double precision",
                nullable: true);

            /* defaultValue hand-set to "[]" (the scaffold emits "") — every
               EXISTING AdtPatients row gets this value, and Patient.ToDto
               deserializes it unconditionally; "" would crash the identity
               resolver on every pre-feature patient (the AddResultAudit /
               AddLabResultEditing precedent). */
            migrationBuilder.AddColumn<string>(
                name: "MeasurementsJson",
                table: "AdtPatients",
                type: "text",
                nullable: false,
                defaultValue: "[]");

            migrationBuilder.AddColumn<double>(
                name: "WeightKg",
                table: "AdtPatients",
                type: "double precision",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "HeightCm",
                table: "AdtPatients");

            migrationBuilder.DropColumn(
                name: "MeasurementsJson",
                table: "AdtPatients");

            migrationBuilder.DropColumn(
                name: "WeightKg",
                table: "AdtPatients");
        }
    }
}
