"use client";

import { useMemo, useState, FormEvent } from "react";
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
import type { InventoryItem, PurchaseOrder } from "@/types";

export default function InventoryPage() {
  const { activeOrgId, user } = useAuth();
  const supabase = useMemo(() => createClient(), []);
  const { data: items, loading } = useOrgTable<InventoryItem>("inventory_items");
  const { data: purchaseOrders } = useOrgTable<PurchaseOrder>("purchase_orders");
  const [showForm, setShowForm] = useState(false);

  const valuationKes = items.reduce((s, i) => s + i.qtyOnHand * i.unitPriceKes, 0);
  const lowStock = items.filter((i) => i.qtyOnHand <= i.reorderPoint);
  const pendingPOs = purchaseOrders.filter((po) => po.status === "pending" || po.status === "in_transit");

  async function addItem(values: Omit<InventoryItem, "id" | "orgId" | "stationId" | "updatedAt">) {
    if (!activeOrgId) return;
    const { error } = await supabase
      .from("inventory_items")
      .insert(camelToRow({ orgId: activeOrgId, stationId: "default", updatedAt: Date.now(), ...values }));
    if (error) throw error;
    setShowForm(false);
  }

  async function createPO(item: InventoryItem) {
    if (!activeOrgId || !user) return;
    const { error } = await supabase.from("purchase_orders").insert(
      camelToRow({
        orgId: activeOrgId,
        stationId: item.stationId,
        inventoryItemId: item.id,
        qty: Math.max(item.reorderPoint * 2, 1),
        status: "pending",
        createdAt: Date.now(),
        createdByUid: user.id,
      })
    );
    if (error) throw error;
  }

  async function receivePO(po: PurchaseOrder) {
    const { error: poError } = await supabase
      .from("purchase_orders")
      .update(camelToRow({ status: "received" }))
      .eq("id", po.id);
    if (poError) throw poError;
    const item = items.find((i) => i.id === po.inventoryItemId);
    if (item) {
      const { error: itemError } = await supabase
        .from("inventory_items")
        .update(camelToRow({ qtyOnHand: item.qtyOnHand + po.qty, updatedAt: Date.now() }))
        .eq("id", item.id);
      if (itemError) throw itemError;
    }
  }

  return (
    <div>
      <PageHeader
        title="Inventory & Supply Chain"
        subtitle={<Currency amount={valuationKes} size="sm" />}
        actions={<Button onClick={() => setShowForm((s) => !s)}>{showForm ? "Cancel" : "+ New Item"}</Button>}
      />

      {lowStock.length > 0 && (
        <div className="px-space-lg pt-space-lg">
          <Card className="border-amber-500 bg-amber-bg">
            <p className="font-label-lg text-amber-text">⚠ Urgent Stock Shortage</p>
            <p className="font-body-sm text-amber-text">{lowStock.map((i) => i.name).join(", ")}</p>
          </Card>
        </div>
      )}

      {showForm && (
        <div className="p-space-lg">
          <InventoryForm onSubmit={addItem} />
        </div>
      )}

      {loading ? (
        <LoadingState />
      ) : items.length === 0 ? (
        <EmptyState title="No inventory items yet" hint="Add ingredients and supplies to track stock." />
      ) : (
        <div className="p-space-lg grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-space-md">
          {items.map((item) => {
            const low = item.qtyOnHand <= item.reorderPoint;
            return (
              <Card key={item.id}>
                <div className="flex items-center justify-between">
                  <p className="font-label-lg">{item.name}</p>
                  {low && <Badge tone="critical">Reorder</Badge>}
                </div>
                <p className="font-body-sm text-on-surface-variant">{item.supplier}</p>
                <p className="font-body-sm">
                  <Currency amount={item.unitPriceKes} size="sm" /> / {item.unit}
                </p>
                <p className="font-body-sm tabular">{item.qtyOnHand} {item.unit} on hand (reorder &lt; {item.reorderPoint})</p>
                {low && (
                  <Button variant="tertiary" className="mt-space-sm" onClick={() => createPO(item)}>
                    + New Purchase Order
                  </Button>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <div className="p-space-lg">
        <h2 className="font-headline-sm mb-space-sm">Pending Purchase Orders ({pendingPOs.length})</h2>
        <div className="flex flex-col gap-space-sm">
          {pendingPOs.map((po) => {
            const item = items.find((i) => i.id === po.inventoryItemId);
            return (
              <Card key={po.id} className="flex items-center justify-between">
                <p className="font-body-sm">{item?.name ?? "Unknown item"} · {po.qty} {item?.unit}</p>
                <Button variant="secondary" onClick={() => receivePO(po)}>Mark Received</Button>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function InventoryForm({
  onSubmit,
}: {
  onSubmit: (values: Omit<InventoryItem, "id" | "orgId" | "stationId" | "updatedAt">) => void;
}) {
  const [category, setCategory] = useState<InventoryItem["category"]>("Butchery & Meats");
  const [name, setName] = useState("");
  const [supplier, setSupplier] = useState("");
  const [unit, setUnit] = useState("kg");
  const [unitPriceKes, setUnitPriceKes] = useState(0);
  const [qtyOnHand, setQtyOnHand] = useState(0);
  const [reorderPoint, setReorderPoint] = useState(0);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name) return;
    onSubmit({ category, name, supplier, unit, unitPriceKes, qtyOnHand, reorderPoint });
    setName("");
    setSupplier("");
    setUnitPriceKes(0);
    setQtyOnHand(0);
    setReorderPoint(0);
  }

  return (
    <Card>
      <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-3 gap-space-sm">
        <select value={category} onChange={(e) => setCategory(e.target.value as InventoryItem["category"])} className="border border-slate-border rounded px-space-sm py-space-xs min-h-touch-min">
          {["Butchery & Meats", "Fresh Produce", "Bar & Beverages", "Dry Store", "LPG & Fuel"].map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <input placeholder="Item name" value={name} onChange={(e) => setName(e.target.value)} className="border border-slate-border rounded px-space-sm py-space-xs min-h-touch-min" required />
        <input placeholder="Supplier" value={supplier} onChange={(e) => setSupplier(e.target.value)} className="border border-slate-border rounded px-space-sm py-space-xs min-h-touch-min" />
        <input placeholder="Unit (kg/pc/bundle)" value={unit} onChange={(e) => setUnit(e.target.value)} className="border border-slate-border rounded px-space-sm py-space-xs min-h-touch-min" />
        <input type="number" placeholder="Unit price (KES)" value={unitPriceKes || ""} onChange={(e) => setUnitPriceKes(Number(e.target.value))} className="border border-slate-border rounded px-space-sm py-space-xs min-h-touch-min" />
        <input type="number" placeholder="Qty on hand" value={qtyOnHand || ""} onChange={(e) => setQtyOnHand(Number(e.target.value))} className="border border-slate-border rounded px-space-sm py-space-xs min-h-touch-min" />
        <input type="number" placeholder="Reorder point" value={reorderPoint || ""} onChange={(e) => setReorderPoint(Number(e.target.value))} className="border border-slate-border rounded px-space-sm py-space-xs min-h-touch-min" />
        <Button type="submit">Save Item</Button>
      </form>
    </Card>
  );
}
