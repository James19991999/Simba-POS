"use client";

import { useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { camelToRow } from "@/lib/supabase/case";
import { useAuth } from "@/context/AuthProvider";
import { useOrgTable } from "@/lib/supabase/useOrgTable";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Currency } from "@/components/ui/Currency";
import { EmptyState, LoadingState } from "@/components/ui/States";
import type { Order, OrderChannel, OrderStatus } from "@/types";

const CHANNEL_LABEL: Record<OrderChannel, string> = {
  dine_in: "Dine-In",
  takeaway: "Takeaway",
  glovo: "Glovo",
  uber_eats: "Uber Eats",
  jumia: "Jumia",
  simba_riders: "Simba Riders (Direct)",
};

const NEXT_STATUS: Partial<Record<OrderStatus, OrderStatus>> = {
  incoming: "cooking",
  cooking: "ready",
  ready: "en_route",
  en_route: "delivered",
};

export default function DeliveryPage() {
  const { activeOrgId, user } = useAuth();
  const supabase = useMemo(() => createClient(), []);
  const { data: orders, loading } = useOrgTable<Order>("orders");
  const deliveryOrders = orders
    .filter((o) => o.channel !== "dine_in" && o.status !== "delivered" && o.status !== "cancelled")
    .sort((a, b) => a.createdAt - b.createdAt);

  async function advance(order: Order) {
    const next = NEXT_STATUS[order.status];
    if (!next) return;
    const { error } = await supabase.from("orders").update(camelToRow({ status: next, updatedAt: Date.now() })).eq("id", order.id);
    if (error) throw error;
  }

  async function reject(order: Order) {
    const { error } = await supabase.from("orders").update(camelToRow({ status: "cancelled", updatedAt: Date.now() })).eq("id", order.id);
    if (error) throw error;
  }

  async function quickAggregatorOrder(channel: OrderChannel) {
    if (!activeOrgId || !user) return;
    const order: Omit<Order, "id"> = {
      orgId: activeOrgId,
      stationId: "default",
      channel,
      status: "incoming",
      items: [{ id: crypto.randomUUID(), menuItemId: "manual", nameEn: "Manual aggregator order", qty: 1, unitPriceKes: 1000 }],
      subtotalKes: 1000,
      vatKes: 0,
      tourismLevyKes: 0,
      totalKes: 1000,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      createdByUid: user.id,
      externalRef: `${channel.toUpperCase()}-${Math.floor(Math.random() * 9000 + 1000)}`,
    };
    const { error } = await supabase.from("orders").insert(camelToRow(order));
    if (error) throw error;
  }

  if (loading) return <LoadingState />;

  return (
    <div>
      <PageHeader
        title="Delivery & Aggregators"
        subtitle="Glovo · Uber Eats · Jumia · Simba Riders — real orders arrive via /api/webhooks/aggregator/{channel}; buttons below are for Simba Riders (direct) or manual testing"
        actions={
          <div className="flex gap-space-xs flex-wrap">
            {(["glovo", "uber_eats", "jumia", "simba_riders"] as OrderChannel[]).map((c) => (
              <Button key={c} variant="tertiary" onClick={() => quickAggregatorOrder(c)}>
                + {CHANNEL_LABEL[c]} {c !== "simba_riders" ? "(test)" : ""}
              </Button>
            ))}
          </div>
        }
      />
      {deliveryOrders.length === 0 ? (
        <EmptyState title="No active delivery orders" hint="Incoming aggregator and rider orders will appear here." />
      ) : (
        <div className="p-space-lg grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-space-md">
          {deliveryOrders.map((order) => (
            <Card key={order.id}>
              <div className="flex items-center justify-between">
                <p className="font-label-lg">{CHANNEL_LABEL[order.channel]} {order.externalRef && `#${order.externalRef}`}</p>
                <Badge tone="occupied">{order.status.replace("_", " ")}</Badge>
              </div>
              <p className="font-body-sm text-on-surface-variant mt-space-xs">
                {order.items.map((i) => `${i.qty}x ${i.nameEn}`).join(", ")}
              </p>
              <Currency amount={order.totalKes} className="block mt-space-xs" />
              <div className="flex gap-space-xs mt-space-sm">
                {order.status === "incoming" && (
                  <Button variant="destructive" onClick={() => reject(order)}>Reject</Button>
                )}
                {NEXT_STATUS[order.status] && (
                  <Button variant="secondary" onClick={() => advance(order)}>
                    Mark {NEXT_STATUS[order.status]?.replace("_", " ")}
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
