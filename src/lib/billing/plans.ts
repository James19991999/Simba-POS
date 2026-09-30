// Shared KES pricing catalog for platform subscription billing (org -> SimbaPOS).
// IntaSend's Checkout API is one-time, not recurring — see the renewal note
// below and app/api/billing/intasend-checkout.

export type PlanTier = "starter" | "growth" | "enterprise";

export interface Plan {
  tier: PlanTier;
  name: string;
  priceKesPerMonth: number;
  maxStations: number;
  features: string[];
}

export const PLANS: Record<PlanTier, Plan> = {
  starter: {
    tier: "starter",
    name: "Starter",
    priceKesPerMonth: 4900,
    maxStations: 1,
    features: [
      "1 station",
      "Floor & table management",
      "Waiter POS with M-Pesa STK Push & card via IntaSend",
      "Digital menu",
      "Basic analytics",
    ],
  },
  growth: {
    tier: "growth",
    name: "Growth",
    priceKesPerMonth: 12900,
    maxStations: 3,
    features: [
      "Up to 3 stations",
      "Everything in Starter",
      "Delivery & aggregator hub",
      "Inventory & supply chain",
      "Staff & shift operations",
      "Customer loyalty (Zawadi Network)",
    ],
  },
  enterprise: {
    tier: "enterprise",
    name: "Enterprise",
    priceKesPerMonth: 34900,
    maxStations: 999,
    features: [
      "Unlimited stations",
      "Everything in Growth",
      "KRA eTIMS fiscal hub",
      "Full analytics & reporting suite",
      "Priority support",
    ],
  },
};

export const BILLING_PERIOD_DAYS = 30;

/**
 * IntaSend's Checkout API only supports one-time collection (their separate
 * Subscriptions API exists but was deliberately not used here — same scope
 * call made on Verdant Enterprise). Renewal is therefore explicit: a plan's
 * currentPeriodEnd is set BILLING_PERIOD_DAYS from a successful checkout,
 * and the app is responsible for prompting/re-checkout before it lapses
 * (see the renewal banner in Settings > Billing) rather than assuming
 * auto-renewal the way a real subscription would provide.
 */
export function nextPeriodEnd(fromMs: number = Date.now()): number {
  return fromMs + BILLING_PERIOD_DAYS * 24 * 60 * 60 * 1000;
}
