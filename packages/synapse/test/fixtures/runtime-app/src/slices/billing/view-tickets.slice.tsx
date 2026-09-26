import React from 'react';

export async function viewTicketsAction(payload: unknown) {
  void payload;
  return { ok: true as const, value: { marker: 'RPC-BILLING-ok' } };
}

export function ViewTicketsView() {
  return <p id="marker">billing</p>;
}

export const sliceTests = {
  cases: [{ name: 'fixture', run: async () => {} }]
};
