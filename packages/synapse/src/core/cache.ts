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
}

/**
 * Declares SSR caching and ISR revalidation policy for a slice.
 */
export function defineCache(config: SliceCacheConfig): SliceCacheConfig {
  return config;
}
