import { createClient, SupabaseClient } from "@supabase/supabase-js";

// Service-role Supabase client — the direct equivalent of the Firebase
// Admin SDK. Uses SUPABASE_SERVICE_ROLE_KEY, which carries Postgres's
// `service_role` grant (BYPASSRLS): every query through this client skips
// Row Level Security entirely, exactly like the Admin SDK bypassed Firestore
// Security Rules. NEVER import this file into client-side code, and never
// send this key to the browser — server-only, same rule as
// FIREBASE_PRIVATE_KEY had.
let cached: SupabaseClient | null = null;

export function supabaseAdmin(): SupabaseClient {
  if (cached) return cached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      "Supabase admin credentials are not configured. Set NEXT_PUBLIC_SUPABASE_URL and " +
        "SUPABASE_SERVICE_ROLE_KEY in the environment."
    );
  }

  cached = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return cached;
}
