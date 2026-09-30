"use client";

import { useMemo, useState } from "react";
import { useOrgTable } from "@/lib/supabase/useOrgTable";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/Card";
import { Currency } from "@/components/ui/Currency";
import { LoadingState } from "@/components/ui/States";
import type { Order, Payment } from "@/types";

type Range = "today" | "week" | "month";

function rangeStartMs(range: Range): number {
  const now = new Date();
  if (range === "today") {
    now.setHours(0, 0, 0, 0);
    return now.getTime();
  }
  if (range === "week") {
    return Date.now() - 7 * 24 * 60 * 60 * 1000;
  }
  return Date.now() - 30 * 24 * 60 * 60 * 1000;
}

export default function AnalyticsPage() {
  const { data: orders, loading } = useOrgTable<Order>("orders");
  const { data: payments } = useOrgTable<Payment>("payments");
  const [range, setRange] = useState<Range>("today");

  const since = rangeStartMs(range);
  const completed = payments.filter((p) => p.status === "completed" && p.createdAt >= since);
  const netSalesKes = completed.reduce((s, p) => s + p.amountKes, 0);
  const orderCount = completed.length;
  const aovKes = orderCount ? netSalesKes / orderCount : 0;

  const channelSplit = useMemo(() => {
    const inScopeOrders = orders.filter((o) => o.createdAt >= since);
    const counts: Record<string, number> = {};
    for (const o of inScopeOrders) counts[o.channel] = (counts[o.channel] ?? 0) + 1;
    return counts;
  }, [orders, since]);

  const topDishes = useMemo(() => {
    const inScopeOrders = orders.filter((o) => o.createdAt >= since);
    const tally: Record<string, { qty: number; grossKes: number }> = {};
    for (const o of inScopeOrders) {
      for (const item of o.items) {
        if (!tally[item.nameEn]) tally[item.nameEn] = { qty: 0, grossKes: 0 };
        tally[item.nameEn].qty += item.qty;
        tally[item.nameEn].grossKes += item.qty * item.unitPriceKes;
      }
    }
    return Object.entries(tally)
      .sort((a, b) => b[1].grossKes - a[1].grossKes)
      .slice(0, 5);
  }, [orders, since]);

  if (loading) return <LoadingState />;

  return (
    <div>
      <PageHeader
        title="Analytics & Reports"
        actions={
          <div className="flex gap-space-xs">
            {(["today", "week", "month"] as Range[]).map((r) => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={`rounded-full px-space-md py-space-xs font-label-md border ${
                  range === r ? "bg-primary-action text-on-primary border-primary-action" : "border-slate-border"
                }`}
              >
                {r}
              </button>
            ))}
          </div>
        }
      />
      <div className="p-space-lg grid grid-cols-1 md:grid-cols-3 gap-space-md">
        <Card>
          <p className="font-label-md text-on-surface-variant uppercase">Net Sales</p>
          <Currency amount={netSalesKes} size="display" />
        </Card>
        <Card>
          <p className="font-label-md text-on-surface-variant uppercase">Avg Order Value</p>
          <Currency amount={aovKes} size="display" />
        </Card>
        <Card>
          <p className="font-label-md text-on-surface-variant uppercase">Completed Orders</p>
          <p className="font-currency-display">{orderCount}</p>
        </Card>
      </div>

      <div className="p-space-lg grid grid-cols-1 lg:grid-cols-2 gap-space-lg">
        <Card>
          <p className="font-label-lg mb-space-sm">Sales Channel Split</p>
          <div className="flex flex-col gap-space-xs">
            {Object.entries(channelSplit).map(([channel, count]) => (
              <div key={channel} className="flex justify-between font-body-sm">
                <span>{channel.replace("_", " ")}</span>
                <span>{count} orders</span>
              </div>
            ))}
          </div>
        </Card>
        <Card>
          <p className="font-label-lg mb-space-sm">Top Dishes by Gross</p>
          <div className="flex flex-col gap-space-xs">
            {topDishes.map(([name, stats]) => (
              <div key={name} className="flex justify-between font-body-sm">
                <span>{name} ({stats.qty})</span>
                <Currency amount={stats.grossKes} size="sm" />
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
