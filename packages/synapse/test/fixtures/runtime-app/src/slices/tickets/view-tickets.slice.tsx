import React from 'react';
import { Err, Ok, type Result, type SliceLoaderContext } from 'synapsejs';

export type ViewTicketsOutput = Result<{ marker: string }, 'NO_DATABASE'>;

export async function viewTicketsAction(payload: unknown): Promise<ViewTicketsOutput> {
  void payload;
  return Ok({ marker: 'RPC-TICKETS-ok' });
}

export async function ViewTicketsLoader(context: SliceLoaderContext) {
  if (context.params.fail === '1') {
    throw new Error('loader falhou de proposito');
  }
  return { marker: `LOADER-TICKETS-${context.params.marker ?? 'default'}` };
}

export function ViewTicketsView({ marker }: { marker?: string }) {
  return <p id="marker">{marker ?? 'sem dados do loader'}</p>;
}

export const sliceTests = {
  cases: [{ name: 'fixture', run: async () => {} }]
};
