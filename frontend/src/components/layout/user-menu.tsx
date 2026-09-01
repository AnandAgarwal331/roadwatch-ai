"use client";

import { useQueryClient } from "@tanstack/react-query";
import { ClipboardList, LayoutDashboard, LogOut, User as UserIcon, Wrench } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/components/ui/toast";
import { initials } from "@/lib/utils";
import type { User } from "@/types";

export function UserMenu({ user }: { user: User }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { error: toastError } = useToast();
  const [signingOut, setSigningOut] = React.useState(false);

  async function signOut() {
    setSigningOut(true);
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error("logout failed");

      // Drop every cached response so the next user cannot see the last one's data.
      queryClient.clear();
      router.replace("/");
      router.refresh();
    } catch {
      toastError("Could not sign out", "Please check your connection and try again.");
      setSigningOut(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="h-9 gap-2 px-2"
          aria-label={`Account menu for ${user.full_name}`}
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
            {initials(user.full_name)}
          </span>
          <span className="hidden max-w-[10rem] truncate text-sm font-medium sm:inline">
            {user.full_name}
          </span>
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="font-normal">
          <span className="block text-sm font-medium text-foreground">{user.full_name}</span>
          <span className="block truncate text-xs text-muted-foreground">{user.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        {user.role === "ADMIN" ? (
          <DropdownMenuItem asChild>
            <Link href="/admin">
              <LayoutDashboard aria-hidden="true" />
              Admin dashboard
            </Link>
          </DropdownMenuItem>
        ) : null}

        {user.role === "REPAIR_TEAM" ? (
          <DropdownMenuItem asChild>
            <Link href="/team">
              <Wrench aria-hidden="true" />
              My work
            </Link>
          </DropdownMenuItem>
        ) : null}

        {user.role === "CITIZEN" ? (
          <DropdownMenuItem asChild>
            <Link href="/my-reports">
              <ClipboardList aria-hidden="true" />
              My reports
            </Link>
          </DropdownMenuItem>
        ) : null}

        <DropdownMenuItem asChild>
          <Link href="/profile">
            <UserIcon aria-hidden="true" />
            Profile
          </Link>
        </DropdownMenuItem>

        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={(event) => {
            event.preventDefault();
            void signOut();
          }}
          disabled={signingOut}
        >
          <LogOut aria-hidden="true" />
          {signingOut ? "Signing out..." : "Sign out"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
