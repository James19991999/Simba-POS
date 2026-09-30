import clsx from "clsx";
import { ReactNode } from "react";

type BadgeTone = "occupied" | "billed" | "available" | "success" | "warning" | "critical" | "neutral";

const toneClasses: Record<BadgeTone, string> = {
  occupied: "bg-amber-bg text-amber-text",
  billed: "bg-orange-100 text-orange-800",
  available: "bg-slate-100 text-slate-600",
  success: "bg-mpesa-bg text-secondary-action border border-mpesa-border",
  warning: "bg-amber-bg text-amber-text",
  critical: "bg-critical-bg text-critical",
  neutral: "bg-surface-container text-on-surface-variant",
};

export function Badge({ tone = "neutral", children }: { tone?: BadgeTone; children: ReactNode }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 rounded-full px-space-sm py-space-xxs font-label-sm uppercase tracking-wide",
        toneClasses[tone]
      )}
    >
      {children}
    </span>
  );
}
