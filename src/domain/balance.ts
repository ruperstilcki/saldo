import type { Transaction, Wallet } from '../db/types'

const isIncoming = (kind: string) => kind === 'INCOME' || kind === 'TRANSFER_IN'

/** Balance is never stored: opening balance + incoming − outgoing, without deleted rows. Integers only. */
export function computeBalances(
  wallets: Pick<Wallet, 'id' | 'openingBalanceMinor'>[],
  transactions: Pick<Transaction, 'walletId' | 'kind' | 'amountMinor' | 'deletedAt'>[],
): Map<string, number> {
  const balances = new Map(wallets.map((w) => [w.id, w.openingBalanceMinor]))
  for (const tx of transactions) {
    const current = balances.get(tx.walletId)
    if (current === undefined || tx.deletedAt !== null) continue
    balances.set(tx.walletId, current + (isIncoming(tx.kind) ? tx.amountMinor : -tx.amountMinor))
  }
  return balances
}
