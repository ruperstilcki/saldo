import { fold } from '../core/strings'
import type { SaldoDb } from '../db/db'
import type { Category } from '../db/types'

/** "+ Create …" in the transaction form: an Unlinked sub-category, without a color. An existing name is reused. */
export async function createCategoryFromForm(db: SaldoDb, name: string, income: boolean): Promise<string> {
  const trimmed = name.trim()
  return db.transaction('rw', db.categories, db.meta, async () => {
    const live = (await db.categories.toArray()).filter((c) => c.deletedAt === null)
    const existing = live.find((c) => fold(c.name) === fold(trimmed))
    if (existing) return existing.id
    const now = Date.now()
    const row: Category = {
      id: crypto.randomUUID(),
      userId: (await db.getOwner()) ?? '',
      name: trimmed,
      level: 'SUB',
      parentId: null,
      kind: income ? 'INCOME' : 'EXPENSE',
      isQuickPick: false,
      excludeFromStats: false,
      matchKeywords: null,
      color: null,
      sortOrder: live.reduce((max, c) => Math.max(max, c.sortOrder), -1) + 1,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      syncState: 'DIRTY',
    }
    await db.categories.add(row)
    return row.id
  })
}
