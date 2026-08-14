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
  Workflow,
} from "lucide-react";
import { auth } from "@/auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import proof from "@/content/recruiter-proof.json";
import { DemoEntryButton } from "./demo-entry-button";

export const metadata: Metadata = {
  title: "Pulse recruiter demo — AI investigation workspace",
  description:
    "Explore a tenant-isolated integration incident, evidence-bounded AI investigation, human approval, and operational audit trail.",
  robots: { index: true, follow: true },
  openGraph: {
    title: "Pulse — Recruiter-ready AI investigation workspace",
    description:
      "A one-click, synthetic integration incident with cited evidence, approval-safe actions, and deterministic AI fallback.",
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
    "A recorded, versioned fixture streams the same contract as live AI.",
  ],
  [
    "4",
    "Approve the retry",
    "Pulse proposes; an operator approves after the target is revalidated.",
  ],
  [
    "5",
    "Inspect the audit",
    "The approval and operational job retry are both durable and attributable.",
  ],
] as const;

const PROOF_CARDS = [
  {
    icon: TestTube2,
    value: String(proof.tests.unit),
    label: "unit tests",
    detail: "Pure reliability and safety logic",
  },
  {
    icon: Workflow,
    value: String(proof.tests.integration),
    label: "integration tests",
    detail: "Real PostgreSQL and Redis",
  },
  {
    icon: PlayCircle,
    value: String(proof.tests.e2e),
    label: "browser tests",
    detail: "Production build plus real worker",
  },
  {
    icon: FileCheck2,
    value: String(proof.evals.safetyCategories),
    label: "AI safety categories",
    detail: "Deterministic, network-free evals",
  },
] as const;

export default async function RecruiterPage() {
  const session = await auth();
  const sha = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local";

  return (
    <main id="main-content" className="min-h-screen bg-white text-slate-950">
      <header className="border-b border-slate-200">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
          <Link href="/recruiter" className="text-lg font-semibold tracking-tight">
            Pulse
          </Link>
          <nav aria-label="Recruiter links" className="flex items-center gap-2">
            <Button variant="ghost" render={<Link href="/login" />}>
              Sign in
            </Button>
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
                Recorded AI by default
              </Badge>
            </div>
            <h1 className="max-w-3xl text-4xl leading-tight font-semibold tracking-tight sm:text-6xl">
              Investigate integration failures before clinicians discover them.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-300">
              Pulse turns failed jobs, health signals, and incident history into a cited
              investigation workspace—then keeps every operational action behind explicit human
              approval.
            </p>
            <div className="mt-8 flex flex-col gap-4 sm:flex-row sm:items-center">
              <DemoEntryButton authenticated={Boolean(session?.user)} />
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

      <section id="walkthrough" className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <div className="max-w-2xl">
          <p className="text-sm font-semibold tracking-wide text-slate-500 uppercase">
            The recruiter path
          </p>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight">
            A complete operational story in 90 seconds
          </h2>
          <p className="mt-3 text-slate-600">
            No credentials, provider key, or shared demo account required.
          </p>
        </div>
        <ol className="mt-10 grid gap-4 lg:grid-cols-5">
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
              Open GitHub Actions →
            </a>
          </div>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
            The public path spends nothing on models. Live AI remains an explicitly credentialed
            deployment mode.
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
          <DemoEntryButton authenticated={Boolean(session?.user)} />
        </div>
      </section>
    </main>
  );
}
