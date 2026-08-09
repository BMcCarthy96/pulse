# Phase 15 — Persistent Ask Pulse Copilot

**Goal:** Add a guarded, evidence-bounded incident copilot with visible streaming tool use.

**Prereqs:** Phase 14 eval harness complete.

## Tasks

1. Add redacted `AiRun` history and OPS-only ask/history routes with typed SSE events.
2. Implement the manual provider tool loop with six read-only, query-scoped tools.
3. Enforce redaction, connector/organization/time bounds, turn/token/cost/wall-clock budgets, and cancellation.
4. Add the incident chat UI, audit entries, browser flow, and stubbed integration coverage.

## Acceptance criteria

- [ ] Browser users see ordered tool and answer events; completed history survives refresh.
- [ ] Crafted cross-connector, arbitrary-time, leakage, and injection requests cannot escape the query layer.
- [ ] Budget, disconnect, provider-error, and persistence paths finalize honestly.
