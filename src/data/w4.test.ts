import { beforeEach, describe, expect, it } from 'vitest'
import { SaldoDb } from '../db/db'
import type { Category, RecurringRule, Transaction } from '../db/types'
import {
  createCategory, deleteCategory, keywordsToStored, keywordsToText, mergeCategory, updateCategory,
} from './categories'
import { deleteRule, saveRule, setRuleActive, type RuleDraft } from './rules'

const category = (id: string, extra: Partial<Category> = {}) =>
  ({ id, name: id, level: 'MAIN', parentId: null, sortOrder: 0, updatedAt: 1, deletedAt: null, syncState: 'CLEAN', ...extra }) as Category
const sub = (id: string, parentId: string | null) => category(id, { level: 'SUB', parentId })
const tx = (id: string, categoryId: string | null, extra: Partial<Transaction> = {}) =>
  ({ id, walletId: 'w', categoryId, updatedAt: 1, deletedAt: null, syncState: 'CLEAN', ...extra }) as Transaction

let db: SaldoDb
let counter = 0
beforeEach(async () => {
  db = new SaldoDb(`w4-${counter++}`)
  await db.setOwner('u')
})

describe('deleting a category', () => {
  it('a sub: its transactions go to the parent', async () => {
    await db.categories.bulkPut([category('main'), sub('s', 'main')])
    await db.transactions.bulkPut([tx('t', 's'), tx('other', 'main')])
    await deleteCategory(db, 's')
    expect(await db.transactions.get('t')).toMatchObject({ categoryId: 'main', syncState: 'DIRTY' })
    expect((await db.categories.get('s'))?.deletedAt).toBeGreaterThan(0)
    expect((await db.transactions.get('other'))?.syncState).toBe('CLEAN')
  })

  it('an Unlinked sub: its transactions lose the category', async () => {
    await db.categories.put(sub('s', null))
    await db.transactions.put(tx('t', 's'))
    await deleteCategory(db, 's')
    expect((await db.transactions.get('t'))?.categoryId).toBeNull()
  })

  it('a main: its subs become Unlinked and its own transactions lose the category', async () => {
    await db.categories.bulkPut([category('main'), sub('s', 'main')])
    await db.transactions.bulkPut([tx('own', 'main'), tx('kept', 's')])
    await deleteCategory(db, 'main')
    expect(await db.categories.get('s')).toMatchObject({ parentId: null, syncState: 'DIRTY' })
    expect((await db.transactions.get('own'))?.categoryId).toBeNull()
    expect(await db.transactions.get('kept')).toMatchObject({ categoryId: 's', syncState: 'CLEAN' })
  })

  it('leaves deleted transactions as they were', async () => {
    await db.categories.put(sub('s', null))
    await db.transactions.put(tx('gone', 's', { deletedAt: 5 }))
    await deleteCategory(db, 's')
    expect(await db.transactions.get('gone')).toMatchObject({ categoryId: 's', syncState: 'CLEAN' })
  })
})

describe('merging a category', () => {
  it('moves the transactions, then deletes the duplicate', async () => {
    await db.categories.bulkPut([category('main'), sub('dup', 'main'), sub('real', 'main')])
    await db.transactions.put(tx('t', 'dup'))
    await mergeCategory(db, 'dup', 'real')
    expect(await db.transactions.get('t')).toMatchObject({ categoryId: 'real', syncState: 'DIRTY' })
    expect((await db.categories.get('dup'))?.deletedAt).toBeGreaterThan(0)
    expect((await db.categories.get('real'))?.deletedAt).toBeNull()
  })

  it('a main brings its subs along', async () => {
    await db.categories.bulkPut([category('a'), category('b'), sub('s', 'a')])
    await mergeCategory(db, 'a', 'b')
    expect((await db.categories.get('s'))?.parentId).toBe('b')
  })

  it('does nothing onto itself', async () => {
    await db.categories.put(category('a'))
    await mergeCategory(db, 'a', 'a')
    expect((await db.categories.get('a'))?.deletedAt).toBeNull()
  })
})

describe('changing a category', () => {
  it('a new one is last in order, and only a sub has a parent', async () => {
    await db.categories.put(category('gone', { sortOrder: 9, deletedAt: 1 }))
    const id = await createCategory(db, { name: ' Food ', level: 'MAIN', parentId: 'x', kind: 'BOTH' })
    expect(await db.categories.get(id)).toMatchObject({ name: 'Food', parentId: null, sortOrder: 10, syncState: 'DIRTY' })
  })

  it('becoming a main clears the parent', async () => {
    await db.categories.put(sub('s', 'main'))
    await updateCategory(db, 's', { level: 'MAIN' })
    expect(await db.categories.get('s')).toMatchObject({ level: 'MAIN', parentId: null, syncState: 'DIRTY' })
  })

  it('keeps fields it was not asked to change', async () => {
    await db.categories.put(category('c', { color: -5, matchKeywords: 'A|B', isQuickPick: false }))
    await updateCategory(db, 'c', { isQuickPick: true })
    expect(await db.categories.get('c')).toMatchObject({ color: -5, matchKeywords: 'A|B', isQuickPick: true })
  })

  it('stores keywords the way the phone does', () => {
    expect(keywordsToStored(' LIDL, LIDL SRBIJA ,, ')).toBe('LIDL|LIDL SRBIJA')
    expect(keywordsToStored('  ')).toBeNull()
    expect(keywordsToText('LIDL|LIDL SRBIJA')).toBe('LIDL, LIDL SRBIJA')
    expect(keywordsToText(null)).toBe('')
  })
})

describe('monthly fee rules', () => {
  const draft = (extra: Partial<RuleDraft> = {}): RuleDraft => ({
    id: null, walletId: 'w', amountMinor: 34000, categoryId: null, noteTemplate: 'Fee {month}', startPeriod: '2026-11', isActive: true, ...extra,
  })

  it('a new rule has the phone defaults and nothing booked', async () => {
    const id = await saveRule(db, draft())
    expect(await db.recurring_rules.get(id)).toMatchObject({
      schedule: 'MONTHLY_LAST_DAY', timeOfDay: '23:59', monthNameLocale: 'sr-Latn', kind: 'EXPENSE', lastGeneratedPeriod: null, syncState: 'DIRTY', userId: 'u',
    })
  })

  it('the web never books a fee, even for a rule that starts long ago', async () => {
    await saveRule(db, draft({ startPeriod: '2020-01' }))
    expect(await db.transactions.count()).toBe(0)
  })

  it('an edit keeps what the phone has done', async () => {
    await db.recurring_rules.put({ id: 'r', lastGeneratedPeriod: '2026-10', createdAt: 1, updatedAt: 2 } as RecurringRule)
    await saveRule(db, draft({ id: 'r', amountMinor: 1 }))
    expect(await db.recurring_rules.get('r')).toMatchObject({ amountMinor: 1, lastGeneratedPeriod: '2026-10', createdAt: 1 })
  })

  it('switching off and deleting go out to the phone', async () => {
    await db.recurring_rules.put({ id: 'r', isActive: true, updatedAt: 2, deletedAt: null, syncState: 'CLEAN' } as RecurringRule)
    await setRuleActive(db, 'r', false)
    expect(await db.recurring_rules.get('r')).toMatchObject({ isActive: false, syncState: 'DIRTY' })
    await deleteRule(db, 'r')
    expect((await db.recurring_rules.get('r'))?.deletedAt).toBeGreaterThan(0)
  })
})
