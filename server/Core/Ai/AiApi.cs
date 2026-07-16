using System.Text;
using System.Text.Json;
using Aurora.Core.Persistence;
using Aurora.Core.Shared;
using Microsoft.EntityFrameworkCore;

namespace Aurora.Core.Ai;

/* ---------------- AI Assistant — grounded query chat (server half) ----------------
   THE DEFINING RULE (design §2): the LLM emits a QUERY, never a VALUE.
   This endpoint translates a natural-language question into ONE
   structured tool call from a fixed, READ-ONLY catalog — and that is
   ALL it does. It never executes the tool, never touches patient rows,
   and its response contract has no field that could carry a clinical
   value. The CLIENT executes the returned tool through the same
   canonical, RBAC-enforced reads every screen uses, on the USER's own
   token (#104 — no service account exists anywhere in this path), and
   renders the result with Aurora's own components. If the model never
   emits a clinical value, it cannot invent one; the worst it can do is
   ask the wrong question, and the question is SHOWN.
   READ-ONLY, FOREVER (locked decision 1): no write tool exists in the
   catalog below — absent, not merely unused. Every question is AUDITED
   as patient-data access (AiQueryRow) before the response leaves.
   DEPLOYMENT (locked decision 2, recorded in 01): production is
   ON-PREMISES, PER HOSPITAL — the model runs locally and patient data
   never leaves the building. Render is staging only (no local model);
   the provider adapter below is OpenAI-compatible so ONE adapter covers
   a hosted staging model (against fake data, no PHI) and a local
   llama.cpp / vLLM / Ollama server in production. */

/* provider config — read once, the AppEnv pattern. AI_PROVIDER:
   "none" (default — the chat states honestly that no model is
   configured) | "openai" (any OpenAI-compatible /chat/completions
   endpoint, hosted or local). The key is optional (local servers are
   commonly keyless) and is never logged and never surfaced. */
static class AiConfig
{
    public static readonly string Provider =
        (Environment.GetEnvironmentVariable("AI_PROVIDER") ?? "none").Trim().ToLowerInvariant();
    public static readonly string Endpoint =
        (Environment.GetEnvironmentVariable("AI_ENDPOINT") ?? "").Trim().TrimEnd('/');
    public static readonly string Model =
        (Environment.GetEnvironmentVariable("AI_MODEL") ?? "").Trim();
    public static readonly string ApiKey =
        (Environment.GetEnvironmentVariable("AI_API_KEY") ?? "").Trim();
}

static class AiApi
{
    /* THE TOOL CATALOG — a curated subset of Aurora's canonical READS
       (design §6). Every tool maps 1:1 to an existing RBAC-enforced
       read (or the client scoring engine over such reads); the CLIENT
       holds the mirror registry and refuses anything not on it. THERE
       IS NO WRITE TOOL — assert by inspection: nothing here creates,
       signs, documents, acknowledges, corrects or assigns anything.
       `unanswerable` makes even refusal structured — the model's output
       is ALWAYS one tool call (~50 tokens of JSON), never prose. */
    static readonly (string Name, string Description, string ParamsJson)[] Tools =
    {
        ("census", "List the current unit census — every admitted patient with bed, diagnosis and identity summary.", """{"type":"object","properties":{},"additionalProperties":false}"""),
        ("patient_identity", "One patient's identity record: legal name, MRN, national ID, age, sex, allergies.", """{"type":"object","properties":{"patient":{"type":"string","description":"patient name (any part, Arabic or Latin), patient id like P-1001, or bed id"}},"required":["patient"],"additionalProperties":false}"""),
        ("encounters", "A patient's admission history (encounters): dates, diagnosis, outcome/disposition.", """{"type":"object","properties":{"patient":{"type":"string"}},"required":["patient"],"additionalProperties":false}"""),
        ("assignments", "Patient-assignment worklists: who is assigned to a patient, or all assignments today. Omit patient for the whole unit.", """{"type":"object","properties":{"patient":{"type":"string"}},"additionalProperties":false}"""),
        ("orders", "A patient's orders (medications, labs, imaging), optionally filtered by status pending|active|completed|discontinued.", """{"type":"object","properties":{"patient":{"type":"string"},"status":{"type":"string","enum":["pending","active","completed","discontinued"]}},"required":["patient"],"additionalProperties":false}"""),
        ("mar", "A patient's medication administration record — current derived doses and documented administrations.", """{"type":"object","properties":{"patient":{"type":"string"}},"required":["patient"],"additionalProperties":false}"""),
        ("observations", "A patient's charted bedside observations (vitals etc.), full history, oldest first.", """{"type":"object","properties":{"patient":{"type":"string"}},"required":["patient"],"additionalProperties":false}"""),
        ("labs", "A patient's laboratory results (all draws with analyte values).", """{"type":"object","properties":{"patient":{"type":"string"}},"required":["patient"],"additionalProperties":false}"""),
        ("imaging", "A patient's imaging studies and reports.", """{"type":"object","properties":{"patient":{"type":"string"}},"required":["patient"],"additionalProperties":false}"""),
        ("score", "A patient's CURRENT clinical score computed by Aurora's engine. instrument: sofa or news2. Use for 'how sick is X now' style questions.", """{"type":"object","properties":{"patient":{"type":"string"},"instrument":{"type":"string","enum":["sofa","news2"]}},"required":["patient","instrument"],"additionalProperties":false}"""),
        ("score_ranking", "Rank the CURRENT unit by a NAMED instrument (sofa or news2), computed by Aurora. Use for 'who is the worst/sickest' — never decide worst yourself; Aurora computes and the instrument is named.", """{"type":"object","properties":{"instrument":{"type":"string","enum":["sofa","news2"]}},"required":["instrument"],"additionalProperties":false}"""),
        ("worst_period", "A patient's WORST period in their current admission by a NAMED instrument: Aurora computes the score across the encounter's history and reports the peak. instrument: sofa or news2.", """{"type":"object","properties":{"patient":{"type":"string"},"instrument":{"type":"string","enum":["sofa","news2"]}},"required":["patient","instrument"],"additionalProperties":false}"""),
        ("timeline", "A patient's clinical timeline — aggregated events (orders, meds, results, notes) in time order.", """{"type":"object","properties":{"patient":{"type":"string"}},"required":["patient"],"additionalProperties":false}"""),
        ("unanswerable", "Use when the question cannot be answered by any tool here (wrong domain, requires prediction/diagnosis/advice, requires data Aurora does not hold, or requires writing/ordering — this assistant is read-only).", """{"type":"object","properties":{"reason":{"type":"string","description":"one short sentence saying why"}},"required":["reason"],"additionalProperties":false}"""),
    };

    const string SystemPrompt =
        "You translate a clinician's question about ICU patients into EXACTLY ONE tool call from the provided tools. "
        + "You are a query translator, not a clinical assistant: you never answer in prose, never state clinical values, "
        + "never predict, diagnose, rank by your own judgment, or suggest management. "
        + "For 'worst/sickest' questions pick score_ranking or worst_period with an instrument (default news2) — Aurora computes; you only choose the instrument. "
        + "Patient references may be Arabic or Latin names, partial names, patient ids (P-…) or beds — pass them through verbatim in the patient argument. "
        + "If a context patient is given, resolve pronouns ('his orders') to it. "
        + "If the question asks for anything outside the tools (writing orders, advice, predictions, non-ICU data), call unanswerable.";

    static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(60) };

    public static void Map(WebApplication app)
    {
        /* POST /api/icu/ai/query — translate + audit. RBAC ai.view (the
           same four clinical profiles the AI screen always had; the
           office Administrator holds no ai.view under the locked matrix
           — their RBAC-correct answer is 403 here and Access Restricted
           at the screen). FOUR-CODE for the domain part (missing/too-long
           question → 400); a missing or failing MODEL is infrastructure
           state, not a domain error → 503/502 with a precise {error}. */
        app.MapPost("/api/icu/ai/query",
            async (AiQueryRequest req, System.Security.Claims.ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Identity.Rbac.Deny(user, "ai.view") is IResult denied) return denied;
            var question = req.Question?.Trim() ?? "";
            if (question == "") return ApiError.BadRequest("question is required");
            if (question.Length > 2000) return ApiError.BadRequest("question exceeds 2000 characters");
            if (req.ContextPatientId is { Length: > 64 })
                return ApiError.BadRequest("contextPatientId exceeds 64 characters");
            var history = (req.History ?? new()).TakeLast(6).ToList();
            foreach (var t in history)
                if ((t.Question?.Length ?? 0) > 2000 || (t.Tool?.Length ?? 0) > 200)
                    return ApiError.BadRequest("history entries exceed bounds");

            var actor = user.FindFirst("name")?.Value ?? "Unknown";
            var role = user.FindFirst("jobTitle")?.Value ?? "Unknown";

            /* the audit row exists for EVERY accepted question — also
               when no model is configured or the provider fails: the
               ATTEMPT is patient-data access and is logged (§3) */
            var row = new AiQueryRow
            {
                QueryId = AiLogic.NextQueryId(),
                Seq = AiLogic.NextSeq(db),
                AskedAt = DateTime.UtcNow.ToString("yyyy-MM-dd HH:mm"),
                Actor = actor,
                ActorRole = role,
                Question = question,
                ContextPatientId = string.IsNullOrWhiteSpace(req.ContextPatientId) ? null : req.ContextPatientId.Trim(),
            };

            if (AiConfig.Provider == "none")
            {
                row.Outcome = "no-provider";
                db.AiQueries.Add(row); db.SaveChanges();
                return Results.Json(new { error = "no AI model is configured in this environment (AI_PROVIDER=none) — the grounded chat needs a translation model; every screen's data remains available directly" }, JsonOpts.Web, statusCode: 503);
            }
            if (AiConfig.Provider != "openai")
            {
                row.Outcome = "bad-provider";
                db.AiQueries.Add(row); db.SaveChanges();
                return Results.Json(new { error = $"unknown AI_PROVIDER '{AiConfig.Provider}' — supported: none, openai (any OpenAI-compatible endpoint, hosted or local)" }, JsonOpts.Web, statusCode: 503);
            }

            try
            {
                var (tool, argsJson) = await Translate(question, row.ContextPatientId, history);
                if (tool == "unanswerable")
                {
                    var reason = "the question is outside the read-only query surface";
                    try
                    {
                        using var doc = JsonDocument.Parse(argsJson);
                        if (doc.RootElement.TryGetProperty("reason", out var r) && r.ValueKind == JsonValueKind.String)
                            reason = r.GetString() ?? reason;
                    }
                    catch { /* keep the default reason — never fail the audit path on model JSON */ }
                    row.Tool = null; row.ArgsJson = null; row.Outcome = $"unanswerable: {Bound(reason, 300)}";
                    db.AiQueries.Add(row); db.SaveChanges();
                    return Results.Json(new AiQueryResponseDto(null, null, reason), JsonOpts.Web);
                }
                if (!Tools.Any(t => t.Name == tool))
                {
                    /* the model asked for a tool that does not exist —
                       a visibly wrong question, never executed */
                    row.Tool = null; row.ArgsJson = null; row.Outcome = $"unknown-tool: {Bound(tool, 100)}";
                    db.AiQueries.Add(row); db.SaveChanges();
                    return Results.Json(new AiQueryResponseDto(null, null,
                        $"the model selected an unknown tool '{tool}' — nothing was executed"), JsonOpts.Web);
                }
                row.Tool = tool; row.ArgsJson = argsJson; row.Outcome = "translated";
                db.AiQueries.Add(row); db.SaveChanges();
                using var args = JsonDocument.Parse(argsJson);
                return Results.Json(new AiQueryResponseDto(tool, args.RootElement.Clone(), null), JsonOpts.Web);
            }
            catch (Exception ex)
            {
                row.Tool = null; row.ArgsJson = null; row.Outcome = $"provider-error: {Bound(ex.Message, 300)}";
                db.AiQueries.Add(row); db.SaveChanges();
                return Results.Json(new { error = "the AI model endpoint did not answer — the question was not translated; no data was accessed" }, JsonOpts.Web, statusCode: 502);
            }
        }).RequireAuthorization();
    }

    static string Bound(string s, int max) => s.Length <= max ? s : s[..max];

    /* the OpenAI-compatible translation call: tool_choice=required so
       the output is ALWAYS one structured tool call — never prose about
       a patient. ~50 output tokens; small local models handle this. */
    static async Task<(string Tool, string ArgsJson)> Translate(
        string question, string? contextPatientId, List<AiTurnDto> history)
    {
        var messages = new List<object> { new { role = "system", content = SystemPrompt } };
        foreach (var t in history)
            if (!string.IsNullOrWhiteSpace(t.Question))
            {
                messages.Add(new { role = "user", content = t.Question });
                messages.Add(new { role = "assistant", content = $"[called tool: {t.Tool ?? "unanswerable"}]" });
            }
        var context = string.IsNullOrWhiteSpace(contextPatientId) ? "" : $"[context patient: {contextPatientId}] ";
        messages.Add(new { role = "user", content = context + question });

        var payload = new
        {
            model = AiConfig.Model,
            messages,
            tools = Tools.Select(t => new
            {
                type = "function",
                function = new
                {
                    name = t.Name,
                    description = t.Description,
                    parameters = JsonDocument.Parse(t.ParamsJson).RootElement,
                },
            }).ToArray(),
            tool_choice = "required",
            temperature = 0,
        };

        using var msg = new HttpRequestMessage(HttpMethod.Post, $"{AiConfig.Endpoint}/chat/completions")
        {
            Content = new StringContent(JsonSerializer.Serialize(payload, JsonOpts.Web), Encoding.UTF8, "application/json"),
        };
        if (AiConfig.ApiKey != "") msg.Headers.Add("Authorization", $"Bearer {AiConfig.ApiKey}");
        using var res = await Http.SendAsync(msg);
        var body = await res.Content.ReadAsStringAsync();
        if (!res.IsSuccessStatusCode)
            throw new InvalidOperationException($"model endpoint returned {(int)res.StatusCode}");
        using var doc = JsonDocument.Parse(body);
        var call = doc.RootElement.GetProperty("choices")[0].GetProperty("message")
            .GetProperty("tool_calls")[0].GetProperty("function");
        var name = call.GetProperty("name").GetString() ?? "";
        var argsRaw = call.GetProperty("arguments").GetString() ?? "{}";
        /* validate the arguments parse as JSON here so the client never
           receives an unparseable payload */
        using var _ = JsonDocument.Parse(argsRaw);
        return (name, argsRaw);
    }
}

static class AiLogic
{
    static long _querySeq;

    /* counters resume from the highest persisted id — the assignments
       pattern (restart-safe against the durable DB) */
    public static void InitializeCounters(AuroraDb db)
    {
        var max = db.AiQueries.AsNoTracking().AsEnumerable()
            .Select(q => long.TryParse(q.QueryId.StartsWith("AIQ-") ? q.QueryId[4..] : "", out var n) ? n : 0)
            .DefaultIfEmpty(1000).Max();
        Interlocked.Exchange(ref _querySeq, Math.Max(max, 1000));
    }

    public static string NextQueryId() => $"AIQ-{Interlocked.Increment(ref _querySeq)}";

    public static int NextSeq(AuroraDb db) =>
        (db.AiQueries.AsNoTracking().Select(q => (int?)q.Seq).Max() ?? 0) + 1;
}
