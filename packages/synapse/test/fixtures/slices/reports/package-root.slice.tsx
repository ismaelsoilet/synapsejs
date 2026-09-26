import React from 'react';
import { Type, Static } from '@sinclair/typebox';
import { Ok, type Result, rpcCall } from 'synapsejs';

export const PackageRootInputSchema = Type.Object({ id: Type.String() });
export type PackageRootInput = Static<typeof PackageRootInputSchema>;

export type PackageRootOutput = Result<{ ok: true }, 'NOPE'>;

export async function packageRootAction(_payload: unknown): Promise<PackageRootOutput> {
  return Ok({ ok: true });
}

export function PackageRootTrigger() {
  // `rpcCall` é um valor do índice do pacote: o gate do cliente tem que reprovar.
  const transport = rpcCall;

  return <button onClick={() => transport}>{String(Boolean(transport))}</button>;
}

export const sliceTests = {
  cases: [{ name: 'sempre ok', run: () => undefined }]
};
