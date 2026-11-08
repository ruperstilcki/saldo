import { expect, it } from 'vitest'
import { computeBalances } from './balance'

const tx = (kind: string, amountMinor: number, deletedAt: number | null = null, walletId = 'w') => ({ walletId, kind, amountMinor, deletedAt })

it('adds income and transfers in, subtracts expenses and transfers out', () => {
  const balances = computeBalances([{ id: 'w', openingBalanceMinor: 1000 }], [
    tx('INCOME', 500), tx('TRANSFER_IN', 20), tx('EXPENSE', 145), tx('TRANSFER_OUT', 5),
  ])
  expect(balances.get('w')).toBe(1370)
})

it('ignores deleted rows and rows of unknown wallets', () => {
  const balances = computeBalances([{ id: 'w', openingBalanceMinor: 0 }], [tx('EXPENSE', 9, 123), tx('EXPENSE', 9, null, 'other')])
  expect(balances.get('w')).toBe(0)
  expect(balances.has('other')).toBe(false)
})

it('does not drift like floating point amounts', () => {
  const balances = computeBalances([{ id: 'w', openingBalanceMinor: 0 }], [tx('INCOME', 10), tx('INCOME', 20), tx('INCOME', 30)])
  expect(balances.get('w')).toBe(60)
})
