using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AuroraIcu.Api.Core.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddCustomLabResult : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "Custom",
                table: "LabDraws",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "CustomRefRange",
                table: "LabDraws",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "CustomUnit",
                table: "LabDraws",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "CustomValue",
                table: "LabDraws",
                type: "text",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Custom",
                table: "LabDraws");

            migrationBuilder.DropColumn(
                name: "CustomRefRange",
                table: "LabDraws");

            migrationBuilder.DropColumn(
                name: "CustomUnit",
                table: "LabDraws");

            migrationBuilder.DropColumn(
                name: "CustomValue",
                table: "LabDraws");
        }
    }
}
