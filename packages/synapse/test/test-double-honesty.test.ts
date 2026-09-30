import { describe, expect, it } from 'bun:test';
import { MockDatabaseClient } from '../src/core/database-client';

/**
 * The test double reports only the work it performed.
 *
 * A double that fabricates a successful write, an update that matched nothing or a
 * rollback that kept the rows turns a green test into a false statement about the
 * shipped behaviour.
 */
describe('the mock database reports only what it did', () => {
  it('reports zero when a delete matched no rows', async () => {
    const db = new MockDatabaseClient({ things: [{ id: 'a' }] });

    const removed = await db.delete('things', { id: 'inexistente' });

    expect(removed).toBe(0);
    expect((await db.findMany('things')).length).toBe(1);

    const realRemoval = await db.delete('things', { id: 'a' });
    expect(realRemoval).toBe(1);
    expect((await db.findMany('things')).length).toBe(0);
  });

  it('returns no row for an update that matched nothing', async () => {
    const db = new MockDatabaseClient({ things: [{ id: 'a', value: 1 }] });

    const missed = await db.update('things', { value: 2 }, { id: 'inexistente' });
    expect(missed).toEqual([]);

    const updated = await db.update('things', { value: 3 }, { id: 'a' });
    expect(updated.length).toBe(1);
    expect((updated[0] as { value: number }).value).toBe(3);
  });

  it('discards the writes made inside a rolled-back transaction', async () => {
    const db = new MockDatabaseClient();

    await expect(
      db.transaction(async (tx) => {
        await tx.insert('things', { id: 'inside' });
        throw new Error('falhou de proposito');
      })
    ).rejects.toThrow('falhou de proposito');

    expect(await db.findMany('things')).toEqual([]);
  });

  it('keeps the writes of a committed transaction', async () => {
    const db = new MockDatabaseClient();

    await db.transaction(async (tx) => {
      await tx.insert('things', { id: 'kept' });
    });

    expect((await db.findMany('things')).length).toBe(1);
  });
});
