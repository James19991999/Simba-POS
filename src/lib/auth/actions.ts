import { createClient } from "@/lib/supabase/client";
import { camelToRow } from "@/lib/supabase/case";
import type { Organization } from "@/types";

export async function signUp(email: string, password: string, displayName: string) {
  const supabase = createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { display_name: displayName } },
  });
  if (error) throw error;
  return data.user;
}

export async function signIn(email: string, password: string) {
  const supabase = createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.user;
}

export async function signOut() {
  const supabase = createClient();
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

/**
 * Onboarding: creates the organization, its first station, and an "owner"
 * membership for the creating user. Three separate inserts (Postgres has no
 * client-side multi-table transaction the way a single Firestore batch
 * write did) — if a later insert fails, the earlier rows are left behind.
 * This is a real, known gap versus the atomic Firestore version; the
 * honest fix is a Postgres RPC function wrapping all three inserts in one
 * transaction, which is straightforward to add once there's a live project
 * to deploy it to (see supabase/migrations — a good candidate for 0002).
 */
export async function createOrganizationAndOwner(params: {
  uid: string;
  email: string;
  displayName: string;
  orgName: string;
  stationName: string;
  stationAddress: string;
}) {
  const supabase = createClient();

  const orgInsert = camelToRow({
    name: params.orgName,
    ownerUid: params.uid,
    vatRate: 0.16,
    tourismLevyRate: 0.02,
    roundingKes: 1,
  });
  const { data: org, error: orgError } = await supabase
    .from("organizations")
    .insert(orgInsert)
    .select()
    .single();
  if (orgError) throw orgError;
  const orgId = (org as Organization & { id: string }).id;

  const stationInsert = camelToRow({
    orgId,
    name: params.stationName,
    address: params.stationAddress,
  });
  const { data: station, error: stationError } = await supabase
    .from("stations")
    .insert(stationInsert)
    .select()
    .single();
  if (stationError) throw stationError;

  const membershipInsert = camelToRow({
    orgId,
    userId: params.uid,
    role: "owner",
    displayName: params.displayName,
    email: params.email,
    active: true,
  });
  const { error: membershipError } = await supabase.from("memberships").insert(membershipInsert);
  if (membershipError) throw membershipError;

  return { orgId, stationId: (station as { id: string }).id };
}
