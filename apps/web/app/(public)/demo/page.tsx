import type { Metadata } from "next";
import Link from "next/link";
import {
  Activity,
  ArrowRight,
  CheckCircle2,
  CircleDollarSign,
  FileCheck2,
  GitBranch,
  PlayCircle,
  ShieldCheck,
  TestTube2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import proof from "@/content/recruiter-proof.json";
import { DemoEntryButton } from "./demo-entry-button";

export const metadata: Metadata = {
  title: "Pulse demo | AI investigation workspace",
  description:
    "Explore a tenant-isolated integration incident, evidence-bounded AI investigation, human approval, and operational audit trail.",
  robots: { index: true, follow: true },
  alternates: { canonical: "/demo" },
  openGraph: {
    title: "Pulse | AI investigation workspace",
    description:
      "A one-click, synthetic integration incident with cited evidence, approval-safe actions, and a provider-free deterministic fallback.",
    type: "website",
  },
};

const WALKTHROUGH = [
  ["1", "Enter an isolated tenant", "Pulse provisions synthetic OPS data with a one-hour TTL."],
  [
    "2",
    "Open the EHR incident",
    "A bounded outage window includes logs, jobs, events, health, and timeline evidence.",
  ],
  [
    "3",
    "Investigate the first signal",
    "A provider-free engine returns the same validated report contract used by live AI.",
  ],
  ["4", "Open a citation", "Each finding links back to the evidence record that supports it."],
  [
    "5",
    "Review the retry",
    "The suggested action stays pending while the operator checks its target and expected result.",
  ],
  ["6", "Approve the action", "The server rechecks the target before it queues the retry."],
  [
    "7",
    "Inspect the audit",
    "The approval and operational job retry are both durable and attributable.",
  ],
] as const;

const PROOF_CARDS = [
  {
    icon: TestTube2,
    value: String(proof.totalAutomatedTests),
    label: "automated tests",
    detail: `${proof.tests.unit} unit · ${proof.tests.integration} integration · ${proof.tests.e2e} browser · ${proof.evals.summaryCases + proof.evals.investigationFixtures} offline eval fixtures`,
  },
  {
    icon: ShieldCheck,
    value: `${Math.round(proof.evals.groundingRate * 100)}%`,
    label: "required-fact coverage",
    detail: "13 of 14 cases on the latest summary eval corpus",
  },
  {
    icon: FileCheck2,
    value: `${Math.round(
      Math.min(
        proof.evals.schemaPassRate,
        proof.evals.leakGuardRate,
        proof.evals.injectionResistanceRate,
      ) * 100,
    )}%`,
    label: "safety fixture pass rate",
    detail: "Schema, leak, and injection regression fixtures",
  },
] as const;

export default async function DemoPage() {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local";
  const videoUrl =
    process.env.NEXT_PUBLIC_DEMO_VIDEO_URL ?? process.env.NEXT_PUBLIC_RECRUITER_VIDEO_URL;

  return (
    <main id="main-content" className="min-h-screen bg-white text-slate-950">
      <header className="border-b border-slate-200">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
          <Link
            href="/demo"
            className="flex items-center gap-2 text-lg font-semibold tracking-tight"
          >
            <span
              aria-hidden="true"
              className="grid size-8 place-items-center rounded-xl bg-gradient-to-br from-teal-500 to-indigo-600 text-sm font-bold text-white"
            >
              P
            </span>
            Pulse
          </Link>
          <nav aria-label="Project links" className="flex items-center gap-2">
            <Button variant="outline" render={<a href="https://github.com/BMcCarthy96/pulse" />}>
              <GitBranch /> GitHub
            </Button>
          </nav>
        </div>
      </header>

      <section className="border-b border-slate-200 bg-slate-950 text-white">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[1.15fr_0.85fr] lg:py-24">
          <div>
            <div className="mb-5 flex flex-wrap gap-2">
              <Badge className="border-white/20 bg-white/10 text-white">
                Synthetic healthcare data
              </Badge>
              <Badge className="border-white/20 bg-white/10 text-white">
                Provider-free by default
              </Badge>
            </div>
            <h1 className="max-w-3xl text-4xl leading-tight font-semibold tracking-tight sm:text-6xl">
              Investigate integration failures before clinicians discover them.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-300">
              Pulse turns failed jobs, health signals, and incident history into a cited
              investigation workspace. Every operational action still needs a person to approve it.
            </p>
            <div className="mt-8 flex flex-col gap-4 sm:flex-row sm:items-center">
              <DemoEntryButton />
              <a
                href={videoUrl ?? "#walkthrough-video"}
                className="inline-flex items-center gap-2 text-sm text-slate-300 hover:text-white"
              >
                <PlayCircle />
                {videoUrl ? "Watch the 90-second walkthrough" : "Preview the demo path"}
              </a>
              <a
                href="#walkthrough"
                className="inline-flex items-center gap-2 text-sm text-slate-300 hover:text-white"
              >
                See the 90-second path <ArrowRight />
              </a>
            </div>
          </div>

          <div className="rounded-2xl border border-white/15 bg-white/5 p-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <p className="font-medium">Mercy General EHR sync</p>
              <Badge className="bg-red-500/15 text-red-200">CRITICAL</Badge>
            </div>
            <div className="mt-6 space-y-4">
              <div className="rounded-lg border border-white/10 bg-black/20 p-4">
                <p className="text-xs font-medium tracking-wide text-slate-400 uppercase">
                  First signal
                </p>
                <p className="mt-2 text-sm">
                  Repeated upstream 503 responses preceded a DEAD sync job.
                </p>
              </div>
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="rounded-lg bg-white/5 p-3">
                  <strong className="block">8</strong>
                  <span className="text-xs text-slate-400">evidence</span>
                </div>
                <div className="rounded-lg bg-white/5 p-3">
                  <strong className="block">2</strong>
                  <span className="text-xs text-slate-400">hypotheses</span>
                </div>
                <div className="rounded-lg bg-white/5 p-3">
                  <strong className="block">1</strong>
                  <span className="text-xs text-slate-400">approval</span>
                </div>
              </div>
              <div className="flex items-center gap-2 text-sm text-emerald-300">
                <CheckCircle2 /> Action target revalidated and audited
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="walkthrough-video" className="border-b border-slate-200 bg-slate-50">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-14 sm:px-6 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
          <div>
            <p className="text-sm font-semibold tracking-wide text-slate-500 uppercase">
              {videoUrl ? "Watch the proof" : "Preview the proof"}
            </p>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight">
              See the whole recovery loop before signing in.
            </h2>
            <p className="mt-3 max-w-xl text-slate-600">
              {videoUrl ? "The captioned recording" : "This guided outline"} follows one synthetic
              EHR outage from the first health signal through cited findings, target revalidation,
              worker execution, and the final audit row.
            </p>
            <ol className="mt-5 space-y-2 text-sm text-slate-600">
              <li>
                <strong className="text-slate-950">00:00</strong> · Review the degraded connector
              </li>
              <li>
                <strong className="text-slate-950">00:25</strong> · Run the bounded investigation
              </li>
              <li>
                <strong className="text-slate-950">00:55</strong> · Approve and inspect the audit
              </li>
            </ol>
          </div>
          <div className="flex min-h-48 items-center justify-center rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
            {videoUrl ? (
              <a className="font-medium text-teal-700 hover:underline" href={videoUrl}>
                Open the captioned walkthrough →
              </a>
            ) : (
              <p className="text-sm text-slate-500">
                The captioned release video is not configured in this environment. Launch the
                interactive demo or follow the timestamped preview beside this card.
              </p>
            )}
          </div>
        </div>
      </section>

      <section id="walkthrough" className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <div className="max-w-2xl">
          <p className="text-sm font-semibold tracking-wide text-slate-500 uppercase">
            The guided path
          </p>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight">
            A complete operational story in 90 seconds
          </h2>
          <p className="mt-3 text-slate-600">
            No credentials, provider key, or shared demo account required.
          </p>
        </div>
        <ol className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {WALKTHROUGH.map(([number, title, detail]) => (
            <li key={number} className="rounded-xl border border-slate-200 p-5">
              <span className="flex size-8 items-center justify-center rounded-full bg-slate-950 text-sm text-white">
                {number}
              </span>
              <h3 className="mt-4 font-semibold">{title}</h3>
              <p className="mt-2 text-sm leading-6 text-slate-600">{detail}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="border-y border-slate-200 bg-slate-50">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
            <div>
              <p className="text-sm font-semibold tracking-wide text-slate-500 uppercase">
                Engineering proof
              </p>
              <h2 className="mt-2 text-3xl font-semibold tracking-tight">
                Claims backed by executable gates
              </h2>
            </div>
            <a href={proof.ciRunUrl} className="text-sm font-medium hover:underline">
              Open verified GitHub Actions run →
            </a>
          </div>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {PROOF_CARDS.map(({ icon: Icon, value, label, detail }) => (
              <article key={label} className="rounded-xl border border-slate-200 bg-white p-5">
                <Icon className="text-slate-500" />
                <p className="mt-5 text-3xl font-semibold">{value}</p>
                <h3 className="font-medium">{label}</h3>
                <p className="mt-2 text-sm text-slate-600">{detail}</p>
              </article>
            ))}
          </div>
          <div className="mt-6 flex flex-wrap gap-3 text-sm text-slate-600">
            {proof.quality.coverageClaims.map((claim) => (
              <span key={claim} className="rounded-full border bg-white px-3 py-1">
                {claim}
              </span>
            ))}
            <span className="rounded-full border bg-white px-3 py-1">Build {sha}</span>
            <span className="rounded-full border bg-white px-3 py-1">App v{proof.appVersion}</span>
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-6 px-4 py-16 sm:px-6 lg:grid-cols-3">
        <article className="rounded-xl border p-6">
          <ShieldCheck />
          <h2 className="mt-4 text-lg font-semibold">Evidence-bounded AI</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Redacted excerpts, structured schemas, cited claims, uncertainty, deterministic
            fallback, and cost caps.
          </p>
        </article>
        <article className="rounded-xl border p-6">
          <Activity />
          <h2 className="mt-4 text-lg font-semibold">Operational reliability</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Retries, attempt history, rolling health windows, durable incidents, replay protection,
            and cleanup.
          </p>
        </article>
        <article className="rounded-xl border p-6">
          <CircleDollarSign />
          <h2 className="mt-4 text-lg font-semibold">Safe by default</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Deterministic replay keeps the public path reliable; credentialed live AI uses the same
            contract with redaction, budgets, telemetry, and eval gates.
          </p>
        </article>
      </section>

      <section className="bg-slate-950 text-white">
        <div className="mx-auto flex max-w-6xl flex-col justify-between gap-6 px-4 py-12 sm:flex-row sm:items-center sm:px-6">
          <div>
            <h2 className="text-2xl font-semibold">Ready to investigate?</h2>
            <p className="mt-2 text-slate-400">
              The workspace resets safely and expires after one hour.
            </p>
          </div>
          <DemoEntryButton />
        </div>
      </section>
    </main>
  );
}
