# Guided demo video script

Record at 1440 by 900 with the browser at 100% zoom. Start signed out on `/demo`. Keep live AI
off so the result is repeatable. Close notifications and hide anything that contains credentials.

## 0:00 to 0:12

Show the public page and choose **Launch interactive demo**.

> “Pulse helps an operator investigate failed healthcare integrations. It connects job attempts,
> health changes, and incident evidence so the operator can see what happened and recover safely.”

## 0:12 to 0:25

Let the first pointer appear. Show the down connector, dead job, and open incident. Use the
highlighted **Open incident** button.

> “This is an isolated workspace with synthetic data. The EHR sync is down, one job has run out of
> retries, and Pulse has already opened an incident.”

## 0:25 to 0:43

Use the highlighted **Find the first signal** question. Wait for the report to finish.

> “The public demo uses deterministic evidence synthesis, so it gives the same result every time
> without calling a model. The live path uses the same report shape and safety checks.”

## 0:43 to 0:55

Open the highlighted citation, then choose **Actions**.

> “Every finding points back to the records it used. This citation opens the source evidence, and
> the report keeps its uncertainty visible.”

## 0:55 to 1:10

Open the highlighted retry. Pause on the approval screen, then choose **Revalidate and approve**.

> “The suggested retry has not run yet. An OPS user reviews it, and the server checks the target
> again before the worker can queue anything.”

## 1:10 to 1:22

Show **SUCCEEDED** in action history and the highlighted audit trail.

> “The retry request was queued successfully. The audit shows who approved it, which job was sent
> to the worker, and when it happened.”

## 1:22 to 1:30

Finish the walkthrough and cut back to the proof cards.

> “The repository backs this flow with unit, integration, browser, accessibility, and offline AI
> evaluation checks.”

End on the repository URL and public demo URL.

## Recording notes

- Say that the data is synthetic.
- Call the public result deterministic evidence synthesis.
- Describe findings as hypotheses when the evidence is not conclusive.
- Show the generated workspace instead of a shared seeded account.
- Reset the workspace after the take.
- Add captions and link the finished video from the README and `/demo` page.
