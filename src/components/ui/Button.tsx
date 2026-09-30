import { ButtonHTMLAttributes, forwardRef } from "react";
import clsx from "clsx";

type Variant = "primary" | "secondary" | "tertiary" | "destructive";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  fullWidth?: boolean;
}

// Buttons component spec (DESIGN.md):
// - Primary: solid terracotta, min-height 48px (52px on payment screens)
// - Secondary: solid safari-emerald green — payment/settlement actions
// - Tertiary: cream-tinted neutral utility actions
// - Destructive: low-saturation rose bg, crimson text — voids/cancellations
const variantClasses: Record<Variant, string> = {
  primary: "bg-primary-action text-on-primary hover:bg-primary active:scale-[0.98]",
  secondary: "bg-secondary-action text-on-secondary hover:bg-secondary active:scale-[0.98]",
  tertiary:
    "bg-surface-container-low text-on-surface border border-slate-border hover:bg-surface-container",
  destructive: "bg-critical-bg text-critical hover:bg-red-200",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", fullWidth, className, children, ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      className={clsx(
        "inline-flex items-center justify-center gap-2 rounded font-label-lg min-h-touch-min px-space-lg transition-transform disabled:opacity-50 disabled:pointer-events-none",
        variantClasses[variant],
        fullWidth && "w-full",
        className
      )}
      {...rest}
    >
      {children}
    </button>
  );
});
