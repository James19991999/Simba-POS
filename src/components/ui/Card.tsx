import clsx from "clsx";
import { HTMLAttributes } from "react";

// Elevation Level 1 (Card & Section Containers): white over the cream
// canvas, 1px slate-border, zero shadow.
export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={clsx(
        "bg-surface-container-lowest border border-slate-border rounded-md p-space-lg",
        className
      )}
      {...rest}
    />
  );
}

// Elevation Level 2 (Active Item / Selected State): terracotta outline + warm tint shadow.
export function ActiveCard({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={clsx(
        "bg-surface-container-lowest border-2 border-primary-action rounded-md p-space-lg shadow-level-2",
        className
      )}
      {...rest}
    />
  );
}
