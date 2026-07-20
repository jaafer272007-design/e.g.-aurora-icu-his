using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AuroraIcu.Api.Core.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddObservationsCatalogueManagement : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            /* HAND-EDITED from the scaffold (which defaulted Active to
               false — that would have RETIRED every existing observation):
               every pre-existing type stays ACTIVE, ranges stay NULL
               (never fabricated), and the score-input lock flag is
               backfilled below for exactly the verified 12. */
            migrationBuilder.AddColumn<bool>(
                name: "Active",
                table: "ObservationTypes",
                type: "boolean",
                nullable: false,
                defaultValue: true);

            migrationBuilder.AddColumn<double>(
                name: "CritHigh",
                table: "ObservationTypes",
                type: "double precision",
                nullable: true);

            migrationBuilder.AddColumn<double>(
                name: "CritLow",
                table: "ObservationTypes",
                type: "double precision",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "Custom",
                table: "ObservationTypes",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "EventsJson",
                table: "ObservationTypes",
                type: "text",
                nullable: false,
                defaultValue: "[]");

            migrationBuilder.AddColumn<double>(
                name: "RefHigh",
                table: "ObservationTypes",
                type: "double precision",
                nullable: true);

            migrationBuilder.AddColumn<double>(
                name: "RefLow",
                table: "ObservationTypes",
                type: "double precision",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "ScoreInput",
                table: "ObservationTypes",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            /* 🔴 the score-input lock backfill — the exhaustively-verified
               NEWS2/SOFA observation inputs (ObservationCatalog.
               ScoreInputTypes; boot re-asserts this every start). TRUE is
               valid on PostgreSQL and SQLite (3.23+) alike. */
            migrationBuilder.Sql(
                "UPDATE \"ObservationTypes\" SET \"ScoreInput\" = TRUE WHERE \"TypeCode\" IN " +
                "('rr','spo2','fio2','sbp','hr','temp','acvpu','resp_support','gcs','gcs_total','map','urine_output')");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Active",
                table: "ObservationTypes");

            migrationBuilder.DropColumn(
                name: "CritHigh",
                table: "ObservationTypes");

            migrationBuilder.DropColumn(
                name: "CritLow",
                table: "ObservationTypes");

            migrationBuilder.DropColumn(
                name: "Custom",
                table: "ObservationTypes");

            migrationBuilder.DropColumn(
                name: "EventsJson",
                table: "ObservationTypes");

            migrationBuilder.DropColumn(
                name: "RefHigh",
                table: "ObservationTypes");

            migrationBuilder.DropColumn(
                name: "RefLow",
                table: "ObservationTypes");

            migrationBuilder.DropColumn(
                name: "ScoreInput",
                table: "ObservationTypes");
        }
    }
}
