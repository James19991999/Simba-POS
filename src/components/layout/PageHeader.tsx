import { ReactNode } from "react";

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-space-sm p-space-lg border-b border-slate-border bg-surface-container-lowest">
      <div>
        <h1 className="font-headline-md text-on-surface">{title}</h1>
        {subtitle && <p className="font-body-sm text-on-surface-variant">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-space-sm">{actions}</div>}
    </div>
  );
}
