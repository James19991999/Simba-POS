"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { camelToRow } from "@/lib/supabase/case";
import { useAuth } from "@/context/AuthProvider";
import { useOrgTable } from "@/lib/supabase/useOrgTable";
import { authFetch } from "@/lib/utils/authFetch";
import { PLANS, PlanTier } from "@/lib/billing/plans";
import { RoleGate } from "@/components/layout/RoleGate";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Currency } from "@/components/ui/Currency";
import type { Membership, Role } from "@/types";
import { ALL_ROLES } from "@/types";

export default function SettingsPage() {
  const { activeOrg, activeOrgId, hasRole } = useAuth();
  const { data: members } = useOrgTable<Membership>("memberships");
  const supabase = useMemo(() => createClient(), []);
  const [busyTier, setBusyTier] = useState<PlanTier | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!activeOrg || !activeOrgId) return null;

  async function saveTax(field: "vatRate" | "tourismLevyRate" | "roundingKes", value: number) {
    await supabase.from("organizations").update(camelToRow({ [field]: value })).eq("id", activeOrgId!);
  }

  async function saveKra(field: "pin" | "vscuDeviceId", value: string) {
    const column = field === "pin" ? "kraPin" : "kraVscuDeviceId";
    await supabase.from("organizations").update(camelToRow({ [column]: value })).eq("id", activeOrgId!);
  }

  async function changeRole(m: Membership, role: Role) {
    await supabase.from("memberships").update(camelToRow({ role })).eq("org_id", m.orgId).eq("user_id", m.userId);
  }

  async function savePhone(m: Membership, phone: string) {
    await supabase.from("memberships").update(camelToRow({ phone: phone || null })).eq("org_id", m.orgId).eq("user_id", m.userId);
  }

  async function upgradePlan(tier: PlanTier) {
    setError(null);
    setBusyTier(tier);
    try {
      const res = await authFetch("/api/billing/intasend-checkout", {
        method: "POST",
        body: JSON.stringify({ orgId: activeOrgId, tier }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Checkout failed");
      window.location.href = json.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start checkout");
    } finally {
      setBusyTier(null);
    }
  }

  const daysLeft = activeOrg.planCurrentPeriodEndAt
    ? Math.max(0, Math.ceil((activeOrg.planCurrentPeriodEndAt - Date.now()) / 86400000))
    : null;

  return (
    <div>
      <PageHeader title="System Settings & Controls" subtitle={activeOrg.name} />

      <div className="p-space-lg grid grid-cols-1 lg:grid-cols-2 gap-space-lg">
        <RoleGate roles={["owner", "manager"]}>
          <Card>
            <p className="font-headline-sm mb-space-sm">Tax Configuration</p>
            <div className="flex flex-col gap-space-sm font-body-sm">
              <label className="flex justify-between items-center">
                VAT rate
                <input
                  type="number"
                  step="0.01"
                  defaultValue={activeOrg.vatRate}
                  onBlur={(e) => saveTax("vatRate", Number(e.target.value))}
                  className="border border-slate-border rounded px-space-sm py-space-xs w-24"
                />
              </label>
              <label className="flex justify-between items-center">
                Tourism & Catering Levy rate
                <input
                  type="number"
                  step="0.01"
                  defaultValue={activeOrg.tourismLevyRate}
                  onBlur={(e) => saveTax("tourismLevyRate", Number(e.target.value))}
                  className="border border-slate-border rounded px-space-sm py-space-xs w-24"
                />
              </label>
              <label className="flex justify-between items-center">
                KES rounding unit
                <input
                  type="number"
                  step="1"
                  defaultValue={activeOrg.roundingKes}
                  onBlur={(e) => saveTax("roundingKes", Number(e.target.value))}
                  className="border border-slate-border rounded px-space-sm py-space-xs w-24"
                />
              </label>
            </div>
          </Card>
        </RoleGate>

        <RoleGate roles={["owner"]}>
          <Card>
            <p className="font-headline-sm mb-space-sm">KRA eTIMS Registration</p>
            <p className="font-body-sm text-on-surface-variant mb-space-sm">
              Fiscal transmission is simulated until real VSCU credentials are entered here — see the Finance hub.
            </p>
            <div className="flex flex-col gap-space-sm">
              <input
                placeholder="KRA PIN"
                defaultValue={activeOrg.kraPin}
                onBlur={(e) => saveKra("pin", e.target.value)}
                className="border border-slate-border rounded px-space-sm py-space-xs min-h-touch-min"
              />
              <input
                placeholder="VSCU Device ID"
                defaultValue={activeOrg.kraVscuDeviceId}
                onBlur={(e) => saveKra("vscuDeviceId", e.target.value)}
                className="border border-slate-border rounded px-space-sm py-space-xs min-h-touch-min"
              />
            </div>
          </Card>
        </RoleGate>

        <RoleGate roles={["owner"]}>
          <Card className="lg:col-span-2">
            <div className="flex items-center justify-between mb-space-sm">
              <p className="font-headline-sm">Billing — Platform Subscription (via IntaSend)</p>
              <Badge tone={activeOrg.planStatus === "active" ? "success" : "warning"}>{activeOrg.planStatus}</Badge>
            </div>
            <p className="font-body-sm text-on-surface-variant mb-space-md">
              Current plan: <span className="font-semibold">{PLANS[activeOrg.planTier].name}</span>
              {daysLeft !== null && ` · renews in ${daysLeft} day(s)`}. IntaSend Checkout is one-time, not
              auto-recurring — renew before it lapses to keep the plan active.
            </p>
            {error && <p className="text-critical font-body-sm mb-space-sm">{error}</p>}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-space-sm">
              {Object.values(PLANS).map((plan) => (
                <Card key={plan.tier} className={plan.tier === activeOrg.planTier ? "border-primary-action" : ""}>
                  <p className="font-label-lg">{plan.name}</p>
                  <Currency amount={plan.priceKesPerMonth} size="sm" /> <span className="font-body-sm">/mo</span>
                  <ul className="font-body-sm text-on-surface-variant mt-space-xs list-disc list-inside">
                    {plan.features.slice(0, 3).map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                  <Button
                    variant={plan.tier === activeOrg.planTier ? "tertiary" : "primary"}
                    className="mt-space-sm"
                    disabled={busyTier === plan.tier}
                    onClick={() => upgradePlan(plan.tier)}
                  >
                    {plan.tier === activeOrg.planTier ? "Renew" : "Switch Plan"}
                  </Button>
                </Card>
              ))}
            </div>
          </Card>
        </RoleGate>

        <RoleGate roles={["owner", "manager"]}>
          <Card className="lg:col-span-2">
            <p className="font-headline-sm mb-space-sm">Role & Team Management</p>
            <p className="font-body-sm text-on-surface-variant mb-space-sm">
              A phone number here is what makes real M-Pesa tip-pool disbursement (Staff & Shifts) possible for
              that person — without it they&apos;re skipped, not silently paid nothing.
            </p>
            <div className="flex flex-col gap-space-sm">
              {members.map((m) => (
                <div key={m.id} className="flex flex-wrap items-center justify-between gap-space-sm font-body-sm">
                  <span>{m.displayName} ({m.email})</span>
                  <input
                    placeholder="2547XXXXXXXX"
                    defaultValue={m.phone ?? ""}
                    disabled={!hasRole("owner", "manager")}
                    onBlur={(e) => savePhone(m, e.target.value.trim())}
                    className="border border-slate-border rounded px-space-sm py-space-xs w-40"
                  />
                  <select
                    defaultValue={m.role}
                    disabled={!hasRole("owner") || m.role === "owner"}
                    onChange={(e) => changeRole(m, e.target.value as Role)}
                    className="border border-slate-border rounded px-space-sm py-space-xs"
                  >
                    {ALL_ROLES.map((r) => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </Card>
        </RoleGate>
      </div>
    </div>
  );
}
