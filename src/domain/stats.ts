import { yearMonthOf } from '../core/dates'
import type { Category } from '../db/types'
import type { TransactionRow } from './rows'

/** Statistics, same rules as Android's Stats.kt. Transfers and categories excluded from statistics are left out. */
export const UNCATEGORIZED_NAME = 'Uncategorized'

export interface MonthTotals {
  yearMonth: string
  outMinor: number
  inMinor: number
  netMinor: number
}

export interface CategoryTotal {
  /** Main category id, or null for "Uncategorized". */
  id: string | null
  name: string
  color: number | null
  amountMinor: number
  share: number
  subs: CategoryTotal[]
}

export interface StatsResult {
  /** Oldest to newest, every month of the range, zeros included. */
  months: MonthTotals[]
  averageOutMinor: number
  byCategory: CategoryTotal[]
  topExpenses: TransactionRow[]
  totalOutMinor: number
  totalInMinor: number
}

export function nextMonth(yearMonth: string, delta = 1): string {
  const [year, month] = yearMonth.split('-').map(Number) as [number, number]
  const date = new Date(year, month - 1 + delta, 1)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

const share = (part: number, total: number) => (total === 0 ? 0 : part / total)
const sum = (rows: TransactionRow[]) => rows.reduce((total, r) => total + r.amountMinor, 0)

function groupBy<K>(rows: TransactionRow[], keyOf: (row: TransactionRow) => K): Map<K, TransactionRow[]> {
  const groups = new Map<K, TransactionRow[]>()
  for (const row of rows) {
    const key = keyOf(row)
    const group = groups.get(key)
    if (group) group.push(row)
    else groups.set(key, [row])
  }
  return groups
}

const biggestFirst = (a: { amountMinor: number }, b: { amountMinor: number }) => b.amountMinor - a.amountMinor

/** [from] and [to] are inclusive months. With [categoryMonth], the breakdown and the top list cover only that month. */
export function computeStats(
  rows: TransactionRow[],
  categories: Category[],
  from: string,
  to: string,
  categoryMonth: string | null = null,
  topN = 10,
): StatsResult {
  const excluded = new Set(categories.filter((c) => c.excludeFromStats).map((c) => c.id))
  const counted = rows.filter(
    (r) =>
      (r.kind === 'EXPENSE' || r.kind === 'INCOME') &&
      (r.categoryId === null || !excluded.has(r.categoryId)) &&
      (r.parentId === null || !excluded.has(r.parentId)),
  )
  const inRange = counted.filter((r) => {
    const yearMonth = yearMonthOf(r.occurredAt)
    return yearMonth >= from && yearMonth <= to
  })

  const perMonth = new Map<string, { out: number; in: number }>()
  for (const r of inRange) {
    const yearMonth = yearMonthOf(r.occurredAt)
    const totals = perMonth.get(yearMonth) ?? { out: 0, in: 0 }
    if (r.kind === 'INCOME') totals.in += r.amountMinor
    else totals.out += r.amountMinor
    perMonth.set(yearMonth, totals)
  }
  const months: MonthTotals[] = []
  for (let m = from; m <= to; m = nextMonth(m)) {
    const totals = perMonth.get(m)
    months.push({ yearMonth: m, outMinor: totals?.out ?? 0, inMinor: totals?.in ?? 0, netMinor: (totals?.in ?? 0) - (totals?.out ?? 0) })
  }

  const scope = categoryMonth ? inRange.filter((r) => yearMonthOf(r.occurredAt) === categoryMonth) : inRange
  const expenses = scope.filter((r) => r.kind === 'EXPENSE')
  const totalOutMinor = sum(expenses)
  const byId = new Map(categories.map((c) => [c.id, c]))

  // A main, or an Unlinked sub that acts as its own group.
  const mainOf = (r: TransactionRow) => (r.categoryId === null ? null : r.parentId ?? r.categoryId)

  const byCategory = [...groupBy(expenses, mainOf)]
    .map(([mainId, list]): CategoryTotal => {
      const amountMinor = sum(list)
      const main = mainId ? byId.get(mainId) : undefined
      const subs: CategoryTotal[] = [...groupBy(list.filter((r) => r.categoryId !== null && r.categoryId !== mainId), (r) => r.categoryId!)].map(
        ([subId, subRows]) => {
          const subAmount = sum(subRows)
          const sub = byId.get(subId)
          return { id: subId, name: sub?.name ?? '?', color: sub?.color ?? main?.color ?? null, amountMinor: subAmount, share: share(subAmount, amountMinor), subs: [] }
        },
      )
      const direct = sum(list.filter((r) => r.categoryId === mainId))
      if (direct > 0 && subs.length > 0) {
        subs.push({ id: mainId, name: `(${main?.name} itself)`, color: main?.color ?? null, amountMinor: direct, share: share(direct, amountMinor), subs: [] })
      }
      subs.sort(biggestFirst)
      return {
        id: mainId,
        name: mainId ? main?.name ?? '?' : UNCATEGORIZED_NAME,
        color: main?.color ?? null,
        amountMinor,
        share: share(amountMinor, totalOutMinor),
        subs,
      }
    })
    .sort(biggestFirst)

  const totalMonthsOut = months.reduce((total, m) => total + m.outMinor, 0)
  return {
    months,
    averageOutMinor: months.length === 0 ? 0 : Math.floor(totalMonthsOut / months.length),
    byCategory,
    topExpenses: [...expenses].sort(biggestFirst).slice(0, topN),
    totalOutMinor,
    totalInMinor: sum(scope.filter((r) => r.kind === 'INCOME')),
  }
}
