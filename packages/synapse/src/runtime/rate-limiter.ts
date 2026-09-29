/**
 * SynapseJS - Native Token Bucket Rate Limiter
 *
 * Provides in-memory sliding token bucket rate limiting to protect RPC,
 * Webhooks, and API endpoints against DoS, brute-force, and noisy neighbors.
 *
 * Implements RFC 6585 standard headers:
 * - Retry-After
 * - X-RateLimit-Limit
 * - X-RateLimit-Remaining
 * - X-RateLimit-Reset
 */

export interface RateLimitOptions {
  /** Maximum burst capacity (default: 150) */
  capacity?: number;
  /** Refill rate in tokens per second (default: 100) */
  refillRate?: number;
  /** Inactivity window in ms before bucket is evicted (default: 60,000ms = 1m) */
  idleTimeoutMs?: number;
  /** Maximum tracked buckets in memory before LRU eviction (default: 10,000) */
  maxBuckets?: number;
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetMs: number;
}

interface Bucket {
  tokens: number;
  lastRefill: number;
  lastAccess: number;
}

export class TokenBucketRateLimiter {
  private capacity: number;
  private refillRate: number;
  private idleTimeoutMs: number;
  private maxBuckets: number;
  private buckets: Map<string, Bucket> = new Map();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: RateLimitOptions = {}) {
    const envRps = Number(process.env.SYNAPSE_RATE_LIMIT_RPS);
    const envBurst = Number(process.env.SYNAPSE_RATE_LIMIT_BURST);

    this.refillRate = options.refillRate ?? (Number.isFinite(envRps) && envRps > 0 ? envRps : 100);
    this.capacity = options.capacity ?? (Number.isFinite(envBurst) && envBurst > 0 ? envBurst : 150);
    this.idleTimeoutMs = options.idleTimeoutMs ?? 60_000;
    this.maxBuckets = options.maxBuckets ?? 10_000;

    // Run background prune of idle buckets every minute
    this.cleanupTimer = setInterval(() => this.pruneIdleBuckets(), this.idleTimeoutMs);
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  /**
   * Consumes `cost` tokens from the bucket for `key`.
   */
  consume(key: string, cost = 1): RateLimitResult {
    const now = Date.now();
    let bucket = this.buckets.get(key);

    if (!bucket) {
      if (this.buckets.size >= this.maxBuckets) {
        const oldest = this.buckets.keys().next().value;
        if (oldest !== undefined) {
          this.buckets.delete(oldest);
        }
      }
      bucket = {
        tokens: this.capacity,
        lastRefill: now,
        lastAccess: now
      };
      this.buckets.set(key, bucket);
    } else {
      // Move to end to track recency (LRU)
      this.buckets.delete(key);
      this.buckets.set(key, bucket);
    }

    // Refill tokens based on elapsed time
    const elapsedSeconds = (now - bucket.lastRefill) / 1000;
    if (elapsedSeconds > 0) {
      bucket.tokens = Math.min(this.capacity, bucket.tokens + elapsedSeconds * this.refillRate);
      bucket.lastRefill = now;
    }
    bucket.lastAccess = now;

    if (bucket.tokens >= cost) {
      bucket.tokens -= cost;
      const remaining = Math.floor(bucket.tokens);
      const resetMs = Math.ceil(((this.capacity - bucket.tokens) / this.refillRate) * 1000);

      return {
        allowed: true,
        limit: this.capacity,
        remaining,
        resetMs: Math.max(0, resetMs)
      };
    }

    // Insufficient tokens: calculate wait time
    const deficit = cost - bucket.tokens;
    const resetMs = Math.ceil((deficit / this.refillRate) * 1000);

    return {
      allowed: false,
      limit: this.capacity,
      remaining: 0,
      resetMs: Math.max(100, resetMs)
    };
  }

  /**
   * Resets rate limit for a specific key, or all keys.
   */
  reset(key?: string): void {
    if (key) {
      this.buckets.delete(key);
    } else {
      this.buckets.clear();
    }
  }

  /**
   * Evicts buckets that haven't been accessed for `idleTimeoutMs`.
   */
  pruneIdleBuckets(): number {
    const now = Date.now();
    let evicted = 0;

    for (const [key, bucket] of this.buckets.entries()) {
      if (now - bucket.lastAccess > this.idleTimeoutMs && bucket.tokens >= this.capacity - 0.001) {
        this.buckets.delete(key);
        evicted++;
      }
    }

    return evicted;
  }

  /**
   * Returns current active bucket count.
   */
  get activeKeysCount(): number {
    return this.buckets.size;
  }

  /**
   * Stops background cleanup timer.
   */
  close(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.buckets.clear();
  }
}
