import dns from 'node:dns';
import net from 'node:net';

/**
 * Checks whether an IP address (IPv4 or IPv6) belongs to a private, loopback,
 * link-local, or cloud-provider metadata address space.
 */
export function isPrivateOrReservedIp(ip: string): boolean {
  const version = net.isIP(ip);
  if (version === 0) {
    return false;
  }

  if (version === 4) {
    const parts = ip.split('.').map((p) => parseInt(p, 10));
    if (parts.length !== 4 || parts.some(isNaN)) return true;

    const [a, b] = parts;

    // 0.0.0.0/8 (Broadcast/Current network)
    if (a === 0) return true;

    // 10.0.0.0/8 (Private)
    if (a === 10) return true;

    // 100.64.0.0/10 (Carrier-grade NAT)
    if (a === 100 && b >= 64 && b <= 127) return true;

    // 127.0.0.0/8 (Loopback)
    if (a === 127) return true;

    // 169.254.0.0/16 (Link-local & Cloud Metadata: AWS, GCP, Azure, DO)
    if (a === 169 && b === 254) return true;

    // 172.16.0.0/12 (Private)
    if (a === 172 && b >= 16 && b <= 31) return true;

    // 192.0.0.0/24 (IETF Protocol Assignments)
    // 192.0.2.0/24 (TEST-NET-1)
    if (a === 192 && b === 0) return true;

    // 192.168.0.0/16 (Private)
    if (a === 192 && b === 168) return true;

    // 198.18.0.0/15 (Benchmarking)
    if (a === 198 && (b === 18 || b === 19)) return true;

    // 198.51.100.0/24 (TEST-NET-2)
    if (a === 198 && b === 51) return true;

    // 203.0.113.0/24 (TEST-NET-3)
    if (a === 203 && b === 0) return true;

    // 224.0.0.0/4 (Multicast) & 240.0.0.0/4 (Reserved)
    if (a >= 224) return true;

    return false;
  }

  // IPv6 checks
  const normalized = ip.toLowerCase();

  // ::1 (Loopback)
  if (normalized === '::1' || normalized === '0:0:0:0:0:0:0:1') return true;

  // :: (Unspecified)
  if (normalized === '::' || normalized === '0:0:0:0:0:0:0:0') return true;

  // IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1)
  if (normalized.startsWith('::ffff:')) {
    const v4Part = normalized.slice(7);
    if (net.isIPv4(v4Part)) {
      return isPrivateOrReservedIp(v4Part);
    }
  }

  // fc00::/7 (Unique Local Address ULA)
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;

  // fe80::/10 (Link-Local Unicast)
  if (/^fe[89ab]/.test(normalized)) return true;

  // ff00::/8 (Multicast)
  if (normalized.startsWith('ff')) return true;

  return false;
}

export interface ValidateUrlOptions {
  allowedDomains?: string[];
  allowLocalhost?: boolean;
}

export interface ValidateUrlResult {
  ok: boolean;
  error?: string;
  resolvedIp?: string;
}

/**
 * Validates a remote URL against SSRF vulnerabilities:
 * - Scheme must be http or https
 * - Hostname cannot be localhost or known cloud metadata domains (unless allowLocalhost is true)
 * - Domain must match allowedDomains list if specified
 * - Pre-resolves DNS to ensure target IP is not private, loopback, or cloud metadata
 */
export async function validateExternalUrl(
  rawUrl: string,
  options: ValidateUrlOptions = {}
): Promise<ValidateUrlResult> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false, error: 'INVALID_URL' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, error: 'INVALID_PROTOCOL' };
  }

  const hostname = parsed.hostname.toLowerCase();

  // Disallow user/password in URL for SSRF protection
  if (parsed.username || parsed.password) {
    return { ok: false, error: 'CREDENTIALS_IN_URL_FORBIDDEN' };
  }

  // Common metadata and internal hosts
  if (
    hostname === 'metadata.google.internal' ||
    hostname === 'instance-data' ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.local')
  ) {
    return { ok: false, error: 'FORBIDDEN_METADATA_HOST' };
  }

  if (!options.allowLocalhost && (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1')) {
    return { ok: false, error: 'LOOPBACK_FORBIDDEN' };
  }

  // Allowed domains enforcement
  if (options.allowedDomains && options.allowedDomains.length > 0) {
    const isAllowed = options.allowedDomains.some((d) => {
      const dom = d.toLowerCase().trim();
      return hostname === dom || hostname.endsWith(`.${dom}`);
    });
    if (!isAllowed) {
      return { ok: false, error: 'DOMAIN_NOT_ALLOWED' };
    }
  }

  // If hostname is directly an IP literal
  if (net.isIP(hostname)) {
    if (!options.allowLocalhost && isPrivateOrReservedIp(hostname)) {
      return { ok: false, error: 'FORBIDDEN_TARGET_IP', resolvedIp: hostname };
    }
    return { ok: true, resolvedIp: hostname };
  }

  // DNS Pre-check to prevent DNS rebinding
  try {
    const records = await dns.promises.lookup(hostname, { all: true });
    if (!records || records.length === 0) {
      return { ok: false, error: 'DNS_LOOKUP_EMPTY' };
    }

    for (const record of records) {
      if (!options.allowLocalhost && isPrivateOrReservedIp(record.address)) {
        return { ok: false, error: 'FORBIDDEN_TARGET_IP', resolvedIp: record.address };
      }
    }

    return { ok: true, resolvedIp: records[0].address };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `DNS_LOOKUP_FAILED: ${message}` };
  }
}
