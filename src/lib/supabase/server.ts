import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// Server Component / Route Handler Supabase client — reads the session from
// the request's cookies (set by the browser client via @supabase/ssr).
// Use this when a server-rendered page or route needs the CALLING USER's
// own session (RLS-scoped). For privileged operations that must bypass RLS
// (checkout creation, webhook processing), use lib/supabase/admin.ts instead
// — the same split as verifySession()+adminDb() had in the Firebase version.
export async function createServerSupabaseClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // Called from a Server Component with no response to attach
            // cookies to — safe to ignore as long as middleware.ts also
            // refreshes the session (it does).
          }
        },
      },
    }
  );
}
