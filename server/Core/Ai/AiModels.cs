using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace Aurora.Core.Ai;

/* AI ASSISTANT — GROUNDED QUERY CHAT (the validator's design).
   THE SIMULATED RISK DOMAIN THAT LIVED HERE IS DELETED — AiRiskRow, the
   seeded probabilities, the ranking and risks endpoints, all of it
   (remove, don't label: the fake SOFA tiles / bell count / order drawer
   precedent). The fabricated percentages RANKED the patient rail a
   doctor scans to decide who is sickest — a random number was triaging
   patients.
   What lives here now is the opposite architecture: the server's ONLY
   AI job is to TRANSLATE a natural-language question into a structured
   tool call (the LLM emits a QUERY, never a VALUE) and to AUDIT the
   question as patient-data access. The translated tool is executed by
   the CLIENT through the same canonical, RBAC-enforced reads every
   screen uses, on the USER's own token — this endpoint never touches
   patient data and never returns any. */

/* the QUERY AUDIT LOG — a patient-data access log (design §3): one row
   per question, row-is-the-record (the PatientAssignment precedent —
   appended, never edited, never deleted). Who asked what, about which
   patient, when, under which ACTIVE role (#104), and what the model
   translated it into (tool null = the model refused / failed — the
   attempt is still access-relevant and still logged). */
[Table("AiQueries")]
class AiQueryRow
{
    [Key]
    public string QueryId { get; set; } = "";
    public int Seq { get; set; }
    /* dated UTC "yyyy-MM-dd HH:mm" — an access log carries the date */
    public string AskedAt { get; set; } = "";
    public string Actor { get; set; } = "";
    public string ActorRole { get; set; } = "";
    public string Question { get; set; } = "";
    /* the remembered-patient context the client sent, if any — part of
       "about which patient" (tools may also name patients in args) */
    public string? ContextPatientId { get; set; }
    /* the translation outcome: the tool the model selected + its args
       JSON, or null when the model declared the question unanswerable
       or the provider call failed (Outcome says which) */
    public string? Tool { get; set; }
    public string? ArgsJson { get; set; }
    public string Outcome { get; set; } = "";
}

/* POST /api/icu/ai/query — request. Disallow: unknown fields fail
   binding (the codified rule). History is the conversation-memory
   policy made visible on the wire: the client sends AT MOST the last 6
   (question, tool) pairs — never tool RESULTS, so prior patient data
   never rides back through this endpoint. */
[System.Text.Json.Serialization.JsonUnmappedMemberHandling(System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
record AiQueryRequest(string? Question, string? ContextPatientId, List<AiTurnDto>? History);

[System.Text.Json.Serialization.JsonUnmappedMemberHandling(System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
record AiTurnDto(string? Question, string? Tool);

/* the response — A QUERY, NEVER A FACT: the selected tool + its
   arguments (or an honest unanswerable). No patient data field exists
   on this contract at all. */
record AiQueryResponseDto(string? Tool, System.Text.Json.JsonElement? Args, string? Unanswerable);

/* POST /api/icu/ai/interpret — THE INTERPRETATION LAYER (the owner's
   2026-07-18 decision, superseding the zero-prose reading of the
   defining rule): the model may COMMENT on data Aurora fetched —
   trends, abnormalities, severity — in a block the UI labels as
   AI-generated commentary. Treatment, medication and management advice
   remain refused, in the interpretation prompt and in the translation
   catalog alike. The client sends the QUESTION and the exact snapshot
   it just RENDERED (the same values on screen, read on the user's own
   token) — the model sees nothing the user could not already see, and
   its output is displayed as commentary, never merged into any record. */
[System.Text.Json.Serialization.JsonUnmappedMemberHandling(System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
record AiInterpretRequest(string? Question, string? Patient, System.Text.Json.JsonElement? Data);

/* the response: ONE text field of labeled commentary — nothing else
   rides on this contract */
record AiInterpretResponseDto(string Text);
