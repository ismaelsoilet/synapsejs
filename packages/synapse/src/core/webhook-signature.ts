/**
 * SynapseJS - Webhook Signature Verification
 *
 * A webhook endpoint is a public write surface, so the framework ships the two
 * primitives a receiver needs to treat it as one: a constant-time comparison of the
 * provider's signature over the raw body, and a bounded replay window so a captured
 * delivery cannot be replayed. Verifying a signature is not enough on its own — a
 * valid signature stays valid forever unless the receiver also tracks what it has
 * already accepted.
 */

import * as crypto from 'crypto';
import { Err, Ok, type Result } from './machine-types';

export type WebhookSignatureError = 'INVALID_SIGNATURE' | 'TIMESTAMP_OUT_OF_WINDOW' | 'REPLAYED_DELIVERY';

/** Compares two strings without leaking their difference through timing. */
export function constantTimeEquals(left: string, right: string): boolean {
  const a = Buffer.from(left, 'utf-8');
  const b = Buffer.from(right, 'utf-8');

  if (a.length !== b.length) {
    // Still perform a comparison of equal length so the failure is not timing-visible.
    const padded = Buffer.alloc(a.length);
    crypto.timingSafeEqual(a, padded);

    return false;
  }

  return crypto.timingSafeEqual(a, b);
}

/** The canonical signed value: `<timestamp>.<raw body>`. */
export function signedPayload(timestampSeconds: number, payload: Uint8Array): Buffer {
  return Buffer.concat([Buffer.from(`${timestampSeconds}.`, 'utf-8'), Buffer.from(payload)]);
}

/** HMAC-SHA256 of `<timestamp>.<body>`, hex encoded — the shape providers send. */
export function signWebhookPayload(secret: string, timestampSeconds: number, payload: Uint8Array): string {
  return crypto.createHmac('sha256', secret).update(signedPayload(timestampSeconds, payload)).digest('hex');
}

export interface VerifyWebhookOptions {
  /** The raw request body, byte for byte — a re-serialized JSON body will not verify. */
  payload: Uint8Array;
  /** The signature the provider sent (hex, `sha256=...` accepted). */
  signature: string;
  secret: string;
  /** The provider's delivery timestamp, in seconds. */
  timestamp: number;
  /** How far from now a delivery may be, in seconds (default: 300). */
  toleranceSeconds?: number;
  /** Injected for tests. */
  nowSeconds?: number;
}

/**
 * Verifies the signature and the delivery window. A signature that matches but whose
 * timestamp is outside the tolerance is refused: otherwise a captured delivery stays
 * valid forever.
 */
export function verifyWebhookSignature(options: VerifyWebhookOptions): Result<true, WebhookSignatureError> {
  const tolerance = options.toleranceSeconds ?? 300;
  const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  const provided = options.signature.replace(/^sha256=/i, '').trim();

  if (!Number.isFinite(options.timestamp) || Math.abs(now - options.timestamp) > tolerance) {
    return Err('TIMESTAMP_OUT_OF_WINDOW');
  }

  const expected = signWebhookPayload(options.secret, options.timestamp, options.payload);

  return constantTimeEquals(expected, provided) ? Ok(true) : Err('INVALID_SIGNATURE');
}

export interface ReplayGuardOptions {
  /** How long a signature stays in the window, in seconds (default: 300). */
  ttlSeconds?: number;
  /** Maximum tracked signatures (default: 10,000). */
  maxEntries?: number;
}

/**
 * Remembers which signatures have already been accepted, bounded by a time-to-live
 * and an entry cap so a flood of deliveries cannot grow the store without bound.
 */
export class WebhookReplayGuard {
  private readonly ttlSeconds: number;
  private readonly maxEntries: number;
  private accepted = new Map<string, number>();

  constructor(options: ReplayGuardOptions = {}) {
    this.ttlSeconds = options.ttlSeconds ?? 300;
    this.maxEntries = options.maxEntries ?? 10_000;
  }

  /** True when this signature has not been accepted inside the window. */
  isFresh(signature: string, nowSeconds?: number): boolean {
    const now = nowSeconds ?? Math.floor(Date.now() / 1000);
    this.prune(now);

    return !this.accepted.has(signature);
  }

  /** Records a signature as accepted. Returns false when it was already inside the window. */
  accept(signature: string, nowSeconds?: number): boolean {
    const now = nowSeconds ?? Math.floor(Date.now() / 1000);
    this.prune(now);

    if (this.accepted.has(signature)) {
      return false;
    }

    while (this.accepted.size >= this.maxEntries) {
      const oldest = this.accepted.keys().next().value;

      if (oldest === undefined) {
        break;
      }

      this.accepted.delete(oldest);
    }

    this.accepted.set(signature, now);

    return true;
  }

  /** Drops entries older than the window. Returns how many were removed. */
  prune(nowSeconds?: number): number {
    const now = nowSeconds ?? Math.floor(Date.now() / 1000);
    let pruned = 0;

    for (const [signature, acceptedAt] of this.accepted) {
      if (now - acceptedAt > this.ttlSeconds) {
        this.accepted.delete(signature);
        pruned++;
      }
    }

    return pruned;
  }

  get size(): number {
    return this.accepted.size;
  }

  clear(): void {
    this.accepted.clear();
  }
}
