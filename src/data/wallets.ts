import type { SaldoDb } from '../db/db'
import type { Wallet } from '../db/types'
import type { PreparedImage } from './images'
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

export interface WalletDraft {
  id: string | null
  name: string
  walletType: string
  currencyCode: string
  openingBalanceMinor: number
  /** The image the wallet keeps: an existing one by hash, or none. A new one comes in [newImage]. */
  imageHash: string | null
  newImage: PreparedImage | null
  color: number
  note: string
}

export async function saveWallet(db: SaldoDb, draft: WalletDraft): Promise<string> {
  const fields = {
    name: draft.name.trim(),
    walletType: draft.walletType,
    currencyCode: draft.currencyCode,
    openingBalanceMinor: draft.openingBalanceMinor,
    imageHash: draft.newImage?.hash ?? draft.imageHash,
    color: draft.color,
    note: draft.note.trim() || null,
    syncState: 'DIRTY' as const,
  }
  return db.transaction('rw', db.wallets, db.images, db.meta, async () => {
    const now = Date.now()
    const owner = (await db.getOwner()) ?? ''

    // A picked image enters the database only here, so leaving the form without saving leaves nothing behind.
    if (draft.newImage) {
      const { hash, blob, byteSize } = draft.newImage
      const existing = await db.images.get(hash)
      await db.images.put({
        hash,
        blob,
        byteSize,
        userId: owner,
        remotePath: existing?.remotePath ?? null,
        createdAt: existing?.createdAt ?? now,
        updatedAt: existing ? nextUpdatedAt(existing.updatedAt) : now,
        deletedAt: null,
        syncState: 'DIRTY',
      })
    }

    const existing = draft.id ? await db.wallets.get(draft.id) : undefined
    if (existing) {
      await db.wallets.update(existing.id, { ...fields, updatedAt: nextUpdatedAt(existing.updatedAt) })
      return existing.id
    }
    const live = (await db.wallets.toArray()).filter((w) => w.deletedAt === null)
    const row: Wallet = {
      ...fields,
      id: crypto.randomUUID(),
      userId: owner,
      sortOrder: live.reduce((max, w) => Math.max(max, w.sortOrder), -1) + 1,
      isArchived: false,
      checkerTransactionId: null,
      legacyId: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    }
    await db.wallets.add(row)
    return row.id
  })
}

/** Marks the wallet, its transactions and its fee rules as deleted. Rows already deleted keep their time. */
export async function deleteWallet(db: SaldoDb, id: string): Promise<void> {
  await db.transaction('rw', db.wallets, db.transactions, db.recurring_rules, async () => {
    const wallet = await db.wallets.get(id)
    if (!wallet) return
    const now = nextUpdatedAt(wallet.updatedAt)
    const deleted = { deletedAt: now, updatedAt: now, syncState: 'DIRTY' as const }
    await db.transactions.where('walletId').equals(id).filter((t) => t.deletedAt === null).modify(deleted)
    await db.recurring_rules.filter((r) => r.walletId === id && r.deletedAt === null).modify(deleted)
    await db.wallets.update(id, deleted)
  })
}
