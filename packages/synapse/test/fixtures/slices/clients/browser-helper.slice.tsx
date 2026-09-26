import React from 'react';
import { Type, Static } from '@sinclair/typebox';
import { Ok, type Result } from 'synapsejs';
import { storeSession } from 'synapsejs/client';

export const BrowserHelperInputSchema = Type.Object({ token: Type.String() });
export type BrowserHelperInput = Static<typeof BrowserHelperInputSchema>;

export type BrowserHelperOutput = Result<{ stored: true }, 'NOPE'>;

export async function browserHelperAction(_payload: unknown): Promise<BrowserHelperOutput> {
  return Ok({ stored: true });
}

export function BrowserHelperTrigger() {
  // Valor vindo da entrada de cliente: o bundle precisa construir e sair sem o servidor.
  return <button onClick={() => storeSession('token-de-teste', ['user'])}>entrar</button>;
}

export const sliceTests = {
  cases: [{ name: 'sempre ok', run: () => undefined }]
};
