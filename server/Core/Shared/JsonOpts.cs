using System.Text.Json;

namespace Aurora.Core.Shared;

static class JsonOpts
{
    /* WhenWritingNull keeps optional fields ABSENT on the wire (not null) —
       exactly how the mock adapter's objects serialize */
    public static readonly JsonSerializerOptions Web = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull,
    };
}

/* Shared error contract for the codified validation rule: malformed input
   is ALWAYS a 400 with an {error} body — never a silent 200, never a 500.
   (Relocated from OrderLogic — it was never orders-specific: Orders, MAR,
   Timeline and AI all reject malformed requests through this one helper.) */
static class ApiError
{
    public static IResult BadRequest(string error) =>
        Results.Json(new { error }, JsonOpts.Web, statusCode: 400);
}
