"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { camelToRow } from "@/lib/supabase/case";
import { useAuth } from "@/context/AuthProvider";
import { useOrgTable } from "@/lib/supabase/useOrgTable";
import { authFetch } from "@/lib/utils/authFetch";
import { tierForPoints, TIER_LABEL, pointsEarnedForSpend, kesValueOfPoints } from "@/lib/loyalty/tiers";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Currency } from "@/components/ui/Currency";
import { EmptyState, LoadingState } from "@/components/ui/States";
import type { LoyaltyMember, SmsCampaign } from "@/types";

export default function LoyaltyPage() {
  const { activeOrgId } = useAuth();
  const supabase = useMemo(() => createClient(), []);
  const { data: members, loading } = useOrgTable<LoyaltyMember>("loyalty_members");
  const { data: campaigns } = useOrgTable<SmsCampaign>("sms_campaigns");
  const [lookupPhone, setLookupPhone] = useState("");

  const found = members.find((m) => m.phone === lookupPhone);
  const totalPoints = members.reduce((s, m) => s + m.points, 0);

  async function enrollOrEarn(phone: string, name: string, spendKes: number) {
    if (!activeOrgId) return;
    const existing = members.find((m) => m.phone === phone);
    const earned = pointsEarnedForSpend(spendKes);
    if (existing) {
      const newPoints = existing.points + earned;
      const { error } = await supabase
        .from("loyalty_members")
        .update(camelToRow({
          points: newPoints,
          tier: tierForPoints(newPoints),
          lastVisitAt: Date.now(),
        }))
        .eq("id", existing.id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from("loyalty_members").insert(
        camelToRow({
          orgId: activeOrgId,
          phone,
          name,
          points: earned,
          tier: tierForPoints(earned),
          lastVisitAt: Date.now(),
          createdAt: Date.now(),
        })
      );
      if (error) throw error;
    }
  }

  async function redeem(member: LoyaltyMember, points: number) {
    if (points > member.points) return;
    const newPoints = member.points - points;
    const { error } = await supabase
      .from("loyalty_members")
      .update(camelToRow({
        points: newPoints,
        tier: tierForPoints(newPoints),
      }))
      .eq("id", member.id);
    if (error) throw error;
  }

  async function createCampaign(title: string, message: string, audienceCount: number) {
    if (!activeOrgId) return;
    const { error } = await supabase.from("sms_campaigns").insert(
      camelToRow({
        orgId: activeOrgId,
        title,
        message,
        audienceCount,
        status: "draft",
      })
    );
    if (error) throw error;
  }

  const [dispatchError, setDispatchError] = useState<string | null>(null);
  const [dispatching, setDispatching] = useState<string | null>(null);

  async function dispatchCampaign(campaign: SmsCampaign) {
    if (!activeOrgId) return;
    setDispatchError(null);
    setDispatching(campaign.id);
    try {
      const res = await authFetch("/api/loyalty/dispatch-campaign", {
        method: "POST",
        body: JSON.stringify({ orgId: activeOrgId, campaignId: campaign.id }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Dispatch failed");
    } catch (err) {
      setDispatchError(err instanceof Error ? err.message : "Dispatch failed");
    } finally {
      setDispatching(null);
    }
  }

  return (
    <div>
      <PageHeader title="Zawadi Network — Customer Loyalty" subtitle={`${members.length} active patrons · ${totalPoints} pts issued`} />

      <div className="p-space-lg">
        <Card>
          <p className="font-label-lg mb-space-sm">Table Loyalty Lookup</p>
          <div className="flex gap-space-sm">
            <input placeholder="+254..." value={lookupPhone} onChange={(e) => setLookupPhone(e.target.value)} className="border border-slate-border rounded px-space-sm py-space-xs min-h-touch-min flex-1" />
          </div>
          {found && (
            <div className="mt-space-sm">
              <p className="font-label-lg">{found.name} <Badge tone="success">{TIER_LABEL[found.tier]}</Badge></p>
              <p className="font-body-sm text-on-surface-variant">{found.points} pts · <Currency amount={kesValueOfPoints(found.points)} size="sm" /> value</p>
              <Button variant="tertiary" className="mt-space-xs" onClick={() => redeem(found, Math.min(found.points, 100))}>
                Redeem 100 pts on Bill
              </Button>
            </div>
          )}
        </Card>

        <Card className="mt-space-md">
          <p className="font-label-lg mb-space-sm">Enroll / Award Points for a Visit</p>
          <EnrollForm onSubmit={enrollOrEarn} />
        </Card>
      </div>

      {loading ? (
        <LoadingState />
      ) : members.length === 0 ? (
        <EmptyState title="No loyalty members yet" hint="Enroll your first guest above." />
      ) : (
        <div className="p-space-lg grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-space-md">
          {members.map((m) => (
            <Card key={m.id}>
              <p className="font-label-lg">{m.name}</p>
              <p className="font-body-sm text-on-surface-variant">{m.phone}</p>
              <Badge tone="success">{TIER_LABEL[m.tier]}</Badge>
              <p className="font-body-sm mt-space-xs">{m.points} pts · <Currency amount={kesValueOfPoints(m.points)} size="sm" /></p>
            </Card>
          ))}
        </div>
      )}

      <div className="p-space-lg">
        <h2 className="font-headline-sm mb-space-sm">SMS Campaigns</h2>
        <p className="font-body-sm text-on-surface-variant mb-space-sm">
          Dispatch sends a real SMS via Africa&apos;s Talking to every enrolled Zawadi Network member. Requires
          AFRICASTALKING_API_KEY / AFRICASTALKING_USERNAME to be configured — otherwise dispatch fails with a
          clear &quot;not configured&quot; error rather than silently pretending to send.
        </p>
        <CampaignForm onSubmit={createCampaign} />
        {dispatchError && <p className="text-critical font-body-sm mt-space-sm">{dispatchError}</p>}
        <div className="flex flex-col gap-space-sm mt-space-sm">
          {campaigns.map((c) => (
            <Card key={c.id} className="flex items-center justify-between">
              <div>
                <p className="font-label-lg">{c.title}</p>
                <p className="font-body-sm text-on-surface-variant">{c.message}</p>
              </div>
              {c.status === "sent" ? (
                <Badge tone="success">Sent</Badge>
              ) : (
                <Button variant="secondary" disabled={dispatching === c.id} onClick={() => dispatchCampaign(c)}>
                  {dispatching === c.id ? "Sending…" : "Dispatch Broadcast"}
                </Button>
              )}
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}

function EnrollForm({ onSubmit }: { onSubmit: (phone: string, name: string, spendKes: number) => void }) {
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [spend, setSpend] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const value = Number(spend);
        if (phone && name && value > 0) onSubmit(phone, name, value);
        setSpend("");
      }}
      className="grid grid-cols-1 sm:grid-cols-4 gap-space-sm"
    >
      <input placeholder="+254..." value={phone} onChange={(e) => setPhone(e.target.value)} className="border border-slate-border rounded px-space-sm py-space-xs min-h-touch-min" />
      <input placeholder="Guest name" value={name} onChange={(e) => setName(e.target.value)} className="border border-slate-border rounded px-space-sm py-space-xs min-h-touch-min" />
      <input type="number" placeholder="Bill amount (KES)" value={spend} onChange={(e) => setSpend(e.target.value)} className="border border-slate-border rounded px-space-sm py-space-xs min-h-touch-min" />
      <Button type="submit" variant="tertiary">Award Points</Button>
    </form>
  );
}

function CampaignForm({ onSubmit }: { onSubmit: (title: string, message: string, audience: number) => void }) {
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (title && message) onSubmit(title, message, 0);
        setTitle("");
        setMessage("");
      }}
      className="flex flex-col gap-space-sm"
    >
      <input placeholder="Campaign title" value={title} onChange={(e) => setTitle(e.target.value)} className="border border-slate-border rounded px-space-sm py-space-xs min-h-touch-min" />
      <textarea placeholder="Message" value={message} onChange={(e) => setMessage(e.target.value)} className="border border-slate-border rounded px-space-sm py-space-xs" />
      <Button type="submit" variant="tertiary" className="self-start">Save Draft</Button>
    </form>
  );
}
