import { type Static, Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { useState } from 'react';
import {
  type DatabaseClient,
  Err,
  MockDatabaseClient,
  Ok,
  type Result,
  type SessionContext,
  signSessionToken
} from 'synapsejs';
import { storeSession } from 'synapsejs/client';
import { DEMO_USERS, ensureDemoUsers } from '../../shared/showcase';

export const LoginInputSchema = Type.Object(
  {
    email: Type.String({ minLength: 3, maxLength: 200 }),
    password: Type.String({ minLength: 8, maxLength: 200 })
  },
  { additionalProperties: true }
);
export type LoginInput = Static<typeof LoginInputSchema>;

export const sliceSchema = `
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    roles TEXT NOT NULL DEFAULT 'user',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
`;

export type LoginOutput = Result<
  { token: string; roles: string[]; expiresAt: number; userId: string },
  'INVALID_SCHEMA' | 'NO_DATABASE' | 'MISSING_SECRET' | 'INVALID_CREDENTIALS'
>;

const SESSION_MAX_AGE_SECONDS = 43_200;
const DECOY_HASH = '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';

export async function loginAction(
  payload: unknown,
  db?: DatabaseClient,
  _session?: SessionContext
): Promise<LoginOutput> {
  if (!db) return Err('NO_DATABASE');
  if (!Value.Check(LoginInputSchema, payload)) return Err('INVALID_SCHEMA');

  const secret = process.env.SYNAPSE_SESSION_SECRET;
  if (!secret) return Err('MISSING_SECRET');

  try {
    await ensureDemoUsers(db);
  } catch {
    return Err('NO_DATABASE');
  }

  const input = payload as LoginInput;
  const email = input.email.trim().toLowerCase();
  const rows = await db.query<{ id: string; password_hash: string; roles: string }>(
    'SELECT id, password_hash, roles FROM users WHERE email = $1',
    [email]
  );
  const user = rows[0];
  const valid = await Bun.password.verify(input.password, user?.password_hash ?? DECOY_HASH).catch(() => false);

  if (!user || !valid) return Err('INVALID_CREDENTIALS');

  const roles = user.roles
    .split(',')
    .map((role) => role.trim())
    .filter(Boolean);
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS;

  return Ok({
    token: signSessionToken({ userId: user.id, roles }, secret, SESSION_MAX_AGE_SECONDS),
    roles,
    expiresAt,
    userId: user.id
  });
}

export interface LoginLoaderData {
  configured: boolean;
  demoUsers: Array<{ label: string; email: string; password: string; roles: string[] }>;
  redirectTo: string;
}

export function LoginLoader(context: { params?: Record<string, string> }): LoginLoaderData {
  return {
    configured: Boolean(process.env.SYNAPSE_SESSION_SECRET),
    demoUsers: DEMO_USERS.map(({ label, email, password, roles }) => ({ label, email, password, roles })),
    redirectTo: context.params?.redirectTo || '/showcase/home'
  };
}

export interface LoginTriggerProps {
  onSubmitAction?: (payload: unknown) => Promise<LoginOutput>;
  configured?: boolean;
  demoUsers?: LoginLoaderData['demoUsers'];
  redirectTo?: string;
}

export function LoginTrigger({
  onSubmitAction,
  configured = true,
  demoUsers = [],
  redirectTo = '/showcase/home'
}: LoginTriggerProps) {
  const [feedback, setFeedback] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const signIn = async (email: string, password: string) => {
    if (!onSubmitAction || busy) return;
    setBusy(true);
    setFeedback(null);
    const result = await onSubmitAction({ email, password });
    setBusy(false);

    if (!result.ok) {
      setFeedback(
        result.error === 'INVALID_CREDENTIALS'
          ? 'E-mail ou senha inválidos.'
          : result.error === 'MISSING_SECRET'
            ? 'O servidor está sem SYNAPSE_SESSION_SECRET; reinicie com o script de demo.'
            : `Falha no login: ${result.error}`
      );
      return;
    }

    storeSession(result.value.token, result.value.roles, result.value.expiresAt - Math.floor(Date.now() / 1000));
    (globalThis as { location?: { assign?: (url: string) => void } }).location?.assign?.(redirectTo);
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_0.9fr]">
      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6 shadow-xl">
        <div className="mb-5">
          <h2 className="text-lg font-bold text-white">Entrar no showcase</h2>
          <p className="mt-1 text-xs text-slate-400">
            Sessão assinada com <code className="text-cyan-300">signSessionToken</code>; o cookie vira{' '}
            <code className="text-cyan-300">Authorization: Bearer</code> nas ações e no upload.
          </p>
        </div>

        {!configured ? (
          <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
            Defina <code>SYNAPSE_SESSION_SECRET</code> e reinicie com <code>bun run start</code>.
          </div>
        ) : null}

        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            void signIn(String(form.get('email') ?? ''), String(form.get('password') ?? ''));
          }}
        >
          <label className="block text-xs font-semibold text-slate-400" htmlFor="login-email">
            E-mail
          </label>
          <input
            id="login-email"
            name="email"
            type="email"
            required
            defaultValue="admin@synapse.dev"
            autoComplete="username"
            className="w-full rounded-xl border border-slate-700 bg-slate-950/60 px-3 py-2.5 text-sm text-white outline-none transition focus:border-cyan-400"
          />
          <label className="block text-xs font-semibold text-slate-400" htmlFor="login-password">
            Senha
          </label>
          <input
            id="login-password"
            name="password"
            type="password"
            required
            minLength={8}
            defaultValue="demo1234"
            autoComplete="current-password"
            className="w-full rounded-xl border border-slate-700 bg-slate-950/60 px-3 py-2.5 text-sm text-white outline-none transition focus:border-cyan-400"
          />
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-cyan-500/20 transition hover:brightness-110 disabled:opacity-50"
          >
            {busy ? 'Entrando…' : 'Entrar'}
          </button>
        </form>

        {feedback ? (
          <p className="mt-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
            {feedback}
          </p>
        ) : null}
      </div>

      <div className="rounded-2xl border border-slate-800 bg-gradient-to-br from-slate-900 to-cyan-950/30 p-6">
        <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-300">Contas de demonstração</div>
        <p className="mt-2 text-xs leading-relaxed text-slate-400">
          Use uma das contas para exercitar RBAC: <strong className="text-slate-200">admin</strong> apaga,
          <strong className="text-slate-200"> editor</strong> atualiza e{' '}
          <strong className="text-slate-200">viewer</strong> só lê.
        </p>
        <div className="mt-5 space-y-2">
          {demoUsers.map((user) => (
            <button
              key={user.email}
              type="button"
              onClick={() => void signIn(user.email, user.password)}
              className="group flex w-full items-center justify-between rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2.5 text-left transition hover:border-cyan-400/40 hover:bg-slate-900"
            >
              <span>
                <span className="block text-xs font-bold text-white group-hover:text-cyan-300">{user.label}</span>
                <span className="block font-mono text-[10px] text-slate-500">{user.email}</span>
              </span>
              <span className="rounded-md bg-slate-800 px-2 py-1 font-mono text-[9px] text-slate-300">
                {user.roles.join(' · ')}
              </span>
            </button>
          ))}
        </div>
        <div className="mt-5 rounded-xl border border-slate-800 bg-slate-950/50 p-3 font-mono text-[10px] leading-relaxed text-slate-500">
          senha: <span className="text-cyan-300">demo1234</span>
          <br />
          cookie: <span className="text-cyan-300">synapse_token</span> (assinado)
        </div>
      </div>
    </div>
  );
}

export function sliceMeta() {
  return {
    title: 'Login | Synapse Showcase',
    description: 'Autenticação com sessões assinadas, RBAC e contas de demonstração.'
  };
}

export const sliceTests = {
  description: 'Invariantes de autenticação',
  cases: [
    {
      name: 'login sem banco retorna NO_DATABASE',
      run: async () => {
        const result = await loginAction({ email: 'admin@synapse.dev', password: 'demo1234' });
        if (result.ok || result.error !== 'NO_DATABASE') throw new Error('esperava NO_DATABASE');
      }
    },
    {
      name: 'payload inválido retorna INVALID_SCHEMA',
      run: async () => {
        const result = await loginAction({ email: 'x', password: '123' }, new MockDatabaseClient());
        if (result.ok || result.error !== 'INVALID_SCHEMA') throw new Error('esperava INVALID_SCHEMA');
      }
    }
  ]
};
