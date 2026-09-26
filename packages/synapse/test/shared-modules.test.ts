import { afterAll, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { artifactDirectory, splitSlice, verifySplit, writeSplitArtifacts } from '../src/compiler/slice-splitter';
import { createSession } from '../src/core/session-context';
import { SqliteDatabaseClient } from '../src/core/sqlite-client';

const appDir = path.resolve(import.meta.dir, 'fixtures', 'generated-shared');

afterAll(() => {
  fs.rmSync(appDir, { recursive: true, force: true });
});

/**
 * O caminho sancionado: o que duas fatias precisam fazer junto vive em `src/shared/`, recebe o
 * `db` por parâmetro e abre a transação lá dentro. O módulo pode lançar; a fatia converte a
 * falha em Err, que é como o contrato de action se mantém sem exceção.
 */
function writeSharedModule(): void {
  const file = path.join(appDir, 'src', 'shared', 'place-order.ts');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    `import type { DatabaseClient } from 'synapsejs';

export interface PlacedOrder {
  orderId: string;
  remaining: number;
}

export class OutOfStockError extends Error {
  constructor(sku: string) {
    super(\`ESTOQUE_INSUFICIENTE:\${sku}\`);
  }
}

/** Duas tabelas, duas fatias, uma atomicidade: ou as duas mudam, ou nenhuma muda. */
export async function placeOrder(
  db: DatabaseClient,
  input: { orderId: string; sku: string; quantity: number }
): Promise<PlacedOrder> {
  return db.transaction(async (tx) => {
    const updated = await tx.query<{ quantity: number }>(
      'UPDATE stock SET quantity = quantity - $1 WHERE sku = $2 AND quantity >= $1 RETURNING quantity',
      [input.quantity, input.sku]
    );

    if (updated.length === 0) {
      throw new OutOfStockError(input.sku);
    }

    await tx.query('INSERT INTO orders (id, sku, quantity) VALUES ($1, $2, $3)', [
      input.orderId,
      input.sku,
      input.quantity
    ]);

    return { orderId: input.orderId, remaining: updated[0].quantity };
  });
}
`,
    'utf-8'
  );
}

function writeSlice(): string {
  const file = path.join(appDir, 'src', 'slices', 'orders', 'place-order.slice.tsx');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    `import React from 'react';
import { Type, Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { type DatabaseClient, Err, Ok, type Result, type SessionContext, requireAuth } from 'synapsejs';
import { OutOfStockError, placeOrder } from '../../shared/place-order';

export const PlaceOrderInputSchema = Type.Object({
  sku: Type.String({ minLength: 1 }),
  quantity: Type.Integer({ minimum: 1 })
});
export type PlaceOrderInput = Static<typeof PlaceOrderInputSchema>;

export type PlaceOrderOutput = Result<
  { orderId: string; remaining: number },
  'INVALID_SCHEMA' | 'NO_DATABASE' | 'UNAUTHORIZED' | 'FORBIDDEN' | 'OUT_OF_STOCK'
>;

export async function placeOrderAction(
  payload: unknown,
  db?: DatabaseClient,
  session?: SessionContext
): Promise<PlaceOrderOutput> {
  const auth = requireAuth(session, ['sales']);
  if (!auth.ok) {
    return Err(auth.error);
  }

  if (!db) {
    return Err('NO_DATABASE');
  }

  if (!Value.Check(PlaceOrderInputSchema, payload)) {
    return Err('INVALID_SCHEMA');
  }

  const input = payload as PlaceOrderInput;

  try {
    const placed = await placeOrder(db, { orderId: crypto.randomUUID(), ...input });
    return Ok(placed);
  } catch (err) {
    // O módulo compartilhado pode lançar; a action continua devolvendo valor.
    return Err(err instanceof OutOfStockError ? 'OUT_OF_STOCK' : 'NO_DATABASE');
  }
}

export function PlaceOrderTrigger() {
  return <button>comprar</button>;
}

export const sliceTests = {
  cases: [{ name: 'sempre ok', run: () => undefined }]
};
`,
    'utf-8'
  );

  return file;
}

function database(): SqliteDatabaseClient {
  const db = new SqliteDatabaseClient(':memory:');
  db.initSchema(`
    CREATE TABLE orders (id TEXT PRIMARY KEY, sku TEXT NOT NULL, quantity INTEGER NOT NULL);
    CREATE TABLE stock (sku TEXT PRIMARY KEY, quantity INTEGER NOT NULL);
  `);

  return db;
}

describe('shared modules', () => {
  it('lets a slice use a module from src/shared and still passes both gates', () => {
    writeSharedModule();
    const sliceFile = writeSlice();

    const split = splitSlice(sliceFile, appDir);
    expect(split.ok).toBe(true);
    if (!split.ok) {
      return;
    }

    const outDir = artifactDirectory(appDir, split.value.sliceName);
    writeSplitArtifacts(split.value, outDir);

    const verification = verifySplit(split.value, outDir);
    expect(verification.diagnostics).toEqual([]);
    expect(verification.leaks).toEqual([]);

    const client = split.value.artifacts.find((artifact) => artifact.kind === 'client');
    expect(client?.code).not.toContain('place-order.ts');
  });

  it('commits both writes when the transaction succeeds', async () => {
    writeSharedModule();
    const sliceFile = writeSlice();
    const db = database();
    await db.query('INSERT INTO stock (sku, quantity) VALUES ($1, $2)', ['camiseta', 5]);

    const { placeOrderAction } = await import(sliceFile);
    const result = await placeOrderAction(
      { sku: 'camiseta', quantity: 2 },
      db,
      createSession({ userId: 'u1', roles: ['sales'] })
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.remaining).toBe(3);
    }

    expect(await db.query('SELECT quantity FROM stock WHERE sku = $1', ['camiseta'])).toEqual([{ quantity: 3 }]);
    expect(await db.query('SELECT sku FROM orders')).toEqual([{ sku: 'camiseta' }]);
  });

  it('rolls both writes back when the second one fails, and still answers with a value', async () => {
    writeSharedModule();
    const sliceFile = writeSlice();
    const db = database();
    await db.query('INSERT INTO stock (sku, quantity) VALUES ($1, $2)', ['camiseta', 1]);

    const { placeOrderAction } = await import(sliceFile);
    const result = await placeOrderAction(
      { sku: 'camiseta', quantity: 99 },
      db,
      createSession({ userId: 'u1', roles: ['sales'] })
    );

    // Nunca lança: a exceção do módulo compartilhado vira um valor de domínio.
    expect(result).toEqual({ ok: false, error: 'OUT_OF_STOCK' });

    // E nada ficou pela metade: o estoque não baixou e nenhum pedido nasceu.
    expect(await db.query('SELECT quantity FROM stock WHERE sku = $1', ['camiseta'])).toEqual([{ quantity: 1 }]);
    expect(await db.query('SELECT sku FROM orders')).toEqual([]);
  });

  it('starts no transaction at all when the caller is not authorized', async () => {
    writeSharedModule();
    const sliceFile = writeSlice();
    const db = database();
    await db.query('INSERT INTO stock (sku, quantity) VALUES ($1, $2)', ['camiseta', 5]);

    const { placeOrderAction } = await import(sliceFile);
    const result = await placeOrderAction(
      { sku: 'camiseta', quantity: 1 },
      db,
      createSession({ userId: 'u1', roles: ['viewer'] })
    );

    expect(result).toEqual({ ok: false, error: 'FORBIDDEN' });
    // Autorização antes de qualquer escrita: o estoque continua intacto.
    expect(await db.query('SELECT quantity FROM stock WHERE sku = $1', ['camiseta'])).toEqual([{ quantity: 5 }]);
    expect(await db.query('SELECT sku FROM orders')).toEqual([]);
  });
});
