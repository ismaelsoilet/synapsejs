/**
 * SynapseJS - Isomorphic OAuth2 & PKCE (Proof Key for Code Exchange) Client
 *
 * Provides RFC 7636 compliant PKCE generators and standard authorization / token exchange
 * flows for Google, GitHub, Microsoft, and generic OAuth2/OIDC providers.
 */

import { Err, Ok, type Result } from './machine-types';

export interface PkceChallenge {
  codeVerifier: string;
  codeChallenge: string;
  codeChallengeMethod: 'S256';
}

/**
 * Generates a high-entropy cryptographic code verifier and SHA-256 code challenge (RFC 7636).
 */
export function generatePkceChallenge(): PkceChallenge {
  const randomBytes = new Uint8Array(32);
  crypto.getRandomValues(randomBytes);

  // Base64URL encoding without padding
  const codeVerifier = Buffer.from(randomBytes)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const hasher = new Bun.CryptoHasher('sha256');
  hasher.update(codeVerifier);
  const codeChallenge = hasher.digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  return {
    codeVerifier,
    codeChallenge,
    codeChallengeMethod: 'S256'
  };
}

export interface OAuthProviderConfig {
  clientId: string;
  clientSecret?: string;
  authorizationUrl: string;
  tokenUrl: string;
  redirectUri: string;
  scope: string[];
}

export interface BuildAuthUrlOptions {
  config: OAuthProviderConfig;
  state: string;
  codeChallenge?: string;
  extraParams?: Record<string, string>;
}

/**
 * Constructs standard OAuth2 authorization URL with PKCE parameters.
 */
export function buildOAuthAuthorizationUrl(options: BuildAuthUrlOptions): string {
  const url = new URL(options.config.authorizationUrl);
  url.searchParams.set('client_id', options.config.clientId);
  url.searchParams.set('redirect_uri', options.config.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', options.config.scope.join(' '));
  url.searchParams.set('state', options.state);

  if (options.codeChallenge) {
    url.searchParams.set('code_challenge', options.codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
  }

  if (options.extraParams) {
    for (const [key, value] of Object.entries(options.extraParams)) {
      url.searchParams.set(key, value);
    }
  }

  return url.toString();
}

export interface TokenExchangeOptions {
  config: OAuthProviderConfig;
  code: string;
  codeVerifier?: string;
  /** Maximum time to wait for the provider, in milliseconds (default: 10s). */
  timeoutMs?: number;
}

/** Generates an opaque, high-entropy OAuth `state` value. */
export function generateOAuthState(): string {
  const randomBytes = new Uint8Array(32);
  crypto.getRandomValues(randomBytes);

  return Buffer.from(randomBytes).toString('base64url');
}

/** Constant-time comparison of the state emitted by the server and the value returned. */
export function verifyOAuthState(expected: string, received: string | null | undefined): boolean {
  if (!expected || !received) {
    return false;
  }

  const expectedBuf = Buffer.from(expected);
  const receivedBuf = Buffer.from(received);

  if (expectedBuf.length !== receivedBuf.length) {
    return false;
  }

  return require('node:crypto').timingSafeEqual(expectedBuf, receivedBuf);
}

export interface OAuthTokenResponse {
  accessToken: string;
  tokenType: string;
  expiresIn?: number;
  refreshToken?: string;
  scope?: string;
  idToken?: string;
  raw: Record<string, unknown>;
}

/**
 * Exchanges authorization code for access tokens via standard HTTP POST.
 */
export async function exchangeOAuthCode(
  options: TokenExchangeOptions
): Promise<Result<OAuthTokenResponse, 'TOKEN_EXCHANGE_FAILED' | 'NETWORK_ERROR'>> {
  const bodyParams = new URLSearchParams();
  bodyParams.set('client_id', options.config.clientId);
  bodyParams.set('code', options.code);
  bodyParams.set('redirect_uri', options.config.redirectUri);
  bodyParams.set('grant_type', 'authorization_code');

  if (options.config.clientSecret) {
    bodyParams.set('client_secret', options.config.clientSecret);
  }

  if (options.codeVerifier) {
    bodyParams.set('code_verifier', options.codeVerifier);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000);

  try {
    const response = await fetch(options.config.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json'
      },
      body: bodyParams.toString(),
      signal: controller.signal
    });

    if (!response.ok) {
      return Err('TOKEN_EXCHANGE_FAILED');
    }

    const data = (await response.json()) as Record<string, unknown>;
    const accessToken = String(data.access_token || data.accessToken || '');

    if (!accessToken) {
      return Err('TOKEN_EXCHANGE_FAILED');
    }

    return Ok({
      accessToken,
      tokenType: String(data.token_type || data.tokenType || 'Bearer'),
      expiresIn: typeof data.expires_in === 'number' ? data.expires_in : undefined,
      refreshToken: typeof data.refresh_token === 'string' ? data.refresh_token : undefined,
      scope: typeof data.scope === 'string' ? data.scope : undefined,
      idToken: typeof data.id_token === 'string' ? data.id_token : undefined,
      raw: data
    });
  } catch {
    return Err('NETWORK_ERROR');
  } finally {
    clearTimeout(timeout);
  }
}

// ============================================================================
// OAUTH PROVIDER PRESETS & UNIFIED USER PROFILE
// ============================================================================
export interface OAuthUserProfile {
  id: string;
  email?: string;
  name?: string;
  avatarUrl?: string;
  provider: 'google' | 'github' | 'discord' | 'oidc';
  raw: Record<string, unknown>;
}

export function googleOAuthPreset(options: {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): OAuthProviderConfig {
  return {
    clientId: options.clientId,
    clientSecret: options.clientSecret,
    authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    redirectUri: options.redirectUri,
    scope: ['openid', 'email', 'profile']
  };
}

export function githubOAuthPreset(options: {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): OAuthProviderConfig {
  return {
    clientId: options.clientId,
    clientSecret: options.clientSecret,
    authorizationUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    redirectUri: options.redirectUri,
    scope: ['read:user', 'user:email']
  };
}

export function discordOAuthPreset(options: {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): OAuthProviderConfig {
  return {
    clientId: options.clientId,
    clientSecret: options.clientSecret,
    authorizationUrl: 'https://discord.com/api/oauth2/authorize',
    tokenUrl: 'https://discord.com/api/oauth2/token',
    redirectUri: options.redirectUri,
    scope: ['identify', 'email']
  };
}

export async function fetchOAuthUserProfile(
  provider: 'google' | 'github' | 'discord' | 'oidc',
  accessToken: string,
  userInfoUrl?: string
): Promise<Result<OAuthUserProfile, 'FETCH_PROFILE_FAILED'>> {
  const url =
    userInfoUrl ||
    (provider === 'google'
      ? 'https://openidconnect.googleapis.com/v1/userinfo'
      : provider === 'github'
        ? 'https://api.github.com/user'
        : provider === 'discord'
          ? 'https://discord.com/api/users/@me'
          : null);

  if (!url) {
    return Err('FETCH_PROFILE_FAILED');
  }

  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        'User-Agent': 'SynapseJS'
      }
    });

    if (!res.ok) {
      return Err('FETCH_PROFILE_FAILED');
    }

    const data = (await res.json()) as Record<string, unknown>;
    let id = '';
    let email: string | undefined;
    let name: string | undefined;
    let avatarUrl: string | undefined;

    if (provider === 'google') {
      id = String(data.sub || data.id || '');
      email = typeof data.email === 'string' ? data.email : undefined;
      name = typeof data.name === 'string' ? data.name : undefined;
      avatarUrl = typeof data.picture === 'string' ? data.picture : undefined;
    } else if (provider === 'github') {
      id = String(data.id || '');
      email = typeof data.email === 'string' ? data.email : undefined;
      name = typeof data.name === 'string' ? data.name : typeof data.login === 'string' ? data.login : undefined;
      avatarUrl = typeof data.avatar_url === 'string' ? data.avatar_url : undefined;
    } else if (provider === 'discord') {
      id = String(data.id || '');
      email = typeof data.email === 'string' ? data.email : undefined;
      name =
        typeof data.global_name === 'string'
          ? data.global_name
          : typeof data.username === 'string'
            ? data.username
            : undefined;
      avatarUrl = data.avatar ? `https://cdn.discordapp.com/avatars/${id}/${data.avatar}.png` : undefined;
    } else {
      id = String(data.sub || data.id || '');
      email = typeof data.email === 'string' ? data.email : undefined;
      name = typeof data.name === 'string' ? data.name : undefined;
      avatarUrl = typeof data.picture === 'string' ? data.picture : undefined;
    }

    if (!id) {
      return Err('FETCH_PROFILE_FAILED');
    }

    return Ok({
      id,
      email,
      name,
      avatarUrl,
      provider,
      raw: data
    });
  } catch {
    return Err('FETCH_PROFILE_FAILED');
  }
}
