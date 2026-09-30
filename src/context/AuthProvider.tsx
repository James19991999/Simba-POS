"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  ReactNode,
  useCallback,
  useMemo,
} from "react";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { rowToCamel, rowsToCamel } from "@/lib/supabase/case";
import type { Membership, Organization, Role } from "@/types";

interface AuthState {
  user: User | null;
  loading: boolean;
  memberships: Membership[];
  activeOrgId: string | null;
  activeOrg: Organization | null;
  activeRole: Role | null;
  activeMembership: Membership | null;
  error: string | null;
  setActiveOrgId: (orgId: string) => void;
  hasRole: (...roles: Role[]) => boolean;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

// Ported from the Firebase version's AuthProvider, same shape and same
// deadlock-avoidance principle: route protection (AppShell) depends only on
// `loading`/`user`, never on a flag this provider itself sets — that flag
// would only ever be set from inside the very layout the guard protects.
export function AuthProvider({ children }: { children: ReactNode }) {
  const supabase = useMemo(() => createClient(), []);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [orgsById, setOrgsById] = useState<Record<string, Organization>>({});
  const [activeOrgId, setActiveOrgIdState] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!user) {
      setMemberships([]);
      return;
    }

    let cancelled = false;

    async function fetchMemberships() {
      const { data, error: err } = await supabase
        .from("memberships")
        .select("*")
        .eq("user_id", user!.id)
        .eq("active", true);
      if (cancelled) return;
      if (err) {
        setError(err.message);
        return;
      }
      const rows = rowsToCamel<Membership>(data ?? []);
      setMemberships(rows);
      setActiveOrgIdState((prev) => prev ?? rows[0]?.orgId ?? null);
    }

    fetchMemberships();

    const channel = supabase
      .channel(`memberships-self-${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "memberships", filter: `user_id=eq.${user.id}` },
        () => fetchMemberships()
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  useEffect(() => {
    if (!activeOrgId) return;
    const orgId = activeOrgId; // narrow to `string` for use inside the nested async closures below

    let cancelled = false;

    async function fetchOrg() {
      const { data, error: err } = await supabase
        .from("organizations")
        .select("*")
        .eq("id", orgId)
        .single();
      if (cancelled) return;
      if (err) {
        setError(err.message);
        return;
      }
      if (data) {
        setOrgsById((prev) => ({ ...prev, [orgId]: rowToCamel<Organization>(data) }));
      }
    }

    fetchOrg();

    const channel = supabase
      .channel(`org-${activeOrgId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "organizations", filter: `id=eq.${activeOrgId}` },
        () => fetchOrg()
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrgId]);

  const setActiveOrgId = useCallback((orgId: string) => setActiveOrgIdState(orgId), []);

  const activeMembership = memberships.find((m) => m.orgId === activeOrgId) ?? null;
  const activeRole = activeMembership?.role ?? null;
  const activeOrg = activeOrgId ? orgsById[activeOrgId] ?? null : null;

  const hasRole = useCallback(
    (...roles: Role[]) => (activeRole ? roles.includes(activeRole) : false),
    [activeRole]
  );

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        memberships,
        activeOrgId,
        activeOrg,
        activeRole,
        activeMembership,
        error,
        setActiveOrgId,
        hasRole,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
