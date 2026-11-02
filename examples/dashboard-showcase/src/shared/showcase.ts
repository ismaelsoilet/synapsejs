import { Database } from 'bun:sqlite';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createSession, type DatabaseClient, SESSION_COOKIE, type SessionContext, verifySessionToken } from 'synapsejs';

export interface DemoUser {
  id: string;
  email: string;
  password: string;
  roles: string[];
  label: string;
}

export const DEMO_USERS: DemoUser[] = [
  {
    id: 'user_admin',
    email: 'admin@synapse.dev',
    password: 'demo1234',
    roles: ['admin', 'writer', 'support'],
    label: 'Admin'
  },
  {
    id: 'user_editor',
    email: 'editor@synapse.dev',
    password: 'demo1234',
    roles: ['writer'],
    label: 'Editor'
  },
  {
    id: 'user_viewer',
    email: 'viewer@synapse.dev',
    password: 'demo1234',
    roles: ['viewer'],
    label: 'Viewer'
  }
];

export async function ensureDemoUsers(db: DatabaseClient): Promise<void> {
  const count = await db.queryOne<{ count: number }>('SELECT count(*) AS count FROM users');
  if (Number(count?.count ?? 0) > 0) {
    return;
  }

  for (const user of DEMO_USERS) {
    const passwordHash = await Bun.password.hash(user.password);
    await db.insert('users', {
      id: user.id,
      email: user.email,
      password_hash: passwordHash,
      roles: user.roles.join(',')
    });
  }
}

export function toUploadKey(relativePath: string): string | null {
  const normalized = relativePath.replace(/\\/g, '/');
  const prefix = '.synapse/uploads/';
  if (!normalized.startsWith(prefix)) {
    return null;
  }
  const key = normalized.slice(prefix.length);
  if (!key.startsWith('showcase/') || key.includes('..')) {
    return null;
  }
  return key;
}

export function showcaseBaseUrl(): string {
  return process.env.SHOWCASE_BASE_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;
}

export function webhookSecret(): string {
  return process.env.SHOWCASE_WEBHOOK_SECRET ?? 'showcase-webhook-secret';
}

export function signWebhookPayload(rawBody: string): string {
  return crypto.createHmac('sha256', webhookSecret()).update(rawBody).digest('hex');
}

export function verifyWebhookSignature(rawBody: string, signature: string | null): boolean {
  if (!signature) return false;
  const expected = signWebhookPayload(rawBody);
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function parseCookieHeader(header: string | null): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index <= 0) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (name) cookies[name] = decodeURIComponent(value);
  }
  return cookies;
}

/** Shared by the plugin routes: the same signed-cookie rule the server uses. */
export function sessionFromRequest(request: Request): SessionContext | null {
  const secret = process.env.SYNAPSE_SESSION_SECRET;
  if (!secret) return null;
  const token = parseCookieHeader(request.headers.get('cookie'))[SESSION_COOKIE];
  if (!token) return null;
  const verified = verifySessionToken(token, secret, { checkRevoked: false });
  if (!verified.ok) return null;
  return createSession({
    userId: verified.value.userId,
    tenantId: verified.value.tenantId,
    roles: verified.value.roles,
    permissions: verified.value.permissions,
    token
  });
}

export interface JobStats {
  pending: number;
  running: number;
  completed: number;
  failed: number;
  deadLetter: number;
  recent: Array<{
    id: string;
    name: string;
    status: string;
    attempts: number;
    last_error: string | null;
    created_at: number;
  }>;
}

const EMPTY_JOB_STATS: JobStats = {
  pending: 0,
  running: 0,
  completed: 0,
  failed: 0,
  deadLetter: 0,
  recent: []
};

/** Reads the isolated queue database; a missing file simply means “no work yet”. */
export function getJobStats(): JobStats {
  const dbPath = path.join(process.cwd(), '.synapse', 'queue.sqlite');
  if (!fs.existsSync(dbPath)) return { ...EMPTY_JOB_STATS, recent: [] };

  let queue: Database | null = null;
  try {
    queue = new Database(dbPath, { readonly: true });
    const statusRows = queue
      .query('SELECT status, count(*) AS count FROM _synapse_jobs GROUP BY status')
      .all() as Array<{ status: string; count: number }>;
    const stats: JobStats = { ...EMPTY_JOB_STATS, recent: [] };
    for (const row of statusRows) {
      const key = row.status as 'pending' | 'running' | 'completed' | 'failed';
      if (key in stats) stats[key] = Number(row.count);
    }
    try {
      const dlq = queue.query('SELECT count(*) AS count FROM _synapse_jobs_dlq').get() as { count: number } | null;
      stats.deadLetter = Number(dlq?.count ?? 0);
    } catch {
      stats.deadLetter = 0;
    }
    try {
      stats.recent = queue
        .query(
          'SELECT id, name, status, attempts, last_error, created_at FROM _synapse_jobs ORDER BY created_at DESC LIMIT 8'
        )
        .all() as JobStats['recent'];
    } catch {
      stats.recent = [];
    }
    return stats;
  } catch {
    return { ...EMPTY_JOB_STATS, recent: [] };
  } finally {
    queue?.close();
  }
}

export interface HomeCounts {
  inventory: number;
  files: number;
  feed: number;
  jobEvents: number;
}

export async function getHomeCounts(db: DatabaseClient): Promise<HomeCounts> {
  const safeCount = async (table: string): Promise<number> => {
    try {
      const row = await db.queryOne<{ count: number }>(`SELECT count(*) AS count FROM ${table}`);
      return Number(row?.count ?? 0);
    } catch {
      return 0;
    }
  };

  return {
    inventory: await safeCount('inventory'),
    files: await safeCount('showcase_files'),
    feed: await safeCount('showcase_feed'),
    jobEvents: await safeCount('showcase_job_events')
  };
}
