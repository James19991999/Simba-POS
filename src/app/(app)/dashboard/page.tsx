"use client";

import { useMemo } from "react";
import { useAuth } from "@/context/AuthProvider";
import { useOrgTable } from "@/lib/supabase/useOrgTable";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/Card";
import { Currency } from "@/components/ui/Currency";
import { LoadingState } from "@/components/ui/States";
import type { Order, RestaurantTable, Payment, InventoryItem, EtimsInvoice } from "@/types";

function startOfTodayMs() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export default function DashboardPage() {
  const { activeOrg } = useAuth();
  const { data: orders, loading: ordersLoading } = useOrgTable<Order>("orders");
  const { data: tables } = useOrgTable<RestaurantTable>("tables");
  const { data: payments } = useOrgTable<Payment>("payments");
  const { data: inventory } = useOrgTable<InventoryItem>("inventory_items");
  const { data: etims } = useOrgTable<EtimsInvoice>("etims_invoices");

  const today = startOfTodayMs();

  const todaysCompletedPayments = payments.filter(
    (p) => p.status === "completed" && p.createdAt >= today
  );

  const grossToday = todaysCompletedPayments.reduce((s, p) => s + p.amountKes, 0);
  const byChannel = useMemo(() => {
    const map: Record<string, number> = { mpesa_stk: 0, card: 0, cash: 0 };
    for (const p of todaysCompletedPayments) map[p.channel] = (map[p.channel] ?? 0) + p.amountKes;
    return map;
  }, [todaysCompletedPayments]);

  const occupied = tables.filter((t) => t.status !== "available").length;
  const kitchenQueue = orders.filter((o) => o.status === "cooking" || o.status === "incoming").length;
  const lowStock = inventory.filter((i) => i.qtyOnHand <= i.reorderPoint);
  const etimsSynced = etims.filter((e) => e.status === "synced").length;

  if (ordersLoading) return <LoadingState />;

  return (
    <div>
      <PageHeader title="Dashboard" subtitle={activeOrg?.name} />
      <div className="p-space-lg grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-space-md">
        <Card>
          <p className="font-label-md text-on-surface-variant uppercase">Today&apos;s Gross Sales</p>
          <Currency amount={grossToday} size="display" />
          <div className="mt-space-sm font-body-sm text-on-surface-variant space-y-1">
            <p>M-Pesa STK: <Currency amount={byChannel.mpesa_stk} size="sm" /></p>
            <p>Card: <Currency amount={byChannel.card} size="sm" /></p>
            <p>Cash: <Currency amount={byChannel.cash} size="sm" /></p>
          </div>
        </Card>
        <Card>
          <p className="font-label-md text-on-surface-variant uppercase">Active Tables</p>
          <p className="font-currency-display">{occupied}/{tables.length}</p>
          <p className="font-body-sm text-on-surface-variant">
            {tables.length ? Math.round((occupied / tables.length) * 100) : 0}% occupancy
          </p>
        </Card>
        <Card>
          <p className="font-label-md text-on-surface-variant uppercase">Kitchen Queue</p>
          <p className="font-currency-display">{kitchenQueue}</p>
          <p className="font-body-sm text-on-surface-variant">orders in progress</p>
        </Card>
        <Card>
          <p className="font-label-md text-on-surface-variant uppercase">KRA eTIMS</p>
          <p className="font-currency-display">{etimsSynced}</p>
          <p className="font-body-sm text-on-surface-variant">of {etims.length} invoices synced</p>
        </Card>
      </div>

      {lowStock.length > 0 && (
        <div className="px-space-lg">
          <Card className="border-amber-500 bg-amber-bg">
            <p className="font-label-lg text-amber-text">⚠ Stock Critical</p>
            <p className="font-body-sm text-amber-text">
              {lowStock.map((i) => i.name).join(", ")} at or below reorder point
            </p>
          </Card>
        </div>
      )}
    </div>
  );
}
