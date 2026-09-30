"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { rowsToCamel } from "@/lib/supabase/case";
import { useAuth } from "@/context/AuthProvider";

/**
 * Live, org-scoped Postgres table reader — the Supabase equivalent of the
 * Firestore version's useOrgCollection (onSnapshot). Does an initial
 * `select` scoped to the active org, then subscribes to postgres_changes
 * for INSERT/UPDATE/DELETE on that table+org and refetches. Real tenant
 * scoping is still enforced server-side by RLS; the `eq("org_id", ...)`
 * filter here is the same client-side convenience the Firestore version had
 * with `where("orgId", "==", ...)`.
 *
 * Note: this refetches the whole scoped table on any change rather than
 * patching the changed row in place. Firestore's onSnapshot gives you the
 * exact diff for free; Supabase's postgres_changes payload has the
 * changed row too, but merging it correctly (respecting order-by, filters,
 * deletes) is real complexity this build didn't spend budget on — refetch
 * is correct, just not the most bandwidth-efficient approach at scale.
 */
export function useOrgTable<T>(table: string, orderByColumn?: string, orderAscending = true) {
  const { activeOrgId } = useAuth();
  const supabase = useMemo(() => createClient(), []);
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!activeOrgId) {
      setData([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    async function fetchAll() {
      let query = supabase.from(table).select("*").eq("org_id", activeOrgId);
      if (orderByColumn) query = query.order(orderByColumn, { ascending: orderAscending });
      const { data: rows, error: err } = await query;
      if (cancelled) return;
      if (err) {
        setError(err.message);
        setLoading(false);
        return;
      }
      setData(rowsToCamel<T>(rows ?? []));
      setLoading(false);
    }

    fetchAll();

    const channel = supabase
      .channel(`${table}-org-${activeOrgId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table, filter: `org_id=eq.${activeOrgId}` },
        () => fetchAll()
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrgId, table, orderByColumn, orderAscending]);

  return { data, loading, error };
}
