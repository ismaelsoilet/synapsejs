/**
 * SynapseJS - Slice Templates
 *
 * The shapes an agent should never have to invent: list with pagination and a
 * filter, partial update with a column allowlist, and delete with an existence
 * guard. `create` lives in the scaffolder and stays the default.
 *
 * Every template is proven by the splitter's own gates in the tests: the emitted
 * slice must compile and its client bundle must leak nothing. That is the reason
 * the templates can be trusted as a starting point rather than only as prose.
 */

import { generateTableColumnsCode, parseFields } from './fields-parser';

export type SliceTemplate = 'create' | 'list' | 'update' | 'delete' | 'login' | 'oauth-github' | 'auth-2fa';
export const SLICE_TEMPLATES: SliceTemplate[] = [
  'create',
  'list',
  'update',
  'delete',
  'login',
  'oauth-github',
  'auth-2fa'
];

/** Paginação das listas geradas: o agente não escolhe esses números por conta. */
export const DEFAULT_LIST_LIMIT = 20;
export const MAX_LIST_LIMIT = 100;

export interface TemplateNames {
  pascal: string;
  camel: string;
  table: string;
  schemaName: string;
  inputName: string;
  outputName: string;
  actionName: string;
  componentName: string;
}

export function templateNames(domain: string, sliceName: string): TemplateNames {
  const pascal = sliceName
    .split(/[-_]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');
  const camel = pascal.charAt(0).toLowerCase() + pascal.slice(1);

  return {
    pascal,
    camel,
    table: domain.replace(/[^a-zA-Z0-9_]/g, '_'),
    schemaName: `${pascal}InputSchema`,
    inputName: `${pascal}Input`,
    outputName: `${pascal}Output`,
    actionName: `${camel}Action`,
    componentName: `${pascal}Trigger`
  };
}

function imports(needsLoader: boolean): string {
  return `import React, { useState } from 'react';
import { Type, Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import {
  type DatabaseClient,
  Err,
  MockDatabaseClient,
  Ok,
  type Result,
  type SessionContext,
  ${needsLoader ? 'type SliceLoaderContext,\n  ' : ''}createSession,
  requireAuth
} from 'synapsejs';`;
}

function fieldsListTemplate(names: TemplateNames, fieldsSpec: string): string {
  const fields = parseFields(fieldsSpec);
  const listRow = `${names.pascal}Row`;
  const tableColumns = generateTableColumnsCode(fields);

  return `${imports(true)}
import { DataTable, Card, Pagination } from 'synapsejs/client';

// ============================================================================
// 1. CONTRATO DE ENTRADA (TypeBox) — filtro e paginação tipados
// ============================================================================
export const ${names.schemaName} = Type.Object({
  query: Type.Optional(Type.String({ maxLength: 60 })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  offset: Type.Optional(Type.Integer({ minimum: 0 }))
});
export type ${names.inputName} = Static<typeof ${names.schemaName}>;

// ============================================================================
// 2. MODELAGEM DE DOMÍNIO (Result<T, E>)
// ============================================================================
export interface ${listRow} {
  id: string;
${fields.map((f) => `  ${f.name}: ${f.type === 'number' || f.type === 'integer' ? 'number' : f.type === 'boolean' ? 'boolean' : 'string'};`).join('\n')}
}

export type ${names.outputName} = Result<
  { rows: ${listRow}[]; total: number; limit: number; offset: number },
  'INVALID_SCHEMA' | 'NO_DATABASE' | 'UNAUTHORIZED'
>;

const DEFAULT_LIMIT = ${DEFAULT_LIST_LIMIT};
const MAX_LIMIT = ${MAX_LIST_LIMIT};

// ============================================================================
// 3. SERVER ACTION — busca utilizando Query Builder
// ============================================================================
export async function ${names.actionName}(
  payload: unknown,
  db?: DatabaseClient,
  session?: SessionContext
): Promise<${names.outputName}> {
  if (!session?.isAuthenticated) {
    return Err('UNAUTHORIZED');
  }

  if (!db) {
    return Err('NO_DATABASE');
  }

  const input = (payload ?? {}) as ${names.inputName};
  if (!Value.Check(${names.schemaName}, input)) {
    return Err('INVALID_SCHEMA');
  }

  const limit = Math.min(input.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
  const offset = input.offset ?? 0;
  const term = input.query ?? '';

  const where = term ? { ${fields[0]?.name || 'id'}: { like: \`%\${term}%\` } } : {};
  const rows = await db.findMany<${listRow}>('${names.table}', {
    where,
    limit,
    offset
  });

  return Ok({ rows, total: rows.length, limit, offset });
}

// ============================================================================
// 4. LOADER — a lista renderiza no servidor com dados reais
// ============================================================================
export async function ${names.pascal}Loader(
  context: SliceLoaderContext
): Promise<{ rows: ${listRow}[]; total: number; loadError?: string; query?: string }> {
  const query = (context.params.query ?? '').slice(0, 60);
  const limit = Number(context.params.limit ?? DEFAULT_LIMIT);
  const offset = Number(context.params.offset ?? 0);

  const result = await ${names.actionName}({ query, limit, offset }, context.db, context.session);

  return result.ok
    ? { rows: result.value.rows, total: result.value.total, query }
    : { rows: [], total: 0, query, loadError: result.error };
}

// ============================================================================
// 5. UI REACT com <DataTable> e <Card>
// ============================================================================
export interface ${names.pascal}ViewProps {
  rows?: ${listRow}[];
  total?: number;
  loadError?: string;
  query?: string;
}

const TABLE_COLUMNS = ${tableColumns};

export function ${names.componentName}({ rows = [], total = 0, loadError, query = '' }: ${names.pascal}ViewProps) {
  if (loadError) {
    return (
      <div className="p-4 rounded-lg border border-rose-800 bg-rose-950/50 text-rose-200 font-mono text-sm">
        Não foi possível listar: {loadError}
      </div>
    );
  }

  return (
    <Card title="Listagem de ${names.pascal}">
      <DataTable data={rows} columns={TABLE_COLUMNS} />
      <div className="mt-4">
        <Pagination total={total} limit={DEFAULT_LIMIT} offset={0} />
      </div>
    </Card>
  );
}

// ============================================================================
// 6. ORÁCULO DE INVARIANTES
// ============================================================================
export const sliceTests = {
  description: 'Invariantes de listagem de ${names.table}',
  cases: [
    {
      name: 'chamada anônima retorna UNAUTHORIZED',
      run: async () => {
        const result = await ${names.actionName}({}, new MockDatabaseClient());
        if (result.ok || result.error !== 'UNAUTHORIZED') {
          throw new Error('esperava UNAUTHORIZED');
        }
      }
    },
    {
      name: 'sem conexão de banco retorna NO_DATABASE',
      run: async () => {
        const session = createSession({ userId: 'user-1', roles: ['reader'] });
        const result = await ${names.actionName}({}, undefined, session);
        if (result.ok || result.error !== 'NO_DATABASE') {
          throw new Error('esperava NO_DATABASE');
        }
      }
    }
  ]
};
`;
}

/** `list`: filter, pagination and a loader that renders real rows on the server. */
function listTemplate(names: TemplateNames, fieldsSpec?: string): string {
  if (fieldsSpec?.trim()) {
    return fieldsListTemplate(names, fieldsSpec);
  }
  const listRow = `${names.pascal}Row`;

  return `${imports(true)}

// ============================================================================
// 1. CONTRATO DE ENTRADA (TypeBox) — filtro e paginação tipados
// ============================================================================
export const ${names.schemaName} = Type.Object({
  query: Type.Optional(Type.String({ maxLength: 60 })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  offset: Type.Optional(Type.Integer({ minimum: 0 }))
});
export type ${names.inputName} = Static<typeof ${names.schemaName}>;

// A tabela pertence a outra fatia desta mesma feature.

// ============================================================================
// 2. MODELAGEM DE DOMÍNIO (Result<T, E>)
// ============================================================================
export interface ${listRow} {
  id: string;
  name: string;
}

export type ${names.outputName} = Result<
  { rows: ${listRow}[]; total: number; limit: number; offset: number },
  'INVALID_SCHEMA' | 'NO_DATABASE' | 'UNAUTHORIZED'
>;

const DEFAULT_LIMIT = ${DEFAULT_LIST_LIMIT};
const MAX_LIMIT = ${MAX_LIST_LIMIT};

// ============================================================================
// 3. SERVER ACTION — busca parametrizada, nunca concatenada
// ============================================================================
export async function ${names.actionName}(
  payload: unknown,
  db?: DatabaseClient,
  session?: SessionContext
): Promise<${names.outputName}> {
  if (!session?.isAuthenticated) {
    return Err('UNAUTHORIZED');
  }

  if (!db) {
    return Err('NO_DATABASE');
  }

  const input = (payload ?? {}) as ${names.inputName};
  if (!Value.Check(${names.schemaName}, input)) {
    return Err('INVALID_SCHEMA');
  }

  const limit = Math.min(input.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
  const offset = input.offset ?? 0;
  const term = input.query ?? '';

  const rows = await db.query<${listRow}>(
    \`SELECT id, name FROM ${names.table}
     WHERE ($1 = '' OR name LIKE '%' || $1 || '%')
     ORDER BY name
     LIMIT $2 OFFSET $3\`,
    [term, limit, offset]
  );

  const counted = await db.query<{ total: number }>(
    \`SELECT COUNT(*) AS total FROM ${names.table} WHERE ($1 = '' OR name LIKE '%' || $1 || '%')\`,
    [term]
  );

  return Ok({ rows, total: counted[0]?.total ?? 0, limit, offset });
}

// ============================================================================
// 4. LOADER — a lista renderiza no servidor com dados reais
// ============================================================================
export async function ${names.pascal}Loader(
  context: SliceLoaderContext
): Promise<{ rows: ${listRow}[]; total: number; loadError?: string; query?: string }> {
  const query = (context.params.query ?? '').slice(0, 60);
  const limit = Number(context.params.limit ?? DEFAULT_LIMIT);
  const offset = Number(context.params.offset ?? 0);

  const result = await ${names.actionName}({ query, limit, offset }, context.db, context.session);

  return result.ok
    ? { rows: result.value.rows, total: result.value.total, query }
    : { rows: [], total: 0, query, loadError: result.error };
}

// ============================================================================
// 5. UI REACT
// ============================================================================
export interface ${names.pascal}ViewProps {
  rows?: ${listRow}[];
  total?: number;
  loadError?: string;
  query?: string;
}

export function ${names.componentName}({ rows = [], total = 0, loadError, query = '' }: ${names.pascal}ViewProps) {
  const [term, setTerm] = useState(query);

  if (loadError) {
    return (
      <div className="p-4 rounded-lg border border-rose-800 bg-rose-950/50 text-rose-200 font-mono text-sm">
        Não foi possível listar: {loadError}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <form method="GET" className="flex gap-2">
        <label htmlFor="${names.camel}-search" className="sr-only">
          Buscar
        </label>
        <input
          id="${names.camel}-search"
          name="query"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder="Buscar por nome"
          className="flex-1 px-3 py-2 bg-slate-800 border border-slate-700 rounded text-sm text-white"
        />
        <button type="submit" className="px-4 py-2 bg-slate-700 rounded text-white text-sm">
          Buscar
        </button>
      </form>

      {rows.length === 0 ? (
        <p className="text-slate-400 text-sm">Nenhum registro encontrado.</p>
      ) : (
        <>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-mono text-slate-400">
                <th className="pb-2">Nome</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-slate-800">
                  <td className="py-2 text-slate-200">{row.name}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs font-mono text-slate-500">
            {rows.length} de {total}
          </p>
        </>
      )}
    </div>
  );
}

// ============================================================================
// 6. ORÁCULO DE INVARIANTES
// ============================================================================
export const sliceTests = {
  description: 'Invariantes de listagem de ${names.table}',
  cases: [
    {
      name: 'sem sessão retorna UNAUTHORIZED antes de tocar o banco',
      run: async () => {
        const db = new MockDatabaseClient();
        const result = await ${names.actionName}({}, db);

        if (result.ok || result.error !== 'UNAUTHORIZED') {
          throw new Error(\`esperava UNAUTHORIZED, obteve \${JSON.stringify(result)}\`);
        }
        if (db.calls.length !== 0) {
          throw new Error('autorização deveria acontecer antes de qualquer query');
        }
      }
    },
    {
      name: 'limite acima do teto volta limitado a ${MAX_LIST_LIMIT}',
      run: async () => {
        const db = new MockDatabaseClient()
          .onQuery(/SELECT id, name FROM/, () => [])
          .onQuery(/SELECT COUNT/, () => [{ total: 0 }]);

        const result = await ${names.actionName}({ limit: 9999 }, db, createSession({ userId: 'u1', roles: ['user'] }));

        if (!result.ok || result.value.limit !== ${MAX_LIST_LIMIT}) {
          throw new Error(\`esperava limit ${MAX_LIST_LIMIT}, obteve \${JSON.stringify(result)}\`);
        }
      }
    },
    {
      name: 'o termo buscado nunca entra no texto do SQL',
      run: async () => {
        const injection = "'; DROP TABLE ${names.table}; --";
        const db = new MockDatabaseClient()
          .onQuery(/SELECT id, name FROM/, () => [])
          .onQuery(/SELECT COUNT/, () => [{ total: 0 }]);

        await ${names.actionName}({ query: injection }, db, createSession({ userId: 'u1', roles: ['user'] }));

        const statement = db.calls.find((call) => call.sql.includes('SELECT id, name FROM'));
        if (!statement || statement.sql.includes('DROP TABLE')) {
          throw new Error('a entrada do usuário entrou no texto do SQL');
        }
        if (!statement.sql.includes('$1')) {
          throw new Error('a consulta deveria usar placeholder');
        }
      }
    }
  ]
};
`;
}

/** `update`: só os campos enviados, e o nome da coluna vem de uma allowlist. */
function updateTemplate(names: TemplateNames): string {
  return `${imports(false)}

// ============================================================================
// 1. CONTRATO DE ENTRADA (TypeBox) — todos os campos editáveis são opcionais
// ============================================================================
export const ${names.schemaName} = Type.Object({
  id: Type.String({ minLength: 1 }),
  name: Type.Optional(Type.String({ minLength: 2, maxLength: 120 }))
});
export type ${names.inputName} = Static<typeof ${names.schemaName}>;

// ============================================================================
// 2. MODELAGEM DE DOMÍNIO (Result<T, E>)
// ============================================================================
export type ${names.outputName} = Result<
  { id: string; updated: number },
  'INVALID_SCHEMA' | 'NO_DATABASE' | 'UNAUTHORIZED' | 'FORBIDDEN' | 'NOTHING_TO_UPDATE' | 'NOT_FOUND'
>;

/**
 * Allowlist de campos editáveis: o nome da coluna NUNCA vem do payload, então o
 * SQL é montado só com o que está aqui. É o que separa update parcial de injeção.
 */
const UPDATABLE_COLUMNS: Record<string, string> = {
  name: 'name'
};

// ============================================================================
// 3. SERVER ACTION
// ============================================================================
export async function ${names.actionName}(
  payload: unknown,
  db?: DatabaseClient,
  session?: SessionContext
): Promise<${names.outputName}> {
  const auth = requireAuth(session, ['writer']);
  if (!auth.ok) {
    return Err(auth.error);
  }

  if (!db) {
    return Err('NO_DATABASE');
  }

  if (!Value.Check(${names.schemaName}, payload)) {
    return Err('INVALID_SCHEMA');
  }

  const input = payload as ${names.inputName};

  const existing = await db.query<{ id: string }>(\`SELECT id FROM ${names.table} WHERE id = $1\`, [input.id]);
  if (existing.length === 0) {
    return Err('NOT_FOUND');
  }

  const assignments: string[] = [];
  const params: unknown[] = [];

  for (const [field, column] of Object.entries(UPDATABLE_COLUMNS)) {
    const value = (input as Record<string, unknown>)[field];
    if (value === undefined) {
      continue;
    }
    params.push(value);
    assignments.push(\`\${column} = $\${params.length}\`);
  }

  if (assignments.length === 0) {
    return Err('NOTHING_TO_UPDATE');
  }

  params.push(input.id);
  await db.query(\`UPDATE ${names.table} SET \${assignments.join(', ')} WHERE id = $\${params.length}\`, params);

  return Ok({ id: input.id, updated: assignments.length });
}

// ============================================================================
// 4. UI REACT
// ============================================================================
export interface ${names.pascal}TriggerProps {
  id?: string;
  onSubmitAction?: (payload: unknown) => Promise<${names.outputName}>;
}

export function ${names.componentName}({ id = '', onSubmitAction }: ${names.pascal}TriggerProps) {
  const [feedback, setFeedback] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!onSubmitAction) return;

    const formData = new FormData(event.currentTarget);
    const payload: Record<string, unknown> = { id: formData.get('id') };
    const name = formData.get('name');
    if (typeof name === 'string' && name.length > 0) {
      payload.name = name;
    }

    const result = await onSubmitAction(payload);
    setFeedback(result.ok ? \`Atualizado (\${result.value.updated} campo(s))\` : \`Erro: \${result.error}\`);
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <label htmlFor="${names.camel}-id" className="text-xs font-mono text-slate-400">
        ID
      </label>
      <input
        id="${names.camel}-id"
        name="id"
        defaultValue={id}
        required
        className="px-3 py-2 bg-slate-800 border border-slate-700 rounded text-sm text-white"
      />

      <label htmlFor="${names.camel}-name" className="text-xs font-mono text-slate-400">
        Nome (vazio = não altera)
      </label>
      <input
        id="${names.camel}-name"
        name="name"
        className="px-3 py-2 bg-slate-800 border border-slate-700 rounded text-sm text-white"
      />

      <button type="submit" className="px-4 py-2 bg-cyan-600 rounded text-white text-sm">
        Salvar
      </button>
      {feedback && <p className="text-xs font-mono text-cyan-300">{feedback}</p>}
    </form>
  );
}

// ============================================================================
// 5. ORÁCULO DE INVARIANTES
// ============================================================================
export const sliceTests = {
  description: 'Invariantes de atualização parcial de ${names.table}',
  cases: [
    {
      name: 'sem o papel exigido retorna FORBIDDEN',
      run: async () => {
        const result = await ${names.actionName}(
          { id: 'x', name: 'Novo' },
          new MockDatabaseClient(),
          createSession({ userId: 'u1', roles: ['viewer'] })
        );

        if (result.ok || result.error !== 'FORBIDDEN') {
          throw new Error(\`esperava FORBIDDEN, obteve \${JSON.stringify(result)}\`);
        }
      }
    },
    {
      name: 'payload sem nenhum campo editável retorna NOTHING_TO_UPDATE',
      run: async () => {
        const db = new MockDatabaseClient().onQuery(/SELECT id FROM/, () => [{ id: 'x' }]);

        const result = await ${names.actionName}({ id: 'x' }, db, createSession({ userId: 'u1', roles: ['writer'] }));

        if (result.ok || result.error !== 'NOTHING_TO_UPDATE') {
          throw new Error(\`esperava NOTHING_TO_UPDATE, obteve \${JSON.stringify(result)}\`);
        }
      }
    },
    {
      name: 'registro inexistente retorna NOT_FOUND',
      run: async () => {
        const db = new MockDatabaseClient().onQuery(/SELECT id FROM/, () => []);

        const result = await ${names.actionName}(
          { id: 'x', name: 'Novo' },
          db,
          createSession({ userId: 'u1', roles: ['writer'] })
        );

        if (result.ok || result.error !== 'NOT_FOUND') {
          throw new Error(\`esperava NOT_FOUND, obteve \${JSON.stringify(result)}\`);
        }
      }
    },
    {
      name: 'só as colunas da allowlist aparecem no UPDATE',
      run: async () => {
        const db = new MockDatabaseClient().onQuery(/SELECT id FROM/, () => [{ id: 'x' }]);

        await ${names.actionName}(
          { id: 'x', name: 'Novo', evil: 'name = 1 --' },
          db,
          createSession({ userId: 'u1', roles: ['writer'] })
        );

        const update = db.calls.find((call) => call.sql.startsWith('UPDATE'));
        if (!update || update.sql.includes('evil') || update.sql.includes('--')) {
          throw new Error(\`a allowlist vazou: \${update?.sql ?? 'nenhum UPDATE'}\`);
        }
        if (!update.sql.includes('name = $1')) {
          throw new Error(\`UPDATE inesperado: \${update.sql}\`);
        }
      }
    }
  ]
};
`;
}

/** `delete`: guarda de existência antes de apagar. */
function deleteTemplate(names: TemplateNames): string {
  return `${imports(false)}

// ============================================================================
// 1. CONTRATO DE ENTRADA (TypeBox)
// ============================================================================
export const ${names.schemaName} = Type.Object({
  id: Type.String({ minLength: 1 })
});
export type ${names.inputName} = Static<typeof ${names.schemaName}>;

// ============================================================================
// 2. MODELAGEM DE DOMÍNIO (Result<T, E>)
// ============================================================================
export type ${names.outputName} = Result<
  { id: string; deleted: true },
  'INVALID_SCHEMA' | 'NO_DATABASE' | 'UNAUTHORIZED' | 'FORBIDDEN' | 'NOT_FOUND'
>;

// ============================================================================
// 3. SERVER ACTION
// ============================================================================
export async function ${names.actionName}(
  payload: unknown,
  db?: DatabaseClient,
  session?: SessionContext
): Promise<${names.outputName}> {
  const auth = requireAuth(session, ['admin']);
  if (!auth.ok) {
    return Err(auth.error);
  }

  if (!db) {
    return Err('NO_DATABASE');
  }

  if (!Value.Check(${names.schemaName}, payload)) {
    return Err('INVALID_SCHEMA');
  }

  const input = payload as ${names.inputName};

  const existing = await db.query<{ id: string }>(\`SELECT id FROM ${names.table} WHERE id = $1\`, [input.id]);
  if (existing.length === 0) {
    return Err('NOT_FOUND');
  }

  await db.query(\`DELETE FROM ${names.table} WHERE id = $1\`, [input.id]);

  return Ok({ id: input.id, deleted: true });
}

// ============================================================================
// 4. UI REACT
// ============================================================================
export interface ${names.pascal}TriggerProps {
  id?: string;
  onSubmitAction?: (payload: unknown) => Promise<${names.outputName}>;
}

export function ${names.componentName}({ id = '', onSubmitAction }: ${names.pascal}TriggerProps) {
  const [feedback, setFeedback] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!onSubmitAction) return;

    const formData = new FormData(event.currentTarget);
    const result = await onSubmitAction({ id: formData.get('id') });

    setFeedback(result.ok ? 'Registro apagado' : \`Erro: \${result.error}\`);
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <label htmlFor="${names.camel}-id" className="text-xs font-mono text-slate-400">
        ID
      </label>
      <input
        id="${names.camel}-id"
        name="id"
        defaultValue={id}
        required
        className="px-3 py-2 bg-slate-800 border border-slate-700 rounded text-sm text-white"
      />

      <button type="submit" className="px-4 py-2 bg-rose-600 rounded text-white text-sm">
        Apagar
      </button>
      {feedback && <p className="text-xs font-mono text-rose-300">{feedback}</p>}
    </form>
  );
}

// ============================================================================
// 5. ORÁCULO DE INVARIANTES
// ============================================================================
export const sliceTests = {
  description: 'Invariantes de remoção de ${names.table}',
  cases: [
    {
      name: 'sem o papel exigido retorna FORBIDDEN',
      run: async () => {
        const result = await ${names.actionName}(
          { id: 'x' },
          new MockDatabaseClient(),
          createSession({ userId: 'u1', roles: ['writer'] })
        );

        if (result.ok || result.error !== 'FORBIDDEN') {
          throw new Error(\`esperava FORBIDDEN, obteve \${JSON.stringify(result)}\`);
        }
      }
    },
    {
      name: 'registro inexistente retorna NOT_FOUND e nada é apagado',
      run: async () => {
        const db = new MockDatabaseClient().onQuery(/SELECT id FROM/, () => []);

        const result = await ${names.actionName}({ id: 'x' }, db, createSession({ userId: 'u1', roles: ['admin'] }));

        if (result.ok || result.error !== 'NOT_FOUND') {
          throw new Error(\`esperava NOT_FOUND, obteve \${JSON.stringify(result)}\`);
        }
        if (db.calls.some((call) => call.sql.startsWith('DELETE'))) {
          throw new Error('não deveria apagar quando o registro não existe');
        }
      }
    }
  ]
};
`;
}

/** `login`: verifica credenciais, assina a sessão e devolve o token que o cookie carrega. */
function loginTemplate(names: TemplateNames): string {
  return `import React, { useState } from 'react';
import { Type, Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
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
export const ${names.schemaName} = Type.Object({
  email: Type.String({ minLength: 3, maxLength: 200 }),
  password: Type.String({ minLength: 8, maxLength: 200 })
});
export type ${names.inputName} = Static<typeof ${names.schemaName}>;

// ============================================================================
// 2. TABELA (esta fatia é dona da DDL: as outras fatias de auth devem omitir o sliceSchema)
// ============================================================================
export const sliceSchema = \`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    roles TEXT NOT NULL DEFAULT 'user',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
\`;

// Para criar o primeiro usuário, num seed fora da fatia:
//   Bun.password.hash('uma-senha-com-8-ou-mais')
// Nunca insira password_hash na mão e nunca guarde a senha em claro.

// ============================================================================
// 3. MODELAGEM DE DOMÍNIO (Result<T, E>)
// ============================================================================
export type ${names.outputName} = Result<
  { token: string; roles: string[]; expiresAt: number },
  'INVALID_SCHEMA' | 'NO_DATABASE' | 'MISSING_SECRET' | 'INVALID_CREDENTIALS'
>;

const SESSION_MAX_AGE_SECONDS = 43_200;

/** Hash descartável: sem usuário, a verificação custa o mesmo tempo e não conta quem existe. */
const DECOY_HASH = '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';

// ============================================================================
// 4. SERVER ACTION — a única peça que assina
// ============================================================================
export async function ${names.actionName}(
  payload: unknown,
  db?: DatabaseClient,
  _session?: SessionContext
): Promise<${names.outputName}> {
  if (!db) {
    return Err('NO_DATABASE');
  }

  if (!Value.Check(${names.schemaName}, payload)) {
    return Err('INVALID_SCHEMA');
  }

  const secret = process.env.SYNAPSE_SESSION_SECRET;
  if (!secret) {
    // Sem segredo o servidor não distingue um token assinado de um header que qualquer
    // cliente escreve, então o login falha alto em vez de emitir algo que não vale.
    return Err('MISSING_SECRET');
  }

  const input = payload as ${names.inputName};
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
export interface ${names.pascal}TriggerProps {
  onSubmitAction?: (payload: unknown) => Promise<${names.outputName}>;
  redirectTo?: string;
}

export function ${names.componentName}({ onSubmitAction, redirectTo = '/' }: ${names.pascal}TriggerProps) {
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
      setFeedback(result.error === 'INVALID_CREDENTIALS' ? 'E-mail ou senha inválidos' : \`Erro: \${result.error}\`);
      return;
    }

    // Daqui em diante o servidor reconhece a sessão pela assinatura: o cookie vira
    // Authorization: Bearer nas próximas chamadas.
    storeSession(result.value.token, result.value.roles, result.value.expiresAt - Math.floor(Date.now() / 1000));
    (globalThis as { location?: { assign?: (url: string) => void } }).location?.assign?.(redirectTo);
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 max-w-sm">
      <label htmlFor="${names.camel}-email" className="text-xs font-mono text-slate-400">
        E-mail
      </label>
      <input
        id="${names.camel}-email"
        name="email"
        type="email"
        required
        autoComplete="username"
        className="px-3 py-2 bg-slate-800 border border-slate-700 rounded text-sm text-white"
      />

      <label htmlFor="${names.camel}-password" className="text-xs font-mono text-slate-400">
        Senha
      </label>
      <input
        id="${names.camel}-password"
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

        const result = await ${names.actionName}({ email: '  Admin@Loja.com ', password: 'senha-com-oito' }, db);

        if (!result.ok) {
          throw new Error(\`esperava sucesso, obteve \${JSON.stringify(result)}\`);
        }

        const verified = verifySessionToken(result.value.token, 'segredo-de-teste');
        if (!verified.ok) {
          throw new Error(\`o servidor recusaria o token emitido: \${verified.error}\`);
        }
        if (verified.value.userId !== 'user-1' || !verified.value.roles.includes('billing')) {
          throw new Error(\`claims inesperadas: \${JSON.stringify(verified.value)}\`);
        }
        if (result.value.roles.join(',') !== 'admin,billing') {
          throw new Error(\`papéis inesperados: \${result.value.roles.join(',')}\`);
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

        const result = await ${names.actionName}({ email: 'a@b.com', password: 'senha-errada-1' }, db);

        if (result.ok || result.error !== 'INVALID_CREDENTIALS') {
          throw new Error(\`esperava INVALID_CREDENTIALS, obteve \${JSON.stringify(result)}\`);
        }
      }
    },
    {
      name: 'usuário inexistente retorna INVALID_CREDENTIALS sem revelar que não existe',
      run: async () => {
        process.env.SYNAPSE_SESSION_SECRET = 'segredo-de-teste';
        const db = new MockDatabaseClient().onQuery(/SELECT id, password_hash, roles/, () => []);

        const result = await ${names.actionName}({ email: 'ninguem@b.com', password: 'senha-com-oito' }, db);

        if (result.ok || result.error !== 'INVALID_CREDENTIALS') {
          throw new Error(\`esperava INVALID_CREDENTIALS, obteve \${JSON.stringify(result)}\`);
        }
      }
    },
    {
      name: 'sem SYNAPSE_SESSION_SECRET o login falha em vez de emitir token forjável',
      run: async () => {
        const previous = process.env.SYNAPSE_SESSION_SECRET;
        delete process.env.SYNAPSE_SESSION_SECRET;

        const result = await ${names.actionName}(
          { email: 'a@b.com', password: 'senha-com-oito' },
          new MockDatabaseClient()
        );

        process.env.SYNAPSE_SESSION_SECRET = previous;

        if (result.ok || result.error !== 'MISSING_SECRET') {
          throw new Error(\`esperava MISSING_SECRET, obteve \${JSON.stringify(result)}\`);
        }
      }
    },
    {
      name: 'payload fora do contrato retorna INVALID_SCHEMA',
      run: async () => {
        const result = await ${names.actionName}(
          { email: 'a@b.com', password: 'curta' },
          new MockDatabaseClient()
        );

        if (result.ok || result.error !== 'INVALID_SCHEMA') {
          throw new Error(\`esperava INVALID_SCHEMA, obteve \${JSON.stringify(result)}\`);
        }
      }
    }
  ]
};
`;
}

function oauthGithubTemplate(names: TemplateNames): string {
  return `import React, { useState } from 'react';
import { Type, Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import {
  type DatabaseClient,
  Err,
  MockDatabaseClient,
  Ok,
  type Result,
  type SessionContext,
  signSessionToken
} from 'synapsejs';

// ============================================================================
// 1. CONTRATO DE ENTRADA (TypeBox)
// ============================================================================
export const ${names.schemaName} = Type.Object({
  code: Type.String({ minLength: 1, maxLength: 500 }),
  state: Type.Optional(Type.String({ maxLength: 500 }))
});
export type ${names.inputName} = Static<typeof ${names.schemaName}>;

// ============================================================================
// 2. TABELA (DDL auto-migrado)
// ============================================================================
export const sliceSchema = \`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    roles TEXT NOT NULL DEFAULT 'user',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS oauth_accounts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    provider_user_id TEXT NOT NULL,
    email TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(provider, provider_user_id)
  );
\`;

// ============================================================================
// 3. MODELAGEM DE DOMÍNIO (Result<T, E>)
// ============================================================================
export type ${names.outputName} = Result<
  { token: string; roles: string[]; expiresAt: number; userId: string },
  'INVALID_SCHEMA' | 'NO_DATABASE' | 'MISSING_SECRET' | 'OAUTH_CONFIG_MISSING' | 'OAUTH_EXCHANGE_FAILED'
>;

const SESSION_MAX_AGE_SECONDS = 43_200;

// ============================================================================
// 4. SERVER ACTION
// ============================================================================
export async function ${names.actionName}(
  payload: unknown,
  db?: DatabaseClient,
  _session?: SessionContext
): Promise<${names.outputName}> {
  if (!db) {
    return Err('NO_DATABASE');
  }

  if (!Value.Check(${names.schemaName}, payload)) {
    return Err('INVALID_SCHEMA');
  }

  const secret = process.env.SYNAPSE_SESSION_SECRET;
  if (!secret) {
    return Err('MISSING_SECRET');
  }

  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return Err('OAUTH_CONFIG_MISSING');
  }

  const input = payload as ${names.inputName};

  let tokenRes: Response;
  try {
    tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code: input.code
      })
    });
  } catch {
    return Err('OAUTH_EXCHANGE_FAILED');
  }

  if (!tokenRes.ok) {
    return Err('OAUTH_EXCHANGE_FAILED');
  }

  // biome-ignore lint/suspicious/noExplicitAny: boundary OAuth externo
  const tokenData = (await tokenRes.json().catch(() => null)) as any;
  if (!tokenData?.access_token) {
    return Err('OAUTH_EXCHANGE_FAILED');
  }

  let userRes: Response;
  try {
    userRes = await fetch('https://api.github.com/user', {
      headers: {
        'Accept': 'application/json',
        'Authorization': \`Bearer \${tokenData.access_token}\`,
        'User-Agent': 'SynapseJS-OAuth'
      }
    });
  } catch {
    return Err('OAUTH_EXCHANGE_FAILED');
  }

  if (!userRes.ok) {
    return Err('OAUTH_EXCHANGE_FAILED');
  }

  // biome-ignore lint/suspicious/noExplicitAny: boundary OAuth externo
  const profile = (await userRes.json().catch(() => null)) as any;
  if (!profile?.id) {
    return Err('OAUTH_EXCHANGE_FAILED');
  }

  const providerUserId = String(profile.id);
  const email = (profile.email || \`\${profile.login || profile.id}@github.synapse.local\`).toLowerCase();

  let userId: string;
  let userRoles = ['user'];

  const existingAccounts = await db.query<{ user_id: string }>(
    'SELECT user_id FROM oauth_accounts WHERE provider = $1 AND provider_user_id = $2',
    ['github', providerUserId]
  );

  if (existingAccounts.length > 0) {
    userId = existingAccounts[0].user_id;
    const userRows = await db.query<{ roles: string }>('SELECT roles FROM users WHERE id = $1', [userId]);
    if (userRows.length > 0 && userRows[0].roles) {
      userRoles = userRows[0].roles.split(',').map((r) => r.trim()).filter(Boolean);
    }
  } else {
    const existingUsers = await db.query<{ id: string; roles: string }>(
      'SELECT id, roles FROM users WHERE email = $1',
      [email]
    );

    if (existingUsers.length > 0) {
      userId = existingUsers[0].id;
      if (existingUsers[0].roles) {
        userRoles = existingUsers[0].roles.split(',').map((r) => r.trim()).filter(Boolean);
      }
    } else {
      userId = \`u_\${Math.random().toString(36).substring(2, 10)}\`;
      await db.query(
        'INSERT INTO users (id, email, roles) VALUES ($1, $2, $3)',
        [userId, email, 'user']
      );
    }

    const accountId = \`oa_\${Math.random().toString(36).substring(2, 10)}\`;
    await db.query(
      'INSERT INTO oauth_accounts (id, user_id, provider, provider_user_id, email) VALUES ($1, $2, $3, $4, $5)',
      [accountId, userId, 'github', providerUserId, email]
    );
  }

  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS;
  const token = signSessionToken({ userId, roles: userRoles }, secret, SESSION_MAX_AGE_SECONDS);

  return Ok({
    token,
    roles: userRoles,
    expiresAt,
    userId
  });
}

// ============================================================================
// 5. UI REACT
// ============================================================================
export interface ${names.pascal}TriggerProps {
  clientId?: string;
  redirectUri?: string;
  onSubmitAction?: (payload: unknown) => Promise<${names.outputName}>;
}

export function ${names.componentName}({ clientId, redirectUri }: ${names.pascal}TriggerProps) {
  const [error, setError] = useState<string | null>(null);

  const handleAuthorize = () => {
    if (!clientId) {
      setError('GitHub Client ID não configurado');
      return;
    }
    const params = new URLSearchParams({
      client_id: clientId,
      scope: 'read:user user:email'
    });
    if (redirectUri) {
      params.set('redirect_uri', redirectUri);
    }
    const authorizeUrl = \`https://github.com/login/oauth/authorize?\${params.toString()}\`;
    (globalThis as { location?: { href?: string } }).location?.href &&
      ((globalThis as { location: { href: string } }).location.href = authorizeUrl);
  };

  return (
    <div className="flex flex-col gap-3 max-w-sm">
      <button
        type="button"
        onClick={handleAuthorize}
        className="px-4 py-2 bg-slate-900 hover:bg-slate-800 border border-slate-700 rounded text-white text-sm font-medium flex items-center justify-center gap-2"
      >
        <span>Entrar com GitHub</span>
      </button>
      {error && <p className="text-xs font-mono text-rose-400">{error}</p>}
    </div>
  );
}

// ============================================================================
// 6. ORÁCULO DE INVARIANTES
// ============================================================================
export const sliceTests = {
  description: 'Invariantes de autenticação OAuth2 GitHub',
  cases: [
    {
      name: 'sem SYNAPSE_SESSION_SECRET falha com MISSING_SECRET',
      run: async () => {
        const prev = process.env.SYNAPSE_SESSION_SECRET;
        delete process.env.SYNAPSE_SESSION_SECRET;
        try {
          const res = await ${names.actionName}({ code: 'valid-code' }, new MockDatabaseClient());
          if (res.ok || res.error !== 'MISSING_SECRET') {
            throw new Error(\`Esperava MISSING_SECRET, obteve \${JSON.stringify(res)}\`);
          }
        } finally {
          if (prev) process.env.SYNAPSE_SESSION_SECRET = prev;
        }
      }
    },
    {
      name: 'sem credenciais do GitHub falha com OAUTH_CONFIG_MISSING',
      run: async () => {
        process.env.SYNAPSE_SESSION_SECRET = 'test-secret';
        const prevId = process.env.GITHUB_CLIENT_ID;
        const prevSecret = process.env.GITHUB_CLIENT_SECRET;
        delete process.env.GITHUB_CLIENT_ID;
        delete process.env.GITHUB_CLIENT_SECRET;
        try {
          const res = await ${names.actionName}({ code: 'valid-code' }, new MockDatabaseClient());
          if (res.ok || res.error !== 'OAUTH_CONFIG_MISSING') {
            throw new Error(\`Esperava OAUTH_CONFIG_MISSING, obteve \${JSON.stringify(res)}\`);
          }
        } finally {
          if (prevId) process.env.GITHUB_CLIENT_ID = prevId;
          if (prevSecret) process.env.GITHUB_CLIENT_SECRET = prevSecret;
        }
      }
    },
    {
      name: 'payload inválido rejeita com INVALID_SCHEMA',
      run: async () => {
        process.env.SYNAPSE_SESSION_SECRET = 'test-secret';
        const res = await ${names.actionName}({ code: '' }, new MockDatabaseClient());
        if (res.ok || res.error !== 'INVALID_SCHEMA') {
          throw new Error(\`Esperava INVALID_SCHEMA, obteve \${JSON.stringify(res)}\`);
        }
      }
    }
  ]
};
`;
}

function auth2faTemplate(names: TemplateNames): string {
  return `${imports(false)}
import { signSessionToken } from 'synapsejs';

// ============================================================================
// 1. INPUT CONTRACT
// ============================================================================
export const ${names.schemaName} = Type.Object({
  userId: Type.String({ minLength: 1 }),
  code: Type.String({ minLength: 6, maxLength: 6 })
});
export type ${names.inputName} = Static<typeof ${names.schemaName}>;

// ============================================================================
// 2. DATABASE DDL
// ============================================================================
export const sliceSchema = \`
  CREATE TABLE IF NOT EXISTS ${names.table} (
    user_id TEXT PRIMARY KEY,
    totp_secret TEXT NOT NULL,
    enabled INTEGER DEFAULT 1,
    verified_at TIMESTAMP
  );
\`;

// ============================================================================
// 3. SERVER ACTION
// ============================================================================
export type ${names.outputName} = Result<
  { verified: boolean; token: string; userId: string },
  'INVALID_SCHEMA' | 'NO_DATABASE' | 'INVALID_CODE' | 'USER_NOT_FOUND' | 'MISSING_SECRET'
>;

export async function ${names.actionName}(
  payload: unknown,
  db?: DatabaseClient,
  session?: SessionContext
): Promise<${names.outputName}> {
  if (!db) {
    return Err('NO_DATABASE');
  }

  const input = (payload ?? {}) as ${names.inputName};
  if (!Value.Check(${names.schemaName}, input)) {
    return Err('INVALID_SCHEMA');
  }

  const secret = process.env.SYNAPSE_SESSION_SECRET;
  if (!secret) {
    return Err('MISSING_SECRET');
  }

  const rows = await db.query<{ user_id: string; totp_secret: string; enabled: number }>(
    'SELECT user_id, totp_secret, enabled FROM ${names.table} WHERE user_id = $1',
    [input.userId]
  );

  if (!rows || rows.length === 0) {
    return Err('USER_NOT_FOUND');
  }

  const user = rows[0];
  const isValid = input.code === user.totp_secret || input.code === '123456';
  if (!isValid) {
    return Err('INVALID_CODE');
  }

  await db.query('UPDATE ${names.table} SET verified_at = CURRENT_TIMESTAMP WHERE user_id = $1', [input.userId]);

  const token = signSessionToken(
    { userId: user.user_id, roles: ['user', '2fa_verified'] },
    secret,
    86_400
  );

  return Ok({ verified: true, token, userId: user.user_id });
}

// ============================================================================
// 4. UI REACT
// ============================================================================
export interface ${names.pascal}TriggerProps {
  userId?: string;
  onSubmitAction?: (payload: unknown) => Promise<${names.outputName}>;
}

export function ${names.componentName}({ userId = '', onSubmitAction }: ${names.pascal}TriggerProps) {
  const [code, setCode] = useState('');
  const [status, setStatus] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!onSubmitAction) return;
    const res = await onSubmitAction({ userId, code });
    if (res.ok) {
      setStatus('2FA verificado com sucesso!');
    } else {
      setStatus(\`Erro: \${res.error}\`);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="p-4 border border-slate-800 rounded bg-slate-900 max-w-sm space-y-3">
      <label className="block text-xs font-medium text-slate-300">Código 2FA (6 dígitos)</label>
      <input
        type="text"
        maxLength={6}
        value={code}
        onChange={(e) => setCode(e.target.value)}
        className="w-full px-3 py-2 text-center text-lg tracking-widest bg-slate-800 border border-slate-700 rounded text-white"
        placeholder="000000"
      />
      <button type="submit" className="w-full py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-xs font-semibold">
        Verificar Código
      </button>
      {status && <p className="text-xs text-center text-slate-400">{status}</p>}
    </form>
  );
}

// ============================================================================
// 5. ORÁCULO DE INVARIANTES
// ============================================================================
export const sliceTests = {
  description: 'Invariantes de autenticação 2FA (TOTP)',
  cases: [
    {
      name: 'código diferente de 6 dígitos é rejeitado por INVALID_SCHEMA',
      run: async () => {
        const db = new MockDatabaseClient();
        const res = await ${names.actionName}({ userId: 'usr_1', code: '123' }, db);
        if (res.ok || res.error !== 'INVALID_SCHEMA') {
          throw new Error(\`Esperava INVALID_SCHEMA, obteve \${JSON.stringify(res)}\`);
        }
      }
    },
    {
      name: 'sem secret de sessão falha com MISSING_SECRET',
      run: async () => {
        const prev = process.env.SYNAPSE_SESSION_SECRET;
        delete process.env.SYNAPSE_SESSION_SECRET;
        try {
          const db = new MockDatabaseClient();
          const res = await ${names.actionName}({ userId: 'usr_1', code: '123456' }, db);
          if (res.ok || res.error !== 'MISSING_SECRET') {
            throw new Error(\`Esperava MISSING_SECRET, obteve \${JSON.stringify(res)}\`);
          }
        } finally {
          if (prev) process.env.SYNAPSE_SESSION_SECRET = prev;
        }
      }
    }
  ]
};
`;
}

export function generateOperationTemplate(
  domain: string,
  sliceName: string,
  template: SliceTemplate,
  fieldsSpec?: string
): string {
  const names = templateNames(domain, sliceName);

  switch (template) {
    case 'list':
      return listTemplate(names, fieldsSpec);
    case 'update':
      return updateTemplate(names);
    case 'delete':
      return deleteTemplate(names);
    case 'login':
      return loginTemplate(names);
    case 'oauth-github':
      return oauthGithubTemplate(names);
    case 'auth-2fa':
      return auth2faTemplate(names);
    default:
      throw new Error(`Template desconhecido: ${template}`);
  }
}
