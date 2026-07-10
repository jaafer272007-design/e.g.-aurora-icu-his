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

/* Shared error contract — THE FOUR-CODE RULE, unified across every domain
   (results audit PR set the convention; the state-conflict PR applied it
   API-wide):
     403 = you may not          (permission — generic, never explains)
     404 = it is not there      (the addressed id resolves to NOTHING)
     409 = it is there, but not like that
                                (the resource exists; its CURRENT STATE
                                 forbids this transition — the same request
                                 could succeed in a different state of the
                                 world: sign it first, free the bed,
                                 another admin exists)
     400 = your request was malformed
                                (bad payload — AND requests that can NEVER
                                 succeed against that resource or
                                 actor/resource pair regardless of state:
                                 shape mismatches like implementing a
                                 medication order, the reserved system
                                 principal, the self-deactivation guards)
   Every non-2xx carries a precise {error} body except the deliberately
   generic 403 — never a silent 200, never a 500. */
static class ApiError
{
    public static IResult BadRequest(string error) =>
        Results.Json(new { error }, JsonOpts.Web, statusCode: 400);

    /** 409 for a transition the resource's CURRENT STATE forbids — the
        error names that state with the same precision as the results
        errors ("already acknowledged (by X at T) — it is not awaiting
        acknowledgment"). */
    public static IResult StateConflict(string error) =>
        Results.Json(new { error }, JsonOpts.Web, statusCode: 409);

    public static IResult NotFound() =>
        Results.Json(new { error = "Not found" }, JsonOpts.Web, statusCode: 404);
}
