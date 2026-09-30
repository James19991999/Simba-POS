"use client";

import { useState, FormEvent, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { camelToRow } from "@/lib/supabase/case";
import { useAuth } from "@/context/AuthProvider";
import { useOrgTable } from "@/lib/supabase/useOrgTable";
import { RoleGate } from "@/components/layout/RoleGate";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Currency } from "@/components/ui/Currency";
import { EmptyState, LoadingState } from "@/components/ui/States";
import type { MenuItem } from "@/types";

export default function MenuPage() {
  const { activeOrgId } = useAuth();
  const supabase = useMemo(() => createClient(), []);
  const { data: items, loading } = useOrgTable<MenuItem>("menu_items");
  const [showForm, setShowForm] = useState(false);
  const categories = Array.from(new Set(items.map((i) => i.category)));

  async function toggleSpecial(item: MenuItem) {
    await supabase.from("menu_items").update(camelToRow({ isSpecial: !item.isSpecial })).eq("id", item.id);
  }

  async function toggleActive(item: MenuItem) {
    await supabase.from("menu_items").update(camelToRow({ active: !item.active })).eq("id", item.id);
  }

  async function addItem(values: {
    category: string;
    nameEn: string;
    nameSw: string;
    priceKes: number;
    stockQty?: number;
  }) {
    if (!activeOrgId) return;
    await supabase.from("menu_items").insert(
      camelToRow({
        orgId: activeOrgId,
        stationId: "default",
        category: values.category,
        nameEn: values.nameEn,
        nameSw: values.nameSw || undefined,
        priceKes: values.priceKes,
        stockQty: values.stockQty,
        active: true,
      })
    );
    setShowForm(false);
  }

  return (
    <div>
      <PageHeader
        title="Digital Menu & Specials"
        subtitle="Bilingual menu · EN / SWA"
        actions={
          <RoleGate roles={["owner", "manager"]}>
            <Button onClick={() => setShowForm((s) => !s)}>{showForm ? "Cancel" : "+ Add Dish"}</Button>
          </RoleGate>
        }
      />

      {showForm && (
        <div className="p-space-lg">
          <MenuItemForm onSubmit={addItem} />
        </div>
      )}

      {loading ? (
        <LoadingState />
      ) : items.length === 0 ? (
        <EmptyState title="No menu items yet" hint="Add dishes to build your bilingual menu." />
      ) : (
        <div className="p-space-lg">
          {categories.map((cat) => (
            <div key={cat} className="mb-space-lg">
              <p className="font-label-lg text-on-surface-variant mb-space-sm">{cat}</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-space-sm">
                {items.filter((i) => i.category === cat).map((item) => (
                  <Card key={item.id}>
                    <div className="flex items-center justify-between">
                      <p className="font-label-lg">{item.nameEn}</p>
                      {item.isSpecial && <Badge tone="warning">Special</Badge>}
                    </div>
                    {item.nameSw && <p className="font-body-sm text-on-surface-variant">{item.nameSw}</p>}
                    <Currency amount={item.priceKes} size="sm" className="block mt-space-xs" />
                    {typeof item.stockQty === "number" && (
                      <p className="font-body-sm mt-space-xs">
                        {item.stockQty > 0 ? `${item.stockQty} Left` : "86'd — Out of Stock"}
                      </p>
                    )}
                    {!item.active && <Badge tone="critical">Inactive</Badge>}
                    <RoleGate roles={["owner", "manager"]}>
                      <div className="flex gap-space-xs mt-space-sm">
                        <Button variant="tertiary" onClick={() => toggleSpecial(item)}>
                          {item.isSpecial ? "Unmark Special" : "Mark Special"}
                        </Button>
                        <Button variant="tertiary" onClick={() => toggleActive(item)}>
                          {item.active ? "Deactivate" : "Activate"}
                        </Button>
                      </div>
                    </RoleGate>
                  </Card>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MenuItemForm({
  onSubmit,
}: {
  onSubmit: (values: { category: string; nameEn: string; nameSw: string; priceKes: number; stockQty?: number }) => void;
}) {
  const [category, setCategory] = useState("Nyama Choma & Grills");
  const [nameEn, setNameEn] = useState("");
  const [nameSw, setNameSw] = useState("");
  const [priceKes, setPriceKes] = useState(0);
  const [stockQty, setStockQty] = useState<string>("");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!nameEn || priceKes <= 0) return;
    onSubmit({ category, nameEn, nameSw, priceKes, stockQty: stockQty ? Number(stockQty) : undefined });
    setNameEn("");
    setNameSw("");
    setPriceKes(0);
    setStockQty("");
  }

  return (
    <Card>
      <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-space-sm">
        <input placeholder="Category" value={category} onChange={(e) => setCategory(e.target.value)} className="border border-slate-border rounded px-space-sm py-space-xs min-h-touch-min" />
        <input placeholder="Name (English)" value={nameEn} onChange={(e) => setNameEn(e.target.value)} className="border border-slate-border rounded px-space-sm py-space-xs min-h-touch-min" required />
        <input placeholder="Name (Kiswahili)" value={nameSw} onChange={(e) => setNameSw(e.target.value)} className="border border-slate-border rounded px-space-sm py-space-xs min-h-touch-min" />
        <input type="number" placeholder="Price (KES)" value={priceKes || ""} onChange={(e) => setPriceKes(Number(e.target.value))} className="border border-slate-border rounded px-space-sm py-space-xs min-h-touch-min" required />
        <input type="number" placeholder="Stock qty (optional)" value={stockQty} onChange={(e) => setStockQty(e.target.value)} className="border border-slate-border rounded px-space-sm py-space-xs min-h-touch-min" />
        <Button type="submit">Save Dish</Button>
      </form>
    </Card>
  );
}
