import { describe, expect, it } from 'bun:test';
import { Ok, Err, type Result } from 'synapsejs';

export type GoodOutput = Result<{ value: number }, 'INVALID'>;

export async function goodAction(payload: unknown): Promise<GoodOutput> {
  if (typeof payload !== 'object' || payload === null) {
    return Err('INVALID');
  }
  return Ok({ value: 1 });
}

export function GoodTrigger() {
  return <span>good</span>;
}

export const sliceTests = {
  description: 'Invariantes da fatia de fixture',
  cases: [
    {
      name: 'aceita objeto',
      run: async () => {
        const result = await goodAction({});
        if (!result.ok) {
          throw new Error('esperava Ok');
        }
      }
    },
    {
      name: 'rejeita nulo',
      run: async () => {
        const result = await goodAction(null);
        if (result.ok) {
          throw new Error('esperava Err');
        }
      }
    }
  ]
};
