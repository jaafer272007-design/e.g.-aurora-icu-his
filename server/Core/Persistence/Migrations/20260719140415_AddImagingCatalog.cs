using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AuroraIcu.Api.Core.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddImagingCatalog : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "StudyId",
                table: "Orders",
                type: "text",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "ImagingCatalog",
                columns: table => new
                {
                    StudyId = table.Column<string>(type: "text", nullable: false),
                    Seq = table.Column<int>(type: "integer", nullable: false),
                    Name = table.Column<string>(type: "text", nullable: false),
                    Modality = table.Column<string>(type: "text", nullable: false),
                    Region = table.Column<string>(type: "text", nullable: false),
                    Contrast = table.Column<bool>(type: "boolean", nullable: false),
                    Portable = table.Column<bool>(type: "boolean", nullable: false),
                    Active = table.Column<bool>(type: "boolean", nullable: false),
                    EventsJson = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ImagingCatalog", x => x.StudyId);
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ImagingCatalog");

            migrationBuilder.DropColumn(
                name: "StudyId",
                table: "Orders");
        }
    }
}
