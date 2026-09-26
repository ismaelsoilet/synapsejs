import { afterEach, describe, expect, it } from 'bun:test';
import { rpcCall, rpcTransportFailure } from '../src/core/rpc-client';

interface FakeDocument {
  cookie: string;
}

interface CapturedRequest {
  url: string;
  method: string | undefined;
  headers: Record<string, string>;
  body: unknown;
}

const originalFetch = globalThis.fetch;
const originalDocument = (globalThis as { document?: FakeDocument }).document;

let calls: CapturedRequest[] = [];

function capture(url: string, init?: RequestInit): void {
  calls.push({
    url,
    method: init?.method,
    headers: Object.fromEntries(new Headers(init?.headers as HeadersInit).entries()),
    body: init?.body
  });
}

function stubFetch(responder: (url: string) => Response): void {
  calls = [];
  globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
    const target = String(url);
    capture(target, init);
    return Promise.resolve(responder(target));
  }) as unknown as typeof fetch;
}

function withCookies(cookie: string): void {
  (globalThis as { document?: FakeDocument }).document = { cookie };
}

afterEach(() => {
  globalThis.fetch = originalFetch;

  if (originalDocument === undefined) {
    delete (globalThis as { document?: FakeDocument }).document;
  } else {
    (globalThis as { document?: FakeDocument }).document = originalDocument;
  }
});

describe('rpcCall', () => {
  it('posts JSON to the endpoint and returns the Result verbatim', async () => {
    stubFetch(() => new Response(JSON.stringify({ ok: true, value: { id: 'inv-1' } }), { status: 200 }));

    const result = await rpcCall<{ ok: true; value: { id: string } }>('/_synapse/rpc/billing/generate-invoice', {
      amountCents: 100
    });

    expect(result).toEqual({ ok: true, value: { id: 'inv-1' } });
    expect(calls[0].url).toBe('/_synapse/rpc/billing/generate-invoice');
    expect(calls[0].method).toBe('POST');
    expect(calls[0].headers['content-type']).toBe('application/json');
    expect(calls[0].body).toBe(JSON.stringify({ amountCents: 100 }));
  });

  it('returns a business error as it came, without inventing a transport error', async () => {
    stubFetch(() => new Response(JSON.stringify({ ok: false, error: 'CUSTOMER_NOT_FOUND' }), { status: 404 }));

    const result = await rpcCall<{ ok: false; error: string }>('/_synapse/rpc/x/y', {});

    expect(result.ok).toBe(false);
    expect(result.error).toBe('CUSTOMER_NOT_FOUND');
  });

  it('treats a response without the ok discriminant as RPC_MALFORMED', async () => {
    stubFetch(() => new Response('<html>erro 500</html>', { status: 500 }));

    const result = await rpcCall<{ ok: false; error: string }>('/_synapse/rpc/x/y', {});

    expect(result).toEqual({ ok: false, error: 'RPC_MALFORMED' });
  });

  it('treats an unreachable server as RPC_UNREACHABLE instead of throwing', async () => {
    calls = [];
    globalThis.fetch = (() => Promise.reject(new TypeError('Failed to fetch'))) as unknown as typeof fetch;

    const result = await rpcCall<{ ok: false; error: string }>('/_synapse/rpc/x/y', {});

    expect(result).toEqual({ ok: false, error: 'RPC_UNREACHABLE' });
  });

  it('reads the session cookies and sends them as the headers the server understands', async () => {
    withCookies('outro=1; synapse_token=abc.def%20ghi; synapse_roles=admin,billing');
    stubFetch(() => new Response(JSON.stringify({ ok: true, value: null }), { status: 200 }));

    await rpcCall('/_synapse/rpc/x/y', {});

    expect(calls[0].headers.authorization).toBe('Bearer abc.def ghi');
    expect(calls[0].headers['x-user-roles']).toBe('admin,billing');
  });

  it('sends no credentials on the server, where there is no document', async () => {
    delete (globalThis as { document?: FakeDocument }).document;
    stubFetch(() => new Response(JSON.stringify({ ok: true, value: null }), { status: 200 }));

    await rpcCall('/_synapse/rpc/x/y', {});

    expect(Object.keys(calls[0].headers)).not.toContain('authorization');
    expect(Object.keys(calls[0].headers)).not.toContain('x-user-roles');
  });
});

describe('rpcTransportFailure', () => {
  it('produces the same shape a slice action would, so callers never branch on transport', () => {
    expect(rpcTransportFailure<{ ok: false; error: string }>('RPC_UNREACHABLE')).toEqual({
      ok: false,
      error: 'RPC_UNREACHABLE'
    });
  });
});
