import React from 'react';
import { Type, Static } from '@sinclair/typebox';
import { Ok, type Result } from 'synapsejs';
import { createOrderAction } from './create-order.slice';

export const ImportsSliceInputSchema = Type.Object({ id: Type.String() });
export type ImportsSliceInput = Static<typeof ImportsSliceInputSchema>;

export type ImportsSliceOutput = Result<{ ok: true }, 'NOPE'>;

export async function importsSliceAction(_payload: unknown): Promise<ImportsSliceOutput> {
  await createOrderAction({});
  return Ok({ ok: true });
}

export function ImportsSliceTrigger() {
  return <button>nada</button>;
}

export const sliceTests = {
  cases: [{ name: 'sempre ok', run: () => undefined }]
};
