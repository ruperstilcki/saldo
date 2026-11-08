import { describe, expect, it } from 'vitest'
import type { Category, Transaction, Wallet } from '../db/types'
import { spentByCurrency, summarize, totalsByCurrency } from './walletSummaries'

const wallet = (id: string, extra: Partial<Wallet> = {}) =>
  ({ id, name: id, currencyCode: 'RSD', openingBalanceMinor: 0, sortOrder: 0, createdAt: 1, isArchived: false, deletedAt: null, ...extra }) as Wallet
const tx = (id: string, extra: Partial<Transaction> = {}) =>
  ({ id, walletId: 'w', kind: 'EXPENSE', amountMinor: 100, occurredAt: 50, createdAt: 1, categoryId: null, deletedAt: null, ...extra }) as Transaction
const category = (id: string, extra: Partial<Category> = {}) =>
  ({ id, name: id, parentId: null, excludeFromStats: false, deletedAt: null, ...extra }) as Category

describe('wallet summaries', () => {
  it('sorts by the saved order and leaves out deleted wallets', () => {
    const list = summarize([wallet('b', { sortOrder: 1 }), wallet('a'), wallet('gone', { deletedAt: 1 })], [], [])
    expect(list.map((s) => s.wallet.id)).toEqual(['a', 'b'])
  })

  it('finds the newest live transaction and its category', () => {
    const [summary] = summarize(
      [wallet('w')],
      [tx('old', { occurredAt: 1 }), tx('new', { occurredAt: 9, categoryId: 'c' }), tx('gone', { occurredAt: 99, deletedAt: 5 })],
      [category('c', { name: 'Groceries' })],
    )
    expect(summary!.lastTransaction?.id).toBe('new')
    expect(summary!.lastCategory).toBe('Groceries')
  })

  it('never adds currencies together and puts common ones first', () => {
    const totals = totalsByCurrency(summarize(
      [wallet('z', { currencyCode: 'AUD', openingBalanceMinor: 1 }), wallet('e', { currencyCode: 'EUR', openingBalanceMinor: 2 }), wallet('r', { openingBalanceMinor: 3 }), wallet('r2', { openingBalanceMinor: 4 })],
      [],
      [],
    ))
    expect(totals).toEqual([{ currency: 'RSD', minor: 7 }, { currency: 'EUR', minor: 2 }, { currency: 'AUD', minor: 1 }])
  })
})

describe('spent this month', () => {
  const wallets = [wallet('w'), wallet('arch', { isArchived: true }), wallet('eur', { currencyCode: 'EUR' })]

  it('counts only expenses in the period, from active wallets', () => {
    const spent = spentByCurrency(wallets, [
      tx('in', { amountMinor: 10 }),
      tx('eur', { walletId: 'eur', amountMinor: 20 }),
      tx('income', { kind: 'INCOME' }),
      tx('before', { occurredAt: 9 }),
      tx('after', { occurredAt: 100 }),
      tx('archived', { walletId: 'arch' }),
      tx('deleted', { deletedAt: 1 }),
    ], [], 10, 100)
    expect(spent).toEqual([{ currency: 'RSD', minor: 10 }, { currency: 'EUR', minor: 20 }])
  })

  it('leaves out categories excluded from statistics, also through the parent', () => {
    const categories = [category('adjust', { excludeFromStats: true }), category('sub', { parentId: 'adjust' })]
    const spent = spentByCurrency(wallets, [tx('a', { categoryId: 'adjust' }), tx('b', { categoryId: 'sub' }), tx('c', { amountMinor: 5 })], categories, 0, 100)
    expect(spent).toEqual([{ currency: 'RSD', minor: 5 }])
  })
})
