/**
 * SynapseJS - Slice Scaffolder for Autonomous AI Agents
 *
 * Generates an end-to-end atomic .slice.tsx file with zero boilerplate,
 * including TypeBox schema, Result types, server action, React UI form, and Fast-Check PBT tests.
 */

import * as fs from 'fs';
import * as path from 'path';
import { Err, Ok, type Result } from '../core/machine-types';
import { generateFormFieldsCode, generateSqlColumns, generateTypeBoxProperties, parseFields } from './fields-parser';
import { resolveSlicesDir, type SlicesDirErrorCode } from './slice-discovery';
import { generateOperationTemplate, type SliceTemplate } from './slice-templates';

export type { SliceTemplate };

export function toPascalCase(str: string): string {
  return str
    .split(/[-_]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');
}

export function toCamelCase(str: string): string {
  const pascal = toPascalCase(str);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

export function generateFieldsSliceTemplate(domain: string, sliceName: string, fieldsSpec: string): string {
  const pascal = toPascalCase(sliceName);
  const camel = toCamelCase(sliceName);
  const tableName = domain.replace(/[^a-zA-Z0-9_]/g, '_');
  const inputSchemaName = `${pascal}InputSchema`;
  const inputTypeName = `${pascal}Input`;
  const outputTypeName = `${pascal}Output`;
  const actionName = `${camel}Action`;
  const triggerName = `${pascal}Trigger`;

  const fields = parseFields(fieldsSpec);
  const tbProps = generateTypeBoxProperties(fields);
  const sqlCols = generateSqlColumns(fields);
  const formFields = generateFormFieldsCode(fields);

  return `import React, { useState } from 'react';
import { Type, Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import * as fc from 'fast-check';
import {
  type DatabaseClient,
  Result,
  Ok,
  Err,
  MockDatabaseClient,
  type SessionContext,
  DataForm,
  Card
} from 'synapsejs';

// ============================================================================
// 1. CONTRATO DE ENTRADA JIT (TypeBox)
// ============================================================================
export const ${inputSchemaName} = Type.Object({
${tbProps}
}, { additionalProperties: true });
export type ${inputTypeName} = Static<typeof ${inputSchemaName}>;

// DDL Schema Declarativo da Fatia (Auto-Migrado pelo Synapse)
export const sliceSchema = \`
  CREATE TABLE IF NOT EXISTS ${tableName} (
    id TEXT PRIMARY KEY,
${sqlCols},
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
\`;

// ============================================================================
// 2. MODELAGEM ESTRITA DO DOMÍNIO (Result<T, E>)
// ============================================================================
export type ${outputTypeName} = Result<
  { id: string } & ${inputTypeName},
  'INVALID_SCHEMA' | 'NO_DATABASE' | 'PERSISTENCE_FAILED'
>;

// ============================================================================
// 3. EXECUÇÃO DE SERVIDOR PURA (Server Action)
// ============================================================================
export async function ${actionName}(
  payload: unknown,
  db?: DatabaseClient,
  session?: SessionContext
): Promise<${outputTypeName}> {
  if (!db) {
    return Err('NO_DATABASE');
  }

  if (!Value.Check(${inputSchemaName}, payload)) {
    return Err('INVALID_SCHEMA');
  }
  const input = payload as ${inputTypeName};

  const generatedId = crypto.randomUUID();

  try {
    const inserted = await db.insert<{ id: string } & ${inputTypeName}>('${tableName}', {
      id: generatedId,
      ...input
    });
    return Ok(inserted);
  } catch (_err) {
    return Err('PERSISTENCE_FAILED');
  }
}

// ============================================================================
// 4. VISUALIZAÇÃO INTERATIVA DA UI (React)
// ============================================================================
export interface ${pascal}TriggerProps {
  onSubmitAction?: (payload: unknown) => Promise<${outputTypeName}>;
}

const FORM_FIELDS = ${formFields};

export function ${triggerName}({ onSubmitAction }: ${pascal}TriggerProps) {
  const [feedback, setFeedback] = useState<string | null>(null);

  const handleSubmit = async (formData: Record<string, unknown>) => {
    if (!onSubmitAction) return;
    const res = await onSubmitAction(formData);
    if (res.ok) {
      setFeedback('Registro criado com sucesso! ID: ' + res.value.id);
    } else {
      setFeedback('Erro: ' + res.error);
    }
  };

  return (
    <Card title="${pascal}" subtitle="Gerenciado por SynapseJS">
      <DataForm
        fields={FORM_FIELDS}
        onSubmit={handleSubmit}
        submitLabel="Salvar ${pascal}"
      />
      {feedback && (
        <div className="mt-4 p-3 rounded font-mono text-xs bg-slate-800 text-slate-300">
          {feedback}
        </div>
      )}
    </Card>
  );
}

// ============================================================================
// 5. ORÁCULO DE AUTO-VERIFICAÇÃO PBT (Property-Based Testing)
// ============================================================================
export const sliceTests = {
  description: 'Invariantes de ${sliceName}',
  cases: [
    {
      name: 'payload inválido retorna INVALID_SCHEMA',
      run: async () => {
        const result = await ${actionName}({ invalidField: 123 }, new MockDatabaseClient());
        if (result.ok || result.error !== 'INVALID_SCHEMA') {
          throw new Error('esperava INVALID_SCHEMA');
        }
      }
    },
    {
      name: 'sem conexão de banco retorna NO_DATABASE',
      run: async () => {
        const result = await ${actionName}({});
        if (result.ok || result.error !== 'NO_DATABASE') {
          throw new Error('esperava NO_DATABASE');
        }
      }
    }
  ]
};
`;
}

export function generateSliceTemplate(domain: string, sliceName: string, fieldsSpec?: string): string {
  if (fieldsSpec?.trim()) {
    return generateFieldsSliceTemplate(domain, sliceName, fieldsSpec);
  }
  const pascal = toPascalCase(sliceName);
  const camel = toCamelCase(sliceName);
  const tableName = domain.replace(/[^a-zA-Z0-9_]/g, '_');
  const inputSchemaName = `${pascal}InputSchema`;
  const inputTypeName = `${pascal}Input`;
  const outputTypeName = `${pascal}Output`;
  const actionName = `${camel}Action`;
  const triggerName = `${pascal}Trigger`;

  return `import React, { useState } from 'react';
import { Type, Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import * as fc from 'fast-check';
import { 
  type DatabaseClient, 
  Result, 
  Ok, 
  Err, 
  MockDatabaseClient, 
  type SessionContext 
} from 'synapsejs';

// ============================================================================
// 1. CONTRATO DE ENTRADA JIT (TypeBox)
// ============================================================================
export const ${inputSchemaName} = Type.Object({
  name: Type.String({ minLength: 2, maxLength: 100 }),
  email: Type.String({ format: 'email' }),
  metadata: Type.Optional(Type.String())
}, { additionalProperties: true });
export type ${inputTypeName} = Static<typeof ${inputSchemaName}>;

// DDL Schema Declarativo da Fatia (Auto-Migrado pelo Synapse)
export const sliceSchema = \`
  CREATE TABLE IF NOT EXISTS ${tableName} (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
\`;

// ============================================================================
// 2. MODELAGEM ESTRITA DO DOMÍNIO (Result<T, E>)
// ============================================================================
export type ${outputTypeName} = Result<
  { id: string; name: string; email: string; createdAt: string },
  'INVALID_SCHEMA' | 'NO_DATABASE' | 'DUPLICATE_EMAIL' | 'PERSISTENCE_FAILED'
>;

// ============================================================================
// 3. EXECUÇÃO DE SERVIDOR PURA (Server Action)
// O banco é opcional para que o mesmo ponto de chamada valha no servidor
// (que injeta a conexão) e no cliente (onde a chamada vira stub RPC).
// ============================================================================
export async function ${actionName}(
  payload: unknown,
  db?: DatabaseClient,
  session?: SessionContext
): Promise<${outputTypeName}> {
  if (!db) {
    return Err('NO_DATABASE');
  }

  // Parsing JIT em memória
  if (!Value.Check(${inputSchemaName}, payload)) {
    return Err('INVALID_SCHEMA');
  }
  const input = payload as ${inputTypeName};

  // Checagem de Duplicidade
  const existing = await db.query<{ id: string }>(
    \`SELECT id FROM ${tableName} WHERE email = $1\`,
    [input.email]
  );
  if (existing.length > 0) {
    return Err('DUPLICATE_EMAIL');
  }

  const generatedId = crypto.randomUUID();
  const now = new Date().toISOString();

  await db.query(
    \`INSERT INTO ${tableName} (id, name, email) VALUES ($1, $2, $3)\`,
    [generatedId, input.name, input.email]
  );

  return Ok({
    id: generatedId,
    name: input.name,
    email: input.email,
    createdAt: now
  });
}

// ============================================================================
// 4. VISUALIZAÇÃO INTERATIVA DA UI (React)
// ============================================================================
export interface ${pascal}TriggerProps {
  onSubmitAction?: (payload: unknown) => Promise<${outputTypeName}>;
}

export function ${triggerName}({ onSubmitAction }: ${pascal}TriggerProps) {
  const [feedback, setFeedback] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!onSubmitAction) return;

    setIsSubmitting(true);
    const formData = new FormData(e.currentTarget);
    const payload = {
      name: formData.get('name') as string,
      email: formData.get('email') as string
    };

    const res = await onSubmitAction(payload);
    setIsSubmitting(false);

    if (res.ok) {
      setFeedback(\`Registro criado com sucesso! ID: \${res.value.id}\`);
    } else {
      setFeedback(\`Erro ao processar: \${res.error}\`);
    }
  };

  return (
    <div className="synapse-${domain}-slice">
      <h3 className="text-xl font-bold text-white mb-4">Novo Registro: ${pascal}</h3>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div>
          <label className="block text-xs font-mono text-slate-300 mb-1">Nome Completo:</label>
          <input
            type="text"
            name="name"
            required
            minLength={2}
            placeholder="Ex: João da Silva"
            className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-white text-sm focus:border-cyan-500 focus:outline-none"
          />
        </div>

        <div>
          <label className="block text-xs font-mono text-slate-300 mb-1">E-mail Corporativo:</label>
          <input
            type="email"
            name="email"
            required
            placeholder="usuario@empresa.com"
            className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-white text-sm focus:border-cyan-500 focus:outline-none"
          />
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full py-2.5 px-4 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-medium text-sm rounded-lg shadow-lg shadow-cyan-600/20 transition-all disabled:opacity-50"
        >
          {isSubmitting ? 'Salvando...' : 'Salvar Registro'}
        </button>
      </form>

      {feedback && (
        <div className="mt-4 p-3 rounded-lg font-mono text-xs bg-slate-800 border border-slate-700 text-slate-300">
          {feedback}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// 5. ORÁCULO DE AUTO-VERIFICAÇÃO PBT (Property-Based Testing)
// ============================================================================
export const sliceTests = {
  description: 'Invariantes de ${sliceName}',
  cases: [
    {
      name: 'nome curto ou e-mail inválido retornam INVALID_SCHEMA',
      run: async () => {
        fc.assert(
          fc.asyncProperty(
            fc.string({ minLength: 0, maxLength: 1 }),
            fc.stringMatching(/^[a-z0-9]{1,10}$/),
            async (shortName, invalidEmail) => {
              const result = await ${actionName}(
                { name: shortName, email: invalidEmail },
                new MockDatabaseClient()
              );
              return result.ok === false && result.error === 'INVALID_SCHEMA';
            }
          )
        );
      }
    },
    {
      name: 'e-mail já cadastrado retorna DUPLICATE_EMAIL',
      run: async () => {
        const mockDbDuplicate = new MockDatabaseClient();
        mockDbDuplicate.onQuery(/SELECT id FROM/, () => [{ id: 'existing-id-123' }]);

        const dupResult = await ${actionName}(
          { name: 'Usuario Valido', email: 'teste@dominio.com' },
          mockDbDuplicate
        );

        if (dupResult.ok || dupResult.error !== 'DUPLICATE_EMAIL') {
          throw new Error(\`Invariante violada: esperava DUPLICATE_EMAIL, obteve \${JSON.stringify(dupResult)}\`);
        }
      }
    },
    {
      name: 'sem conexão de banco retorna NO_DATABASE',
      run: async () => {
        const result = await ${actionName}({ name: 'Usuario Valido', email: 'teste@dominio.com' });

        if (result.ok || result.error !== 'NO_DATABASE') {
          throw new Error(\`Invariante violada: esperava NO_DATABASE, obteve \${JSON.stringify(result)}\`);
        }
      }
    }
  ]
};
`;
}

export type ScaffoldErrorCode = SlicesDirErrorCode | 'SLICE_EXISTS' | 'WRITE_FAILED';

export interface ScaffoldError {
  code: ScaffoldErrorCode;
  message: string;
  candidates: string[];
}

/**
 * Resolves where a new slice should be written.
 *
 * A write target may legitimately not exist yet, so absence falls back to
 * `<baseDir>/src/slices`. Ambiguity is always fatal — guessing the wrong app
 * would scatter slices across the workspace.
 */
function resolveScaffoldTarget(baseDir: string): Result<string, ScaffoldError> {
  const resolution = resolveSlicesDir(baseDir);

  if (resolution.ok) {
    return Ok(resolution.value.slicesDir);
  }

  if (resolution.error.code === 'AMBIGUOUS_SLICES_DIR') {
    return Err({
      code: resolution.error.code,
      message: resolution.error.message,
      candidates: resolution.error.candidates
    });
  }

  return Ok(path.join(path.resolve(baseDir), 'src', 'slices'));
}

export function scaffoldSlice(
  domain: string,
  sliceName: string,
  baseDir: string = process.cwd(),
  template: SliceTemplate = 'create',
  fieldsSpec?: string
): Result<string, ScaffoldError> {
  const target = resolveScaffoldTarget(baseDir);

  if (!target.ok) {
    return target;
  }

  const targetDir = path.join(target.value, domain);
  const targetFile = path.join(targetDir, `${sliceName}.slice.tsx`);

  if (fs.existsSync(targetFile)) {
    return Err({
      code: 'SLICE_EXISTS',
      message: `A fatia '${targetFile}' já existe.`,
      candidates: [targetFile]
    });
  }

  try {
    fs.mkdirSync(targetDir, { recursive: true });
    const content =
      template === 'create'
        ? generateSliceTemplate(domain, sliceName, fieldsSpec)
        : generateOperationTemplate(domain, sliceName, template, fieldsSpec);
    fs.writeFileSync(targetFile, content, 'utf-8');
  } catch (err) {
    return Err({
      code: 'WRITE_FAILED',
      message: err instanceof Error ? err.message : String(err),
      candidates: [targetFile]
    });
  }

  return Ok(targetFile);
}

/**
 * The set an agent would otherwise invent: the four operations of one resource,
 * each in its own file, all in the same shape as the rest of the framework.
 */
export function scaffoldCrud(
  domain: string,
  resource: string,
  baseDir: string = process.cwd(),
  fieldsSpec?: string
): Result<string[], ScaffoldError> {
  const created: string[] = [];

  for (const template of ['create', 'list', 'update', 'delete'] as const) {
    const result = scaffoldSlice(domain, `${template}-${resource}`, baseDir, template, fieldsSpec);

    if (!result.ok) {
      return Err({
        code: result.error.code,
        message: `${template}: ${result.error.message}`,
        candidates: result.error.candidates
      });
    }

    created.push(result.value);
  }

  return Ok(created);
}

if (import.meta.main) {
  const domain = process.argv[2] || 'core';
  const name = process.argv[3] || 'example-feature';
  const created = scaffoldSlice(domain, name);

  if (created.ok) {
    process.stdout.write(`✅ [Scaffolder] Nova fatia gerada com sucesso: ${created.value}\n`);
    process.exit(0);
  }

  process.stderr.write(`❌ [Scaffolder] ${created.error.code}: ${created.error.message}\n`);
  process.exit(1);
}
