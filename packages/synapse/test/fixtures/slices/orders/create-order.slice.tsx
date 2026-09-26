import React, { useState } from 'react';
import { Type, Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { type DatabaseClient, Ok, Err, type Result, type SessionContext } from 'synapsejs';
import './side-effect';

export const OrderInputSchema = Type.Object({
  customerId: Type.String({ minLength: 10 }),
  amountCents: Type.Integer({ minimum: 1 })
});
export type OrderInput = Static<typeof OrderInputSchema>;

export const sliceSchema = `
  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL
  );
`;

export type OrderOutput = Result<
  { orderId: string; label: string },
  'INVALID_SCHEMA' | 'NO_DATABASE' | 'PERSISTENCE_FAILED'
>;

function formatAmount(cents: number): string {
  return `${(cents / 100).toFixed(2)} BRL`;
}

// The database is optional so the same call site is valid on the server (which
// injects it) and on the client (where the call becomes an RPC stub).
export async function createOrderAction(
  payload: unknown,
  db?: DatabaseClient,
  session?: SessionContext
): Promise<OrderOutput> {
  if (!db) {
    return Err('NO_DATABASE');
  }

  if (!Value.Check(OrderInputSchema, payload)) {
    return Err('INVALID_SCHEMA');
  }

  const input = payload as OrderInput;
  await db.query(`INSERT INTO orders (id, customer_id) VALUES ($1, $2)`, [
    crypto.randomUUID(),
    input.customerId
  ]);

  return Ok({ orderId: 'order-1', label: formatAmount(input.amountCents) });
}

export function CreateOrderTrigger({ amountCents = 500 }: { amountCents?: number }) {
  const [status, setStatus] = useState('idle');
  const label = formatAmount(amountCents);

  const submit = async () => {
    const result = await createOrderAction({ customerId: 'cust-1234567890', amountCents });
    setStatus(result.ok ? `ok ${result.value.label}` : `err ${result.error}`);
  };

  return (
    <div>
      <label htmlFor="order-tier">Faixa de preço</label>
      <select id="order-tier" name="tier" defaultValue="padrao">
        <option value="padrao">Padrão</option>
        <option value="expresso">Expresso</option>
      </select>
      <button type="button" onClick={submit}>
        {label} / {status}
      </button>
    </div>
  );
}
