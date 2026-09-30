import { formatKes, roundToNearestKes } from "@/lib/utils/currency";

describe("formatKes", () => {
  it("always prefixes KES and shows two decimal places", () => {
    expect(formatKes(1450)).toBe("KES 1,450.00");
  });

  it("groups thousands", () => {
    expect(formatKes(1842500)).toBe("KES 1,842,500.00");
  });

  it("rounds to the nearest cent", () => {
    expect(formatKes(965.5172)).toBe("KES 965.52");
  });
});

describe("roundToNearestKes", () => {
  it("rounds change to the nearest whole KES by default", () => {
    expect(roundToNearestKes(7140.4)).toBe(7140);
    expect(roundToNearestKes(7140.6)).toBe(7141);
  });
});
