using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AuroraIcu.Api.Core.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddPatientDateOfBirth : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<int>(
                name: "Age",
                table: "AdtPatients",
                type: "integer",
                nullable: true,
                oldClrType: typeof(int),
                oldType: "integer");

            migrationBuilder.AddColumn<string>(
                name: "DateOfBirth",
                table: "AdtPatients",
                type: "text",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            /* HAND-EDITED (adversarial-review finding, never-fabricate
               rule): the scaffolded Down dropped DateOfBirth FIRST and
               then backfilled the restored NOT NULL Age with 0 — a
               rollback would silently turn every DOB-admitted patient
               into "age 0" while destroying the birth date. Materialize
               the age COMPUTED FROM the DOB (exactly what every read has
               been serving) BEFORE the column is dropped. Postgres-only
               SQL is safe here: the SQLite demo path never runs
               migrations (EnsureCreated). */
            migrationBuilder.Sql("""
                UPDATE "AdtPatients"
                SET "Age" = date_part('year', age(("DateOfBirth")::date))::int
                WHERE "Age" IS NULL AND "DateOfBirth" IS NOT NULL;
                """);

            migrationBuilder.DropColumn(
                name: "DateOfBirth",
                table: "AdtPatients");

            migrationBuilder.AlterColumn<int>(
                name: "Age",
                table: "AdtPatients",
                type: "integer",
                nullable: false,
                defaultValue: 0,
                oldClrType: typeof(int),
                oldType: "integer",
                oldNullable: true);
        }
    }
}
