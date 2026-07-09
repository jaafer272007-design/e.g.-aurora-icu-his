using System.Security.Cryptography;
using System.Text;
using Microsoft.IdentityModel.Tokens;

namespace Aurora.Core.Identity;

/* ---- JWT (Stage 10 Phase 2) ----
   Signing key from JWT_SECRET (any length — hashed to 256 bits). When the
   env var is unset a random per-boot key is generated: fine for the demo
   (tokens simply expire when the free-tier service restarts), and it means
   no secret ever lives in the repo. Validation is registered ONCE in the
   composition root (Program.cs) so endpoints opt in with just
   `.RequireAuthorization()`. */
static class Jwt
{
    public const string Issuer = "aurora-icu";
    public const string Audience = "aurora-icu-client";

    public static SymmetricSecurityKey ResolveKey()
    {
        var jwtSecret = Environment.GetEnvironmentVariable("JWT_SECRET");
        if (string.IsNullOrWhiteSpace(jwtSecret))
            jwtSecret = Convert.ToBase64String(RandomNumberGenerator.GetBytes(48));
        return new SymmetricSecurityKey(SHA256.HashData(Encoding.UTF8.GetBytes(jwtSecret)));
    }
}
