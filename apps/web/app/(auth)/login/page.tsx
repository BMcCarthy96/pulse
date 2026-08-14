"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { DEMO_PERSONAS, APP_NAME } from "@pulse/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const DEMO_PASSWORD = process.env.NEXT_PUBLIC_DEMO_PASSWORD ?? "pulse-demo-2026";

export default function LoginPage() {
  const router = useRouter();
  const [organization, setOrganization] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function doSignIn(
    emailValue: string,
    passwordValue: string,
    organizationValue = organization,
  ) {
    setError(null);
    const res = await signIn("credentials", {
      organization: organizationValue,
      email: emailValue,
      password: passwordValue,
      redirect: false,
    });
    if (res?.error) {
      setError("Invalid email or password.");
      return;
    }
    router.push("/");
    router.refresh();
  }

  async function enterRecruiterDemo() {
    setError(null);
    const res = await signIn("demo", { demo: "1", redirect: false });
    if (res?.error) {
      setError(
        res.url?.includes("demo_capacity")
          ? "The demo is at capacity. Try the recorded tour in a moment."
          : "The guarded demo is unavailable right now.",
      );
      return;
    }
    router.push("/");
    router.refresh();
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(() => doSignIn(email, password));
  }

  function handleDemo(personaEmail: string) {
    setOrganization("");
    setEmail(personaEmail);
    setPassword(DEMO_PASSWORD);
    startTransition(() => doSignIn(personaEmail, DEMO_PASSWORD, ""));
  }

  return (
    <div className="bg-muted/30 flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-semibold tracking-tight">{APP_NAME}</h1>
          <p className="text-muted-foreground text-sm">
            Integration health for Lakeview Health Partners
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Sign in</CardTitle>
            <CardDescription>Use your credentials or a demo persona below.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="bg-primary/5 border-primary/20 rounded-md border p-3">
              <p className="text-sm font-medium">Recruiter walkthrough</p>
              <p className="text-foreground/70 mt-1 text-xs">
                Open an isolated OPS workspace with a live incident, evidence board, and
                approval-safe actions.
              </p>
              <Button
                type="button"
                className="mt-3 w-full"
                disabled={isPending}
                onClick={() => startTransition(() => enterRecruiterDemo())}
              >
                {isPending ? "Preparing workspace…" : "Enter one-click demo"}
              </Button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="organization">Organization</Label>
                <Input
                  id="organization"
                  value={organization}
                  onChange={(e) => setOrganization(e.target.value)}
                  placeholder="Optional for unique email addresses"
                  autoComplete="organization"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
              {error && <p className="text-sm text-red-600">{error}</p>}
              <Button type="submit" className="w-full" disabled={isPending}>
                Sign in
              </Button>
            </form>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card text-muted-foreground px-2">Or demo as</span>
              </div>
            </div>

            <div className="space-y-2">
              {DEMO_PERSONAS.map((p) => (
                <Button
                  key={p.email}
                  type="button"
                  variant="outline"
                  className="w-full justify-between"
                  disabled={isPending}
                  onClick={() => handleDemo(p.email)}
                >
                  <span>
                    {p.name} <span className="text-muted-foreground">({p.role})</span>
                  </span>
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>

        <p className="text-muted-foreground text-center text-xs">
          All data is synthetic. Upstream systems are simulated.
        </p>
        <p className="text-center text-xs">
          <Link
            href="/recruiter"
            className="text-muted-foreground hover:text-foreground underline-offset-4 hover:underline"
          >
            Back to recruiter overview
          </Link>
        </p>
      </div>
    </div>
  );
}
