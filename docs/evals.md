# Pulse evaluation methodology

`pnpm eval` is an offline replay gate. It reads the committed synthetic corpus and recorded
responses, runs deterministic graders, and regenerates `evals/reports/latest.json` and
`evals/reports/latest.md`. It never calls Anthropic unless `--live` or `--judge` is explicit.

## Corpus and fixtures

The 14 cases in `evals/corpus.ts` are synthetic and already redacted. They cover outage, timeout,
rate limiting, authorization, schema drift, partial failure, recovery, flapping, sparse evidence,
duplicate/replay handling, and prompt injection. Each case declares:

- normalized facts and required concepts;
- forbidden claims;
- acceptable confidence values;
- whether provider dispatch must be refused before a call;
- whether the case is an injection-resistance case.

Recorded responses in `evals/fixtures.json` are keyed by the complete fixture key:

```text
case:model:promptVersion:contextHash:outputSchemaVersion:{generationSettings}
```

This lets a live recording for another model coexist with the default model instead of silently
overwriting it. Fixtures are schema-checked and scanned for protected identifiers before they are
written. The leakage refusal case is represented by `null`, which is itself part of the expected
behavior.

## Deterministic graders

The gate reports schema validity, pre-send refusal, output leakage, injection resistance,
case-declared fact grounding, confidence calibration, and actionability. Critical guardrails must
be 100%. Aggregate floors are explicit in the runner: required-fact grounding is at least 90%,
confidence at least 90%, and actionability at least 90%.

`evals/baseline.json` is a conservative reviewed v1 gate until a credentialed live v1/v2 recording
is available. The runner compares every v2 category to that baseline and fails on regression. A
live recording is still required before making a production prompt change; offline replay proves
the corpus and graders, not quality on an unseen prompt.

The optional judge is deliberately non-gating. It sends the context and structured fixture to
`ANTHROPIC_JUDGE_MODEL` (defaulting to the eval model), records a bounded score and rationale, and
never changes the deterministic pass/fail result.

## Commands

```bash
pnpm eval                                      # offline report regeneration
pnpm eval:check                                # stale-report and gate check
pnpm eval --live --model claude-sonnet-4-6    # record reviewed provider fixtures
pnpm eval --live --model claude-haiku-4-5      # record a comparison model
pnpm eval --judge                              # advisory judge scores
```

`--live` and `--judge` require `ANTHROPIC_API_KEY`. They are intentionally opt-in so CI and local
replays cannot spend money or depend on network availability. Review live output and commit the
fixture/report update together with any prompt version change.
