import { formatKes } from "@/lib/utils/currency";
import clsx from "clsx";

export function Currency({
  amount,
  size = "md",
  className,
}: {
  amount: number;
  size?: "sm" | "md" | "display";
  className?: string;
}) {
  const sizeClass =
    size === "display" ? "font-currency-display" : size === "sm" ? "font-currency-sm" : "font-body-md font-semibold";
  return <span className={clsx("tabular", sizeClass, className)}>{formatKes(amount)}</span>;
}
