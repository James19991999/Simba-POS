import { tierForPoints, pointsEarnedForSpend, kesValueOfPoints } from "../tiers";

describe("loyalty tiers", () => {
  it("earns 1 point per KES 20 spent, per the Zawadi Network rate card", () => {
    expect(pointsEarnedForSpend(2000)).toBe(100);
    expect(pointsEarnedForSpend(710 * 20)).toBe(710); // matches Wanjiku's 1,420 pts / KES 710 example ratio
  });

  it("floors fractional points rather than rounding up", () => {
    expect(pointsEarnedForSpend(39)).toBe(1); // 39/20 = 1.95 -> floor 1
  });

  it("assigns tiers at the documented boundaries (Elite starts AT 2,500+, per the screen's own '2,500+' label)", () => {
    expect(tierForPoints(0)).toBe("silver");
    expect(tierForPoints(500)).toBe("silver");
    expect(tierForPoints(501)).toBe("gold");
    expect(tierForPoints(2499)).toBe("gold");
    expect(tierForPoints(2500)).toBe("elite");
  });

  it("values 100 points at KES 50, per the Zawadi Club Engine rate", () => {
    expect(kesValueOfPoints(100)).toBe(50);
    expect(kesValueOfPoints(1420)).toBeCloseTo(710, 5);
  });
});
