"use client";

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { signUp } from "@/lib/auth/actions";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

export default function SignUpPage() {
  const router = useRouter();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    setSubmitting(true);
    try {
      await signUp(email, password, displayName);
      router.replace("/onboarding");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-up failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface p-space-md">
      <Card className="w-full max-w-sm">
        <p className="font-headline-md text-primary mb-space-md">Create your SimbaPOS account</p>
        <form onSubmit={handleSubmit} className="flex flex-col gap-space-md">
          <input
            required
            placeholder="Your full name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="border border-slate-border rounded px-space-md py-space-sm min-h-touch-min focus:border-primary-action outline-none"
          />
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
            placeholder="Password (min. 8 characters)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="border border-slate-border rounded px-space-md py-space-sm min-h-touch-min focus:border-primary-action outline-none"
          />
          {error && <p className="text-critical font-body-sm">{error}</p>}
          <Button type="submit" disabled={submitting} fullWidth>
            {submitting ? "Creating account…" : "Create Account"}
          </Button>
        </form>
        <p className="font-body-sm text-on-surface-variant mt-space-lg">
          Already have an account?{" "}
          <Link href="/sign-in" className="text-primary-action font-semibold">
            Sign in
          </Link>
        </p>
      </Card>
    </div>
  );
}
