"use client";

import { Menu, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";

import { Logo } from "@/components/layout/logo";
import { NotificationBell } from "@/components/layout/notification-bell";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { UserMenu } from "@/components/layout/user-menu";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { User } from "@/types";

export interface DashboardNavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Match only the exact path - used for section roots like `/admin`. */
  exact?: boolean;
}

interface DashboardShellProps {
  user: User;
  /** Shown under the logo so a crew member knows which console they are in. */
  workspace: string;
  nav: DashboardNavItem[];
  children: React.ReactNode;
}

function isActive(pathname: string, item: DashboardNavItem): boolean {
  return item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
}

/**
 * Sidebar layout shared by the admin console and the crew console.
 *
 * The sidebar is a persistent landmark on large screens and collapses into a
 * disclosure on small ones, so the same markup serves a desk and a phone in
 * the field.
 */
export function DashboardShell({ user, workspace, nav, children }: DashboardShellProps) {
  const pathname = usePathname();
  const [open, setOpen] = React.useState(false);

  // Close the mobile nav whenever navigation happens. This is the "adjust
  // state when a prop changes" pattern: done during render rather than in an
  // effect, so it does not cost a second render pass.
  const [lastPath, setLastPath] = React.useState(pathname);
  if (lastPath !== pathname) {
    setLastPath(pathname);
    setOpen(false);
  }

  const links = (
    <ul className="space-y-1">
      {nav.map((item) => {
        const active = isActive(pathname, item);
        const Icon = item.icon;
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
        <div className="flex h-16 items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden"
              aria-expanded={open}
              aria-controls="dashboard-nav"
              aria-label={open ? "Close navigation" : "Open navigation"}
              onClick={() => setOpen((value) => !value)}
            >
              {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </Button>
            <Logo />
            <span className="hidden rounded-full border border-border px-2.5 py-0.5 text-xs font-medium text-muted-foreground sm:inline">
              {workspace}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <ThemeToggle />
            <NotificationBell />
            <UserMenu user={user} />
          </div>
        </div>
      </header>

      <div className="flex flex-1">
        <aside className="hidden w-60 shrink-0 border-r border-border bg-muted/20 lg:block">
          <nav aria-label={workspace} className="sticky top-16 p-4">
            {links}
          </nav>
        </aside>

        {open ? (
          <nav
            id="dashboard-nav"
            aria-label={`${workspace} (mobile)`}
            className="absolute inset-x-0 top-16 z-30 border-b border-border bg-background p-4 shadow-panel lg:hidden"
          >
            {links}
          </nav>
        ) : null}

        <main id="main" className="min-w-0 flex-1 bg-background">
          <div className="mx-auto max-w-[1200px] px-4 py-6 sm:px-6 sm:py-8">{children}</div>
        </main>
      </div>
    </div>
  );
}

/** Page heading used at the top of every dashboard screen. */
export function PageHeading({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? (
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}
