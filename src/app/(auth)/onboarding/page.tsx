"use client";

import { useState, FormEvent, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthProvider";
import { createOrganizationAndOwner } from "@/lib/auth/actions";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

export default function OnboardingPage() {
  const router = useRouter();
  const { user, loading, memberships } = useAuth();
  const [orgName, setOrgName] = useState("");
  const [stationName, setStationName] = useState("Nairobi Station #01");
  const [stationAddress, setStationAddress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.replace("/sign-in");
    if (!loading && memberships.length > 0) router.replace("/dashboard");
  }, [loading, user, memberships, router]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!user) return;
    setError(null);
    setSubmitting(true);
    try {
      await createOrganizationAndOwner({
        uid: user.id,
        email: user.email ?? "",
        displayName: (user.user_metadata?.display_name as string | undefined) ?? "Owner",
        orgName,
        stationName,
        stationAddress,
      });
      router.replace("/dashboard");
    } catch (err) {
      // Temporary diagnostic: log the raw error and try much harder to
      // surface a real message, whatever shape the thrown value has
      // (Error, Supabase PostgrestError-like object, plain string, etc.)
      // instead of silently falling back to a generic message.
      // eslint-disable-next-line no-console
      console.error("Onboarding error (full object):", err);
      let message = "Could not create your restaurant";
      if (err instanceof Error) {
        message = err.message;
      } else if (typeof err === "string") {
        message = err;
      } else if (err && typeof err === "object") {
        const anyErr = err as Record<string, unknown>;
        const candidate = anyErr.message ?? anyErr.error_description ?? anyErr.msg ?? anyErr.hint;
        if (typeof candidate === "string" && candidate.length > 0) {
          message = candidate;
        } else {
          try {
            message = `Could not create your restaurant  ${JSON.stringify(err)}`;
          } catch {
            // JSON.stringify can fail on circular objects; keep the generic message
          }
        }
      }
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading || !user) return null;

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface p-space-md">
      <Card className="w-full max-w-md">
        <p className="font-headline-md text-primary mb-space-xs">Set up your restaurant</p>
        <p className="font-body-sm text-on-surface-variant mb-space-lg">
          This creates your organization, your first station, and makes you the Owner.
        </p>
        <form onSubmit={handleSubmit} className="flex flex-col gap-space-md">
          <input
            required
            placeholder="Restaurant name (e.g. Boma Bistro - Westlands)"
            value={orgName}
            onChange={(e) => setOrgName(e.target.value)}
            className="border border-slate-border rounded px-space-md py-space-sm min-h-touch-min focus:border-primary-action outline-none"
          />
          <input
            required
            placeholder="Station name (e.g. Nairobi Station #04)"
            value={stationName}
            onChange={(e) => setStationName(e.target.value)}
            className="border border-slate-border rounded px-space-md py-space-sm min-h-touch-min focus:border-primary-action outline-none"
          />
          <input
            required
            placeholder="Station address"
            value={stationAddress}
            onChange={(e) => setStationAddress(e.target.value)}
            className="border border-slate-border rounded px-space-md py-space-sm min-h-touch-min focus:border-primary-action outline-none"
          />
          {error && <p className="text-critical font-body-sm">{error}</p>}
          <Button type="submit" disabled={submitting} fullWidth>
            {submitting ? "Creating" : "Create Restaurant"}
          </Button>
        </form>
      </Card>
    </div>
  );
}
