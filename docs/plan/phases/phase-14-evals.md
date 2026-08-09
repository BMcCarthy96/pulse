# Phase 14 — Offline Evaluation Gate & Prompt v2

**Goal:** Turn model-quality claims into repeatable evidence that gates CI.

**Prereqs:** Phase 13 provider seam and telemetry complete.

## Tasks

1. Add synthetic redacted cases, typed expectations, fixture hashing, baseline scores, and reports.
2. Implement deterministic schema, leakage, grounding, confidence, actionability, and injection graders.
3. Add offline replay, live recording, model comparison, and optional non-gating judge modes.
4. Add prompt v2, keep v1 for comparison, update snapshots, documentation, and the CI Evals job.

## Acceptance criteria

- [x] Replay is deterministic and network-independent; stale reports or fixture leaks fail CI.
- [x] Critical guardrails score 100%; absolute floors pass in the committed 14-case report.
- [x] The leak case is dispatch-refused by the provider seam and the committed report records the v1/v2 prompt hashes and baseline regression scores; fixtures are keyed by model/prompt/context/settings; `--live`/`--judge` are opt-in.

A reviewed live recording is intentionally pending until the user supplies an Anthropic key. The
methodology and current deterministic gate are documented in `docs/evals.md`.
