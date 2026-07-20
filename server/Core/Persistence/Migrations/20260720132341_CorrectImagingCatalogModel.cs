using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AuroraIcu.Api.Core.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class CorrectImagingCatalogModel : Migration
    {
        /// <inheritdoc />
        /* CORRECTED IMAGING MODEL (Imaging Catalogue Correction design §4):
           region and contrast move from the study DEFINITION to the ORDER.
           Order of operations is load-bearing — the new order columns are
           added FIRST, then the baked-in definition values are COPIED onto
           every historical order that references the study (so no existing
           order loses its region — the design's hard rule), and only then
           are the definition columns dropped. The copy uses correlated
           subqueries (valid on PostgreSQL and SQLite alike); NULLIF keeps
           an empty definition region as NULL rather than "". StudyIds and
           names are untouched — order→result linkage is preserved. */
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "Contrast",
                table: "Orders",
                type: "boolean",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Region",
                table: "Orders",
                type: "text",
                nullable: true);

            migrationBuilder.Sql("""
                UPDATE "Orders" SET
                    "Region" = (SELECT NULLIF(c."Region", '') FROM "ImagingCatalog" c WHERE c."StudyId" = "Orders"."StudyId"),
                    "Contrast" = (SELECT c."Contrast" FROM "ImagingCatalog" c WHERE c."StudyId" = "Orders"."StudyId")
                WHERE "StudyId" IS NOT NULL
                  AND EXISTS (SELECT 1 FROM "ImagingCatalog" c WHERE c."StudyId" = "Orders"."StudyId");
                """);

            migrationBuilder.DropColumn(
                name: "Contrast",
                table: "ImagingCatalog");

            migrationBuilder.DropColumn(
                name: "Portable",
                table: "ImagingCatalog");

            migrationBuilder.DropColumn(
                name: "Region",
                table: "ImagingCatalog");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Contrast",
                table: "Orders");

            migrationBuilder.DropColumn(
                name: "Region",
                table: "Orders");

            migrationBuilder.AddColumn<bool>(
                name: "Contrast",
                table: "ImagingCatalog",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "Portable",
                table: "ImagingCatalog",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "Region",
                table: "ImagingCatalog",
                type: "text",
                nullable: false,
                defaultValue: "");
        }
    }
}
