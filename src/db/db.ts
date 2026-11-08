import Dexie, { type Table } from 'dexie'
import type { BalanceCheck, Category, ImageRow, Meta, RecurringRule, Transaction, Wallet } from './types'

export const SYNC_TABLES = ['wallets', 'images', 'categories', 'recurring_rules', 'transactions', 'balance_checks'] as const
export type SyncTableName = (typeof SYNC_TABLES)[number]

const OWNER_KEY = 'owner_uid'

export class SaldoDb extends Dexie {
  wallets!: Table<Wallet, string>
  images!: Table<ImageRow, string>
  categories!: Table<Category, string>
  recurring_rules!: Table<RecurringRule, string>
  transactions!: Table<Transaction, string>
  balance_checks!: Table<BalanceCheck, string>
  meta!: Table<Meta, string>

  constructor(name = 'saldo') {
    super(name)
    this.version(1).stores({
      wallets: 'id, syncState',
      images: 'hash, syncState',
      categories: 'id, syncState',
      recurring_rules: 'id, syncState',
      transactions: 'id, syncState, walletId, [walletId+occurredAt]',
      balance_checks: 'id, syncState',
      meta: 'key',
    })
  }

  async dirtyCount(): Promise<number> {
    const counts = await Promise.all(SYNC_TABLES.map((t) => this.table(t).where('syncState').equals('DIRTY').count()))
    return counts.reduce((a, b) => a + b, 0)
  }

  async getOwner(): Promise<string | null> {
    const row = await this.meta.get(OWNER_KEY)
    return typeof row?.value === 'string' ? row.value : null
  }

  setOwner(uid: string) {
    return this.meta.put({ key: OWNER_KEY, value: uid })
  }

  /** Removes every synced row, the cached images, the cursors and the owner. */
  async wipe(): Promise<void> {
    await this.transaction('rw', [...SYNC_TABLES, 'meta'], async () => {
      await Promise.all([...SYNC_TABLES, 'meta'].map((t) => this.table(t).clear()))
    })
  }
}

export const db = new SaldoDb()
