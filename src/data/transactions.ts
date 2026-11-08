import type { SaldoDb } from '../db/db'

/** Each local change gets a strictly newer updatedAt, so sync can tell it from the row being sent. */
export const nextUpdatedAt = (previous: number, now = Date.now()) => Math.max(now, previous + 1)

export async function updateTransactionNote(db: SaldoDb, id: string, note: string): Promise<void> {
  await db.transaction('rw', db.transactions, async () => {
    const row = await db.transactions.get(id)
    if (!row) return
    await db.transactions.update(id, {
      note: note.trimEnd() || null,
      updatedAt: nextUpdatedAt(row.updatedAt),
      syncState: 'DIRTY',
    })
  })
}
