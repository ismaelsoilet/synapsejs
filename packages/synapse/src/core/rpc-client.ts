/**
 * SynapseJS - Transparent RPC Client
 *
 * Consumed by generated client-side stubs. Keeps the zero-throw contract across
 * the network boundary: a malformed or unreachable RPC becomes an Err value
 * instead of an exception, and never a business error the caller must guess.
 */

import { Err } from './machine-types';

export type RpcTransportError = 'RPC_MALFORMED' | 'RPC_UNREACHABLE';

/**
 * Transport-level failure, deliberately outside the slice's domain error union:
 * a broken response is not a business outcome.
 */
export function rpcTransportFailure<R>(error: RpcTransportError): R {
  return Err(error) as R;
}

function browserCredentials(): Record<string, string> {
  const scope = globalThis as { document?: { cookie?: string } };
  const cookie = scope.document?.cookie;

  if (!cookie) {
    return {};
  }

  const readCookie = (name: string): string | null => {
    const entry = cookie.split('; ').find((item) => item.startsWith(`${name}=`));
    return entry ? decodeURIComponent(entry.slice(name.length + 1)) : null;
  };

  const headers: Record<string, string> = {};
  const token = readCookie('synapse_token');
  const roles = readCookie('synapse_roles');
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  if (roles) {
    headers['x-user-roles'] = roles;
  }

  return headers;
}

/**
 * Calls a slice RPC endpoint and returns its Result payload verbatim.
 * The response is shape-checked: anything without the `ok` discriminant is a
 * transport failure rather than a value the caller would silently accept.
 */
export async function rpcCall<R>(endpoint: string, payload: unknown): Promise<R> {
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...browserCredentials() },
      body: JSON.stringify(payload)
    });

    const data = (await response.json().catch(() => null)) as unknown;

    if (!data || typeof data !== 'object' || !('ok' in data)) {
      return rpcTransportFailure<R>('RPC_MALFORMED');
    }

    return data as R;
  } catch {
    return rpcTransportFailure<R>('RPC_UNREACHABLE');
  }
}
