# Phase 14 — Offline Evaluation Gate & Prompt v2

**Goal:** Turn model-quality claims into repeatable evidence that gates CI.

**Prereqs:** Phase 13 provider seam and telemetry complete.

## Tasks

1. Add synthetic redacted cases, typed expectations, fixture hashing, baseline scores, and reports.
2. Implement deterministic schema, leakage, grounding, confidence, actionability, and injection graders.
3. Add offline replay, live recording, model comparison, and optional non-gating judge modes.
4. Add prompt v2, keep v1 for comparison, update snapshots, documentation, and the CI Evals job.

## Acceptance criteria

- [ ] Replay is deterministic and network-independent; stale reports or fixture leaks fail CI.
- [ ] Critical guardrails score 100%; absolute floors and reviewed baseline regression checks pass.
- [ ] The leak case makes zero provider calls and the v1/v2 report is committed.
