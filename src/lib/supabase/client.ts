"use client";

import { createBrowserClient } from "@supabase/ssr";

// Browser Supabase client — used by client components (AuthProvider, every
// module page's data hooks). Auth state lives in cookies via @supabase/ssr
// so it's readable by both the browser and the Next.js server (middleware,
// route handlers) without a manual token-passing dance.
//
// Note on typing: this client is NOT parameterized with a generated
// `Database` type (`supabase gen types typescript`) because that command
// needs a live Supabase project to introspect, which this build environment
// doesn't have. Query results are cast to the domain types in
// src/types/index.ts instead — the same trust boundary the Firestore
// version had with `snap.data() as T`. Run `supabase gen types` once you
// have a real project linked, and switch to `createBrowserClient<Database>`
// for compile-time-checked queries.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
