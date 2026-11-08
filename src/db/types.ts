/** Local rows mirror the server columns (see src/sync/tables.ts), in camelCase, plus syncState. */
export type SyncState = 'CLEAN' | 'DIRTY'

interface Synced {
  userId: string
  createdAt: number
  updatedAt: number
  deletedAt: number | null
  syncState: SyncState
}

export interface Wallet extends Synced {
  id: string
  name: string
  walletType: string
  currencyCode: string
  openingBalanceMinor: number
  imageHash: string | null
  color: number
  sortOrder: number
  isArchived: boolean
  checkerTransactionId: string | null
  note: string | null
  legacyId: number | null
}

export interface ImageRow extends Synced {
  hash: string
  remotePath: string | null
  byteSize: number
  /** The file itself, cached locally. Never sent as a column. */
  blob?: Blob
}

export interface Category extends Synced {
  id: string
  name: string
  level: string
  parentId: string | null
  kind: string
  isQuickPick: boolean
  excludeFromStats: boolean
  matchKeywords: string | null
  color: number | null
  sortOrder: number
}

export interface Transaction extends Synced {
  id: string
  walletId: string
  kind: string
  amountMinor: number
  occurredAt: number
  categoryId: string | null
  note: string | null
  originalAmountMinor: number | null
  originalCurrency: string | null
  transferId: string | null
  source: string
  recurringRuleId: string | null
  periodKey: string | null
  legacyId: number | null
}

export interface RecurringRule extends Synced {
  id: string
  walletId: string
  kind: string
  amountMinor: number
  categoryId: string | null
  noteTemplate: string
  schedule: string
  timeOfDay: string
  monthNameLocale: string
  startPeriod: string
  lastGeneratedPeriod: string | null
  isActive: boolean
}

export interface BalanceCheck extends Synced {
  id: string
  walletId: string
  checkedAt: number
  reportedBalanceMinor: number
  computedBalanceMinor: number
  adjustmentTxId: string | null
}

export interface Meta {
  key: string
  value: string | number
}
