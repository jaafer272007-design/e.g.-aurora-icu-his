using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AuroraIcu.Api.Core.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddBedRegistry : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            /* LIVE-UPGRADE RULE (bed-registry design §2): existing beds
               become ACTIVE — a hospital's beds must not vanish from the
               board on upgrade — and carry an EMPTY audit history (a
               valid JSON list; pre-registry beds get no invented events).
               The scaffolded defaults (false / "") would have retired
               every existing bed and broken History() deserialization —
               the recorded default-trap, fixed by hand. */
            migrationBuilder.AddColumn<bool>(
                name: "Active",
                table: "Beds",
                type: "boolean",
                nullable: false,
                defaultValue: true);

            migrationBuilder.AddColumn<string>(
                name: "EventsJson",
                table: "Beds",
                type: "text",
                nullable: false,
                defaultValue: "[]");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Active",
                table: "Beds");

            migrationBuilder.DropColumn(
                name: "EventsJson",
                table: "Beds");
        }
    }
}
