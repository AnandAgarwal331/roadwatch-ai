"use client";

import * as React from "react";

import { IDLE_TIMEOUT_MS, KEEPALIVE_INTERVAL_MS } from "@/lib/session-policy";

export const ACTIVITY_KEY = "rw_last_activity";
const ACTIVITY_EVENTS = ["pointerdown", "keydown", "scroll", "touchstart"] as const;
// Writing to localStorage on every mouse move would be wasteful; one write a
// few seconds is plenty of resolution against a 30 minute limit.
const WRITE_THROTTLE_MS = 5_000;

function readLastActivity(): number {
  try {
    const stored = Number(window.localStorage.getItem(ACTIVITY_KEY));
    return Number.isFinite(stored) && stored > 0 ? stored : 0;
  } catch {
    return 0;
  }
}

function writeLastActivity(now: number) {
  try {
    window.localStorage.setItem(ACTIVITY_KEY, String(now));
  } catch {
    // Storage blocked - the in-memory timestamp below still covers this tab.
  }
}

interface IdleTimeoutOptions {
  /** Called once when the user has been idle for `timeoutMs`. */
  onTimeout: () => void;
  /**
   * Called every `keepAliveMs` if the user did anything since the last call.
   * This is what tells the server the session is still in use, so it can renew
   * the token and extend the cookies; without it an active user would be cut
   * off when those expire.
   */
  onKeepAlive?: () => void;
  timeoutMs?: number;
  keepAliveMs?: number;
}

/**
 * Signs out idle users and keeps the server informed about active ones.
 *
 * Activity is shared across tabs through localStorage, so an idle background
 * tab cannot sign out someone who is actively working in another one. The
 * deadline is re-checked against the wall clock when the tab becomes visible
 * again, because timers are throttled or frozen while a laptop sleeps.
 */
export function useIdleTimeout({
  onTimeout,
  onKeepAlive,
  timeoutMs = IDLE_TIMEOUT_MS,
  keepAliveMs = KEEPALIVE_INTERVAL_MS,
}: IdleTimeoutOptions) {
  const callbacks = React.useRef({ onTimeout, onKeepAlive });
  React.useEffect(() => {
    callbacks.current = { onTimeout, onKeepAlive };
  });

  React.useEffect(() => {
    let lastActivity = Math.max(readLastActivity(), Date.now());
    let lastWrite = 0;
    let lastKeepAlive = Date.now();
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    let fired = false;

    function refreshFromStorage() {
      lastActivity = Math.max(lastActivity, readLastActivity());
    }

    function checkIdle() {
      if (fired) return;
      refreshFromStorage();
      const remaining = lastActivity + timeoutMs - Date.now();
      if (remaining <= 0) {
        fired = true;
        callbacks.current.onTimeout();
        return;
      }
      idleTimer = setTimeout(checkIdle, remaining);
    }

    function keepAlive() {
      if (fired) return;
      refreshFromStorage();
      if (lastActivity > lastKeepAlive) {
        lastKeepAlive = Date.now();
        callbacks.current.onKeepAlive?.();
      }
    }

    function markActive() {
      const now = Date.now();
      lastActivity = now;
      if (now - lastWrite > WRITE_THROTTLE_MS) {
        lastWrite = now;
        writeLastActivity(now);
      }
    }

    function onVisible() {
      if (document.visibilityState === "visible") {
        clearTimeout(idleTimer);
        checkIdle();
      }
    }

    writeLastActivity(lastActivity);
    checkIdle();
    const keepAliveTimer = setInterval(keepAlive, keepAliveMs);
    ACTIVITY_EVENTS.forEach((name) =>
      window.addEventListener(name, markActive, { passive: true }),
    );
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      clearTimeout(idleTimer);
      clearInterval(keepAliveTimer);
      ACTIVITY_EVENTS.forEach((name) => window.removeEventListener(name, markActive));
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [timeoutMs, keepAliveMs]);
}
