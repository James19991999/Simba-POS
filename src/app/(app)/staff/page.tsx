"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { camelToRow } from "@/lib/supabase/case";
import { useAuth } from "@/context/AuthProvider";
import { useOrgTable } from "@/lib/supabase/useOrgTable";
import { authFetch } from "@/lib/utils/authFetch";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Currency } from "@/components/ui/Currency";
import { EmptyState, LoadingState } from "@/components/ui/States";
import type { Shift, ShiftCheckIn, TipPoolEntry, LeaveRequest, Membership } from "@/types";

export default function StaffPage() {
  const { activeOrgId, user, activeOrg, activeMembership } = useAuth();
  const supabase = useMemo(() => createClient(), []);
  const { data: shifts, loading } = useOrgTable<Shift>("shifts");
  const { data: checkIns } = useOrgTable<ShiftCheckIn>("shift_check_ins");
  const { data: tipPools } = useOrgTable<TipPoolEntry>("tip_pool_entries");
  const { data: leaveRequests } = useOrgTable<LeaveRequest>("leave_requests");
  const { data: members } = useOrgTable<Membership>("memberships");

  const openShift = shifts.find((s) => !s.closed);
  const shiftCheckIns = checkIns.filter((c) => c.shiftId === openShift?.id);
  const pendingLeave = leaveRequests.filter((l) => l.status === "pending");

  async function startShift() {
    if (!activeOrgId || !user) return;
    const { error } = await supabase.from("shifts").insert(
      camelToRow({
        orgId: activeOrgId,
        stationId: "default",
        label: "Shift B - Afternoon/Evening",
        startAt: Date.now(),
        managerUid: user.id,
        closed: false,
      })
    );
    if (error) throw error;
  }

  async function checkIn(station: ShiftCheckIn["station"]) {
    if (!activeOrgId || !user || !openShift) return;
    const { error } = await supabase.from("shift_check_ins").insert(
      camelToRow({
        orgId: activeOrgId,
        shiftId: openShift.id,
        userId: user.id,
        displayName: activeMembership?.displayName ?? "Staff",
        station,
        checkedInAt: Date.now(),
      })
    );
    if (error) throw error;
  }

  async function collectTips(totalKes: number) {
    if (!activeOrgId || !openShift) return;
    const crewCount = shiftCheckIns.length || 1;
    const { error } = await supabase.from("tip_pool_entries").insert(
      camelToRow({
        orgId: activeOrgId,
        shiftId: openShift.id,
        totalKes,
        crewCount,
        perHeadKes: Math.round((totalKes / crewCount) * 100) / 100,
        disbursed: false,
      })
    );
    if (error) throw error;
  }

  const [disburseError, setDisburseError] = useState<string | null>(null);
  const [disbursing, setDisbursing] = useState<string | null>(null);

  async function disburseTips(entry: TipPoolEntry) {
    if (!activeOrgId) return;
    setDisburseError(null);
    setDisbursing(entry.id);
    try {
      const res = await authFetch("/api/staff/disburse-tips", {
        method: "POST",
        body: JSON.stringify({ orgId: activeOrgId, tipPoolEntryId: entry.id }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Disbursement failed");
    } catch (err) {
      setDisburseError(err instanceof Error ? err.message : "Disbursement failed");
    } finally {
      setDisbursing(null);
    }
  }

  async function decideLeave(req: LeaveRequest, approve: boolean) {
    const { error } = await supabase
      .from("leave_requests")
      .update(camelToRow({ status: approve ? "approved" : "rejected" }))
      .eq("id", req.id);
    if (error) throw error;
  }

  async function requestLeave(fromDate: string, toDate: string) {
    if (!activeOrgId || !user) return;
    const { error } = await supabase.from("leave_requests").insert(
      camelToRow({
        orgId: activeOrgId,
        userId: user.id,
        displayName: activeMembership?.displayName ?? "Staff",
        fromDate,
        toDate,
        status: "pending",
        createdAt: Date.now(),
      })
    );
    if (error) throw error;
  }

  if (loading) return <LoadingState />;

  return (
    <div>
      <PageHeader
        title="Staff & Shift Operations"
        subtitle={activeOrg?.name}
        actions={!openShift ? <Button onClick={startShift}>Start Shift</Button> : undefined}
      />

      {!openShift ? (
        <EmptyState title="No shift in progress" hint="Start a shift to begin tracking check-ins and tips." />
      ) : (
        <div className="p-space-lg grid grid-cols-1 lg:grid-cols-2 gap-space-lg">
          <Card>
            <p className="font-headline-sm mb-space-sm">{openShift.label}</p>
            <p className="font-body-sm text-on-surface-variant mb-space-sm">
              {shiftCheckIns.length} / {members.length} Checked In
            </p>
            <div className="flex gap-space-xs flex-wrap mb-space-sm">
              {(["floor", "grill", "bar", "riders"] as const).map((s) => (
                <Button key={s} variant="tertiary" onClick={() => checkIn(s)}>Check In · {s}</Button>
              ))}
            </div>
            <div className="flex flex-col gap-space-xs">
              {shiftCheckIns.map((c) => (
                <div key={c.id} className="flex justify-between font-body-sm">
                  <span>{c.displayName}</span>
                  <Badge tone="success">{c.station}</Badge>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <p className="font-headline-sm mb-space-sm">Digital Tip Pool</p>
            <p className="font-body-sm text-on-surface-variant mb-space-sm">
              Disbursement pays each checked-in crew member their share directly via a real IntaSend M-Pesa B2C
              call. Crew without a phone number on file (Settings &gt; Team) are skipped and reported, not silently dropped.
            </p>
            <TipForm onCollect={collectTips} />
            {disburseError && <p className="text-critical font-body-sm mt-space-sm">{disburseError}</p>}
            <div className="flex flex-col gap-space-sm mt-space-sm">
              {tipPools.filter((t) => t.shiftId === openShift.id).map((t) => (
                <div key={t.id} className="flex flex-col gap-space-xs font-body-sm border-b border-slate-border pb-space-sm last:border-none">
                  <div className="flex items-center justify-between">
                    <span>
                      <Currency amount={t.totalKes} size="sm" /> split {t.crewCount} ways = <Currency amount={t.perHeadKes} size="sm" /> ea
                    </span>
                    {t.disbursed ? (
                      <Badge tone="success">Disbursed{t.intasendTrackingId ? ` · ${t.intasendTrackingId}` : ""}</Badge>
                    ) : (
                      <Button variant="secondary" disabled={disbursing === t.id} onClick={() => disburseTips(t)}>
                        {disbursing === t.id ? "Sending…" : "Disburse via IntaSend B2C"}
                      </Button>
                    )}
                  </div>
                  {t.disbursementError && <p className="text-amber-text">{t.disbursementError}</p>}
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <p className="font-headline-sm mb-space-sm">Leave Requests ({pendingLeave.length} pending)</p>
            <LeaveForm onSubmit={requestLeave} />
            <div className="flex flex-col gap-space-sm mt-space-sm">
              {pendingLeave.map((r) => (
                <div key={r.id} className="flex items-center justify-between font-body-sm">
                  <span>{r.displayName}: {r.fromDate} → {r.toDate}</span>
                  <div className="flex gap-space-xs">
                    <Button variant="secondary" onClick={() => decideLeave(r, true)}>Approve</Button>
                    <Button variant="destructive" onClick={() => decideLeave(r, false)}>Reject</Button>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

function TipForm({ onCollect }: { onCollect: (amount: number) => void }) {
  const [amount, setAmount] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const value = Number(amount);
        if (value > 0) onCollect(value);
        setAmount("");
      }}
      className="flex gap-space-sm"
    >
      <input type="number" placeholder="Total collected (KES)" value={amount} onChange={(e) => setAmount(e.target.value)} className="border border-slate-border rounded px-space-sm py-space-xs min-h-touch-min flex-1" />
      <Button type="submit" variant="tertiary">Log Total</Button>
    </form>
  );
}

function LeaveForm({ onSubmit }: { onSubmit: (from: string, to: string) => void }) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (from && to) onSubmit(from, to);
        setFrom("");
        setTo("");
      }}
      className="flex gap-space-sm flex-wrap"
    >
      <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="border border-slate-border rounded px-space-sm py-space-xs min-h-touch-min" />
      <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="border border-slate-border rounded px-space-sm py-space-xs min-h-touch-min" />
      <Button type="submit" variant="tertiary">Request Leave</Button>
    </form>
  );
}
