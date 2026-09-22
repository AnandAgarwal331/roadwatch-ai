import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { IDLE_TIMEOUT_MS, KEEPALIVE_INTERVAL_MS } from "@/lib/session-policy";

import { ACTIVITY_KEY, useIdleTimeout } from "./use-idle-timeout";

const MINUTE = 60_000;

function setup() {
  const onTimeout = vi.fn();
  const onKeepAlive = vi.fn();
  const hook = renderHook(() => useIdleTimeout({ onTimeout, onKeepAlive }));
  return { onTimeout, onKeepAlive, ...hook };
}

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

function interact(event: string = "keydown") {
  act(() => {
    window.dispatchEvent(new Event(event));
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-22T09:00:00Z"));
  window.localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("idle timeout", () => {
  it("signs the user out after the idle limit with no activity", () => {
    const { onTimeout } = setup();

    advance(IDLE_TIMEOUT_MS - 1000);
    expect(onTimeout).not.toHaveBeenCalled();

    advance(1000);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it("does not sign out someone who keeps interacting", () => {
    const { onTimeout } = setup();

    for (let i = 0; i < 6; i++) {
      advance(20 * MINUTE);
      interact();
    }

    expect(onTimeout).not.toHaveBeenCalled();
  });

  it("restarts the countdown from the last interaction, not from page load", () => {
    const { onTimeout } = setup();

    advance(25 * MINUTE);
    interact("pointerdown");

    advance(25 * MINUTE); // 50 minutes after load, but only 25 since the click
    expect(onTimeout).not.toHaveBeenCalled();

    advance(5 * MINUTE + 1000);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it("counts clicks, keys, scrolling and touch as activity", () => {
    for (const event of ["pointerdown", "keydown", "scroll", "touchstart"]) {
      const { onTimeout, unmount } = setup();
      advance(20 * MINUTE);
      interact(event);
      advance(20 * MINUTE);
      expect(onTimeout).not.toHaveBeenCalled();
      unmount();
    }
  });

  it("fires only once", () => {
    const { onTimeout } = setup();
    advance(IDLE_TIMEOUT_MS * 3);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it("does nothing after the component unmounts", () => {
    const { onTimeout, onKeepAlive, unmount } = setup();
    unmount();

    interact();
    advance(IDLE_TIMEOUT_MS * 2);

    expect(onTimeout).not.toHaveBeenCalled();
    expect(onKeepAlive).not.toHaveBeenCalled();
  });

  it("is kept alive by activity in another tab", () => {
    const { onTimeout } = setup();

    advance(25 * MINUTE);
    // Another tab records activity through the shared timestamp.
    window.localStorage.setItem(ACTIVITY_KEY, String(Date.now()));

    advance(20 * MINUTE);
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it("signs out on waking up after the limit passed while timers were frozen", () => {
    const { onTimeout } = setup();

    // A sleeping laptop: the clock moves on but no timer callbacks run.
    vi.setSystemTime(Date.now() + IDLE_TIMEOUT_MS + MINUTE);
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it("still works when localStorage is unavailable", () => {
    const blocked = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const blockedWrite = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });

    const { onTimeout } = setup();
    advance(IDLE_TIMEOUT_MS + 1000);
    expect(onTimeout).toHaveBeenCalledTimes(1);

    blocked.mockRestore();
    blockedWrite.mockRestore();
  });
});

describe("keep-alive", () => {
  it("does not ping while the user has done nothing", () => {
    const { onKeepAlive } = setup();
    advance(KEEPALIVE_INTERVAL_MS * 2);
    expect(onKeepAlive).not.toHaveBeenCalled();
  });

  it("pings once an interval after the user did something", () => {
    const { onKeepAlive } = setup();

    advance(3 * MINUTE);
    interact();
    advance(KEEPALIVE_INTERVAL_MS);

    expect(onKeepAlive).toHaveBeenCalledTimes(1);
  });

  it("stops pinging again until there is new activity", () => {
    const { onKeepAlive } = setup();

    advance(MINUTE);
    interact();
    advance(KEEPALIVE_INTERVAL_MS);
    expect(onKeepAlive).toHaveBeenCalledTimes(1);

    advance(KEEPALIVE_INTERVAL_MS);
    expect(onKeepAlive).toHaveBeenCalledTimes(1);

    interact();
    advance(KEEPALIVE_INTERVAL_MS);
    expect(onKeepAlive).toHaveBeenCalledTimes(2);
  });

  it("does not ping after the idle timeout has fired", () => {
    const { onTimeout, onKeepAlive } = setup();
    advance(IDLE_TIMEOUT_MS + 1000);
    expect(onTimeout).toHaveBeenCalled();

    interact();
    advance(KEEPALIVE_INTERVAL_MS);
    expect(onKeepAlive).not.toHaveBeenCalled();
  });
});
