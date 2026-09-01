"use client";

import {
  BarChart3,
  Copy,
  LayoutDashboard,
  ListChecks,
  ScrollText,
  SlidersHorizontal,
  Users,
} from "lucide-react";

import { DashboardShell, type DashboardNavItem } from "@/components/dashboard/dashboard-shell";
import type { User } from "@/types";

/**
 * The admin navigation lives here rather than in the layout because the icons
 * are React components, and a server component cannot hand those to a client
 * one. The layout stays responsible for the access check.
 */
const NAV: DashboardNavItem[] = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { href: "/admin/reports", label: "Reports", icon: ListChecks },
  { href: "/admin/duplicates", label: "Duplicates", icon: Copy },
  { href: "/admin/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/admin/teams", label: "Repair teams", icon: Users },
  { href: "/admin/audit", label: "Audit trail", icon: ScrollText },
  { href: "/admin/settings", label: "Scoring settings", icon: SlidersHorizontal },
];

export function AdminShell({ user, children }: { user: User; children: React.ReactNode }) {
  return (
    <DashboardShell user={user} workspace="Works department" nav={NAV}>
      {children}
    </DashboardShell>
  );
}
