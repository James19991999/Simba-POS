"use client";

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { signIn } from "@/lib/auth/actions";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

export default function SignInPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await signIn(email, password);
      router.replace("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface p-space-md">
      <Card className="w-full max-w-sm">
        <p className="font-headline-md text-primary mb-space-md">SimbaPOS</p>
        <p className="font-body-sm text-on-surface-variant mb-space-lg">
          Sign in to your restaurant&apos;s SimbaPOS station.
        </p>
        <form onSubmit={handleSubmit} className="flex flex-col gap-space-md">
          <input
            type="email"
            required
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="border border-slate-border rounded px-space-md py-space-sm min-h-touch-min focus:border-primary-action outline-none"
          />
          <input
            type="password"
            required
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="border border-slate-border rounded px-space-md py-space-sm min-h-touch-min focus:border-primary-action outline-none"
          />
          {error && <p className="text-critical font-body-sm">{error}</p>}
          <Button type="submit" disabled={submitting} fullWidth>
            {submitting ? "Signing in…" : "Sign In"}
          </Button>
        </form>
        <p className="font-body-sm text-on-surface-variant mt-space-lg">
          New restaurant?{" "}
          <Link href="/sign-up" className="text-primary-action font-semibold">
            Create an account
          </Link>
        </p>
      </Card>
    </div>
  );
}
