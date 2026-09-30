import type { LoyaltyMember } from "@/types";

// Zawadi Network rules, from customer_engagement_loyalty/code.html:
// "Earn 1 pt for every KES 20 spent", "100 Zawadi Points = KES 50 Value".
export const POINTS_PER_KES = 1 / 20;
export const KES_VALUE_PER_POINT = 50 / 100;

export function tierForPoints(points: number): LoyaltyMember["tier"] {
  if (points >= 2500) return "elite";
  if (points >= 501) return "gold";
  return "silver";
}

export const TIER_LABEL: Record<LoyaltyMember["tier"], string> = {
  silver: "Simba Silver",
  gold: "Chui Gold",
  elite: "Kifaru Elite",
};

export function pointsEarnedForSpend(amountKes: number): number {
  return Math.floor(amountKes * POINTS_PER_KES);
}

export function kesValueOfPoints(points: number): number {
  return Math.round(points * KES_VALUE_PER_POINT * 100) / 100;
}
