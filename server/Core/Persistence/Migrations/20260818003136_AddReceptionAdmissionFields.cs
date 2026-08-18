using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AuroraIcu.Api.Core.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddReceptionAdmissionFields : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "AdmissionSourceCode",
                table: "Encounters",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "AdmissionTypeCode",
                table: "Encounters",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "AdmittingDoctorUserId",
                table: "Encounters",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "DepartmentCode",
                table: "Encounters",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ReferrerName",
                table: "Encounters",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ReferrerUserId",
                table: "Encounters",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ServiceCode",
                table: "Encounters",
                type: "text",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "AdmissionSourceCode",
                table: "Encounters");

            migrationBuilder.DropColumn(
                name: "AdmissionTypeCode",
                table: "Encounters");

            migrationBuilder.DropColumn(
                name: "AdmittingDoctorUserId",
                table: "Encounters");

            migrationBuilder.DropColumn(
                name: "DepartmentCode",
                table: "Encounters");

            migrationBuilder.DropColumn(
                name: "ReferrerName",
                table: "Encounters");

            migrationBuilder.DropColumn(
                name: "ReferrerUserId",
                table: "Encounters");

            migrationBuilder.DropColumn(
                name: "ServiceCode",
                table: "Encounters");
        }
    }
}
