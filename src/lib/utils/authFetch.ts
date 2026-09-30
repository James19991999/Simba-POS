import { createClient } from "@/lib/supabase/client";

// Fetch wrapper that attaches the current Supabase access token as a bearer
// token — used by every client call into our own API routes, which verify
// it server-side via lib/auth/verifySession.ts.
export async function authFetch(input: string, init: RequestInit = {}) {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const token = session?.access_token ?? null;
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  headers.set("Content-Type", "application/json");
  return fetch(input, { ...init, headers });
}
