"use client";

import Link from "next/link";
import { useOrgTable } from "@/lib/supabase/useOrgTable";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState, LoadingState } from "@/components/ui/States";
import type { RestaurantTable } from "@/types";

export default function PosIndexPage() {
  const { data: tables, loading } = useOrgTable<RestaurantTable>("tables");
  const openTables = tables.filter((t) => t.status !== "available");

  if (loading) return <LoadingState />;

  return (
    <div>
      <PageHeader title="POS & Pay" subtitle="Select a table to build or settle its ticket" />
      {openTables.length === 0 ? (
        <EmptyState title="No open tables" hint="Seat a table from Floor & Tables to start an order." />
      ) : (
        <div className="p-space-lg grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-space-md">
          {openTables.map((t) => (
            <Link key={t.id} href={`/pos/${t.id}`}>
              <Card className="hover:border-primary-action">
                <div className="flex items-center justify-between">
                  <p className="font-headline-sm">{t.code}</p>
                  <Badge tone="occupied">{t.status.replace("_", " ")}</Badge>
                </div>
                <p className="font-body-sm text-on-surface-variant">{t.zone} · {t.pax ?? "-"} pax</p>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
