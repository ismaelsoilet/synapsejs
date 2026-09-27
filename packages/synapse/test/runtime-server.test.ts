import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { buildAllClientBundles } from '../src/compiler/client-bundler';
import { signSessionToken } from '../src/core/session-token';
import { CLIENT_ROOT_ID } from '../src/runtime/client-entry';
import { formatLogLine, httpStatusForError, SynapseServer } from '../src/runtime/server';

const appDir = path.resolve(import.meta.dir, 'fixtures', 'runtime-app');

let server: { port: number; stop: () => void };
let base: string;

beforeAll(async () => {
  const synapse = new SynapseServer(appDir, 0);
  await synapse.discoverSlices();
  server = (await synapse.start()) as unknown as { port: number; stop: () => void };
  base = `http://localhost:${server.port}`;
});

afterAll(() => {
  server?.stop();
});

describe('slice loaders', () => {
  it('renders the data the loader fetched, not a hardcoded prop', async () => {
    const response = await fetch(`${base}/tickets/view-tickets?marker=42`);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain('LOADER-TICKETS-42');
  });

  it('passes the query string to the loader', async () => {
    const html = await (await fetch(`${base}/billing/view-tickets`)).text();

    expect(html).toContain('billing');
  });

  it('renders a loader failure in the page instead of a blank screen', async () => {
    const html = await (await fetch(`${base}/tickets/view-tickets?fail=1`)).text();

    expect(html).toContain('Falha no loader de tickets/view-tickets');
    expect(html).toContain('loader falhou de proposito');
  });
});

describe('client hydration', () => {
  let pageHtml = '';

  it('serves props for hydration and the generated client entry', async () => {
    pageHtml = await (await fetch(`${base}/tickets/view-tickets?marker=7`)).text();

    expect(pageHtml).toContain('globalThis.__SYNAPSE_PROPS__ = ');
    // O id que a entrada de cliente procura tem que ser o id que o servidor renderiza.
    expect(pageHtml).toContain(`id="${CLIENT_ROOT_ID}"`);
    expect(pageHtml).toContain('LOADER-TICKETS-7');
    expect(pageHtml).toMatch(
      /<script type="module" src="\/_synapse\/client\/[^"]+"[^>]*><\/script>| <script type="module"/
    );
  });

  it('no longer ships the inline form script that competed with React', () => {
    expect(pageHtml).not.toContain('addEventListener');
  });

  it('serves a real bundle for the slice', async () => {
    const match = pageHtml.match(/src="(\/_synapse\/client\/[^"]+)"/);
    expect(match).not.toBeNull();

    const bundleUrl = (match as RegExpMatchArray)[1];
    const response = await fetch(`${base}${bundleUrl}`);
    const code = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('javascript');
    // Nomes somem na minificação; o que prova o bundle é o código do componente
    // estar lá e o SQL não estar.
    expect(code).toContain('sem dados do loader');
    expect(code).not.toMatch(/SELECT\s+[\w*"`][\w*"`.,\s]*\bFROM\b/i);
    expect(code).not.toContain('INSERT INTO');
  });

  it('answers 404 for a bundle that does not exist', async () => {
    const response = await fetch(`${base}/_synapse/client/nao-existe.js`);
    expect(response.status).toBe(404);
  });
});

describe('RPC dispatch', () => {
  it('resolves a slice by <domain>/<name>', async () => {
    const response = await fetch(`${base}/_synapse/rpc/tickets/view-tickets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, value: { marker: 'RPC-TICKETS-ok' } });
  });

  it('refuses an ambiguous bare name with 409 instead of guessing', async () => {
    const response = await fetch(`${base}/_synapse/rpc/view-tickets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });

    const payload = (await response.json()) as { error: string };
    expect(response.status).toBe(409);
    expect(payload.error).toContain('ambíguo');
    expect(payload.error).toContain('tickets/view-tickets');
    expect(payload.error).toContain('billing/view-tickets');
  });

  it('answers 404 for a slice that does not exist', async () => {
    const response = await fetch(`${base}/_synapse/rpc/nope/nothing`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });

    expect(response.status).toBe(404);
  });
});

describe('uploads over HTTP', () => {
  it('refuses an anonymous upload and stores one sent with a session', async () => {
    const anonymous = await fetch(`${base}/_synapse/files/tickets/view-tickets?name=nota.txt`, {
      method: 'POST',
      body: 'conteudo'
    });

    expect(anonymous.status).toBe(401);

    const previous = process.env.SYNAPSE_SESSION_SECRET;
    delete process.env.SYNAPSE_SESSION_SECRET;

    const authorized = await fetch(`${base}/_synapse/files/tickets/view-tickets?name=nota.txt`, {
      method: 'POST',
      headers: { 'x-user-id': 'u1' },
      body: 'conteudo real'
    });

    if (previous !== undefined) {
      process.env.SYNAPSE_SESSION_SECRET = previous;
    }

    expect(authorized.status).toBe(200);
    const body = (await authorized.json()) as { path: string; bytes: number };
    expect(body.bytes).toBe(13);
    expect(body.path.startsWith('.synapse/uploads/tickets/')).toBe(true);

    const stored = path.join(appDir, body.path);
    expect(fs.readFileSync(stored, 'utf-8')).toBe('conteudo real');
    fs.rmSync(stored, { force: true });
  });

  it('refuses a file over the limit and a name that tries to leave the directory', async () => {
    const previousLimit = process.env.SYNAPSE_MAX_UPLOAD_BYTES;
    process.env.SYNAPSE_MAX_UPLOAD_BYTES = '32';

    const tooLarge = await fetch(`${base}/_synapse/files/tickets/view-tickets?name=grande.bin`, {
      method: 'POST',
      headers: { 'x-user-id': 'u1' },
      body: 'x'.repeat(4096)
    });

    const escaping = await fetch(`${base}/_synapse/files/tickets/view-tickets?name=../../escapou.txt`, {
      method: 'POST',
      headers: { 'x-user-id': 'u1' },
      body: 'x'
    });

    if (previousLimit === undefined) {
      delete process.env.SYNAPSE_MAX_UPLOAD_BYTES;
    } else {
      process.env.SYNAPSE_MAX_UPLOAD_BYTES = previousLimit;
    }

    expect(tooLarge.status).toBe(413);
    expect(escaping.status).toBe(400);
    expect(fs.existsSync(path.join(appDir, 'escapou.txt'))).toBe(false);
  });

  it('answers 405 for a GET on the upload endpoint', async () => {
    const response = await fetch(`${base}/_synapse/files/tickets/view-tickets?name=a.txt`);

    expect(response.status).toBe(405);
  });
});

describe('pre-built client bundles', () => {
  it('serves the bundle the build produced, without waiting for the bundler', async () => {
    const report = await buildAllClientBundles(appDir);
    expect(report.ok).toBe(true);

    const html = await (await fetch(`${base}/tickets/view-tickets`)).text();
    expect(html).toContain('/_synapse/client/tickets-view-tickets.js');

    const bundle = await fetch(`${base}/_synapse/client/tickets-view-tickets.js`);
    expect(bundle.status).toBe(200);
    expect((await bundle.text()).length).toBeGreaterThan(1000);
  }, 20000);
});

describe('session from headers', () => {
  it('accepts a session identified only by x-user-roles', async () => {
    const html = await (
      await fetch(`${base}/tickets/view-tickets`, { headers: { 'x-user-roles': 'sales,support' } })
    ).text();

    expect(html).toContain('LOADER-TICKETS-default-sales,support');
  });

  it('treats a request without any header as anonymous', async () => {
    const html = await (await fetch(`${base}/tickets/view-tickets`)).text();

    expect(html).toContain('LOADER-TICKETS-default-anonimo');
  });
});

describe('static files, CORS and CSRF', () => {
  it('serves a file from the app public directory', async () => {
    const response = await fetch(`${base}/hello.txt`);

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('ola do public');
  });

  it('does not serve files outside public', async () => {
    const response = await fetch(`${base}/..%2Fpackage.json`);
    expect(response.status).toBe(404);
  });

  it('rejects an RPC call that is not JSON, which is what blocks cross-site form posts', async () => {
    const response = await fetch(`${base}/_synapse/rpc/tickets/view-tickets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'a=1'
    });

    expect(response.status).toBe(415);
  });

  it('answers a preflight only for an allowed origin', async () => {
    const denied = await fetch(`${base}/_synapse/rpc/tickets/view-tickets`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://outro.example' }
    });
    expect(denied.status).toBe(404);

    process.env.SYNAPSE_ALLOWED_ORIGINS = 'https://app.example';
    const allowed = await fetch(`${base}/_synapse/rpc/tickets/view-tickets`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://app.example' }
    });
    delete process.env.SYNAPSE_ALLOWED_ORIGINS;

    expect(allowed.status).toBe(204);
    expect(allowed.headers.get('access-control-allow-origin')).toBe('https://app.example');
  });

  it('formats a request log line as a single JSON object', () => {
    const line = formatLogLine({ method: 'GET', path: '/x', status: 200, ms: 3 });
    const parsed = JSON.parse(line) as Record<string, unknown>;

    expect(parsed.method).toBe('GET');
    expect(parsed.status).toBe(200);
    expect(typeof parsed.ts).toBe('string');
  });
});

describe('discovery failures are visible', () => {
  it('reports the slice that failed to load in /health', async () => {
    const payload = (await (await fetch(`${base}/_synapse/api/health`)).json()) as {
      slicesLoaded: number;
      loadErrors: Array<{ file: string; message: string }>;
    };

    expect(payload.slicesLoaded).toBe(2);
    expect(payload.loadErrors.length).toBe(1);
    expect(payload.loadErrors[0].file).toContain('cannot-load.slice.tsx');
    expect(payload.loadErrors[0].message).toContain('falha proposital');
  });

  it('shows the failure on the dashboard rather than hiding it', async () => {
    const html = await (await fetch(`${base}/`)).text();

    expect(html).toContain('falharam ao carregar');
    expect(html).toContain('cannot-load.slice.tsx');
  });
});

describe('HTTP status reflects the domain error', () => {
  it('maps the well-known domain codes and keeps 400 for the rest', () => {
    const cases: Array<[unknown, number]> = [
      ['UNAUTHORIZED', 401],
      ['FORBIDDEN', 403],
      ['TICKET_NOT_FOUND', 404],
      ['CUSTOMER_NOT_FOUND', 404],
      ['DUPLICATE_EMAIL', 409],
      ['DUPLICATE_TICKET', 409],
      ['ALREADY_CLOSED', 409],
      ['INVALID_SCHEMA', 422],
      ['INVALID_PRIORITY', 422],
      ['NO_DATABASE', 500],
      ['PERSISTENCE_FAILED', 500],
      ['SOMETHING_ELSE', 400],
      [undefined, 400]
    ];

    for (const [code, expected] of cases) {
      expect(httpStatusForError(code)).toBe(expected);
    }
  });
});

describe('signed sessions', () => {
  it('derives the session from a signed token instead of a forgeable header', async () => {
    process.env.SYNAPSE_SESSION_SECRET = 'segredo-de-teste';
    const token = signSessionToken({ userId: 'u-assinado', roles: ['financeiro'] }, 'segredo-de-teste');

    const signed = await (
      await fetch(`${base}/tickets/view-tickets`, {
        headers: { Authorization: `Bearer ${token}`, 'x-user-roles': 'sales' }
      })
    ).text();

    delete process.env.SYNAPSE_SESSION_SECRET;

    // O papel vem do token, não do header que o cliente escreveu.
    expect(signed).toContain('LOADER-TICKETS-default-financeiro');
  });

  it('treats a tampered or forged token as anonymous', async () => {
    process.env.SYNAPSE_SESSION_SECRET = 'segredo-de-teste';

    const forged = await (
      await fetch(`${base}/tickets/view-tickets`, {
        headers: { Authorization: 'Bearer abc.def', 'x-user-roles': 'sales' }
      })
    ).text();

    delete process.env.SYNAPSE_SESSION_SECRET;

    expect(forged).toContain('LOADER-TICKETS-default-anonimo');
  });
});
