import type { Category, Transaction } from '../db/types'

export const isIncoming = (kind: string) => kind === 'INCOME' || kind === 'TRANSFER_IN'

/** A transaction with its category resolved. A sub-category without a color inherits its parent's. */
export interface TransactionRow extends Transaction {
  categoryName: string | null
  parentName: string | null
  categoryColor: number | null
}

/** Live transactions, newest first. A deleted category counts as no category. */
export function buildRows(transactions: Transaction[], categories: Category[]): TransactionRow[] {
  const live = new Map(categories.filter((c) => c.deletedAt === null).map((c) => [c.id, c]))
  return transactions
    .filter((t) => t.deletedAt === null)
    .map((t) => {
      const category = t.categoryId ? live.get(t.categoryId) : undefined
      const parent = category?.parentId ? live.get(category.parentId) : undefined
      return {
        ...t,
        categoryName: category?.name ?? null,
        parentName: parent?.name ?? null,
        categoryColor: category?.color ?? parent?.color ?? null,
      }
    })
    .sort((a, b) => b.occurredAt - a.occurredAt || b.createdAt - a.createdAt)
}
