import { describe, expect, it } from 'vitest'
import type { Category, Transaction } from '../db/types'
import { buildRows, type TransactionRow } from './rows'
import { buildTable, defaultCollapsed, type TableItem } from './tableModel'

// Same data and expected values as android/app/src/test/.../ui/wallet/TableModelTest.kt
const row = (id: string, date: string, minor: number, kind = 'EXPENSE') =>
  ({ id, walletId: 'w', kind, amountMinor: minor, occurredAt: new Date(`${date}T12:00:00`).getTime(), note: null, source: 'MANUAL' }) as TransactionRow

const rows = [
  row('a', '2026-11-05', 1_000),
  row('b', '2026-10-31', 34_000),
  row('c', '2026-10-04', 13_000_000, 'INCOME'),
  row('d', '2025-12-31', 25_000),
]

const months = (items: TableItem[]) =>
  new Map(items.flatMap((i) => (i.type === 'month' ? [[i.yearMonth, i] as const] : [])))

describe('wallet table', () => {
  it('is year, month, rows, newest first', () => {
    const items = buildTable(rows, 100_000, () => false)
    expect(items.map((i) => i.key)).toEqual(['y2026', 'm2026-11', 'a', 'm2026-10', 'b', 'c', 'y2025', 'm2025-12', 'd'])
  })

  it('has month totals and end balances', () => {
    const items = buildTable(rows, 100_000, () => false)
    const byMonth = months(items)
    expect(byMonth.get('2025-12')!.endBalanceMinor).toBe(75_000)
    const october = byMonth.get('2026-10')!
    expect(october.endBalanceMinor).toBe(13_041_000)
    expect(october.outMinor).toBe(34_000)
    expect(october.inMinor).toBe(13_000_000)
    expect(october.count).toBe(2)
    expect(byMonth.get('2026-11')!.endBalanceMinor).toBe(13_040_000)
    const y2026 = items.find((i) => i.key === 'y2026')
    expect(y2026).toMatchObject({ endBalanceMinor: 13_040_000, count: 3 })
  })

  it('hides rows of a collapsed month and months of a collapsed year', () => {
    const items = buildTable(rows, 0, (key) => key === 'm2026-10' || key === 'y2025')
    expect(items.map((i) => i.key)).toEqual(['y2026', 'm2026-11', 'a', 'm2026-10', 'y2025'])
    expect(items.find((i) => i.key === 'm2026-10')).toMatchObject({ collapsed: true })
  })

  it('is empty without rows', () => {
    expect(buildTable([], 100, () => false)).toEqual([])
  })

  it('collapses by default all except the current period', () => {
    const now = '2026-11'
    const c = 'COLLAPSE_EXCEPT_CURRENT'
    const e = 'EXPANDED'
    expect(defaultCollapsed('m2026-11', c, e, now)).toBe(false)
    expect(defaultCollapsed('m2026-10', c, e, now)).toBe(true)
    expect(defaultCollapsed('y2025', c, e, now)).toBe(false)
    expect(defaultCollapsed('y2025', e, c, now)).toBe(true)
    expect(defaultCollapsed('y2026', e, c, now)).toBe(false)
  })
})

describe('rows', () => {
  const tx = (id: string, extra: Partial<Transaction>) => ({ id, deletedAt: null, occurredAt: 1, createdAt: 1, categoryId: null, ...extra }) as Transaction
  const category = (id: string, extra: Partial<Category>) => ({ id, name: id, parentId: null, color: null, deletedAt: null, ...extra }) as Category

  it('a sub-category without a color inherits the color of its parent', () => {
    const categories = [category('main', { color: -1 }), category('sub', { parentId: 'main' })]
    const [row] = buildRows([tx('t', { categoryId: 'sub' })], categories)
    expect(row).toMatchObject({ categoryName: 'sub', parentName: 'main', categoryColor: -1 })
  })

  it('a deleted category counts as none', () => {
    const [row] = buildRows([tx('t', { categoryId: 'c' })], [category('c', { deletedAt: 5, color: -1 })])
    expect(row).toMatchObject({ categoryName: null, categoryColor: null })
  })

  it('leaves out deleted rows and sorts by date, then by creation', () => {
    const list = buildRows([
      tx('old', { occurredAt: 1 }),
      tx('first', { occurredAt: 2, createdAt: 1 }),
      tx('second', { occurredAt: 2, createdAt: 2 }),
      tx('gone', { occurredAt: 3, deletedAt: 9 }),
    ], [])
    expect(list.map((r) => r.id)).toEqual(['second', 'first', 'old'])
  })
})
