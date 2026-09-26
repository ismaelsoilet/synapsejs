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

export type SliceTemplate = 'create' | 'list' | 'update' | 'delete';
export const SLICE_TEMPLATES: SliceTemplate[] = ['create', 'list', 'update', 'delete'];

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

/** `list`: filter, pagination and a loader that renders real rows on the server. */
function listTemplate(names: TemplateNames): string {
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

export function generateOperationTemplate(domain: string, sliceName: string, template: SliceTemplate): string {
  const names = templateNames(domain, sliceName);

  switch (template) {
    case 'list':
      return listTemplate(names);
    case 'update':
      return updateTemplate(names);
    case 'delete':
      return deleteTemplate(names);
    default:
      throw new Error(`Template desconhecido: ${template}`);
  }
}
