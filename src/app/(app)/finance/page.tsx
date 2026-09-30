"use client";

import { useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { camelToRow } from "@/lib/supabase/case";
import { useAuth } from "@/context/AuthProvider";
import { useOrgTable } from "@/lib/supabase/useOrgTable";
import { simulateEtimsTransmit } from "@/lib/etims/client";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Currency } from "@/components/ui/Currency";
import { LoadingState } from "@/components/ui/States";
import type { Payment, EtimsInvoice, Order } from "@/types";

function startOfTodayMs() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export default function FinancePage() {
  const { activeOrgId, activeOrg } = useAuth();
  const supabase = useMemo(() => createClient(), []);
  const { data: payments, loading } = useOrgTable<Payment>("payments");
  const { data: etims } = useOrgTable<EtimsInvoice>("etims_invoices");
  const { data: orders } = useOrgTable<Order>("orders");

  const today = startOfTodayMs();
  const todaysPayments = payments.filter((p) => p.status === "completed" && p.createdAt >= today);
  const grossKes = todaysPayments.reduce((s, p) => s + p.amountKes, 0);
  const vatRate = activeOrg?.vatRate ?? 0.16;
  const levyRate = activeOrg?.tourismLevyRate ?? 0.02;
  // Aggregate approximation matching lib/billing/tax.ts's per-ticket formula:
  // gross (post-levy) -> back out the levy to recover the VAT-inclusive
  // items subtotal -> back VAT out of THAT subtotal, not out of gross.
  // This only matches per-ticket totals exactly when every ticket used the
  // same tax config; per-ticket eTIMS invoices remain the source of truth.
  const itemsSubtotalApprox = grossKes / (1 + levyRate);
  const tourismLevyKes = grossKes - itemsSubtotalApprox;
  const vatKes = (itemsSubtotalApprox * vatRate) / (1 + vatRate);

  const byChannel = {
    mpesa_stk: todaysPayments.filter((p) => p.channel === "mpesa_stk").reduce((s, p) => s + p.amountKes, 0),
    card: todaysPayments.filter((p) => p.channel === "card").reduce((s, p) => s + p.amountKes, 0),
    cash: todaysPayments.filter((p) => p.channel === "cash").reduce((s, p) => s + p.amountKes, 0),
  };

  const unsyncedPayments = todaysPayments.filter((p) => !etims.some((e) => e.orderId === p.orderId));

  async function syncEtims() {
    if (!activeOrgId) return;
    for (const payment of unsyncedPayments) {
      const order = orders.find((o) => o.id === payment.orderId);
      // Same subtotal-first formula as lib/billing/tax.ts: back the levy out
      // of the gross to recover the VAT-inclusive subtotal, then back VAT
      // out of that subtotal (not out of gross) — see the comment there.
      const subtotal = payment.amountKes / (1 + levyRate);
      const invoiceData = simulateEtimsTransmit({
        orgId: activeOrgId,
        stationId: payment.stationId,
        orderId: payment.orderId,
        grossKes: payment.amountKes,
        vatKes: (subtotal * vatRate) / (1 + vatRate),
        tourismLevyKes: payment.amountKes - subtotal,
      });
      const { error } = await supabase.from("etims_invoices").insert(camelToRow(invoiceData));
      if (error) throw error;
      void order;
    }
  }

  if (loading) return <LoadingState />;

  return (
    <div>
      <PageHeader
        title="Finance & KRA eTIMS Hub"
        subtitle="Simulated VSCU sync — see gap analysis for what's needed to go live"
        actions={<Button onClick={syncEtims} disabled={unsyncedPayments.length === 0}>Sync Now ({unsyncedPayments.length})</Button>}
      />

      <div className="p-space-lg grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-space-md">
        <Card>
          <p className="font-label-md text-on-surface-variant uppercase">Gross Turnover (Today)</p>
          <Currency amount={grossKes} size="display" />
        </Card>
        <Card>
          <p className="font-label-md text-on-surface-variant uppercase">VAT (16% incl.)</p>
          <Currency amount={vatKes} size="display" />
        </Card>
        <Card>
          <p className="font-label-md text-on-surface-variant uppercase">Tourism Levy (2%)</p>
          <Currency amount={tourismLevyKes} size="display" />
        </Card>
        <Card>
          <p className="font-label-md text-on-surface-variant uppercase">eTIMS Synced</p>
          <p className="font-currency-display">{etims.filter((e) => e.status === "synced").length} / {etims.length}</p>
          <Badge tone={unsyncedPayments.length === 0 ? "success" : "warning"}>
            {unsyncedPayments.length === 0 ? "All settled tickets synced" : `${unsyncedPayments.length} pending`}
          </Badge>
        </Card>
      </div>

      <div className="p-space-lg">
        <h2 className="font-headline-sm mb-space-sm">Tender Reconciliation</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-space-md">
          <Card>
            <p className="font-label-lg">M-Pesa STK (IntaSend)</p>
            <Currency amount={byChannel.mpesa_stk} />
          </Card>
          <Card>
            <p className="font-label-lg">Card (IntaSend)</p>
            <Currency amount={byChannel.card} />
          </Card>
          <Card>
            <p className="font-label-lg">Cash in Drawer</p>
            <Currency amount={byChannel.cash} />
          </Card>
        </div>
      </div>

      <div className="p-space-lg">
        <h2 className="font-headline-sm mb-space-sm">Recent eTIMS Receipts</h2>
        <div className="flex flex-col gap-space-sm">
          {etims.slice(0, 10).map((inv) => (
            <Card key={inv.id} className="flex items-center justify-between">
              <div>
                <p className="font-label-lg">{inv.controlNumber}</p>
                <p className="font-body-sm text-on-surface-variant">
                  {inv.simulated ? "Simulated — pending real KRA credentials" : "Live"}
                </p>
              </div>
              <div className="text-right">
                <Currency amount={inv.grossKes} size="sm" />
                <Badge tone={inv.status === "synced" ? "success" : "warning"}>{inv.status}</Badge>
              </div>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
