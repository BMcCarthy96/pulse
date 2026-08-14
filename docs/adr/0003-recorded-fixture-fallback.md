# ADR 0003: Exact-question deterministic demo fallback

## Decision

The investigation SSE contract is identical in live and deterministic demo mode. Without a
configured provider, only three exact guided questions are answered from bounded, evidence-derived
synthesis; arbitrary questions return a clear conflict response. Deterministic runs persist
`AiRun` metadata with mode `RECORDED` and explicitly identify `deterministic-demo-v3` rather than
implying a provider call or a provider-recorded trace.

## Why

Recruiters should be able to verify the product and safety model without an API key, while a live
deployment can be enabled behind quotas and a server-side secret.
