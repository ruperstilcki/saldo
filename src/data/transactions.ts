import type { SaldoDb } from '../db/db'
import type { Transaction } from '../db/types'
import { isIncoming } from '../domain/rows'

/** Each local change gets a strictly newer updatedAt, so sync can tell it from the row being sent. */
export const nextUpdatedAt = (previous: number, now = Date.now()) => Math.max(now, previous + 1)

export interface TransactionDraft {
  id: string | null
  walletId: string
  kind: string
  amountMinor: number
  occurredAt: number
  note: string
  categoryId: string | null
  originalAmountMinor: number | null
  originalCurrency: string | null
}

export async function saveTransaction(db: SaldoDb, draft: TransactionDraft): Promise<string> {
  if (draft.amountMinor <= 0) throw new Error('Amount must be above zero')
  const fields = {
    walletId: draft.walletId,
    amountMinor: draft.amountMinor,
    occurredAt: draft.occurredAt,
    note: draft.note.trimEnd() || null,
    categoryId: draft.categoryId,
    originalAmountMinor: draft.originalAmountMinor,
    originalCurrency: draft.originalCurrency,
    syncState: 'DIRTY' as const,
  }
  return db.transaction('rw', db.transactions, db.meta, async () => {
    const existing = draft.id ? await db.transactions.get(draft.id) : undefined
    if (existing) {
      await db.transactions.update(existing.id, {
        ...fields,
        // The form knows only Expense and Income: a transfer stays a transfer unless its direction changes.
        kind: isIncoming(existing.kind) === isIncoming(draft.kind) ? existing.kind : draft.kind,
        updatedAt: nextUpdatedAt(existing.updatedAt),
      })
      return existing.id
    }
    const now = Date.now()
    const row: Transaction = {
      ...fields,
      id: crypto.randomUUID(),
      userId: (await db.getOwner()) ?? '',
      kind: draft.kind,
      transferId: null,
      source: 'MANUAL',
      recurringRuleId: null,
      periodKey: null,
      legacyId: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    }
    await db.transactions.add(row)
    return row.id
  })
}

/** Soft delete. If the row carried the wallet's checker, the checker goes too. Returns that wallet, for Undo. */
export async function deleteTransaction(db: SaldoDb, id: string): Promise<{ checkerWalletId: string | null }> {
  return db.transaction('rw', db.transactions, db.wallets, async () => {
    const row = await db.transactions.get(id)
    if (!row) return { checkerWalletId: null }
    const now = nextUpdatedAt(row.updatedAt)
    await db.transactions.update(id, { deletedAt: now, updatedAt: now, syncState: 'DIRTY' })
    const wallet = await db.wallets.get(row.walletId)
    if (wallet?.checkerTransactionId !== id) return { checkerWalletId: null }
    await db.wallets.update(wallet.id, { checkerTransactionId: null, updatedAt: nextUpdatedAt(wallet.updatedAt), syncState: 'DIRTY' })
    return { checkerWalletId: wallet.id }
  })
}

export async function restoreTransaction(db: SaldoDb, id: string, checkerWalletId: string | null): Promise<void> {
  await db.transaction('rw', db.transactions, db.wallets, async () => {
    const row = await db.transactions.get(id)
    if (!row) return
    await db.transactions.update(id, { deletedAt: null, updatedAt: nextUpdatedAt(row.updatedAt), syncState: 'DIRTY' })
    const wallet = checkerWalletId ? await db.wallets.get(checkerWalletId) : undefined
    if (wallet) {
      await db.wallets.update(wallet.id, { checkerTransactionId: id, updatedAt: nextUpdatedAt(wallet.updatedAt), syncState: 'DIRTY' })
    }
  })
}
