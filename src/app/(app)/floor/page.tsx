"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { camelToRow } from "@/lib/supabase/case";
import { useAuth } from "@/context/AuthProvider";
import { useOrgTable } from "@/lib/supabase/useOrgTable";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, ActiveCard } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState, LoadingState } from "@/components/ui/States";
import type { RestaurantTable, WaitlistEntry, TableStatus } from "@/types";
import clsx from "clsx";

const STATUS_TONE: Record<TableStatus, "available" | "occupied" | "billed" | "neutral"> = {
  available: "available",
  seated: "occupied",
  ordered: "occupied",
  bill_requested: "billed",
  settled: "neutral",
  cleaning: "neutral",
  reserved: "neutral",
};

const STATUS_LABEL: Record<TableStatus, string> = {
  available: "Available",
  seated: "Seated",
  ordered: "Ordered",
  bill_requested: "Bill Requested",
  settled: "Settled",
  cleaning: "Cleaning",
  reserved: "Reserved",
};

export default function FloorPage() {
  const { activeOrgId, user, activeOrg, activeMembership } = useAuth();
  const supabase = useMemo(() => createClient(), []);
  const { data: tables, loading } = useOrgTable<RestaurantTable>("tables");
  const { data: waitlist } = useOrgTable<WaitlistEntry>("waitlist");
  const [zoneFilter, setZoneFilter] = useState<string>("All Zones");

  const zones = useMemo(() => {
    const set = new Set(tables.map((t) => t.zone));
    return ["All Zones", ...Array.from(set)];
  }, [tables]);

  const filtered = zoneFilter === "All Zones" ? tables : tables.filter((t) => t.zone === zoneFilter);
  const occupied = tables.filter((t) => t.status !== "available").length;
  const occupancyPct = tables.length ? Math.round((occupied / tables.length) * 100) : 0;
  const activeWaitlist = waitlist.filter((w) => !w.seated);

  async function addTable() {
    if (!activeOrgId) return;
    const code = `T${String(tables.length + 1).padStart(2, "0")}`;
    const { error } = await supabase
      .from("tables")
      .insert(
        camelToRow({
          orgId: activeOrgId,
          stationId: "default",
          code,
          zone: zones[1] ?? "Indoor Dining",
          seats: 4,
          status: "available",
        })
      );
    if (error) throw error;
  }

  async function seatTable(table: RestaurantTable, pax: number) {
    const { error } = await supabase
      .from("tables")
      .update(
        camelToRow({
          status: "seated",
          pax,
          seatedAt: Date.now(),
          waiterUid: user?.id ?? null,
          waiterName: activeMembership?.displayName ?? "Waiter",
        })
      )
      .eq("id", table.id);
    if (error) throw error;
  }

  async function markAvailable(table: RestaurantTable) {
    const { error } = await supabase
      .from("tables")
      .update(
        camelToRow({
          status: "available",
          pax: null,
          seatedAt: null,
          waiterUid: null,
          waiterName: null,
          activeOrderId: null,
        })
      )
      .eq("id", table.id);
    if (error) throw error;
  }

  async function requestBill(table: RestaurantTable) {
    const { error } = await supabase
      .from("tables")
      .update(camelToRow({ status: "bill_requested" }))
      .eq("id", table.id);
    if (error) throw error;
  }

  async function addWaitlist(name: string, phone: string, pax: number) {
    if (!activeOrgId) return;
    const { error } = await supabase
      .from("waitlist")
      .insert(
        camelToRow({
          orgId: activeOrgId,
          stationId: "default",
          name,
          phone,
          pax,
          createdAt: Date.now(),
          seated: false,
        })
      );
    if (error) throw error;
  }

  async function seatFromWaitlist(entry: WaitlistEntry, table: RestaurantTable) {
    await seatTable(table, entry.pax);
    const { error } = await supabase
      .from("waitlist")
      .update(camelToRow({ seated: true }))
      .eq("id", entry.id);
    if (error) throw error;
  }

  return (
    <div>
      <PageHeader
        title="Floor & Tables"
        subtitle={activeOrg?.name}
        actions={<Button onClick={addTable}>+ Add Table</Button>}
      />
      <div className="p-space-lg flex flex-wrap gap-space-sm">
        {zones.map((z) => (
          <button
            key={z}
            onClick={() => setZoneFilter(z)}
            className={clsx(
              "rounded-full px-space-md py-space-xs font-label-md border",
              zoneFilter === z ? "bg-primary-action text-on-primary border-primary-action" : "border-slate-border text-on-surface-variant"
            )}
          >
            {z}
          </button>
        ))}
        <span className="ml-auto font-body-sm text-on-surface-variant">{occupancyPct}% Capacity</span>
      </div>

      {loading ? (
        <LoadingState />
      ) : filtered.length === 0 ? (
        <EmptyState title="No tables yet" hint="Add your first table to start seating guests." />
      ) : (
        <div className="p-space-lg grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-space-md">
          {filtered.map((table) => {
            const CardComp = table.status === "bill_requested" ? ActiveCard : Card;
            return (
              <CardComp key={table.id}>
                <div className="flex items-center justify-between mb-space-sm">
                  <p className="font-headline-sm">{table.code}</p>
                  <Badge tone={STATUS_TONE[table.status]}>{STATUS_LABEL[table.status]}</Badge>
                </div>
                <p className="font-body-sm text-on-surface-variant">{table.zone}</p>
                {table.pax && <p className="font-body-sm">👤 {table.pax} pax {table.waiterName ? `· Waiter: ${table.waiterName}` : ""}</p>}
                <div className="flex flex-wrap gap-space-xs mt-space-md">
                  {table.status === "available" && (
                    <Button variant="tertiary" onClick={() => seatTable(table, 2)}>Seat Table</Button>
                  )}
                  {table.status === "seated" && (
                    <Button variant="tertiary" onClick={() => requestBill(table)}>Request Bill</Button>
                  )}
                  {table.status !== "available" && (
                    <Button variant="destructive" onClick={() => markAvailable(table)}>Clear / Reset</Button>
                  )}
                </div>
              </CardComp>
            );
          })}
        </div>
      )}

      <div className="p-space-lg">
        <h2 className="font-headline-sm mb-space-sm">Live Waitlist ({activeWaitlist.length} parties)</h2>
        <WaitlistForm onAdd={addWaitlist} />
        <div className="flex flex-col gap-space-sm mt-space-md">
          {activeWaitlist.map((w) => (
            <Card key={w.id} className="flex items-center justify-between">
              <div>
                <p className="font-label-lg">{w.name} · {w.pax} pax</p>
                <p className="font-body-sm text-on-surface-variant">{w.phone}</p>
              </div>
              <div className="flex gap-space-xs flex-wrap">
                {tables.filter((t) => t.status === "available").slice(0, 1).map((t) => (
                  <Button key={t.id} variant="tertiary" onClick={() => seatFromWaitlist(w, t)}>
                    Seat at {t.code}
                  </Button>
                ))}
              </div>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}

function WaitlistForm({ onAdd }: { onAdd: (name: string, phone: string, pax: number) => void }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [pax, setPax] = useState(2);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!name || !phone) return;
        onAdd(name, phone, pax);
        setName("");
        setPhone("");
        setPax(2);
      }}
      className="flex flex-wrap gap-space-sm"
    >
      <input placeholder="Guest name" value={name} onChange={(e) => setName(e.target.value)} className="border border-slate-border rounded px-space-sm py-space-xs min-h-touch-min" />
      <input placeholder="Phone (+254...)" value={phone} onChange={(e) => setPhone(e.target.value)} className="border border-slate-border rounded px-space-sm py-space-xs min-h-touch-min" />
      <input type="number" min={1} value={pax} onChange={(e) => setPax(Number(e.target.value))} className="border border-slate-border rounded px-space-sm py-space-xs w-20 min-h-touch-min" />
      <Button type="submit" variant="tertiary">Add Walk-in</Button>
    </form>
  );
}
