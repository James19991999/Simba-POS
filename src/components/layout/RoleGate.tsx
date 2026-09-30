"use client";

import { ReactNode } from "react";
import { useAuth } from "@/context/AuthProvider";
import type { Role } from "@/types";

export function RoleGate({ roles, children, fallback = null }: { roles: Role[]; children: ReactNode; fallback?: ReactNode }) {
  const { hasRole } = useAuth();
  if (!hasRole(...roles)) return <>{fallback}</>;
  return <>{children}</>;
}
