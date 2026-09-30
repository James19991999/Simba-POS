"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthProvider";

export default function RootPage() {
  const { user, loading, memberships } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/sign-in");
    } else if (memberships.length === 0) {
      router.replace("/onboarding");
    } else {
      router.replace("/dashboard");
    }
  }, [loading, user, memberships, router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface">
      <p className="font-headline-sm text-primary">SimbaPOS</p>
    </div>
  );
}
