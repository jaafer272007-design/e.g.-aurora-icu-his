using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Aurora.Core.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddOrderEncounterScope : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "EncounterId",
                table: "Orders",
                type: "text",
                nullable: false,
                defaultValue: "");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "EncounterId",
                table: "Orders");
        }
    }
}
