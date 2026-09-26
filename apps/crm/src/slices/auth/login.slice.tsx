import { type Static, Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import type React from 'react';
import { useState } from 'react';
import {
  type DatabaseClient,
  Err,
  MockDatabaseClient,
  Ok,
  type Result,
  type SessionContext,
  signSessionToken,
  verifySessionToken
} from 'synapsejs';
import { storeSession } from 'synapsejs/client';

// ============================================================================
// 1. CONTRATO DE ENTRADA (TypeBox)
// ============================================================================
export const LoginInputSchema = Type.Object({
  email: Type.String({ minLength: 3, maxLength: 200 }),
  password: Type.String({ minLength: 8, maxLength: 200 })
});
export type LoginInput = Static<typeof LoginInputSchema>;

// ============================================================================
// 2. TABELA (esta fatia é dona da DDL: as outras fatias de auth devem omitir o sliceSchema)
// ============================================================================
export const sliceSchema = `
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    roles TEXT NOT NULL DEFAULT 'user',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
`;

// Para criar o primeiro usuário, num seed fora da fatia:
//   Bun.password.hash('uma-senha-com-8-ou-mais')
// Nunca insira password_hash na mão e nunca guarde a senha em claro.

// ============================================================================
// 3. MODELAGEM DE DOMÍNIO (Result<T, E>)
// ============================================================================
export type LoginOutput = Result<
  { token: string; roles: string[]; expiresAt: number },
  'INVALID_SCHEMA' | 'NO_DATABASE' | 'MISSING_SECRET' | 'INVALID_CREDENTIALS'
>;

const SESSION_MAX_AGE_SECONDS = 43_200;

/** Hash descartável: sem usuário, a verificação custa o mesmo tempo e não conta quem existe. */
const DECOY_HASH = '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';

// ============================================================================
// 4. SERVER ACTION — a única peça que assina
// ============================================================================
export async function loginAction(
  payload: unknown,
  db?: DatabaseClient,
  _session?: SessionContext
): Promise<LoginOutput> {
  if (!db) {
    return Err('NO_DATABASE');
  }

  if (!Value.Check(LoginInputSchema, payload)) {
    return Err('INVALID_SCHEMA');
  }

  const secret = process.env.SYNAPSE_SESSION_SECRET;
  if (!secret) {
    // Sem segredo o servidor não distingue um token assinado de um header que qualquer
    // cliente escreve, então o login falha alto em vez de emitir algo que não vale.
    return Err('MISSING_SECRET');
  }

  const input = payload as LoginInput;
  const email = input.email.trim().toLowerCase();

  const rows = await db.query<{ id: string; password_hash: string; roles: string }>(
    'SELECT id, password_hash, roles FROM users WHERE email = $1',
    [email]
  );
  const user = rows[0];

  const valid = await Bun.password.verify(input.password, user?.password_hash ?? DECOY_HASH).catch(() => false);
  if (!user || !valid) {
    return Err('INVALID_CREDENTIALS');
  }

  const roles = user.roles
    .split(',')
    .map((role) => role.trim())
    .filter((role) => role.length > 0);

  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS;

  return Ok({
    token: signSessionToken({ userId: user.id, roles }, secret, SESSION_MAX_AGE_SECONDS),
    roles,
    expiresAt
  });
}

// ============================================================================
// 5. UI REACT — grava o token no cookie e recarrega
// ============================================================================
export interface LoginTriggerProps {
  onSubmitAction?: (payload: unknown) => Promise<LoginOutput>;
  redirectTo?: string;
}

export function LoginTrigger({ onSubmitAction, redirectTo = '/' }: LoginTriggerProps) {
  const [feedback, setFeedback] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!onSubmitAction) return;

    const formData = new FormData(event.currentTarget);
    const result = await onSubmitAction({
      email: formData.get('email'),
      password: formData.get('password')
    });

    if (!result.ok) {
      setFeedback(result.error === 'INVALID_CREDENTIALS' ? 'E-mail ou senha inválidos' : `Erro: ${result.error}`);
      return;
    }

    // Daqui em diante o servidor reconhece a sessão pela assinatura: o cookie vira
    // Authorization: Bearer nas próximas chamadas.
    storeSession(result.value.token, result.value.roles, result.value.expiresAt - Math.floor(Date.now() / 1000));
    (globalThis as { location?: { assign?: (url: string) => void } }).location?.assign?.(redirectTo);
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 max-w-sm">
      <label htmlFor="login-email" className="text-xs font-mono text-slate-400">
        E-mail
      </label>
      <input
        id="login-email"
        name="email"
        type="email"
        required
        autoComplete="username"
        className="px-3 py-2 bg-slate-800 border border-slate-700 rounded text-sm text-white"
      />

      <label htmlFor="login-password" className="text-xs font-mono text-slate-400">
        Senha
      </label>
      <input
        id="login-password"
        name="password"
        type="password"
        required
        minLength={8}
        autoComplete="current-password"
        className="px-3 py-2 bg-slate-800 border border-slate-700 rounded text-sm text-white"
      />

      <button type="submit" className="px-4 py-2 bg-cyan-600 rounded text-white text-sm">
        Entrar
      </button>
      {feedback && <p className="text-xs font-mono text-rose-300">{feedback}</p>}
    </form>
  );
}

// ============================================================================
// 6. ORÁCULO DE INVARIANTES
// ============================================================================
export const sliceTests = {
  description: 'Invariantes de autenticação de users',
  cases: [
    {
      name: 'senha correta devolve um token que o próprio servidor aceita',
      run: async () => {
        process.env.SYNAPSE_SESSION_SECRET = 'segredo-de-teste';
        const hash = await Bun.password.hash('senha-com-oito');
        const db = new MockDatabaseClient().onQuery(/SELECT id, password_hash, roles/, () => [
          { id: 'user-1', password_hash: hash, roles: 'admin,billing' }
        ]);

        const result = await loginAction({ email: '  Admin@Loja.com ', password: 'senha-com-oito' }, db);

        if (!result.ok) {
          throw new Error(`esperava sucesso, obteve ${JSON.stringify(result)}`);
        }

        const verified = verifySessionToken(result.value.token, 'segredo-de-teste');
        if (!verified.ok) {
          throw new Error(`o servidor recusaria o token emitido: ${verified.error}`);
        }
        if (verified.value.userId !== 'user-1' || !verified.value.roles.includes('billing')) {
          throw new Error(`claims inesperadas: ${JSON.stringify(verified.value)}`);
        }
        if (result.value.roles.join(',') !== 'admin,billing') {
          throw new Error(`papéis inesperados: ${result.value.roles.join(',')}`);
        }
      }
    },
    {
      name: 'senha errada retorna INVALID_CREDENTIALS',
      run: async () => {
        process.env.SYNAPSE_SESSION_SECRET = 'segredo-de-teste';
        const hash = await Bun.password.hash('senha-com-oito');
        const db = new MockDatabaseClient().onQuery(/SELECT id, password_hash, roles/, () => [
          { id: 'user-1', password_hash: hash, roles: 'user' }
        ]);

        const result = await loginAction({ email: 'a@b.com', password: 'senha-errada-1' }, db);

        if (result.ok || result.error !== 'INVALID_CREDENTIALS') {
          throw new Error(`esperava INVALID_CREDENTIALS, obteve ${JSON.stringify(result)}`);
        }
      }
    },
    {
      name: 'usuário inexistente retorna INVALID_CREDENTIALS sem revelar que não existe',
      run: async () => {
        process.env.SYNAPSE_SESSION_SECRET = 'segredo-de-teste';
        const db = new MockDatabaseClient().onQuery(/SELECT id, password_hash, roles/, () => []);

        const result = await loginAction({ email: 'ninguem@b.com', password: 'senha-com-oito' }, db);

        if (result.ok || result.error !== 'INVALID_CREDENTIALS') {
          throw new Error(`esperava INVALID_CREDENTIALS, obteve ${JSON.stringify(result)}`);
        }
      }
    },
    {
      name: 'sem SYNAPSE_SESSION_SECRET o login falha em vez de emitir token forjável',
      run: async () => {
        const previous = process.env.SYNAPSE_SESSION_SECRET;
        delete process.env.SYNAPSE_SESSION_SECRET;

        const result = await loginAction({ email: 'a@b.com', password: 'senha-com-oito' }, new MockDatabaseClient());

        process.env.SYNAPSE_SESSION_SECRET = previous;

        if (result.ok || result.error !== 'MISSING_SECRET') {
          throw new Error(`esperava MISSING_SECRET, obteve ${JSON.stringify(result)}`);
        }
      }
    },
    {
      name: 'payload fora do contrato retorna INVALID_SCHEMA',
      run: async () => {
        const result = await loginAction({ email: 'a@b.com', password: 'curta' }, new MockDatabaseClient());

        if (result.ok || result.error !== 'INVALID_SCHEMA') {
          throw new Error(`esperava INVALID_SCHEMA, obteve ${JSON.stringify(result)}`);
        }
      }
    }
  ]
};
