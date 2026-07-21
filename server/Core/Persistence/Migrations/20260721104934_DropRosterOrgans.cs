using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AuroraIcu.Api.Core.Persistence.Migrations
{
    /* MIGRATION HONESTY (hand-checked): drops the FABRICATED per-patient
       organ snapshot (OrgansJson) — seeded demo fixtures, plus an all-"ok"
       compose-time default that painted every fresh admission's digital
       twin green regardless of the scores (the no-reassuring-default
       rule). Organ status is now DERIVED at render from the computed
       SOFA, so the column has no reader — the same shape as
       DropRosterSofaEws, which dropped the fabricated score columns when
       the real Clinical Scoring Engine arrived. The "may result in data
       loss" scaffold warning is CORRECT and INTENDED: the only data lost
       is the fixture. Down restores the column empty (the fixture is not
       reconstructable and must not be). */
    /// <inheritdoc />
    public partial class DropRosterOrgans : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "OrgansJson",
                table: "Patients");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "OrgansJson",
                table: "Patients",
                type: "text",
                nullable: false,
                defaultValue: "");
        }
    }
}
