"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import * as React from "react";

import { Button } from "@/components/ui/button";

const subscribe = () => () => {};

/**
 * false on the server and during hydration, true once mounted in the browser.
 *
 * next-themes reads localStorage / prefers-color-scheme synchronously on the
 * client's first render, so `resolvedTheme` is already defined during
 * hydration and cannot double as a "mounted" check - using it that way
 * renders a different icon than the server HTML and throws React error #418
 * for anyone whose theme resolves to dark.
 */
function useMounted(): boolean {
  return React.useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}

/**
 * Toggles between light and dark - not a three-way light/dark/system menu,
 * to keep this a single click. `next-themes` still respects the system
 * preference as the initial value; this only overrides it once clicked.
 */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useMounted();
  const isDark = mounted && resolvedTheme === "dark";

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={mounted ? `Switch to ${isDark ? "light" : "dark"} mode` : "Toggle theme"}
      onClick={() => setTheme(isDark ? "light" : "dark")}
    >
      {isDark ? (
        <Sun className="h-[1.1rem] w-[1.1rem]" aria-hidden="true" />
      ) : (
        <Moon className="h-[1.1rem] w-[1.1rem]" aria-hidden="true" />
      )}
    </Button>
  );
}
