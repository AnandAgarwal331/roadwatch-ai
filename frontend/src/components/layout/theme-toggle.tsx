"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

import { Button } from "@/components/ui/button";

/**
 * Toggles between light and dark - not a three-way light/dark/system menu,
 * to keep this a single click. `next-themes` still respects the system
 * preference as the initial value; this only overrides it once clicked.
 *
 * `resolvedTheme` is `undefined` until next-themes has run client-side (the
 * server can't know the viewer's preference), which doubles as the
 * mounted-check that avoids a hydration mismatch - no separate effect needed.
 */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = resolvedTheme !== undefined;

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={mounted ? `Switch to ${resolvedTheme === "dark" ? "light" : "dark"} mode` : "Toggle theme"}
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
    >
      {mounted && resolvedTheme === "dark" ? (
        <Sun className="h-[1.1rem] w-[1.1rem]" aria-hidden="true" />
      ) : (
        <Moon className="h-[1.1rem] w-[1.1rem]" aria-hidden="true" />
      )}
    </Button>
  );
}
