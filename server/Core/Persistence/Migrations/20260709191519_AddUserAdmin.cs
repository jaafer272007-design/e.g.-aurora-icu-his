using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Aurora.Core.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddUserAdmin : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<string>(
                name: "Username",
                table: "Users",
                type: "text",
                nullable: false,
                collation: "C",
                oldClrType: typeof(string),
                oldType: "text");

            /* backfill defaults HAND-SET (the scaffold emitted false/""):
               the 20 pre-Layer-3 accounts on the durable database must come
               through the migration ACTIVE with an empty-but-valid audit
               history — false would deactivate every seeded account and ""
               would break the JSON deserialization on first read */
            migrationBuilder.AddColumn<bool>(
                name: "Active",
                table: "Users",
                type: "boolean",
                nullable: false,
                defaultValue: true);

            migrationBuilder.AddColumn<string>(
                name: "EventsJson",
                table: "Users",
                type: "text",
                nullable: false,
                defaultValue: "[]");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Active",
                table: "Users");

            migrationBuilder.DropColumn(
                name: "EventsJson",
                table: "Users");

            migrationBuilder.AlterColumn<string>(
                name: "Username",
                table: "Users",
                type: "text",
                nullable: false,
                oldClrType: typeof(string),
                oldType: "text",
                oldCollation: "C");
        }
    }
}
