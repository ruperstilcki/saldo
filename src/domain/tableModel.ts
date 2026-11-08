import { yearMonthOf, yearOf } from '../core/dates'
import { isIncoming, type TransactionRow } from './rows'

/** Items of the wallet table, same as Android's TableModel.kt: year -> month -> rows, newest first. */
export type TableItem =
  | { type: 'year'; key: string; year: number; outMinor: number; inMinor: number; endBalanceMinor: number; count: number; collapsed: boolean }
  | { type: 'month'; key: string; yearMonth: string; outMinor: number; inMinor: number; endBalanceMinor: number; count: number; collapsed: boolean }
  | { type: 'tx'; key: string; row: TransactionRow; yearMonth: string }

export type GroupDefault = 'EXPANDED' | 'COLLAPSE_EXCEPT_CURRENT'

export const yearKey = (year: number) => `y${year}`
export const monthKey = (yearMonth: string) => `m${yearMonth}`

export function defaultCollapsed(key: string, monthsDefault: GroupDefault, yearsDefault: GroupDefault, nowYearMonth: string): boolean {
  if (key.startsWith('y')) return yearsDefault === 'COLLAPSE_EXCEPT_CURRENT' && key !== yearKey(yearOf(nowYearMonth))
  if (key.startsWith('m')) return monthsDefault === 'COLLAPSE_EXCEPT_CURRENT' && key !== monthKey(nowYearMonth)
  return false
}

interface Totals {
  out: number
  in: number
  count: number
  end: number
}

const totalsOf = <K,>(map: Map<K, Totals>, key: K): Totals => {
  let totals = map.get(key)
  if (!totals) map.set(key, (totals = { out: 0, in: 0, count: 0, end: 0 }))
  return totals
}

export function buildTable(rowsNewestFirst: TransactionRow[], openingBalanceMinor: number, isCollapsed: (key: string) => boolean): TableItem[] {
  const months = new Map<string, Totals>()
  const years = new Map<number, Totals>()
  const yearMonths = new Map<string, string>()

  // Running balance, oldest to newest, for the balance at the end of each month and year.
  let balance = openingBalanceMinor
  for (let i = rowsNewestFirst.length - 1; i >= 0; i--) {
    const row = rowsNewestFirst[i]!
    const yearMonth = yearMonthOf(row.occurredAt)
    yearMonths.set(row.id, yearMonth)
    const incoming = isIncoming(row.kind)
    balance += incoming ? row.amountMinor : -row.amountMinor
    for (const totals of [totalsOf(months, yearMonth), totalsOf(years, yearOf(yearMonth))]) {
      if (incoming) totals.in += row.amountMinor
      else totals.out += row.amountMinor
      totals.count += 1
      totals.end = balance
    }
  }

  const items: TableItem[] = []
  let currentYear: number | null = null
  let currentMonth: string | null = null
  let yearCollapsed = false
  let monthCollapsed = false
  for (const row of rowsNewestFirst) {
    const yearMonth = yearMonths.get(row.id)!
    const year = yearOf(yearMonth)
    if (year !== currentYear) {
      currentYear = year
      currentMonth = null
      const t = years.get(year)!
      const key = yearKey(year)
      yearCollapsed = isCollapsed(key)
      items.push({ type: 'year', key, year, outMinor: t.out, inMinor: t.in, endBalanceMinor: t.end, count: t.count, collapsed: yearCollapsed })
    }
    if (yearCollapsed) continue
    if (yearMonth !== currentMonth) {
      currentMonth = yearMonth
      const t = months.get(yearMonth)!
      const key = monthKey(yearMonth)
      monthCollapsed = isCollapsed(key)
      items.push({ type: 'month', key, yearMonth, outMinor: t.out, inMinor: t.in, endBalanceMinor: t.end, count: t.count, collapsed: monthCollapsed })
    }
    if (monthCollapsed) continue
    items.push({ type: 'tx', key: row.id, row, yearMonth })
  }
  return items
}
