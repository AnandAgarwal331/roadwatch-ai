import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { sharedCache, TtlCache } from "./ttl-cache";

const OPTIONS = { maxEntries: 3, freshMs: 1000, staleMs: 4000 };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-22T09:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("TtlCache.get", () => {
  it("returns a fresh value, then a stale one, then nothing", () => {
    const cache = new TtlCache<string>(OPTIONS);
    cache.set("a", "one");

    expect(cache.get("a")).toEqual({ value: "one", fresh: true });

    vi.advanceTimersByTime(1500);
    expect(cache.get("a")).toEqual({ value: "one", fresh: false });

    vi.advanceTimersByTime(4000);
    expect(cache.get("a")).toBeUndefined();
  });

  it("evicts the oldest entry once full", () => {
    const cache = new TtlCache<string>(OPTIONS);
    for (const key of ["a", "b", "c", "d"]) cache.set(key, key);

    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("d")?.value).toBe("d");
  });

  it("counts a rewrite as the newest, so a busy key is not the one evicted", () => {
    const cache = new TtlCache<string>(OPTIONS);
    cache.set("a", "1");
    cache.set("b", "2");
    cache.set("c", "3");
    cache.set("a", "1 again");
    cache.set("d", "4");

    expect(cache.get("a")?.value).toBe("1 again");
    expect(cache.get("b")).toBeUndefined();
  });

  it("forgets a deleted key", () => {
    const cache = new TtlCache<string>(OPTIONS);
    cache.set("a", "1");
    cache.delete("a");
    expect(cache.get("a")).toBeUndefined();
  });
});

describe("TtlCache.getOrLoad", () => {
  it("loads on a miss and answers from memory afterwards", async () => {
    const cache = new TtlCache<string>(OPTIONS);
    const load = vi.fn().mockResolvedValue("data");

    expect(await cache.getOrLoad("k", load)).toEqual({ value: "data", state: "miss" });
    expect(await cache.getOrLoad("k", load)).toEqual({ value: "data", state: "hit" });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("answers a stale value at once and refreshes in the background", async () => {
    const cache = new TtlCache<string>(OPTIONS);
    const load = vi.fn().mockResolvedValueOnce("old").mockResolvedValueOnce("new");
    await cache.getOrLoad("k", load);

    vi.advanceTimersByTime(2000);
    const stale = await cache.getOrLoad("k", load);
    expect(stale).toEqual({ value: "old", state: "stale" });

    await vi.advanceTimersByTimeAsync(0);
    expect(load).toHaveBeenCalledTimes(2);
    expect(await cache.getOrLoad("k", load)).toEqual({ value: "new", state: "hit" });
  });

  it("makes the caller wait once the entry is too old to serve", async () => {
    const cache = new TtlCache<string>(OPTIONS);
    const load = vi.fn().mockResolvedValueOnce("old").mockResolvedValueOnce("new");
    await cache.getOrLoad("k", load);

    vi.advanceTimersByTime(6000);
    expect(await cache.getOrLoad("k", load)).toEqual({ value: "new", state: "miss" });
  });

  it("shares one load between simultaneous callers", async () => {
    const cache = new TtlCache<string>(OPTIONS);
    const load = vi.fn().mockResolvedValue("data");

    await Promise.all([cache.getOrLoad("k", load), cache.getOrLoad("k", load), cache.getOrLoad("k", load)]);

    expect(load).toHaveBeenCalledTimes(1);
  });

  it("hands back a value it was told not to keep, and does not keep it", async () => {
    const cache = new TtlCache<number>(OPTIONS);
    const load = vi.fn().mockResolvedValueOnce(500).mockResolvedValueOnce(200);
    const isOk = (status: number) => status === 200;

    expect(await cache.getOrLoad("k", load, isOk)).toEqual({ value: 500, state: "miss" });
    expect(await cache.getOrLoad("k", load, isOk)).toEqual({ value: 200, state: "miss" });
    expect(await cache.getOrLoad("k", load, isOk)).toEqual({ value: 200, state: "hit" });
  });

  it("keeps serving the stale value when the background refresh fails", async () => {
    const cache = new TtlCache<string>(OPTIONS);
    const load = vi.fn().mockResolvedValueOnce("old").mockRejectedValue(new Error("backend down"));
    await cache.getOrLoad("k", load);

    vi.advanceTimersByTime(2000);
    expect((await cache.getOrLoad("k", load)).value).toBe("old");
    await vi.advanceTimersByTimeAsync(0);
    expect((await cache.getOrLoad("k", load)).value).toBe("old");
  });

  it("lets a failed first load reach the caller instead of caching it", async () => {
    const cache = new TtlCache<string>(OPTIONS);
    const load = vi.fn().mockRejectedValueOnce(new Error("backend down")).mockResolvedValueOnce("data");

    await expect(cache.getOrLoad("k", load)).rejects.toThrow("backend down");
    expect((await cache.getOrLoad("k", load)).value).toBe("data");
  });
});

describe("sharedCache", () => {
  it("returns the same cache for the same name", () => {
    expect(sharedCache("test-shared", OPTIONS)).toBe(sharedCache("test-shared", OPTIONS));
    expect(sharedCache("test-shared", OPTIONS)).not.toBe(sharedCache("test-other", OPTIONS));
  });
});
