import type { SyncTableName } from '../db/db'

type Row = Record<string, unknown>

export interface TableSpec {
  name: SyncTableName
  /** Local primary key, and the matching server column. */
  key: 'id' | 'hash'
  onConflict: string
  /** Server columns, as in supabase/migrations. A column missing here is never touched. */
  columns: readonly string[]
  /** Columns read from the server but never written by the web. */
  neverPush?: readonly string[]
}

const COMMON = ['user_id', 'created_at', 'updated_at', 'deleted_at'] as const

export const TABLES: Record<SyncTableName, TableSpec> = {
  wallets: {
    name: 'wallets',
    key: 'id',
    onConflict: 'user_id,id',
    columns: [
      'id', 'name', 'wallet_type', 'currency_code', 'opening_balance_minor', 'image_hash', 'color', 'sort_order',
      'is_archived', 'checker_transaction_id', 'note', 'legacy_id', ...COMMON,
    ],
  },
  images: {
    name: 'images',
    key: 'hash',
    onConflict: 'user_id,hash',
    columns: ['hash', 'remote_path', 'byte_size', ...COMMON],
  },
  categories: {
    name: 'categories',
    key: 'id',
    onConflict: 'user_id,id',
    columns: [
      'id', 'name', 'level', 'parent_id', 'kind', 'is_quick_pick', 'exclude_from_stats', 'match_keywords', 'color',
      'sort_order', ...COMMON,
    ],
  },
  recurring_rules: {
    name: 'recurring_rules',
    key: 'id',
    onConflict: 'user_id,id',
    columns: [
      'id', 'wallet_id', 'kind', 'amount_minor', 'category_id', 'note_template', 'schedule', 'time_of_day',
      'month_name_locale', 'start_period', 'last_generated_period', 'is_active', ...COMMON,
    ],
    // Only the phone books fees. A stale value from the web must not move the phone's progress back.
    neverPush: ['last_generated_period'],
  },
  transactions: {
    name: 'transactions',
    key: 'id',
    onConflict: 'user_id,id',
    columns: [
      'id', 'wallet_id', 'kind', 'amount_minor', 'occurred_at', 'category_id', 'note', 'original_amount_minor',
      'original_currency', 'transfer_id', 'source', 'recurring_rule_id', 'period_key', 'legacy_id', ...COMMON,
    ],
  },
  balance_checks: {
    name: 'balance_checks',
    key: 'id',
    onConflict: 'user_id,id',
    columns: [
      'id', 'wallet_id', 'checked_at', 'reported_balance_minor', 'computed_balance_minor', 'adjustment_tx_id', ...COMMON,
    ],
  },
}

export const PUSH_ORDER: readonly SyncTableName[] = ['wallets', 'categories', 'recurring_rules', 'transactions', 'balance_checks']
export const PULL_ORDER: readonly SyncTableName[] = ['wallets', 'categories', 'recurring_rules', 'transactions', 'balance_checks', 'images']

const camel = (column: string) => column.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())

/**
 * Local row -> server row. updated_at is never sent: the server trigger sets it. deleted_at is always
 * sent, also as null, or restoring a deleted row (Undo) would not reach the server.
 */
export function toRemote(spec: TableSpec, row: Row, uid: string): Row {
  const out: Row = {}
  for (const column of spec.columns) {
    if (column === 'updated_at' || spec.neverPush?.includes(column)) continue
    out[column] = row[camel(column)] ?? null
  }
  out.user_id = uid
  return out
}

/** Server row -> local CLEAN row. Values such as unknown enum text are kept exactly as they are. */
export function toLocal(spec: TableSpec, row: Row): Row {
  const out: Row = { syncState: 'CLEAN' }
  for (const column of spec.columns) out[camel(column)] = row[column] ?? null
  out.createdAt = row.created_at ?? 0
  out.updatedAt = row.updated_at ?? 0
  return out
}
