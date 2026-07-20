using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AuroraIcu.Api.Core.Persistence.Migrations
{
    /// <inheritdoc />
    /// MIGRATION HONESTY (hand-checked): pure-additive — five new columns
    /// on the single-row HospitalIdentity table, all defaulting to
    /// unset ('' / 0). An upgraded install keeps its configured identity
    /// exactly and gains NO branding it never set: no header/footer text,
    /// no logo (the letterhead keeps its placeholder until the office
    /// Administrator uploads one). Nothing existing is modified.
    public partial class AddHospitalBranding : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "FooterText",
                table: "HospitalIdentity",
                type: "text",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "HeaderText",
                table: "HospitalIdentity",
                type: "text",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "LogoBase64",
                table: "HospitalIdentity",
                type: "text",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "LogoMime",
                table: "HospitalIdentity",
                type: "text",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<int>(
                name: "LogoVersion",
                table: "HospitalIdentity",
                type: "integer",
                nullable: false,
                defaultValue: 0);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "FooterText",
                table: "HospitalIdentity");

            migrationBuilder.DropColumn(
                name: "HeaderText",
                table: "HospitalIdentity");

            migrationBuilder.DropColumn(
                name: "LogoBase64",
                table: "HospitalIdentity");

            migrationBuilder.DropColumn(
                name: "LogoMime",
                table: "HospitalIdentity");

            migrationBuilder.DropColumn(
                name: "LogoVersion",
                table: "HospitalIdentity");
        }
    }
}
