using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AuroraIcu.Api.Core.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddLabResultSource : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "Source",
                table: "LabDraws",
                type: "text",
                nullable: false,
                defaultValue: "");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Source",
                table: "LabDraws");
        }
    }
}
