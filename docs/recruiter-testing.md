# Recruiter review and release checklist

This is the shortest path to understand Pulse and the exact path maintainers use to prove it is
ready to share. The public experience is designed to be useful even before a reviewer creates a
demo session.

## Review Pulse in three minutes

1. Open `/recruiter`. Read the product problem, architecture proof, and the recorded-AI
   disclosure without signing in.
2. Choose **Try the live demo**. Pulse creates an isolated, synthetic tenant that expires after
   one hour.
3. Follow the persistent **Recruiter walkthrough**: overview → EHR incident → **Find the first
   signal** → approve the retry → inspect the audit trail.
4. Choose **Reset demo**. The operational data returns to its initial seeded state; the isolated
   tenant is deleted automatically when its one-hour session expires.

No Anthropic key is required for this path. The guided questions use versioned recorded fixtures
and are labelled **Recorded fixture** in the interface. Live model output is enabled only when
both a key and `INVESTIGATION_LIVE_ENABLED=true` are present.

## Where things are

| Destination               | What it proves                                                             |
| ------------------------- | -------------------------------------------------------------------------- |
| Overview                  | Health roll-up, affected connectors, dead jobs, and active incidents       |
| Incidents → investigation | Cited evidence, calibrated uncertainty, safe proposed actions              |
| Jobs                      | Retry/backoff history and operator-controlled recovery                     |
| Settings → audit          | Attribution for every operational mutation (ADMIN persona)                 |
| API reference             | OpenAPI 1.1 contract rendered from the committed specification             |
| `/recruiter`              | Public product story, architecture, safety, cost, and current proof counts |

On narrow screens, use **Open navigation** in the header. The walkthrough and its progress survive
navigation for the lifetime of the demo session.

## Local verification

Prerequisites are Node 22+, pnpm 9, Docker Compose, and Playwright Chromium. From the repository
root:

```bash
cp .env.example .env
docker compose up -d
corepack pnpm install
pnpm --filter @pulse/db generate
pnpm db:push
pnpm db:seed
pnpm run doctor
```

`pnpm run doctor` is read-only. It reports the exact missing tool or unavailable service and gives the
repair command. It does not start containers, migrate a database, or install browsers for you.

Use the verification ladder instead of guessing which command matters:

```bash
# No mutation of Postgres or Redis; suitable during normal editing.
pnpm verify:fast

# Requires the Compose services; runs integration tests, production build, and Playwright.
pnpm verify:full

# Against the deployed URL; provisions and resets one demo, then enforces Lighthouse budgets.
DEMO_BASE_URL=https://your-deployment.example pnpm verify:release
```

The fast gate covers formatting, lint, TypeScript, unit coverage, deterministic AI evals, and the
machine-derived recruiter proof manifest. The full gate adds real Postgres/Redis integration,
production compilation, and the browser journey. Browser failures retain trace, screenshot, and
video evidence.

## Proof that stays current

[`apps/web/content/recruiter-proof.json`](../apps/web/content/recruiter-proof.json) is the single
source for the public proof cards and Lighthouse thresholds. Do not edit its counts by hand:

```bash
pnpm proof:refresh  # derive counts and versions after adding tests
pnpm proof:check    # fail when the committed proof is stale
```

CI runs the check. The deployed smoke workflow runs daily after the repository variable
`DEMO_BASE_URL` is configured. It verifies the health endpoint, public page, provisioning,
authenticated incident access, reset, and all four Lighthouse categories.

For a disposable deployment, the optional k6 profile verifies the multi-tenant flow and its API
latency/error thresholds:

```bash
BASE_URL=https://your-deployment.example VUS=5 pnpm load:demo
```

The public provisioning guard permits five new demo sessions per network per hour. If the remote
smoke ran from the same network moments earlier, use `VUS=4` or wait for the bucket to refill.

## Before sharing the repository

- Put the real public URL in the README recruiter path; do not publish a placeholder URL.
- Set the GitHub Actions repository variable `DEMO_BASE_URL` and confirm the scheduled workflow
  is green.
- Record the 90-second guided flow using [`docs/loom-script.md`](loom-script.md), then link the
  video from the README and recruiter page.
- Confirm `DEMO_MODE=true` on both web and worker, while `INVESTIGATION_LIVE_ENABLED=false` unless
  the live-AI cost and safety review is complete.
- Run `pnpm verify:full`, `pnpm verify:release`, and the k6 profile; retain the resulting CI run as
  the evidence link for the release.
- Review the page at 390px and 1440px widths and confirm keyboard-only navigation reaches the skip
  link, mobile menu, walkthrough, approval, and reset controls.

The only intentionally external handoff items are deployment credentials, the final public URL,
and the narrated video. The repository owns and verifies everything else.
