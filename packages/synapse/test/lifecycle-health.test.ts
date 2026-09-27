import { describe, expect, it } from 'bun:test';
import * as path from 'path';
import { SynapseServer } from '../src/runtime/server';

const appDir = path.resolve(import.meta.dir, 'fixtures', 'runtime-app');
const CLI = path.resolve(import.meta.dir, '../bin/synapse.ts');

describe('Active Healthcheck & Database Liveness (G-12)', () => {
  it('returns HTTP 200 and database connected when database responds to ping', async () => {
    const synapse = new SynapseServer(appDir, 0);
    await synapse.discoverSlices();
    const srv = (await synapse.start()) as unknown as { port: number };
    const base = `http://localhost:${srv.port}`;

    try {
      const response = await fetch(`${base}/_synapse/api/health`);
      expect(response.status).toBe(200);

      const data = (await response.json()) as {
        status: string;
        database: string;
        slicesLoaded: number;
      };

      expect(data.status).toBe('OK');
      expect(data.database).toBe('connected');
      expect(data.slicesLoaded).toBe(2);
    } finally {
      await synapse.stop();
    }
  });

  it('returns HTTP 503 and status DEGRADED when database is disconnected', async () => {
    const synapse = new SynapseServer(appDir, 0);
    await synapse.discoverSlices();
    const srv = (await synapse.start()) as unknown as { port: number };
    const base = `http://localhost:${srv.port}`;

    try {
      // Simula queda de conectividade fechando o banco
      await synapse.database.close?.();

      const response = await fetch(`${base}/_synapse/api/health`);
      expect(response.status).toBe(503);

      const data = (await response.json()) as {
        status: string;
        database: string;
        databaseError?: string;
      };

      expect(data.status).toBe('DEGRADED');
      expect(data.database).toBe('disconnected');
      expect(typeof data.databaseError).toBe('string');
    } finally {
      await synapse.stop();
    }
  });
});

describe('Graceful Shutdown & Server Lifecycle (G-11)', () => {
  it('stops HTTP server and terminates connection cleanly on server.stop()', async () => {
    const synapse = new SynapseServer(appDir, 0);
    await synapse.discoverSlices();
    const srv = (await synapse.start()) as unknown as { port: number };
    const port = srv.port;

    // Servidor respondendo
    const resBefore = await fetch(`http://localhost:${port}/_synapse/api/health`);
    expect(resBefore.status).toBe(200);

    // Encerra graciosamente
    await synapse.stop();

    // Servidor fechado: novas conexões devem falhar
    let failed = false;
    try {
      await fetch(`http://localhost:${port}/_synapse/api/health`, { signal: AbortSignal.timeout(500) });
    } catch {
      failed = true;
    }
    expect(failed).toBe(true);
  });

  it('spawns synapse start in production mode and exits cleanly with SIGTERM', async () => {
    // Escolhe uma porta alta livre
    const port = 39821;
    const proc = Bun.spawn([process.execPath, CLI, 'start', String(port)], {
      cwd: appDir,
      env: { ...process.env, NODE_ENV: 'production', SYNAPSE_SESSION_SECRET: 'prod-secret' },
      stdout: 'pipe',
      stderr: 'pipe'
    });

    // Aguarda o servidor subir
    let ready = false;
    for (let i = 0; i < 30; i++) {
      try {
        const res = await fetch(`http://localhost:${port}/_synapse/api/health`);
        if (res.status === 200) {
          ready = true;
          break;
        }
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }

    expect(ready).toBe(true);

    // Envia SIGTERM para testar graceful shutdown
    proc.kill('SIGTERM');
    const exitCode = await proc.exited;
    expect(exitCode).toBe(0);
  }, 15000);
});
