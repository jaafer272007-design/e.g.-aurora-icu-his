using System.ComponentModel.DataAnnotations;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using Aurora.Core.Persistence;
using Aurora.Core.Shared;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;

namespace Aurora.Core.Identity;

static class AuthApi
{
    /* POST /api/auth/login — Phase 2's authentication endpoint (anonymous).
       Accepts username OR full display name + password; verifies against the
       bcrypt hash; returns a JWT whose claims carry the user's identity and
       JobTitle. Failure is ALWAYS the same generic 401 — never reveals whether
       the username or the password was wrong. `decoyHash` is verified against
       when the username doesn't exist, so unknown-user and wrong-password
       take the same time (no user enumeration via timing). */
    public static void Map(WebApplication app, SymmetricSecurityKey jwtKey, string decoyHash)
    {
        app.MapPost("/api/auth/login", (LoginRequest req, AuroraDb db) =>
        {
            var input = (req.Username ?? "").Trim().ToLowerInvariant();
            var user = input.Length == 0 ? null : db.Users.AsNoTracking()
                .AsEnumerable()
                .FirstOrDefault(u => u.Username == input || u.Name.ToLowerInvariant() == input);
            var verified = BCrypt.Net.BCrypt.Verify(req.Password ?? "", user?.PasswordHash ?? decoyHash);
            if (user is null || !verified)
                return Results.Json(new { error = "Invalid credentials" }, JsonOpts.Web, statusCode: 401);

            var now = DateTime.UtcNow;
            var token = new JwtSecurityTokenHandler().WriteToken(new JwtSecurityToken(
                issuer: Jwt.Issuer,
                audience: Jwt.Audience,
                claims:
                [
                    new Claim(JwtRegisteredClaimNames.Sub, user.Username),
                    new Claim(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString()),
                    new Claim("name", user.Name),
                    new Claim("jobTitle", user.JobTitle),
                ],
                notBefore: now,
                expires: now.AddHours(12), // one shift
                signingCredentials: new SigningCredentials(jwtKey, SecurityAlgorithms.HmacSha256)));
            return Results.Json(new { token, name = user.Name, jobTitle = user.JobTitle }, JsonOpts.Web);
        });
    }
}

/* One row per staff account (Stage 10 Phase 2). Only the bcrypt hash is
   stored — never a plaintext password. PermissionProfile/permissions are
   deliberately NOT columns: they are derived from JobTitle at read time
   (locked RBAC rule), on the client today and server-side from Phase 3. */
class UserRow
{
    [Key]
    public string Username { get; set; } = "";
    public string Name { get; set; } = "";
    public string JobTitle { get; set; } = "";
    public string PasswordHash { get; set; } = "";
}

record UserSeedDto(string Username, string Name, string JobTitle);

record LoginRequest(string? Username, string? Password);
