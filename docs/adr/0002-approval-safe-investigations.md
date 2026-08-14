# ADR 0002: Approval-safe investigation actions

## Decision

Persist evidence, reports, hypotheses, and proposed actions. The model may propose only four
existing domain operations. An OPS approval re-checks `orgId` and target state, atomically claims
the proposal, invokes the domain operation, and records both the approval and mutation in audit.

## Why

An incident assistant should accelerate diagnosis without becoming an unbounded mutation API.
Stale targets become explicit `409`/`STALE` outcomes rather than silently changing state.
