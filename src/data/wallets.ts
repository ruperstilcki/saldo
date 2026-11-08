import type { SaldoDb } from '../db/db'
import type { Wallet } from '../db/types'
import { nextUpdatedAt } from './transactions'

async function change(db: SaldoDb, id: string, fields: Partial<Wallet>) {
  await db.transaction('rw', db.wallets, async () => {
    const wallet = await db.wallets.get(id)
    if (!wallet) return
    await db.wallets.update(id, { ...fields, updatedAt: nextUpdatedAt(wallet.updatedAt), syncState: 'DIRTY' })
  })
}

/** A wallet has at most one checker, so setting it on another row moves it. */
export const setChecker = (db: SaldoDb, walletId: string, txId: string | null) => change(db, walletId, { checkerTransactionId: txId })

export const setArchived = (db: SaldoDb, walletId: string, isArchived: boolean) => change(db, walletId, { isArchived })

/** Saves the new order. Only wallets whose position really changed go out to the server. */
export async function reorderWallets(db: SaldoDb, idsInOrder: string[]): Promise<void> {
  await db.transaction('rw', db.wallets, async () => {
    for (const [index, id] of idsInOrder.entries()) {
      const wallet = await db.wallets.get(id)
      if (wallet && wallet.sortOrder !== index) {
        await db.wallets.update(id, { sortOrder: index, updatedAt: nextUpdatedAt(wallet.updatedAt), syncState: 'DIRTY' })
      }
    }
  })
}
