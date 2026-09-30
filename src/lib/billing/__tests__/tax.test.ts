import { computeBillBreakdown, splitEven } from "../tax";
import type { OrderLineItem } from "@/types";

const TAX = { vatRate: 0.16, tourismLevyRate: 0.02, roundingKes: 1 };

function item(qty: number, unitPriceKes: number): OrderLineItem {
  return { id: crypto.randomUUID(), menuItemId: "m1", nameEn: "Test Dish", qty, unitPriceKes };
}

describe("computeBillBreakdown", () => {
  it("matches the worked example from the Waiter POS screen (7,000 -> 7,140 total)", () => {
    // 1,800 + 2,200 + 950 + 1,400 + 650 = 7,000
    const items = [item(1, 1800), item(1, 2200), item(1, 950), item(1, 1400), item(1, 650)];
    const result = computeBillBreakdown(items, TAX);
    expect(result.itemsSubtotalKes).toBe(7000);
    expect(result.tourismLevyKes).toBe(140);
    expect(result.totalPayableKes).toBe(7140);
    // VAT inclusive of the 7,000 SUBTOTAL (not the post-levy total) at 16%:
    // 7000 * 0.16 / 1.16 = 965.5172... matching the screen's displayed 965.52.
    expect(result.vatKes).toBeCloseTo(965.52, 1);
  });

  it("never lets VAT + net sales diverge from the total payable", () => {
    const items = [item(3, 333.33), item(2, 99.99)];
    const result = computeBillBreakdown(items, TAX);
    expect(round2(result.vatKes + result.netSalesKes)).toBe(result.totalPayableKes);
  });

  it("handles an empty ticket without throwing", () => {
    const result = computeBillBreakdown([], TAX);
    expect(result.totalPayableKes).toBe(0);
  });

  it("respects a non-default rounding unit", () => {
    const items = [item(1, 999)];
    const result = computeBillBreakdown(items, { ...TAX, roundingKes: 10 });
    // 999 + 2% levy (19.98) = 1018.98 -> rounds to nearest 10 -> 1020
    expect(result.totalPayableKes).toBe(1020);
  });
});

describe("splitEven", () => {
  it("splits a bill across N guests so shares sum exactly to the total", () => {
    const shares = splitEven(1785 * 4, 4);
    expect(shares).toHaveLength(4);
    const sum = shares.reduce((a, b) => a + b, 0);
    expect(round2(sum)).toBe(1785 * 4);
  });

  it("distributes rounding remainder across the first shares, not lost", () => {
    // 100 / 3 = 33.33 repeating — a naive split would lose or gain a cent.
    const shares = splitEven(100, 3);
    const sum = shares.reduce((a, b) => a + b, 0);
    expect(round2(sum)).toBe(100);
  });

  it("returns the full amount for zero/one pax", () => {
    expect(splitEven(500, 0)).toEqual([500]);
  });
});

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
