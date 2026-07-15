using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AuroraIcu.Api.Core.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddImagingDocumentation : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "DocumentedAt",
                table: "ImagingStudies",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "OrderId",
                table: "ImagingStudies",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ReportingRadiologist",
                table: "ImagingStudies",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Source",
                table: "ImagingStudies",
                type: "text",
                nullable: false,
                defaultValue: "");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "DocumentedAt",
                table: "ImagingStudies");

            migrationBuilder.DropColumn(
                name: "OrderId",
                table: "ImagingStudies");

            migrationBuilder.DropColumn(
                name: "ReportingRadiologist",
                table: "ImagingStudies");

            migrationBuilder.DropColumn(
                name: "Source",
                table: "ImagingStudies");
        }
    }
}
