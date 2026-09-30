import type { OrderLineItem } from "@/types";

export interface TaxConfig {
  vatRate: number; // e.g. 0.16 — VAT is inclusive in KRA eTIMS pricing, so it is
  // "backed out" of the tax-inclusive subtotal, not added on top.
  tourismLevyRate: number; // e.g. 0.02 — applied on the net (pre-VAT) amount,
  // per the Finance & eTIMS hub's "Tourism & Catering Levy... computed prior
  // to net fiscalization".
  roundingKes: number; // e.g. 1
}

export interface BillBreakdown {
  itemsSubtotalKes: number; // tax-inclusive menu total
  tourismLevyKes: number;
  netSalesKes: number; // subtotal excluding VAT and the levy base
  vatKes: number;
  totalPayableKes: number;
}

/**
 * Computes the fiscal breakdown for a ticket exactly as modeled in the
 * Waiter POS ticket's own worked example: subtotal KES 7,000.00 -> Catering
 * Levy (2%) KES 140.00 -> VAT (16% Included / KRA eTIMS) KES 965.52 ->
 * Total Payable KES 7,140.
 *
 * The key detail (verified against that worked example, not assumed): VAT
 * is the inclusive component of the ITEMS SUBTOTAL alone (7000 * 0.16/1.16
 * = 965.52), not of the post-levy total — an earlier version of this
 * function backed VAT out of the total instead and was caught by
 * tax.test.ts producing 984.83 instead of the design's 965.52. The 2% levy
 * is then added on top of the (VAT-inclusive) subtotal to reach the total.
 */
export function computeBillBreakdown(
  items: OrderLineItem[],
  tax: TaxConfig
): BillBreakdown {
  const itemsSubtotalKes = round2(
    items.reduce((sum, item) => sum + item.qty * item.unitPriceKes, 0)
  );

  const tourismLevyKes = round2(itemsSubtotalKes * tax.tourismLevyRate);
  const totalPayableKes = roundToNearest(
    itemsSubtotalKes + tourismLevyKes,
    tax.roundingKes
  );

  // VAT is the inclusive component of the tax-inclusive ITEMS SUBTOTAL:
  // subtotal = net * (1 + vatRate)  =>  vat = subtotal * vatRate / (1 + vatRate)
  const vatKes = round2((itemsSubtotalKes * tax.vatRate) / (1 + tax.vatRate));
  const netSalesKes = round2(totalPayableKes - vatKes);

  return { itemsSubtotalKes, tourismLevyKes, netSalesKes, vatKes, totalPayableKes };
}

export type SplitMode = "full" | "even" | "by_item" | "custom";

export function splitEven(totalKes: number, pax: number): number[] {
  if (pax <= 0) return [totalKes];
  const baseShare = Math.floor((totalKes / pax) * 100) / 100;
  const shares = new Array(pax).fill(baseShare);
  // distribute the rounding remainder (cents) across the first N shares so
  // the sum always exactly equals totalKes — avoids a classic split-bill bug
  // where per-head * pax != total.
  const distributed = round2(baseShare * pax);
  let remainder = round2(totalKes - distributed);
  let i = 0;
  while (remainder > 0.001 && i < shares.length) {
    shares[i] = round2(shares[i] + 0.01);
    remainder = round2(remainder - 0.01);
    i++;
  }
  return shares;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function roundToNearest(n: number, unit: number): number {
  if (!unit) return round2(n);
  return Math.round(n / unit) * unit;
}
