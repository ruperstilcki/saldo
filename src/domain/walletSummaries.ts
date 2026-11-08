import type { Category, Transaction, Wallet } from '../db/types'
import { computeBalances } from './balance'

const COMMON_CURRENCIES = ['RSD', 'EUR', 'USD', 'CHF', 'GBP', 'MKD', 'BAM', 'HUF']

export interface WalletSummary {
  wallet: Wallet
  balanceMinor: number
  lastTransaction: Transaction | null
  lastCategory: string | null
}

export interface CurrencySum {
  currency: string
  minor: number
}

/** Common currencies first, as on the phone. Currencies are never added together. */
const sortByCurrency = (sums: Map<string, number>): CurrencySum[] =>
  [...sums]
    .map(([currency, minor]) => ({ currency, minor }))
    .sort((a, b) => {
      const rank = (c: string) => (COMMON_CURRENCIES.includes(c) ? COMMON_CURRENCIES.indexOf(c) : Infinity)
      return rank(a.currency) - rank(b.currency) || a.currency.localeCompare(b.currency)
    })

export function summarize(wallets: Wallet[], transactions: Transaction[], categories: Category[]): WalletSummary[] {
  const live = wallets
    .filter((w) => w.deletedAt === null)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt - b.createdAt)
  const balances = computeBalances(live, transactions)
  const names = new Map(categories.filter((c) => c.deletedAt === null).map((c) => [c.id, c.name]))

  const last = new Map<string, Transaction>()
  for (const tx of transactions) {
    if (tx.deletedAt !== null) continue
    const current = last.get(tx.walletId)
    if (!current || tx.occurredAt > current.occurredAt || (tx.occurredAt === current.occurredAt && tx.createdAt > current.createdAt)) {
      last.set(tx.walletId, tx)
    }
  }

  return live.map((wallet) => {
    const lastTransaction = last.get(wallet.id) ?? null
    return {
      wallet,
      balanceMinor: balances.get(wallet.id) ?? 0,
      lastTransaction,
      lastCategory: lastTransaction?.categoryId ? names.get(lastTransaction.categoryId) ?? null : null,
    }
  })
}

export function totalsByCurrency(summaries: WalletSummary[]): CurrencySum[] {
  const sums = new Map<string, number>()
  for (const { wallet, balanceMinor } of summaries) {
    sums.set(wallet.currencyCode, (sums.get(wallet.currencyCode) ?? 0) + balanceMinor)
  }
  return sortByCurrency(sums)
}

/** Expenses in [from, to) of active wallets, without categories marked exclude_from_stats, as on the phone. */
export function spentByCurrency(wallets: Wallet[], transactions: Transaction[], categories: Category[], from: number, to: number): CurrencySum[] {
  const active = new Map(wallets.filter((w) => w.deletedAt === null && !w.isArchived).map((w) => [w.id, w]))
  const byId = new Map(categories.map((c) => [c.id, c]))
  const sums = new Map<string, number>()
  for (const tx of transactions) {
    const wallet = active.get(tx.walletId)
    if (!wallet || tx.deletedAt !== null || tx.kind !== 'EXPENSE' || tx.occurredAt < from || tx.occurredAt >= to) continue
    const category = tx.categoryId ? byId.get(tx.categoryId) : undefined
    const parent = category?.parentId ? byId.get(category.parentId) : undefined
    if (category?.excludeFromStats || parent?.excludeFromStats) continue
    sums.set(wallet.currencyCode, (sums.get(wallet.currencyCode) ?? 0) + tx.amountMinor)
  }
  return sortByCurrency(sums)
}
