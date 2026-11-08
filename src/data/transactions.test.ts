import { beforeEach, describe, expect, it } from 'vitest'
import { SaldoDb } from '../db/db'
import type { Transaction, Wallet } from '../db/types'
import { deleteTransaction, restoreTransaction, saveTransaction, type TransactionDraft } from './transactions'

const draft = (extra: Partial<TransactionDraft> = {}): TransactionDraft => ({
  id: null, walletId: 'w', kind: 'EXPENSE', amountMinor: 145996, occurredAt: 5, note: 'Lunch', categoryId: null,
  originalAmountMinor: null, originalCurrency: null, ...extra,
})

let db: SaldoDb
let counter = 0
beforeEach(async () => {
  db = new SaldoDb(`transactions-${counter++}`)
  await db.setOwner('u')
})

describe('saving a transaction', () => {
  it('creates a manual row, marked for sync', async () => {
    const id = await saveTransaction(db, draft({ note: 'Lunch  \n' }))
    expect(await db.transactions.get(id)).toMatchObject({
      userId: 'u', source: 'MANUAL', syncState: 'DIRTY', deletedAt: null, note: 'Lunch', recurringRuleId: null, periodKey: null,
    })
  })

  it('stores an empty note as nothing', async () => {
    const id = await saveTransaction(db, draft({ note: '   ' }))
    expect((await db.transactions.get(id))?.note).toBeNull()
  })

  it('refuses a zero amount, which the server would refuse too', async () => {
    await expect(saveTransaction(db, draft({ amountMinor: 0 }))).rejects.toThrow()
  })

  it('an edit keeps what the form does not show', async () => {
    await db.transactions.put({
      id: 't', walletId: 'w', kind: 'EXPENSE', source: 'RECURRING', recurringRuleId: 'r', periodKey: '2026-10', legacyId: 7,
      createdAt: 1, updatedAt: 2, deletedAt: null, syncState: 'CLEAN',
    } as Transaction)
    await saveTransaction(db, draft({ id: 't', note: 'Edited' }))
    expect(await db.transactions.get('t')).toMatchObject({
      note: 'Edited', source: 'RECURRING', recurringRuleId: 'r', periodKey: '2026-10', legacyId: 7, createdAt: 1, syncState: 'DIRTY',
    })
  })

  it('an edit never turns a transfer into an expense', async () => {
    await db.transactions.put({ id: 't', walletId: 'w', kind: 'TRANSFER_OUT', updatedAt: 2 } as Transaction)
    await saveTransaction(db, draft({ id: 't', kind: 'EXPENSE' }))
    expect((await db.transactions.get('t'))?.kind).toBe('TRANSFER_OUT')
    await saveTransaction(db, draft({ id: 't', kind: 'INCOME' }))
    expect((await db.transactions.get('t'))?.kind).toBe('INCOME')
  })
})

describe('deleting a transaction', () => {
  const setup = async (checker: string | null) => {
    await db.wallets.put({ id: 'w', checkerTransactionId: checker, updatedAt: 1, syncState: 'CLEAN' } as Wallet)
    await db.transactions.put({ id: 't', walletId: 'w', updatedAt: 1, deletedAt: null, syncState: 'CLEAN' } as Transaction)
  }

  it('only marks the row, so that sync can carry the deletion', async () => {
    await setup(null)
    expect(await deleteTransaction(db, 't')).toEqual({ checkerWalletId: null })
    const row = await db.transactions.get('t')
    expect(row?.deletedAt).toBeGreaterThan(0)
    expect(row?.syncState).toBe('DIRTY')
  })

  it('takes the checker with it, and Undo brings both back', async () => {
    await setup('t')
    const { checkerWalletId } = await deleteTransaction(db, 't')
    expect(checkerWalletId).toBe('w')
    expect((await db.wallets.get('w'))?.checkerTransactionId).toBeNull()

    await restoreTransaction(db, 't', checkerWalletId)
    expect((await db.transactions.get('t'))?.deletedAt).toBeNull()
    expect((await db.wallets.get('w'))?.checkerTransactionId).toBe('t')
  })

  it('Undo marks the row for sync with a newer time', async () => {
    await setup(null)
    await deleteTransaction(db, 't')
    const before = (await db.transactions.get('t'))!.updatedAt
    await db.transactions.update('t', { syncState: 'CLEAN' })
    await restoreTransaction(db, 't', null)
    const row = await db.transactions.get('t')
    expect(row?.syncState).toBe('DIRTY')
    expect(row!.updatedAt).toBeGreaterThan(before)
  })

  it('does not disturb the checker on another row', async () => {
    await setup('other')
    await deleteTransaction(db, 't')
    expect((await db.wallets.get('w'))?.checkerTransactionId).toBe('other')
  })
})
