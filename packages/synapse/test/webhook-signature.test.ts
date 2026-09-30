import { describe, expect, it } from 'bun:test';
import * as crypto from 'crypto';
import {
  constantTimeEquals,
  signWebhookPayload,
  verifyWebhookSignature,
  WebhookReplayGuard
} from '../src/core/webhook-signature';

describe('webhook signature verification', () => {
  const secret = 'segredo-de-webhook';
  const body = new TextEncoder().encode(JSON.stringify({ id: 'evt-1', amountCents: 1200 }));
  const timestamp = 1_700_000_000;

  it('matches an independent HMAC recomputation over `<timestamp>.<body>`', () => {
    const expected = crypto
      .createHmac('sha256', secret)
      .update(Buffer.concat([Buffer.from(`${timestamp}.`, 'utf-8'), Buffer.from(body)]))
      .digest('hex');

    expect(signWebhookPayload(secret, timestamp, body)).toBe(expected);
  });

  it('accepts a correct signature inside the window and refuses a tampered body', () => {
    const signature = signWebhookPayload(secret, timestamp, body);

    const accepted = verifyWebhookSignature({
      payload: body,
      signature,
      secret,
      timestamp,
      nowSeconds: timestamp + 10
    });
    expect(accepted.ok).toBe(true);

    const tampered = verifyWebhookSignature({
      payload: new TextEncoder().encode(JSON.stringify({ id: 'evt-1', amountCents: 999_999 })),
      signature,
      secret,
      timestamp,
      nowSeconds: timestamp + 10
    });
    expect(tampered.ok).toBe(false);
    if (!tampered.ok) {
      expect(tampered.error).toBe('INVALID_SIGNATURE');
    }
  });

  it('refuses a signature computed with a different secret', () => {
    const otherSecret = signWebhookPayload('outro-segredo', timestamp, body);

    const result = verifyWebhookSignature({
      payload: body,
      signature: otherSecret,
      secret,
      timestamp,
      nowSeconds: timestamp
    });

    expect(result.ok).toBe(false);
  });

  it('refuses a correct signature outside the tolerance window', () => {
    const signature = signWebhookPayload(secret, timestamp, body);

    const result = verifyWebhookSignature({
      payload: body,
      signature,
      secret,
      timestamp,
      toleranceSeconds: 300,
      nowSeconds: timestamp + 3600
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('TIMESTAMP_OUT_OF_WINDOW');
    }
  });

  it('compares in constant time without leaking length differences', () => {
    expect(constantTimeEquals('abc', 'abc')).toBe(true);
    expect(constantTimeEquals('abc', 'abd')).toBe(false);
    expect(constantTimeEquals('abc', 'abcd')).toBe(false);
    expect(constantTimeEquals('', 'a')).toBe(false);
  });
});

describe('webhook replay guard', () => {
  it('accepts a signature once and refuses the replay inside the window', () => {
    const guard = new WebhookReplayGuard({ ttlSeconds: 300 });

    expect(guard.accept('sig-1', 1000)).toBe(true);
    expect(guard.accept('sig-1', 1001)).toBe(false);
    expect(guard.accept('sig-2', 1001)).toBe(true);
  });

  it('forgets a signature once the window has elapsed', () => {
    const guard = new WebhookReplayGuard({ ttlSeconds: 10 });

    expect(guard.accept('sig-1', 1000)).toBe(true);
    expect(guard.isFresh('sig-1', 1005)).toBe(false);
    expect(guard.prune(1020)).toBe(1);
    expect(guard.isFresh('sig-1', 1020)).toBe(true);
  });

  it('stays bounded when deliveries keep arriving', () => {
    const guard = new WebhookReplayGuard({ ttlSeconds: 3600, maxEntries: 50 });

    for (let index = 0; index < 500; index++) {
      guard.accept(`sig-${index}`, 1000 + index);
    }

    expect(guard.size).toBeLessThanOrEqual(50);
  });
});
