using System.Text;
using System.Text.Json;
using Aurora.Core.Persistence;
using Aurora.Core.Shared;
using Microsoft.EntityFrameworkCore;

namespace Aurora.Core.Ai;

/* ---------------- AI Assistant — grounded query chat (server half) ----------------
   THE DEFINING RULE (design §2): the LLM emits a QUERY, never a FACT.
   [Superseded in part, owner's decision 2026-07-18: the zero-prose
   reading is widened by ONE addition — the /interpret endpoint below may
   generate labeled COMMENTARY on data Aurora fetched (trends, severity),
   rendered by the UI as AI-generated and never merged into any record.
   Treatment, medication and management advice remain refused in both
   layers. Every clinical FACT on screen still comes from Aurora alone.]
   The /query endpoint translates a natural-language question into ONE
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
    /* AI_TIMEOUT_SECONDS — how long a translation may take before the
       honest 502. Default 60 (unchanged). Raised for CPU-only hosts: the
       local-model eval MEASURED the cold first call of the full tool
       catalog at 60.1–60.2 s on a 4-vCPU box — exactly astride this
       default — while warm calls ran ~5–12 s (llama-server caches the
       shared prompt prefix). Bounded to [10, 600]. */
    public static readonly int TimeoutSeconds =
        Math.Clamp(int.TryParse(Environment.GetEnvironmentVariable("AI_TIMEOUT_SECONDS"), out var t) ? t : 60, 10, 600);
    /* AI_UNAVAILABLE_REASON (appliance §2.3 — warn and disable, never
       refuse): when the AI is deliberately off, the INSTALLER says why
       ("no GPU on this server") and the 503 carries that reason — the
       AI screen must never let absence look like breakage. Only read
       when Provider is "none"; never logged beyond the response. */
    public static readonly string UnavailableReason =
        (Environment.GetEnvironmentVariable("AI_UNAVAILABLE_REASON") ?? "").Trim();
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
        ("assignments", "Nurse coverage: which nurses are covering a patient (everyone covers by default; exceptions are removals). Omit patient for the whole unit.", """{"type":"object","properties":{"patient":{"type":"string"}},"additionalProperties":false}"""),
        ("orders", "A patient's orders (medications, labs, imaging), optionally filtered by status pending|active|completed|discontinued.", """{"type":"object","properties":{"patient":{"type":"string"},"status":{"type":"string","enum":["pending","active","completed","discontinued"]}},"required":["patient"],"additionalProperties":false}"""),
        ("mar", "A patient's medication administration record — current derived doses and documented administrations.", """{"type":"object","properties":{"patient":{"type":"string"}},"required":["patient"],"additionalProperties":false}"""),
        ("observations", "A patient's charted bedside observations (vitals etc.), full history, oldest first.", """{"type":"object","properties":{"patient":{"type":"string"}},"required":["patient"],"additionalProperties":false}"""),
        ("labs", "A patient's laboratory results (all draws with analyte values).", """{"type":"object","properties":{"patient":{"type":"string"}},"required":["patient"],"additionalProperties":false}"""),
        ("imaging", "A patient's imaging studies and reports.", """{"type":"object","properties":{"patient":{"type":"string"}},"required":["patient"],"additionalProperties":false}"""),
        ("score", "A patient's CURRENT clinical score computed by Aurora's engine. instrument: sofa or news2. Use for 'how sick is X now' style questions.", """{"type":"object","properties":{"patient":{"type":"string"},"instrument":{"type":"string","enum":["sofa","news2"]}},"required":["patient","instrument"],"additionalProperties":false}"""),
        ("score_ranking", "Rank the CURRENT unit by a NAMED instrument (sofa or news2), computed by Aurora. Use for 'who is the worst/sickest' — never decide worst yourself; Aurora computes and the instrument is named.", """{"type":"object","properties":{"instrument":{"type":"string","enum":["sofa","news2"]}},"required":["instrument"],"additionalProperties":false}"""),
        ("worst_period", "A patient's WORST period in their current admission by a NAMED instrument: Aurora computes the score across the encounter's history and reports the peak. instrument: sofa or news2.", """{"type":"object","properties":{"patient":{"type":"string"},"instrument":{"type":"string","enum":["sofa","news2"]}},"required":["patient","instrument"],"additionalProperties":false}"""),
        ("timeline", "A patient's clinical timeline — aggregated events (orders, meds, results, notes) in time order.", """{"type":"object","properties":{"patient":{"type":"string"}},"required":["patient"],"additionalProperties":false}"""),
        /* the interpretation layer (owner's 2026-07-18 decision): condition
           questions stop being unanswerable — Aurora fetches the data and a
           SEPARATE, labeled step comments on it. Treatment stays refused. */
        ("condition_interpretation", "A patient's FULL current picture: Aurora fetches identity, admission, both clinical scores, recent observations, recent labs and open orders, and a clearly-labeled AI step adds a short interpretation of trends and severity. Use when asked how a patient is doing, their condition, an impression, to interpret their data, or for the patient's data/full picture as a whole. NEVER for treatment, medication or management advice — that stays unanswerable.", """{"type":"object","properties":{"patient":{"type":"string","description":"patient name (any part, Arabic or Latin), patient id like P-1001, or bed id"}},"required":["patient"],"additionalProperties":false}"""),
        ("unanswerable", "Use when the question cannot be answered by any tool here (wrong domain, asks for treatment/medication/management advice or a prediction, requires data Aurora does not hold, or requires writing/ordering — this assistant is read-only).", """{"type":"object","properties":{"reason":{"type":"string","description":"one short sentence saying why"}},"required":["reason"],"additionalProperties":false}"""),
    };

    const string SystemPrompt =
        "You translate a clinician's question about ICU patients into EXACTLY ONE tool call from the provided tools. "
        + "You are a query translator, not a clinical assistant: you never answer in prose, never state clinical values, "
        + "never predict, rank by your own judgment, or give treatment, medication or management advice. "
        + "For questions about a patient's condition, how they are doing, an overall impression, an interpretation of their data, or their data/full picture AS A WHOLE ('give me the patient data', 'everything about X'), call condition_interpretation — Aurora fetches the full current picture and a separate, clearly-labeled step comments on it. A question about ONE named domain (only the orders, only the labs, only the observations) still uses that domain's own tool. "
        + "For 'worst/sickest' questions pick score_ranking or worst_period with an instrument (default news2) — Aurora computes; you only choose the instrument. "
        + "Patient references may be Arabic or Latin names, partial names, patient ids (P-…) or beds — pass them through verbatim in the patient argument. "
        + "If a context patient is given, resolve pronouns ('his orders') to it. "
        /* the W4 lesson (local-model eval): a write request must be REFUSED,
           never silently converted into a related read — enumerate the verbs
           so a small model cannot miss the class */
        + "You can only LOOK THINGS UP. If the user asks you to DO anything — order, prescribe, give, administer, discontinue, hold, chart, document, record, acknowledge, sign, correct, amend, assign, transfer, admit, discharge — call unanswerable saying this assistant is read-only; NEVER answer an action request with a lookup instead. "
        + "If the question asks for anything else outside the tools (treatment or management advice, predictions, non-ICU data), call unanswerable.";

    static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(AiConfig.TimeoutSeconds) };

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
                /* the honesty rule (appliance §2.3): when the installer
                   recorded WHY the AI is off, the screen says exactly that
                   — never a bare "unavailable" that reads as breakage */
                var msg = AiConfig.UnavailableReason != ""
                    ? $"AI unavailable: {AiConfig.UnavailableReason}. Aurora runs fully — the AI assistant is a disabled feature on this install, not a fault; every screen's data remains available directly"
                    : "no AI model is configured in this environment (AI_PROVIDER=none) — the grounded chat needs a translation model; every screen's data remains available directly";
                return Results.Json(new { error = msg }, JsonOpts.Web, statusCode: 503);
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

        /* POST /api/icu/ai/interpret — the INTERPRETATION LAYER (owner's
           2026-07-18 decision). Same RBAC (ai.view), same audit-every-
           attempt rule, same provider honesty. The client sends the exact
           snapshot it just rendered — data the user's own token already
           read; this endpoint reads NO patient rows itself. The reply is
           ONE bounded text of commentary the UI labels as AI-generated.
           The prompt forbids treatment/medication/management advice — the
           boundary the owner kept when widening the rule. */
        app.MapPost("/api/icu/ai/interpret",
            async (AiInterpretRequest req, System.Security.Claims.ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Identity.Rbac.Deny(user, "ai.view") is IResult denied) return denied;
            var question = req.Question?.Trim() ?? "";
            if (question == "") return ApiError.BadRequest("question is required");
            if (question.Length > 2000) return ApiError.BadRequest("question exceeds 2000 characters");
            var patient = req.Patient?.Trim() ?? "";
            if (patient.Length > 200) return ApiError.BadRequest("patient exceeds 200 characters");
            if (req.Data is not { } data || data.ValueKind is JsonValueKind.Undefined or JsonValueKind.Null)
                return ApiError.BadRequest("data snapshot is required — interpretation only ever comments on fetched data");
            var dataJson = JsonSerializer.Serialize(data, JsonOpts.Web);
            if (dataJson.Length > 60_000) return ApiError.BadRequest("data snapshot exceeds 60000 characters");

            var row = new AiQueryRow
            {
                QueryId = AiLogic.NextQueryId(),
                Seq = AiLogic.NextSeq(db),
                AskedAt = DateTime.UtcNow.ToString("yyyy-MM-dd HH:mm"),
                Actor = user.FindFirst("name")?.Value ?? "Unknown",
                ActorRole = user.FindFirst("jobTitle")?.Value ?? "Unknown",
                Question = question,
                /* the snapshot itself is NOT persisted — the audit records
                   the access (who asked what about whom), never a second
                   copy of patient data */
                ContextPatientId = null,
                Tool = "condition_interpretation",
            };

            if (AiConfig.Provider == "none")
            {
                row.Outcome = "no-provider";
                db.AiQueries.Add(row); db.SaveChanges();
                var msg = AiConfig.UnavailableReason != ""
                    ? $"AI unavailable: {AiConfig.UnavailableReason}. Aurora runs fully — the AI assistant is a disabled feature on this install, not a fault; every screen's data remains available directly"
                    : "no AI model is configured in this environment (AI_PROVIDER=none) — the interpretation layer needs a model; the fetched data above is complete without it";
                return Results.Json(new { error = msg }, JsonOpts.Web, statusCode: 503);
            }
            if (AiConfig.Provider != "openai")
            {
                row.Outcome = "bad-provider";
                db.AiQueries.Add(row); db.SaveChanges();
                return Results.Json(new { error = $"unknown AI_PROVIDER '{AiConfig.Provider}' — supported: none, openai (any OpenAI-compatible endpoint, hosted or local)" }, JsonOpts.Web, statusCode: 503);
            }

            try
            {
                var text = await Interpret(question, patient, dataJson);
                row.Outcome = "interpreted";
                db.AiQueries.Add(row); db.SaveChanges();
                return Results.Json(new AiInterpretResponseDto(text), JsonOpts.Web);
            }
            catch (Exception ex)
            {
                row.Outcome = $"provider-error: {Bound(ex.Message, 300)}";
                db.AiQueries.Add(row); db.SaveChanges();
                return Results.Json(new { error = "the AI model endpoint did not answer — no interpretation was generated; the fetched data above is complete without it" }, JsonOpts.Web, statusCode: 502);
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
        /* the multi-turn priming lesson (local-model eval): with a prior
           lookup in the history, a small model answered "place an order…"
           with the orders READ instead of refusing — the local pattern
           beat the distant system rule, deterministically (2/2). A terse
           frame on the final message restores the refusal where the
           decision happens (the context-patient prefix precedent; the
           audit row always stores the RAW question). */
        /* "perform any action" over-triggered on imperative LOOKUPS
           ("give me his orders" refused intermittently) — the frame names
           the actual line: changing or recording something in the chart */
        const string frame = "[translate this new question on its own; asking to SEE data is fine — but if it asks to change, create or record anything (an order, a dose, a chart entry, an acknowledgment), call unanswerable] ";
        messages.Add(new { role = "user", content = frame + context + question });

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

    /* the interpretation prompt — THE KEPT BOUNDARY, stated where the
       generation happens: comment on the snapshot, never manage the
       patient. Everything the model writes lands in a UI block labeled
       as AI commentary; nothing it writes is ever merged into a record. */
    const string InterpretPrompt =
        "You are the interpretation layer of an ICU information system. You receive a clinician's question and a JSON "
        + "snapshot of ONE patient's real data (clinical scores, recent observations, recent labs, active orders) that the "
        + "system just fetched from the record and displayed. Write a SHORT interpretation — three to five plain sentences: "
        + "describe the trends, abnormalities and overall severity visible in the snapshot, citing only values that are "
        + "present in it. State uncertainty where the data is sparse; if the snapshot is too thin to interpret, say exactly "
        + "that. ABSOLUTE RULES: never recommend, suggest, start, stop or adjust any treatment, medication, dose, fluid, "
        + "oxygen or ventilation setting, and never propose investigations or management steps. If the question asks which "
        + "treatment to give, what dose, or what to do, do NOT engage with that choice at all — not even conditionally or "
        + "by saying more data would be needed to choose; describe the data, then end with exactly: 'Management decisions "
        + "belong to the treating team - I interpret data only.' Never invent or estimate values missing from the "
        + "snapshot. No markdown, no lists, no headings — plain sentences only.";

    /* the interpretation call: a plain completion (no tools) at
       temperature 0 with a hard output ceiling — commentary is short or
       it is not commentary */
    static async Task<string> Interpret(string question, string patient, string dataJson)
    {
        var payload = new
        {
            model = AiConfig.Model,
            messages = new object[]
            {
                new { role = "system", content = InterpretPrompt },
                new { role = "user", content = $"Patient: {(patient == "" ? "(unnamed)" : patient)}\nQuestion: {question}\nData snapshot (JSON, fetched from the record and shown to the user):\n{dataJson}" },
            },
            temperature = 0,
            max_tokens = 350,
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
        var text = (doc.RootElement.GetProperty("choices")[0].GetProperty("message")
            .TryGetProperty("content", out var c) && c.ValueKind == JsonValueKind.String ? c.GetString() : null)?.Trim() ?? "";
        if (text == "") throw new InvalidOperationException("model returned an empty interpretation");
        return Bound(text, 2000);
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
