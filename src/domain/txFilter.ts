import type { DateParts } from '../core/dates'
import { parseMoney } from '../core/money'
import { fold } from '../core/strings'
import type { Category } from '../db/types'
import { isIncoming, type TransactionRow } from './rows'

/** Search and filters, same rules as Android's TxFilter.kt. */
export type PeriodPreset = 'ALL' | 'THIS_MONTH' | 'LAST_MONTH' | 'THIS_YEAR' | 'LAST_YEAR' | 'CUSTOM'
export type TypeFilter = 'ALL' | 'OUT' | 'IN'

export const UNCATEGORIZED = '__none__'

export interface TxFilter {
  query: string
  period: PeriodPreset
  customFrom: DateParts | null
  /** Inclusive. */
  customTo: DateParts | null
  type: TypeFilter
  minMinor: number | null
  maxMinor: number | null
  /** A main category includes its subs. [UNCATEGORIZED] selects rows without a category. */
  categoryIds: ReadonlySet<string>
}

export const EMPTY_FILTER: TxFilter = {
  query: '', period: 'ALL', customFrom: null, customTo: null, type: 'ALL', minMinor: null, maxMinor: null, categoryIds: new Set(),
}

export function isFilterEmpty(f: TxFilter): boolean {
  return !f.query.trim() && f.period === 'ALL' && f.type === 'ALL' && f.minMinor === null && f.maxMinor === null && f.categoryIds.size === 0
}

const startOfDay = (year: number, month: number, day: number) => new Date(year, month - 1, day).getTime()

/** [from, to) in epoch ms, or null for all time. */
export function filterRange(f: TxFilter, today: Date): [number, number] | null {
  const year = today.getFullYear()
  const month = today.getMonth() + 1
  switch (f.period) {
    case 'ALL': return null
    case 'THIS_MONTH': return [startOfDay(year, month, 1), startOfDay(year, month + 1, 1)]
    case 'LAST_MONTH': return [startOfDay(year, month - 1, 1), startOfDay(year, month, 1)]
    case 'THIS_YEAR': return [startOfDay(year, 1, 1), startOfDay(year + 1, 1, 1)]
    case 'LAST_YEAR': return [startOfDay(year - 1, 1, 1), startOfDay(year, 1, 1)]
    case 'CUSTOM': {
      if (!f.customFrom) return null
      const to = f.customTo ?? f.customFrom
      return [startOfDay(f.customFrom.year, f.customFrom.month, f.customFrom.day), startOfDay(to.year, to.month, to.day + 1)]
    }
  }
}

/** The selected ids plus all subs of selected mains. */
export function expandCategories(selected: ReadonlySet<string>, categories: Category[]): ReadonlySet<string> {
  if (selected.size === 0) return selected
  return new Set([...selected, ...categories.filter((c) => c.parentId !== null && selected.has(c.parentId)).map((c) => c.id)])
}

export const searchText = (r: TransactionRow) => fold([r.note, r.categoryName, r.parentName].filter(Boolean).join('\n'))

/**
 * The text matches the note or category, ignoring case and diacritics. A number also matches the
 * amount: "340" finds 340,00 and 340,50, and "1.459,96" finds exactly that amount.
 */
export function matchesQuery(r: TransactionRow, foldedText: string, query: string): boolean {
  const q = query.trim()
  if (!q) return true
  if (foldedText.includes(fold(q))) return true
  const parsed = parseMoney(q)
  if (parsed.type !== 'ok') return false
  if (/[.,]\d{1,2}$/.test(q)) return r.amountMinor === parsed.minor
  return Math.floor(r.amountMinor / 100) === Math.floor(parsed.minor / 100)
}

export function applyFilter(
  rows: TransactionRow[],
  f: TxFilter,
  categories: Category[],
  today: Date,
  textOf: (row: TransactionRow) => string = searchText,
): TransactionRow[] {
  if (isFilterEmpty(f)) return rows
  const range = filterRange(f, today)
  const selected = expandCategories(f.categoryIds, categories)
  return rows.filter((r) => {
    if (range && (r.occurredAt < range[0] || r.occurredAt >= range[1])) return false
    if (f.type === 'OUT' && isIncoming(r.kind)) return false
    if (f.type === 'IN' && !isIncoming(r.kind)) return false
    if (f.minMinor !== null && r.amountMinor < f.minMinor) return false
    if (f.maxMinor !== null && r.amountMinor > f.maxMinor) return false
    if (selected.size > 0 && !selected.has(r.categoryId ?? UNCATEGORIZED)) return false
    return matchesQuery(r, textOf(r), f.query)
  })
}

export interface FilterSummary {
  count: number
  outMinor: number
  inMinor: number
  netMinor: number
}

export function summarizeFilter(rows: TransactionRow[]): FilterSummary {
  let outMinor = 0
  let inMinor = 0
  for (const r of rows) {
    if (isIncoming(r.kind)) inMinor += r.amountMinor
    else outMinor += r.amountMinor
  }
  return { count: rows.length, outMinor, inMinor, netMinor: inMinor - outMinor }
}
