import { describe, expect, it } from 'bun:test';
import { createActionContext } from '../src/core/action-context';
import {
  discordOAuthPreset,
  fetchOAuthUserProfile,
  githubOAuthPreset,
  googleOAuthPreset
} from '../src/core/oauth-client';

describe('SynapseJS ctx.stream() and Multi-Provider OAuth', () => {
  it('creates an HTTP chunked streaming response from an async generator', async () => {
    const ctx = createActionContext({
      sliceOwner: 'ai/stream',
      session: {} as any,
      db: {} as any
    });

    async function* generateTokens() {
      yield 'Hello ';
      yield 'from ';
      yield 'SynapseJS ';
      yield 'Streaming!';
    }

    const response = ctx.stream(generateTokens, {
      contentType: 'text/event-stream'
    });

    expect(response).toBeInstanceOf(Response);
    expect(response.headers.get('Content-Type')).toBe('text/event-stream');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');

    const text = await response.text();
    expect(text).toBe('Hello from SynapseJS Streaming!');
  });

  it('handles Uint8Array chunks in ctx.stream() properly', async () => {
    const ctx = createActionContext({
      sliceOwner: 'audio/stream',
      session: {} as any,
      db: {} as any
    });

    const encoder = new TextEncoder();
    async function* generateBinary() {
      yield encoder.encode('Chunk 1;');
      yield encoder.encode('Chunk 2;');
    }

    const response = ctx.stream(generateBinary);
    const text = await response.text();
    expect(text).toBe('Chunk 1;Chunk 2;');
  });

  it('provides well-formed OAuth presets for Google, GitHub and Discord', () => {
    const google = googleOAuthPreset({
      clientId: 'google-client-id',
      clientSecret: 'google-secret',
      redirectUri: 'http://localhost:3000/_synapse/auth/google/callback'
    });
    expect(google.authorizationUrl).toContain('accounts.google.com');
    expect(google.tokenUrl).toContain('oauth2.googleapis.com');
    expect(google.scope).toContain('openid');

    const github = githubOAuthPreset({
      clientId: 'github-client-id',
      clientSecret: 'github-secret',
      redirectUri: 'http://localhost:3000/_synapse/auth/github/callback'
    });
    expect(github.authorizationUrl).toContain('github.com/login/oauth/authorize');
    expect(github.tokenUrl).toContain('github.com/login/oauth/access_token');

    const discord = discordOAuthPreset({
      clientId: 'discord-client-id',
      clientSecret: 'discord-secret',
      redirectUri: 'http://localhost:3000/_synapse/auth/discord/callback'
    });
    expect(discord.authorizationUrl).toContain('discord.com/api/oauth2/authorize');
    expect(discord.tokenUrl).toContain('discord.com/api/oauth2/token');
    expect(discord.scope).toContain('identify');
  });

  it('gracefully handles network error when fetching user profile with dummy token', async () => {
    const result = await fetchOAuthUserProfile('google', 'dummy_invalid_token');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('FETCH_PROFILE_FAILED');
    }
  });
});
