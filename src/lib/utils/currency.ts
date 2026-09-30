// Currency formatting rules from DESIGN.md: "KES Notation" — always designate
// currency with the KES prefix, tabular numerals mandatory for all ledgers.
export function formatKes(amount: number): string {
  const rounded = Math.round(amount * 100) / 100;
  const formatted = rounded.toLocaleString("en-KE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `KES ${formatted}`;
}

export function roundToNearestKes(amount: number, unit = 1): number {
  return Math.round(amount / unit) * unit;
}
