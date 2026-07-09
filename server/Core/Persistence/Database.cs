using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;
using Npgsql;

namespace Aurora.Core.Persistence;

/* ---------- provider selection (Stage 10 — database persistence) ----------
   DATABASE_URL set   → PostgreSQL: EF Core migrations + durable writes.
                        Render wires it from the blueprint database; the
                        value is NEVER committed to the repo.
   DATABASE_URL unset → the ORIGINAL ephemeral SQLite demo mode (rebuilt +
                        reseeded every boot), retained ONLY so a plain local
                        `docker run` still works — the boot log warns loudly.
                        Render always runs Postgres. */
static class Db
{
    public static bool UsePostgres => !string.IsNullOrWhiteSpace(
        Environment.GetEnvironmentVariable("DATABASE_URL"));

    /** Render/Heroku-style postgres://user:pass@host:port/db URL → Npgsql
        keyword connection string. A string that already looks like keyword
        format passes through untouched (local testing convenience). */
    public static string NpgsqlConnectionString(string databaseUrl)
    {
        if (!databaseUrl.Contains("://")) return databaseUrl;
        var uri = new Uri(databaseUrl);
        var userInfo = uri.UserInfo.Split(':', 2);
        return new NpgsqlConnectionStringBuilder
        {
            Host = uri.Host,
            Port = uri.Port > 0 ? uri.Port : 5432,
            Username = Uri.UnescapeDataString(userInfo[0]),
            Password = userInfo.Length > 1 ? Uri.UnescapeDataString(userInfo[1]) : "",
            Database = uri.AbsolutePath.TrimStart('/'),
            /* Prefer = TLS when the server offers it (Render external),
               plaintext otherwise (Render internal URL, local container) */
            SslMode = SslMode.Prefer,
        }.ConnectionString;
    }
}

/* Design-time factory for `dotnet ef migrations …` — EF tools use this
   directly instead of booting Program.cs (which would seed a database at
   design time). Migrations are generated against the Npgsql provider; the
   connection string is only a placeholder (migrations add never connects). */
class AuroraDbDesignTimeFactory : IDesignTimeDbContextFactory<AuroraDb>
{
    public AuroraDb CreateDbContext(string[] args) =>
        new(new DbContextOptionsBuilder<AuroraDb>()
            .UseNpgsql("Host=localhost;Database=aurora;Username=postgres;Password=postgres")
            .Options);
}
