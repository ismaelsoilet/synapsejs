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

  it('streams through a real HTTP server', async () => {
    const ctx = createActionContext({
      sliceOwner: 'ai/http-stream',
      session: {} as any,
      db: {} as any
    });

    const server = Bun.serve({
      port: 0,
      fetch: () =>
        ctx.stream(
          async function* () {
            yield 'first;';
            yield 'second;';
          },
          { contentType: 'text/plain' }
        )
    });

    try {
      const response = await fetch(`http://localhost:${server.port}/`);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/plain');
      expect(await response.text()).toBe('first;second;');
    } finally {
      await server.stop(true);
    }
  });

  it('normalizes Google, GitHub and Discord profiles from a local stub', async () => {
    const server = Bun.serve({
      port: 0,
      fetch: (request) => {
        const path = new URL(request.url).pathname;
        if (path === '/google') {
          return Response.json({ sub: 'g-1', email: 'g@example.com', name: 'Google User', picture: 'https://x/g.png' });
        }
        if (path === '/github') {
          return Response.json({ id: 42, email: 'gh@example.com', login: 'octo', avatar_url: 'https://x/gh.png' });
        }
        return Response.json({ id: 'd-1', email: 'd@example.com', global_name: 'Discord User', avatar: 'abc' });
      }
    });

    try {
      const google = await fetchOAuthUserProfile('google', 'token', `http://localhost:${server.port}/google`);
      const github = await fetchOAuthUserProfile('github', 'token', `http://localhost:${server.port}/github`);
      const discord = await fetchOAuthUserProfile('discord', 'token', `http://localhost:${server.port}/discord`);

      expect(google.ok).toBe(true);
      if (google.ok) {
        expect(google.value).toMatchObject({ id: 'g-1', name: 'Google User', provider: 'google' });
      }

      expect(github.ok).toBe(true);
      if (github.ok) {
        expect(github.value).toMatchObject({ id: '42', name: 'octo', provider: 'github' });
      }

      expect(discord.ok).toBe(true);
      if (discord.ok) {
        expect(discord.value).toMatchObject({ id: 'd-1', name: 'Discord User', provider: 'discord' });
        expect(discord.value.avatarUrl).toContain('cdn.discordapp.com');
      }
    } finally {
      await server.stop(true);
    }
  });

  it('gracefully handles network error when fetching user profile with dummy token', async () => {
    const result = await fetchOAuthUserProfile('google', 'dummy_invalid_token');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('FETCH_PROFILE_FAILED');
    }
  });
});
