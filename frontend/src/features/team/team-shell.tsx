"use client";

import { ClipboardList, LayoutDashboard } from "lucide-react";

import { DashboardShell, type DashboardNavItem } from "@/components/dashboard/dashboard-shell";
import type { User } from "@/types";

/** Kept client-side so the icon components never cross the RSC boundary. */
const NAV: DashboardNavItem[] = [
  { href: "/team", label: "Today", icon: LayoutDashboard, exact: true },
  { href: "/team/tasks", label: "All jobs", icon: ClipboardList },
];

export function TeamShell({ user, children }: { user: User; children: React.ReactNode }) {
  return (
    <DashboardShell user={user} workspace="Crew console" nav={NAV}>
      {children}
    </DashboardShell>
  );
}
