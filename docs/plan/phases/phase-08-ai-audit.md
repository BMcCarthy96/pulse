# Phase 8 — AI Incident Summaries & Audit Surface

**Goal:** Real Claude-generated incident summaries with PHI redaction, prompt versioning,
regenerate/edit flows; audit log + users pages in Settings.

**Prereqs:** Phase 7. **Read first:** doc 03 §6 (implement exactly), doc 04 (summary + audit
routes), doc 05 (AI card + settings pages).

## Tasks

1. **Redaction** `apps/worker/src/ai/redact.ts`: pure `redact(text: string): string` (and a
   deep-object variant for JSON contexts) replacing synthetic PHI-like tokens per doc 03 §6.2:
   `PAT-\d+` → `[REDACTED:patient-ref]`, `CLM-\d+` → `[REDACTED:claim-ref]`, member ids, names
   from a known-names list (faker uses real-looking names — redact via the `firstName lastName`
   pattern adjacent to patient context), DOB-like dates. Order patterns from most to least
   specific; idempotent (redacting twice = once).
2. **Context builder** `ai/context.ts`: gather incident + connector + last 50 logs + last 20
   failed-job errors + last 10 events per doc 03 §6.1 (chaos mode explicitly excluded), render
   to a compact markdown doc, redact, cap at ~8K chars (truncate oldest first).
3. **Prompt** in `packages/shared/src/prompts.ts`: `INCIDENT_SUMMARY_PROMPT_V1` — system prompt
   framing: "You are drafting an internal incident note for a healthcare integration ops team…
   be concrete, no speculation beyond evidence, plain language, ≤3 sentence summary." Version
   string exported alongside.
4. **Summarizer** `ai/summarize.ts` + real `incident-summary` processor per doc 03 §6.3–6.5:
   `client.messages.parse` with `zodOutputFormat(IncidentSummary)`, model from
   `ANTHROPIC_MODEL` (default `claude-opus-4-8`), `max_tokens: 1500`; store result + metadata;
   graceful degradation without API key (`aiSummaryStatus: "failed"`, message "AI not
   configured"); `parsed_output === null` → job failure path; attempts 2.
   Status transitions: queued → generating (on processor start) → ready | failed.
5. **API**: `POST incidents/:id/summary/regenerate`, `PATCH incidents/:id/summary` (edit, keep
   `original`, status `edited`), both audited; plus `GET /v1/audit` and `GET /v1/users` (ADMIN).
6. **UI**: complete the AI card states (generating spinner via polling, ready render of all
   fields + footer metadata, regenerate button with 409 handling, edit mode textarea);
   `/settings` users table + audit log table with action filter and metadata popover.
7. Rejected-claim niceness (small but demoable): incident context builder includes recent
   claim-ack rejections when the incident is on the claims connector.
8. Commit: `feat(ai): redacted incident summaries + audit surface (phase 8)`.

## Acceptance criteria

- [ ] With a real `ANTHROPIC_API_KEY`: trigger an outage incident → card goes queued →
      generating → ready with sensible summary/probable cause/steps; footer shows model +
      prompt v1 + timestamp
- [ ] The stored context (log it at DEBUG) contains zero `PAT-`/`CLM-` tokens or seeded names —
      grep to confirm
- [ ] Without the key (unset locally): status `failed`, "AI not configured", app otherwise fine
- [ ] Regenerate produces a new summary and an AuditEntry; edit stores edited copy + original,
      shows "edited by Marcus", audited
- [ ] `/settings` audit log shows the full history of this phase's actions with correct actors
- [ ] Redaction unit spot-checks: idempotency, mixed text, nested JSON
