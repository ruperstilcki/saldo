import { describe, expect, it } from 'vitest'
import type { Category } from '../db/types'
import { canCreateCategory, categoryOptions, suggestCategories } from './categorySuggest'

// Same data and expected values as android/app/src/test/.../domain/CategorySuggestTest.kt
const c = (id: string, name: string, level: string, parentId: string | null = null, extra: Partial<Category> = {}) =>
  ({ id, name, level, parentId, kind: 'EXPENSE', isQuickPick: false, color: null, ...extra }) as Category

const all = [
  c('g', 'Groceries', 'MAIN', null, { color: 0x11 }),
  c('maxi', 'Maxi', 'SUB', 'g', { isQuickPick: true }),
  c('mere', 'Mere', 'SUB', 'g'),
  c('mango', 'Mango', 'SUB'),
  c('sal', 'Salary', 'MAIN', null, { kind: 'INCOME' }),
  c('sum', 'Šumadija', 'SUB', 'g'),
]

const ids = (q: string, { income = false, quick = true, usage = {} }: { income?: boolean; quick?: boolean; usage?: Record<string, number> } = {}) =>
  suggestCategories(q, all, new Map(Object.entries(usage)), income, quick).map((o) => o.id)

describe('category autocomplete', () => {
  it('puts name prefixes first, then contains, then parent names', () => {
    expect(ids('m')).toEqual(['mango', 'maxi', 'mere', 'sum'])
    expect(ids('ma')).toEqual(['mango', 'maxi', 'sum'])
    expect(ids('groc')).toEqual(['g', 'maxi', 'mere', 'sum'])
  })

  it('breaks ties by usage', () => {
    expect(ids('m', { usage: { mere: 50, maxi: 10 } })).toEqual(['mere', 'maxi', 'mango', 'sum'])
  })

  it('ignores diacritics and case', () => {
    expect(ids('SUMAD')).toEqual(['sum'])
  })

  it('hides quick picks when the setting is off', () => {
    expect(ids('ma', { quick: false })).toEqual(['mango', 'sum'])
  })

  it('filters by kind', () => {
    expect(ids('sal', { income: true })).toEqual(['sal'])
    expect(ids('sal')).toEqual([])
  })

  it('builds labels and inherits the color', () => {
    const options = new Map(categoryOptions(all).map((o) => [o.id, o]))
    expect(options.get('maxi')!.label).toBe('Maxi · Groceries')
    expect(options.get('mango')!.label).toBe('Mango · (Unlinked)')
    expect(options.get('maxi')!.color).toBe(0x11)
  })

  it('offers Create only for new names', () => {
    expect(canCreateCategory('Shell', all)).toBe(true)
    expect(canCreateCategory('maxi', all)).toBe(false)
    expect(canCreateCategory('  ', all)).toBe(false)
  })
})
