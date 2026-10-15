/**
 * SkyCast - cache and request coalescing.
 *
 * Weather, radar, alert and news providers each publish on their own cadence,
 * so SkyCast polls each one at its own interval (configured in `config.js`)
 * rather than hammering every endpoint on a single global timer.
 *
 * Three behaviours matter here:
 *
 *   1. TTL caching      - a fresh entry is served without touching the network.
 *   2. Request coalescing - concurrent callers waiting on the same cold key
 *      share one upstream request instead of firing N identical ones.
 *   3. Stale-while-error - when a provider fails, the last good response is
 *      still served, explicitly flagged as stale so the UI can say so rather
 *      than inventing data.
 */

/** Bound the number of cached entries so a long-running server cannot leak. */
const MAX_ENTRIES = 500;

export class ResponseCache {
  /**
   * @param {object} [options]
   * @param {number} [options.staleMaxAgeMs] - how long a failed refresh may keep serving the last good value
   * @param {number} [options.maxEntries]
   */
  constructor({ staleMaxAgeMs = 21_600_000, maxEntries = MAX_ENTRIES } = {}) {
    /** @type {Map<string, { value: unknown, fetchedAt: number, expiresAt: number }>} */
    this.entries = new Map();
    /** @type {Map<string, Promise<unknown>>} */
    this.inFlight = new Map();
    this.staleMaxAgeMs = staleMaxAgeMs;
    this.maxEntries = maxEntries;
    this.hits = 0;
    this.misses = 0;
    this.staleServes = 0;
    this.coalesced = 0;
  }

  /** Drop the least recently written entry once the cache is full. */
  #evictIfNeeded() {
    while (this.entries.size > this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      this.entries.delete(oldestKey);
    }
  }

  /** Read a live entry, refreshing its recency so eviction is roughly LRU. */
  #readLive(key) {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) return null;
    // Re-insert to move it to the back of the Map (most recently used).
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry;
  }

  /** Read an entry regardless of expiry, for the stale fallback path. */
  #readAny(key) {
    return this.entries.get(key) ?? null;
  }

  /** @param {string} key @param {unknown} value @param {number} ttlMs */
  #write(key, value, ttlMs) {
    const now = Date.now();
    this.entries.set(key, { value, fetchedAt: now, expiresAt: now + ttlMs });
    this.#evictIfNeeded();
  }

  /**
   * Return a cached value, or load it via `loader`.
   *
   * The resolved envelope always reports provenance so the API layer can pass
   * an honest `cached` / `stale` / `ageSeconds` triple to the browser.
   *
   * @template T
   * @param {string} key
   * @param {object} options
   * @param {number} options.ttlMs - freshness window
   * @param {() => Promise<T>} options.loader
   * @param {boolean} [options.allowStale] - permit serving expired data if the loader fails
   * @returns {Promise<{ value: T, cached: boolean, stale: boolean, fetchedAt: number, ageSeconds: number }>}
   */
  async getOrLoad(key, { ttlMs, loader, allowStale = true }) {
    const live = this.#readLive(key);
    if (live) {
      this.hits += 1;
      return envelope(live.value, { cached: true, stale: false, fetchedAt: live.fetchedAt });
    }

    this.misses += 1;

    // Coalesce: if an identical load is already running, await that instead.
    const pending = this.inFlight.get(key);
    if (pending) {
      this.coalesced += 1;
      const value = await pending;
      const entry = this.#readAny(key);
      return envelope(value, { cached: true, stale: false, fetchedAt: entry?.fetchedAt ?? Date.now() });
    }

    const load = (async () => {
      const value = await loader();
      this.#write(key, value, ttlMs);
      return value;
    })();

    this.inFlight.set(key, load);

    try {
      const value = await load;
      return envelope(value, { cached: false, stale: false, fetchedAt: Date.now() });
    } catch (error) {
      const previous = this.#readAny(key);
      const ageMs = previous ? Date.now() - previous.fetchedAt : Number.POSITIVE_INFINITY;

      if (allowStale && previous && ageMs <= this.staleMaxAgeMs) {
        this.staleServes += 1;
        return envelope(previous.value, { cached: true, stale: true, fetchedAt: previous.fetchedAt });
      }
      throw error;
    } finally {
      this.inFlight.delete(key);
    }
  }

  /** Remove a single key (used after a write is known to be invalid). */
  invalidate(key) {
    this.entries.delete(key);
  }

  /** Remove every key beginning with `prefix`. */
  invalidatePrefix(prefix) {
    for (const key of [...this.entries.keys()]) {
      if (key.startsWith(prefix)) this.entries.delete(key);
    }
  }

  clear() {
    this.entries.clear();
    this.inFlight.clear();
  }

  stats() {
    return {
      entries: this.entries.size,
      inFlight: this.inFlight.size,
      hits: this.hits,
      misses: this.misses,
      coalesced: this.coalesced,
      staleServes: this.staleServes,
      hitRate: this.hits + this.misses > 0 ? Number((this.hits / (this.hits + this.misses)).toFixed(3)) : 0,
    };
  }
}

/**
 * Normalise a cached value into the provenance envelope the API returns.
 * @param {unknown} value
 * @param {{ cached: boolean, stale: boolean, fetchedAt: number }} meta
 */
const envelope = (value, { cached, stale, fetchedAt }) => ({
  value,
  cached,
  stale,
  fetchedAt,
  ageSeconds: Math.max(0, Math.round((Date.now() - fetchedAt) / 1000)),
});

/** Process-wide cache shared by every route. */
export const cache = new ResponseCache();

/** Stable, order-independent cache key for a route plus its query parameters. */
export const cacheKeyFor = (scope, params = {}) => {
  const sortedKeys = Object.keys(params)
    .filter((key) => params[key] !== undefined && params[key] !== null && params[key] !== "")
    .sort();
  const serialised = sortedKeys.map((key) => `${key}=${String(params[key])}`).join("&");
  return `${scope}?${serialised}`;
};

/**
 * Round coordinates to a fixed precision before they become part of a cache
 * key. Two users asking for "Chennai" at 13.0827/80.2707 and 13.08271/80.27069
 * should share one upstream request; ~1 km resolution is plenty for weather.
 */
export const roundCoord = (value, decimals = 2) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Number(parsed.toFixed(decimals));
};
