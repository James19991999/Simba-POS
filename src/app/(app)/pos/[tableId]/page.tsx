"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { camelToRow, rowToCamel } from "@/lib/supabase/case";
import { useAuth } from "@/context/AuthProvider";
import { useOrgTable } from "@/lib/supabase/useOrgTable";
import { computeBillBreakdown, splitEven } from "@/lib/billing/tax";
import { authFetch } from "@/lib/utils/authFetch";
import { buildKotHtml, buildReceiptHtml, printHtml } from "@/lib/printing/receipt";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Currency } from "@/components/ui/Currency";
import { LoadingState } from "@/components/ui/States";
import type { RestaurantTable, MenuItem, Order, OrderLineItem } from "@/types";

type SplitMode = "full" | "even";

export default function TableTicketPage() {
  const { tableId } = useParams<{ tableId: string }>();
  const { activeOrgId, activeOrg, user } = useAuth();
  const [table, setTable] = useState<RestaurantTable | null>(null);
  const [order, setOrder] = useState<Order | null>(null);
  const { data: menu } = useOrgTable<MenuItem>("menu_items");

  const [splitMode, setSplitMode] = useState<SplitMode>("full");
  const [splitPax, setSplitPax] = useState(2);
  const [channel, setChannel] = useState<"mpesa_stk" | "card" | "cash">("mpesa_stk");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [paymentRef, setPaymentRef] = useState<string | null>(null);
  const [paymentStatus, setPaymentStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [printError, setPrintError] = useState<string | null>(null);

  // Live table row
  useEffect(() => {
    if (!tableId) return;
    const supabase = createClient();
    let cancelled = false;
    async function fetchTable() {
      const { data } = await supabase.from("tables").select("*").eq("id", tableId).maybeSingle();
      if (!cancelled) setTable(data ? rowToCamel<RestaurantTable>(data) : null);
    }
    fetchTable();
    const channel = supabase
      .channel(`table-${tableId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "tables", filter: `id=eq.${tableId}` }, () => fetchTable())
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [tableId]);

  // Live open order for this table (created on first item add)
  useEffect(() => {
    if (!activeOrgId || !tableId) return;
    const supabase = createClient();
    let cancelled = false;
    async function fetchOrder() {
      const { data } = await supabase
        .from("orders")
        .select("*")
        .eq("org_id", activeOrgId)
        .eq("table_id", tableId);
      if (cancelled) return;
      const open = (data ?? [])
        .map((row) => rowToCamel<Order>(row))
        .filter((o) => o.status !== "served" && o.status !== "cancelled")
        .sort((a, b) => b.createdAt - a.createdAt)[0];
      setOrder(open ?? null);
    }
    fetchOrder();
    const ch = supabase
      .channel(`orders-org-${activeOrgId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "orders", filter: `org_id=eq.${activeOrgId}` },
        () => fetchOrder()
      )
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(ch);
    };
  }, [activeOrgId, tableId]);

  const tax = useMemo(
    () =>
      activeOrg
        ? { vatRate: activeOrg.vatRate, tourismLevyRate: activeOrg.tourismLevyRate, roundingKes: activeOrg.roundingKes }
        : { vatRate: 0.16, tourismLevyRate: 0.02, roundingKes: 1 },
    [activeOrg]
  );
  const breakdown = useMemo(
    () => computeBillBreakdown(order?.items ?? [], tax),
    [order, tax]
  );
  const splits = splitMode === "even" ? splitEven(breakdown.totalPayableKes, splitPax) : [breakdown.totalPayableKes];
  const amountDue = splitMode === "even" ? splits[0] : breakdown.totalPayableKes;

  async function ensureOrder(): Promise<string> {
    if (order) return order.id;
    if (!activeOrgId || !tableId || !user) throw new Error("Not ready");
    const supabase = createClient();
    const { data, error: insertError } = await supabase
      .from("orders")
      .insert(
        camelToRow({
          orgId: activeOrgId,
          stationId: table?.stationId ?? "default",
          tableId,
          channel: "dine_in",
          status: "cooking",
          items: [],
          subtotalKes: 0,
          vatKes: 0,
          tourismLevyKes: 0,
          totalKes: 0,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          createdByUid: user.id,
        })
      )
      .select()
      .single();
    if (insertError) throw insertError;
    const newOrder = rowToCamel<Order>(data);
    const { error: updateError } = await supabase
      .from("tables")
      .update(camelToRow({ status: "ordered", activeOrderId: newOrder.id }))
      .eq("id", tableId);
    if (updateError) throw updateError;
    return newOrder.id;
  }

  async function addItem(item: MenuItem) {
    const orderId = await ensureOrder();
    const current = order?.items ?? [];
    const existing = current.find((i) => i.menuItemId === item.id);
    let items: OrderLineItem[];
    if (existing) {
      items = current.map((i) => (i.menuItemId === item.id ? { ...i, qty: i.qty + 1 } : i));
    } else {
      items = [
        ...current,
        { id: crypto.randomUUID(), menuItemId: item.id, nameEn: item.nameEn, qty: 1, unitPriceKes: item.priceKes },
      ];
    }
    const supabase = createClient();
    const { error: updateError } = await supabase
      .from("orders")
      .update(camelToRow({ items, updatedAt: Date.now() }))
      .eq("id", orderId);
    if (updateError) throw updateError;
  }

  async function requestPayment() {
    if (!order || !activeOrgId) return;
    setError(null);
    setBusy(true);
    try {
      const supabase = createClient();
      if (channel === "cash") {
        const apiRef = `cash-${order.id}-${Date.now()}`;
        const { error: insertError } = await supabase.from("payments").upsert(
          camelToRow({
            id: apiRef,
            orgId: activeOrgId,
            stationId: order.stationId,
            orderId: order.id,
            tableId,
            channel: "cash",
            status: "completed",
            amountKes: amountDue,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            createdByUid: user?.id,
          })
        );
        if (insertError) throw insertError;
        const { error: orderUpdateError } = await supabase
          .from("orders")
          .update(camelToRow({ status: "served" }))
          .eq("id", order.id);
        if (orderUpdateError) throw orderUpdateError;
        const { error: tableUpdateError } = await supabase
          .from("tables")
          .update(camelToRow({ status: "settled" }))
          .eq("id", tableId);
        if (tableUpdateError) throw tableUpdateError;
        setPaymentStatus("completed");
        return;
      }

      if (channel === "mpesa_stk" && !phone) {
        setError("Enter the customer's phone number for M-Pesa STK Push.");
        return;
      }

      const res = await authFetch("/api/pos/intasend-checkout", {
        method: "POST",
        body: JSON.stringify({
          orgId: activeOrgId,
          stationId: order.stationId,
          orderId: order.id,
          tableId,
          amountKes: amountDue,
          channel,
          phone: channel === "mpesa_stk" ? phone : undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Checkout failed");
      setPaymentRef(json.apiRef);
      setPaymentStatus("pending");
      // Card payments go through IntaSend's hosted Express Checkout — there
      // is no direct-push equivalent for cards, so the guest/waiter must
      // open the hosted page to enter card details. M-Pesa STK needs no
      // such redirect: the push goes straight to the customer's phone.
      if (channel === "card" && json.url) {
        window.open(json.url, "_blank", "noopener,noreferrer");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Payment failed");
    } finally {
      setBusy(false);
    }
  }

  // Poll IntaSend status while a checkout is pending
  useEffect(() => {
    if (!paymentRef || !activeOrgId || paymentStatus === "completed" || paymentStatus === "failed") return;
    const interval = setInterval(async () => {
      const res = await authFetch(`/api/pos/intasend-status?apiRef=${paymentRef}&orgId=${activeOrgId}`);
      if (res.ok) {
        const json = await res.json();
        setPaymentStatus(json.status);
      }
    }, 4000);
    return () => clearInterval(interval);
  }, [paymentRef, activeOrgId, paymentStatus]);

  function printKot() {
    if (!order) return;
    setPrintError(null);
    const ok = printHtml(buildKotHtml(order, table!.code));
    if (!ok) setPrintError("Could not open the print window — check your browser's popup blocker.");
  }

  function printReceipt() {
    if (!order || !activeOrg) return;
    setPrintError(null);
    const ok = printHtml(
      buildReceiptHtml({
        orgName: activeOrg.name,
        stationName: table!.zone,
        tableCode: table!.code,
        order,
        breakdown,
        channel,
        kraPin: activeOrg.kraPin || undefined,
        simulatedEtims: true,
      })
    );
    if (!ok) setPrintError("Could not open the print window — check your browser's popup blocker.");
  }

  if (!table) return <LoadingState />;

  const categories = Array.from(new Set(menu.map((m) => m.category)));

  return (
    <div>
      <PageHeader
        title={`Table ${table.code}`}
        subtitle={`${table.zone} · ${table.pax ?? "-"} pax`}
        actions={
          order && order.items.length > 0 ? (
            <Button variant="tertiary" onClick={printKot}>🖨 Print KOT</Button>
          ) : undefined
        }
      />
      {printError && <p className="text-critical font-body-sm px-space-lg pt-space-sm">{printError}</p>}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-space-lg p-space-lg">
        <div>
          <h2 className="font-headline-sm mb-space-sm">Menu</h2>
          {categories.map((cat) => (
            <div key={cat} className="mb-space-md">
              <p className="font-label-lg text-on-surface-variant mb-space-xs">{cat}</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-space-sm">
                {menu.filter((m) => m.category === cat).map((m) => (
                  <Card key={m.id} className="flex items-center justify-between">
                    <div>
                      <p className="font-label-lg">{m.nameEn}</p>
                      <Currency amount={m.priceKes} size="sm" />
                    </div>
                    <Button variant="tertiary" onClick={() => addItem(m)}>Add</Button>
                  </Card>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div>
          <h2 className="font-headline-sm mb-space-sm">Ticket Items ({order?.items.length ?? 0})</h2>
          <Card>
            {(order?.items ?? []).length === 0 ? (
              <p className="font-body-sm text-on-surface-variant">No items ordered yet.</p>
            ) : (
              <div className="flex flex-col gap-space-xs">
                {order!.items.map((i) => (
                  <div key={i.id} className="flex justify-between font-body-sm">
                    <span>{i.qty}x {i.nameEn}</span>
                    <Currency amount={i.qty * i.unitPriceKes} size="sm" />
                  </div>
                ))}
              </div>
            )}
            <hr className="my-space-sm border-slate-border" />
            <div className="flex justify-between font-body-sm">
              <span>Items Subtotal</span>
              <Currency amount={breakdown.itemsSubtotalKes} />
            </div>
            <div className="flex justify-between font-body-sm">
              <span>Tourism & Catering Levy ({(tax.tourismLevyRate * 100).toFixed(0)}%)</span>
              <Currency amount={breakdown.tourismLevyKes} />
            </div>
            <div className="flex justify-between font-body-sm text-on-surface-variant">
              <span>VAT ({(tax.vatRate * 100).toFixed(0)}% incl. / KRA eTIMS)</span>
              <Currency amount={breakdown.vatKes} />
            </div>
            <div className="flex justify-between font-headline-sm mt-space-xs">
              <span>Total Payable</span>
              <Currency amount={breakdown.totalPayableKes} size="display" />
            </div>
          </Card>

          <Card className="mt-space-md">
            <p className="font-label-lg mb-space-sm">Split Bill</p>
            <div className="flex gap-space-sm mb-space-sm">
              <Button variant={splitMode === "full" ? "primary" : "tertiary"} onClick={() => setSplitMode("full")}>
                Full Bill
              </Button>
              <Button variant={splitMode === "even" ? "primary" : "tertiary"} onClick={() => setSplitMode("even")}>
                Split Evenly
              </Button>
              {splitMode === "even" && (
                <input
                  type="number"
                  min={2}
                  value={splitPax}
                  onChange={(e) => setSplitPax(Number(e.target.value))}
                  className="w-16 border border-slate-border rounded px-space-xs"
                />
              )}
            </div>
            {splitMode === "even" && (
              <p className="font-body-sm text-on-surface-variant">
                {splitPax} guests · <Currency amount={splits[0]} size="sm" /> each
              </p>
            )}

            <p className="font-label-lg mt-space-md mb-space-sm">Select Payment Channel</p>
            <div className="flex gap-space-sm flex-wrap mb-space-sm">
              <Button variant={channel === "mpesa_stk" ? "secondary" : "tertiary"} onClick={() => setChannel("mpesa_stk")}>
                M-Pesa STK (IntaSend)
              </Button>
              <Button variant={channel === "card" ? "secondary" : "tertiary"} onClick={() => setChannel("card")}>
                Card (IntaSend)
              </Button>
              <Button variant={channel === "cash" ? "secondary" : "tertiary"} onClick={() => setChannel("cash")}>
                Cash
              </Button>
            </div>
            {channel === "mpesa_stk" && (
              <input
                placeholder="Customer phone (2547XXXXXXXX)"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full border border-slate-border rounded px-space-md py-space-sm min-h-touch-min mb-space-sm"
              />
            )}
            {error && <p className="text-critical font-body-sm mb-space-sm">{error}</p>}
            {paymentStatus && (
              <p className="font-body-sm mb-space-sm">
                Payment status: <span className="font-semibold">{paymentStatus}</span>
                {paymentStatus === "pending" && " — awaiting customer PIN entry…"}
              </p>
            )}
            {paymentStatus === "completed" ? (
              <Button fullWidth variant="secondary" onClick={printReceipt}>🖨 Print Receipt</Button>
            ) : (
              <Button
                fullWidth
                disabled={busy || !order || order.items.length === 0}
                onClick={requestPayment}
              >
                {busy ? "Processing…" : channel === "cash" ? `Confirm Cash (${amountDue.toFixed(0)} KES)` : `Trigger ${channel === "mpesa_stk" ? "M-Pesa STK Push" : "Card Checkout"}`}
              </Button>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
