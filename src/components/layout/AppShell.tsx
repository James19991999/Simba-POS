"use client";

import { ReactNode, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthProvider";
import type { Role } from "@/types";
import clsx from "clsx";

interface NavItem {
  href: string;
  label: string;
  icon: string; // emoji stand-in for the Material Symbols icons used in the Stitch export
  roles: Role[];
}

const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: "📊", roles: ["owner", "manager"] },
  { href: "/floor", label: "Floor & Tables", icon: "🍽️", roles: ["owner", "manager", "floor_captain", "waiter"] },
  { href: "/pos", label: "POS & Pay", icon: "🧾", roles: ["owner", "manager", "floor_captain", "waiter"] },
  { href: "/menu", label: "Menu", icon: "📖", roles: ["owner", "manager", "floor_captain", "waiter", "kitchen"] },
  { href: "/delivery", label: "Delivery Hub", icon: "🛵", roles: ["owner", "manager", "rider"] },
  { href: "/inventory", label: "Inventory", icon: "📦", roles: ["owner", "manager"] },
  { href: "/staff", label: "Staff & Shifts", icon: "🧑‍🍳", roles: ["owner", "manager", "floor_captain"] },
  { href: "/finance", label: "Finance & eTIMS", icon: "🏛️", roles: ["owner", "accountant"] },
  { href: "/loyalty", label: "Loyalty", icon: "🎁", roles: ["owner", "manager", "floor_captain", "waiter"] },
  { href: "/analytics", label: "Analytics", icon: "📈", roles: ["owner", "manager", "accountant"] },
  { href: "/settings", label: "Settings", icon: "⚙️", roles: ["owner", "manager"] },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { user, loading, activeOrg, activeRole, memberships } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/sign-in");
    } else if (!loading && user && memberships.length === 0) {
      router.replace("/onboarding");
    }
  }, [loading, user, memberships, router]);

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-on-surface-variant">Loading SimbaPOS…</div>;
  }
  if (!user) return null;

  const visibleItems = NAV_ITEMS.filter((item) => !activeRole || item.roles.includes(activeRole));

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-surface">
      <aside className="hidden md:flex md:w-[260px] md:flex-col border-r border-slate-border bg-surface-container-lowest">
        <div className="p-space-lg border-b border-slate-border">
          <p className="font-headline-sm text-primary">SimbaPOS</p>
          <p className="font-body-sm text-on-surface-variant">{activeOrg?.name ?? "Loading station…"}</p>
        </div>
        <nav className="flex-1 overflow-y-auto py-space-sm">
          {visibleItems.map((item) => {
            const active = pathname?.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={clsx(
                  "flex items-center gap-3 px-space-lg py-space-sm font-label-lg",
                  active ? "bg-primary-fixed text-on-primary-fixed" : "text-on-surface hover:bg-surface-container"
                )}
              >
                <span aria-hidden>{item.icon}</span>
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="p-space-lg border-t border-slate-border font-body-sm text-on-surface-variant">
          Role: <span className="font-semibold text-on-surface">{activeRole}</span>
        </div>
      </aside>

      {/* Mobile top bar + bottom nav shelf, per DESIGN.md's "sticky bottom interaction shelf" */}
      <header className="md:hidden flex items-center justify-between p-space-md border-b border-slate-border bg-surface-container-lowest">
        <p className="font-headline-sm text-primary">SimbaPOS</p>
        <p className="font-body-sm text-on-surface-variant">{activeOrg?.name}</p>
      </header>

      <main className="flex-1 min-h-screen pb-24 md:pb-0">{children}</main>

      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-surface-container-lowest border-t border-slate-border flex overflow-x-auto">
        {visibleItems.map((item) => {
          const active = pathname?.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={clsx(
                "flex flex-col items-center justify-center min-w-[72px] min-h-touch-comfortable px-space-sm font-label-sm",
                active ? "text-primary-action" : "text-on-surface-variant"
              )}
            >
              <span aria-hidden className="text-lg">{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
