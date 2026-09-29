/**
 * SynapseJS - Incremental Static Regeneration (ISR) & SSR Micro-Cache Contract
 *
 * Slices export `sliceCache` or `cacheConfig` to declare caching boundaries,
 * stale-while-revalidate windows, and tag-based invalidation.
 */

export interface SliceCacheConfig {
  /** Time to live in seconds before the cached SSR HTML is considered stale */
  ttlSeconds: number;
  /** Stale-while-revalidate grace period in seconds */
  staleWhileRevalidateSeconds?: number;
  /** Invalidation tags (e.g. ['products', 'catalog']) */
  tags?: string[];
  /** Allowed query parameters to differentiate cache entries (default: all non-tracking parameters) */
  allowedParams?: string[];
}

/**
 * Declares SSR caching and ISR revalidation policy for a slice.
 */
export function defineCache(config: SliceCacheConfig): SliceCacheConfig {
  return config;
}

const DEFAULT_TRACKING_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'fbclid',
  'gclid',
  'msclkid',
  'mc_eid',
  '_ga',
  '_gl',
  'ref',
  'v'
]);

/**
 * Normalizes a URL into a deterministic SSR cache key:
 * - Strips common ad/tracking query parameters (utm_*, fbclid, etc.)
 * - If allowedParams is specified, filters query parameters strictly to that allowlist
 * - Sorts query parameters deterministically to avoid duplicate cache entries for different key orders
 */
export function normalizeCacheKey(url: URL, allowedParams?: string[]): string {
  const pathname = url.pathname;
  const searchParams = new URLSearchParams(url.search);

  const cleanParams = new URLSearchParams();
  const allowedSet = allowedParams ? new Set(allowedParams) : null;

  const sortedKeys = Array.from(searchParams.keys()).sort();
  for (const key of sortedKeys) {
    if (allowedSet) {
      if (allowedSet.has(key)) {
        for (const val of searchParams.getAll(key)) {
          cleanParams.append(key, val);
        }
      }
    } else if (!DEFAULT_TRACKING_PARAMS.has(key.toLowerCase()) && !key.toLowerCase().startsWith('utm_')) {
      for (const val of searchParams.getAll(key)) {
        cleanParams.append(key, val);
      }
    }
  }

  const queryStr = cleanParams.toString();
  return queryStr ? `${pathname}?${queryStr}` : pathname;
}

/**
 * In-memory Bounded LRU Cache with O(1) get/set and automatic eviction of least recently used entries.
 */
export class BoundedLruCache<V> {
  private map = new Map<string, V>();
  readonly maxEntries: number;

  constructor(maxEntries = 1000) {
    this.maxEntries = Math.max(1, maxEntries);
  }

  get(key: string): V | undefined {
    const val = this.map.get(key);
    if (val !== undefined) {
      // Re-insert to mark as most recently used (MRU)
      this.map.delete(key);
      this.map.set(key, val);
    }
    return val;
  }

  set(key: string, value: V): void {
    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.maxEntries) {
      // Evict least recently used (first key in map iteration order)
      const oldestKey = this.map.keys().next().value;
      if (oldestKey !== undefined) {
        this.map.delete(oldestKey);
      }
    }
    this.map.set(key, value);
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  delete(key: string): boolean {
    return this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }

  entries(): IterableIterator<[string, V]> {
    return this.map.entries();
  }

  values(): IterableIterator<V> {
    return this.map.values();
  }

  keys(): IterableIterator<string> {
    return this.map.keys();
  }

  [Symbol.iterator](): IterableIterator<[string, V]> {
    return this.map[Symbol.iterator]();
  }
}
