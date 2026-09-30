import { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { rowToCamel } from "@/lib/supabase/case";
import type { Membership, Role } from "@/types";

export class UnauthorizedError extends Error {
  constructor(message = "Unauthorized") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends Error {
  constructor(message = "Forbidden") {
    super(message);
    this.name = "ForbiddenError";
  }
}

/**
 * Verifies the caller's Supabase access token (sent as
 * `Authorization: Bearer <token>`) via the service-role admin client's
 * `auth.getUser(token)` — the Postgres/Supabase equivalent of the Firebase
 * version's `adminAuth().verifyIdToken(idToken)`. Returns the verified uid
 * and email; throws UnauthorizedError on a missing/invalid/expired token.
 */
export async function verifySession(req: NextRequest): Promise<{ uid: string; email: string | null }> {
  const authHeader = req.headers.get("authorization") ?? req.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new UnauthorizedError("Missing bearer token");
  }
  const token = authHeader.slice("Bearer ".length).trim();
  if (!token) {
    throw new UnauthorizedError("Missing bearer token");
  }

  const { data, error } = await supabaseAdmin().auth.getUser(token);
  if (error || !data?.user) {
    throw new UnauthorizedError("Invalid or expired session");
  }

  return { uid: data.user.id, email: data.user.email ?? null };
}

/**
 * Confirms `uid` holds an active membership in `orgId` with one of
 * `allowedRoles`, querying the memberships table with the service-role
 * client (bypasses RLS, mirroring the Firestore version's Admin SDK
 * membership lookup). Returns the membership row on success.
 */
export async function requireOrgRole(
  uid: string,
  orgId: string,
  allowedRoles: Role[]
): Promise<Membership> {
  const { data, error } = await supabaseAdmin()
    .from("memberships")
    .select("*")
    .eq("org_id", orgId)
    .eq("user_id", uid)
    .eq("active", true)
    .maybeSingle();

  if (error) {
    throw new ForbiddenError("Could not verify membership");
  }
  if (!data) {
    throw new ForbiddenError("Not a member of this organization");
  }

  const membership = rowToCamel<Membership>(data);
  if (!allowedRoles.includes(membership.role)) {
    throw new ForbiddenError(`Requires one of roles: ${allowedRoles.join(", ")}`);
  }

  return membership;
}
