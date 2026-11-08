import { describe, expect, it } from 'vitest'
import type { Category, Transaction } from '../db/types'
import { buildRows } from './rows'
import { computeStats, nextMonth } from './stats'
import { applyFilter, EMPTY_FILTER, isFilterEmpty, summarizeFilter, UNCATEGORIZED, type TxFilter } from './txFilter'

// Same data and expected values as android/app/src/test/.../domain/SearchAndStatsTest.kt
const cat = (id: string, name: string, parentId: string | null = null, excludeFromStats = false) =>
  ({ id, name, parentId, excludeFromStats, level: parentId ? 'SUB' : 'MAIN', color: null, deletedAt: null }) as Category

const cats = [cat('g', 'Groceries'), cat('maxi', 'Maxi', 'g'), cat('lidl', 'Lidl', 'g'), cat('fuel', 'Fuel'), cat('adj', 'Balance adjustment', null, true)]

const tx = (id: string, date: string, amountMinor: number, kind = 'EXPENSE', categoryId: string | null = null, note: string | null = null) =>
  ({ id, walletId: 'w', kind, amountMinor, occurredAt: new Date(`${date}T12:00:00`).getTime(), createdAt: 1, categoryId, note, deletedAt: null, source: 'MANUAL' }) as Transaction

const rows = buildRows([
  tx('a', '2026-11-05', 145996, 'EXPENSE', 'lidl', 'Koriscenje kartice kod LIDL'),
  tx('b', '2026-11-02', 34000, 'EXPENSE', 'maxi', 'Šumadija sir'),
  tx('c', '2026-10-31', 34050, 'EXPENSE', null, 'održavanje računa'),
  tx('d', '2026-10-04', 13000000, 'INCOME', null, 'plata'),
  tx('e', '2026-09-20', 500000, 'EXPENSE', 'fuel'),
  tx('f', '2026-09-01', 10000000, 'INCOME', 'adj', 'početno stanje'),
], cats)

const today = new Date('2026-11-08T12:00:00')
const ids = (f: Partial<TxFilter>) => applyFilter(rows, { ...EMPTY_FILTER, ...f }, cats, today).map((r) => r.id)
const stats = (month: string | null = null) => computeStats(rows, cats, '2026-09', '2026-11', month)

describe('search and filters', () => {
  it('search ignores case and diacritics, and covers category names', () => {
    expect(ids({ query: 'sumadija' })).toEqual(['b'])
    expect(ids({ query: 'ODRZAVANJE' })).toEqual(['c'])
    expect(ids({ query: 'groceries' })).toEqual(['a', 'b'])
  })

  it('numbers also match amounts', () => {
    expect(ids({ query: '340' })).toEqual(['b', 'c'])
    expect(ids({ query: '340,50' })).toEqual(['c'])
    expect(ids({ query: '1.459,96' })).toEqual(['a'])
  })

  it('filters by period, type, amount and category', () => {
    expect(ids({ period: 'THIS_MONTH' })).toEqual(['a', 'b'])
    expect(ids({ period: 'LAST_MONTH' })).toEqual(['c', 'd'])
    expect(ids({ type: 'IN' })).toEqual(['d', 'f'])
    expect(ids({ minMinor: 100000, maxMinor: 1000000 })).toEqual(['a', 'e'])
    expect(ids({ categoryIds: new Set(['g']) })).toEqual(['a', 'b'])
    expect(ids({ categoryIds: new Set([UNCATEGORIZED]) })).toEqual(['c', 'd'])
    const day = { year: 2026, month: 10, day: 31 }
    expect(ids({ period: 'CUSTOM', customFrom: day, customTo: day })).toEqual(['c'])
  })

  it('more filters: this and last year, Out, and a custom start only', () => {
    expect(ids({ period: 'THIS_YEAR' })).toHaveLength(6)
    expect(ids({ period: 'LAST_YEAR' })).toEqual([])
    expect(ids({ type: 'OUT' })).toEqual(['a', 'b', 'c', 'e'])
    expect(ids({ period: 'CUSTOM', customFrom: { year: 2026, month: 11, day: 2 }, customTo: null })).toEqual(['b'])
  })

  it('combines all filters', () => {
    expect(ids({ query: 'kartice', period: 'THIS_MONTH', type: 'OUT', minMinor: 1000, categoryIds: new Set(['lidl']) })).toEqual(['a'])
  })

  it('sums what it finds', () => {
    const summary = summarizeFilter(applyFilter(rows, { ...EMPTY_FILTER, period: 'LAST_MONTH' }, cats, today))
    expect(summary).toEqual({ count: 2, outMinor: 34050, inMinor: 13000000, netMinor: 12965950 })
  })

  it('knows when nothing is filtered', () => {
    expect(isFilterEmpty(EMPTY_FILTER)).toBe(true)
    expect(isFilterEmpty({ ...EMPTY_FILTER, query: '  ' })).toBe(true)
    expect(isFilterEmpty({ ...EMPTY_FILTER, query: 'x' })).toBe(false)
  })
})

describe('statistics', () => {
  it('leave out balance adjustment and roll subs up to their main', () => {
    const r = stats()
    expect(r.months.map((m) => m.outMinor)).toEqual([500000, 34050, 179996])
    expect(r.months.map((m) => m.inMinor)).toEqual([0, 13000000, 0])
    expect(r.byCategory.map((c) => c.name)).toEqual(['Fuel', 'Groceries', 'Uncategorized'])
    const groceries = r.byCategory.find((c) => c.name === 'Groceries')!
    expect(groceries.amountMinor).toBe(179996)
    expect(groceries.subs.map((s) => s.name)).toEqual(['Lidl', 'Maxi'])
    expect(r.averageOutMinor).toBe(238015)
  })

  it('can cover one month', () => {
    const r = stats('2026-11')
    expect(r.totalOutMinor).toBe(179996)
    expect(r.topExpenses.map((t) => t.id)).toEqual(['a', 'b'])
  })

  it('has every month of the range, also the empty ones', () => {
    expect(computeStats([], cats, '2026-11', '2027-02').months.map((m) => m.yearMonth)).toEqual(['2026-11', '2026-12', '2027-01', '2027-02'])
  })

  it('leaves transfers out', () => {
    const transfer = buildRows([tx('t', '2026-11-05', 999, 'TRANSFER_OUT')], cats)
    expect(computeStats(transfer, cats, '2026-11', '2026-11').totalOutMinor).toBe(0)
  })

  it('shows money booked on the main itself next to its subs', () => {
    const list = buildRows([tx('x', '2026-11-05', 100, 'EXPENSE', 'g'), tx('y', '2026-11-05', 300, 'EXPENSE', 'maxi')], cats)
    const [groceries] = computeStats(list, cats, '2026-11', '2026-11').byCategory
    expect(groceries!.subs.map((s) => [s.name, s.amountMinor])).toEqual([['Maxi', 300], ['(Groceries itself)', 100]])
    expect(groceries!.subs[0]!.share).toBe(0.75)
  })

  it('moves through months across a new year', () => {
    expect(nextMonth('2026-12')).toBe('2027-01')
    expect(nextMonth('2027-01', -1)).toBe('2026-12')
  })
})
