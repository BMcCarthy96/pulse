# Demo review and release checklist

This is the shortest path to understand Pulse and the exact path maintainers use to prove it is
ready to share. The public experience is designed to be useful even before a reviewer creates a
demo session.

## Review Pulse in three minutes

### Launching the demo

1. Open `/demo`. Read the product problem, engineering proof, and the deterministic demo
   disclosure without signing in.
2. Choose **Launch interactive demo**. Pulse creates an isolated, synthetic tenant that expires after
   one hour.
3. Follow the pointer through the real controls: **Open incident**, **Find the first signal**, open
   the first citation, choose **Actions**, open the retry, approve it, then review the audit.
4. Open **Demo controls** and choose **Reset workspace**. The operational data returns to its initial seeded state; the isolated
   tenant is deleted automatically when its one-hour session expires.

No Anthropic key is required for this path. The guided questions use deterministic, evidence-bound
synthesis and are labelled **Deterministic demo synthesis** in the interface. Live provider output
is enabled only when `AI_ENABLED=true`, a key, and `INVESTIGATION_LIVE_ENABLED=true` are present.

## Where things are

| Destination               | What it proves                                                                       |
| ------------------------- | ------------------------------------------------------------------------------------ |
| Overview                  | Health roll-up, affected connectors, dead jobs, and active incidents                 |
| Incidents → investigation | Cited evidence, calibrated uncertainty, safe proposed actions                        |
| Jobs                      | Retry/backoff history and operator-controlled recovery                               |
| Settings → audit          | Attribution for every operational mutation (ADMIN persona)                           |
| API reference             | OpenAPI 1.1 contract rendered from the committed specification                       |
| `/demo`                   | Public product story, timestamped walkthrough outline, AI quality, safety, and proof |

On narrow screens, the pointer text sits in a bottom card so it does not cover the highlighted
control. Press Escape to pause. Use **Walkthrough** in the header to pick up where you left off.
Progress survives page changes and reloads for the lifetime of the demo session.

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

The fast gate covers formatting, lint, TypeScript, unit coverage, deterministic evaluation fixtures, and the
machine-derived public proof manifest. The full gate adds real Postgres/Redis integration,
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

- Put the real public URL in the README demo path; do not publish a placeholder URL.
- Set the GitHub Actions repository variable `DEMO_BASE_URL` and confirm the scheduled workflow
  is green.
- Record the 90-second guided flow using [`docs/loom-script.md`](loom-script.md), then link the
  video from the README and demo page.
- Confirm `DEMO_MODE=true` on both web and worker, while `AI_ENABLED=false` and
  `INVESTIGATION_LIVE_ENABLED=false` unless
  the live-AI cost and safety review is complete.
- Run `pnpm verify:full`, `pnpm verify:release`, and the k6 profile; retain the resulting CI run as
  the evidence link for the release.
- Review the page at 390px and 1440px widths and confirm keyboard-only navigation reaches the skip
  link, mobile menu, walkthrough, approval, and reset controls.

The only intentionally external handoff items are deployment credentials, the final public URL,
and the narrated video. The repository owns and verifies everything else.
