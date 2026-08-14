# ADR 0003: Exact-question recorded fallback

## Decision

The investigation SSE contract is identical in live and recorded mode. Without a configured
provider, only three exact, versioned guided questions are answered from deterministic fixtures;
arbitrary questions return a clear conflict response. Recorded runs still persist `AiRun` metadata
with mode `RECORDED` and never imply a provider call.

## Why

Recruiters should be able to verify the product and safety model without an API key, while a live
deployment can be enabled behind quotas and a server-side secret.
