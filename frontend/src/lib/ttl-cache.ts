/**
 * A small in-memory cache with stale-while-revalidate, for the Next.js server.
 *
 * Every trip to the backend costs a network round trip - several hundred
 * milliseconds to a couple of seconds on a cold Edge Function - so anything
 * that can safely be a few seconds old should not pay it every time.
 *
 * An entry is *fresh* for `freshMs`, returned instantly. For a further
 * `staleMs` it is *stale*: still returned instantly, but a background refresh
 * is started so the next caller gets new data. Only once it is older than both
 * is a caller made to wait. Concurrent misses for the same key share one load.
 *
 * Bounded (`maxEntries`, oldest evicted first) so it cannot grow without limit,
 * and per server instance: another instance has its own copy, which is fine for
 * data that is merely allowed to be a little stale.
 */

interface Entry<V> {
  value: V;
  storedAt: number;
}

export interface TtlCacheOptions {
  maxEntries: number;
  freshMs: number;
  staleMs: number;
}

export type CacheState = "hit" | "stale" | "miss";

export class TtlCache<V> {
  private entries = new Map<string, Entry<V>>();
  private loading = new Map<string, Promise<V>>();

  constructor(private options: TtlCacheOptions) {}

  /** The stored value and whether it is still fresh, or `undefined` if absent or too old to use. */
  get(key: string): { value: V; fresh: boolean } | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;

    const age = Date.now() - entry.storedAt;
    if (age <= this.options.freshMs) return { value: entry.value, fresh: true };
    if (age <= this.options.freshMs + this.options.staleMs) return { value: entry.value, fresh: false };

    this.entries.delete(key);
    return undefined;
  }

  set(key: string, value: V): void {
    // Re-inserting moves the key to the back, so the front is always the oldest.
    this.entries.delete(key);
    this.entries.set(key, { value, storedAt: Date.now() });
    while (this.entries.size > this.options.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  /**
   * The cached value if there is a usable one, otherwise the result of `load`.
   *
   * `load` always produces a value the caller can use (an error response, say,
   * is still something to hand back), but only values `shouldStore` accepts are
   * kept - a failure must never be served again to the next visitor.
   */
  async getOrLoad(
    key: string,
    load: () => Promise<V>,
    shouldStore: (value: V) => boolean = () => true,
  ): Promise<{ value: V; state: CacheState }> {
    const cached = this.get(key);
    if (cached?.fresh) return { value: cached.value, state: "hit" };

    const refresh = () => {
      const running = this.loading.get(key);
      if (running) return running;

      const pending = load()
        .then((value) => {
          if (shouldStore(value)) this.set(key, value);
          return value;
        })
        .finally(() => this.loading.delete(key));
      this.loading.set(key, pending);
      return pending;
    };

    if (cached) {
      // Stale: answer now, refresh for whoever comes next. A failed refresh
      // just leaves the stale value in place until it ages out.
      refresh().catch(() => {});
      return { value: cached.value, state: "stale" };
    }

    return { value: await refresh(), state: "miss" };
  }
}

/**
 * One cache per name for the whole server process.
 *
 * Next.js can load the same module more than once (separate route bundles), and
 * a plain module-level cache would then be several unrelated caches. Parking
 * them on `globalThis` keeps it one.
 */
export function sharedCache<V>(name: string, options: TtlCacheOptions): TtlCache<V> {
  const registry = ((globalThis as Record<string, unknown>).__rwCaches ??= new Map()) as Map<
    string,
    TtlCache<unknown>
  >;
  let cache = registry.get(name);
  if (!cache) {
    cache = new TtlCache<unknown>(options);
    registry.set(name, cache);
  }
  return cache as TtlCache<V>;
}
