import type { DatabaseClient, Result } from 'synapsejs';
import { Err, Ok } from 'synapsejs';

/**
 * Módulo de Negócio Compartilhado para o Domínio Inventory.
 * Fatias não importam fatias — regras que envolvem múltiplas fatias ou transações cruzadas
 * residem em src/shared/, recebem o DatabaseClient por parâmetro e abrem db.transaction().
 */
export async function adjustInventoryStock(
  db: DatabaseClient,
  itemId: string,
  delta: number,
  _reason = 'manual_adjustment'
): Promise<
  Result<{ id: string; oldStock: number; newStock: number }, 'NO_DATABASE' | 'NOT_FOUND' | 'INSUFFICIENT_STOCK'>
> {
  if (!db) {
    return Err('NO_DATABASE');
  }

  return await db.transaction(async (tx) => {
    const item = await tx.queryOne<{ id: string; stock: number; name: string }>(
      'SELECT id, stock, name FROM inventory WHERE id = $1',
      [itemId]
    );

    if (!item) {
      return Err('NOT_FOUND');
    }

    const newStock = Number(item.stock) + delta;
    if (newStock < 0) {
      return Err('INSUFFICIENT_STOCK');
    }

    const newStatus = newStock <= 5 ? 'low_stock' : 'active';
    await tx.query('UPDATE inventory SET stock = $1, status = $2 WHERE id = $3', [newStock, newStatus, itemId]);

    return Ok({ id: itemId, oldStock: Number(item.stock), newStock });
  });
}
