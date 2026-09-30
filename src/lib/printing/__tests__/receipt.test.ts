import { buildKotHtml, buildReceiptHtml, printHtml } from "../receipt";
import { computeBillBreakdown } from "@/lib/billing/tax";
import { formatKes } from "@/lib/utils/currency";
import type { Order } from "@/types";

const order: Order = {
  id: "order-abc12345",
  orgId: "org1",
  stationId: "st1",
  tableId: "t1",
  channel: "dine_in",
  status: "cooking",
  items: [
    { id: "i1", menuItemId: "m1", nameEn: "Nyama Choma Platter", qty: 1, unitPriceKes: 1800 },
    { id: "i2", menuItemId: "m2", nameEn: 'Tusker Lager <script>alert(1)</script>', qty: 2, unitPriceKes: 350 },
  ],
  subtotalKes: 2500,
  vatKes: 0,
  tourismLevyKes: 0,
  totalKes: 2500,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  createdByUid: "u1",
};

describe("buildKotHtml", () => {
  it("includes every ordered item with its quantity", () => {
    const html = buildKotHtml(order, "T04");
    expect(html).toContain("1x Nyama Choma Platter");
    expect(html).toContain("2x Tusker Lager");
    expect(html).toContain("Table T04");
  });

  it("escapes item names to prevent script injection into the print window", () => {
    const html = buildKotHtml(order, "T04");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("buildReceiptHtml", () => {
  const tax = { vatRate: 0.16, tourismLevyRate: 0.02, roundingKes: 1 };
  const breakdown = computeBillBreakdown(order.items, tax);

  it("shows the org name, itemized lines, and the computed total", () => {
    const html = buildReceiptHtml({
      orgName: "Boma Bistro - Westlands",
      stationName: "Nairobi Station #04",
      tableCode: "T04",
      order,
      breakdown,
      channel: "mpesa_stk",
      simulatedEtims: true,
    });
    expect(html).toContain("Boma Bistro - Westlands");
    expect(html).toContain("M-Pesa (IntaSend)");
    expect(html).toContain("SIMULATED eTIMS");
    expect(html).toContain(formatKes(breakdown.totalPayableKes));
  });

  it("omits the simulated-eTIMS notice when simulatedEtims is false", () => {
    const html = buildReceiptHtml({
      orgName: "Org",
      stationName: "Station",
      order,
      breakdown,
      channel: "cash",
      simulatedEtims: false,
    });
    expect(html).not.toContain("SIMULATED eTIMS");
  });
});

describe("printHtml", () => {
  it("returns false when window is undefined (server-side call)", () => {
    // jsdom provides `window`, so simulate the server context explicitly.
    const originalWindow = global.window;
    // @ts-expect-error deliberately deleting for the test
    delete global.window;
    expect(printHtml("<html></html>")).toBe(false);
    global.window = originalWindow;
  });

  it("returns false when window.open is blocked (returns null)", () => {
    const openSpy = jest.spyOn(window, "open").mockReturnValue(null);
    expect(printHtml("<html></html>")).toBe(false);
    openSpy.mockRestore();
  });

  it("writes the HTML and calls print() once the popup loads", () => {
    const fakeWindow = {
      document: { open: jest.fn(), write: jest.fn(), close: jest.fn() },
      focus: jest.fn(),
      print: jest.fn(),
      onload: null as null | (() => void),
    };
    const openSpy = jest.spyOn(window, "open").mockReturnValue(fakeWindow as unknown as Window);
    const ok = printHtml("<html>hi</html>");
    expect(ok).toBe(true);
    expect(fakeWindow.document.write).toHaveBeenCalledWith("<html>hi</html>");
    fakeWindow.onload?.();
    expect(fakeWindow.print).toHaveBeenCalled();
    openSpy.mockRestore();
  });
});
