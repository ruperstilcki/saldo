import { fold } from '../core/strings'
import type { SaldoDb } from '../db/db'
import type { Category } from '../db/types'
import { nextUpdatedAt } from './transactions'

type CategoryFields = Pick<Category, 'name' | 'level' | 'parentId' | 'kind'>

async function insert(db: SaldoDb, fields: CategoryFields): Promise<string> {
  const all = await db.categories.toArray()
  const now = Date.now()
  const row: Category = {
    ...fields,
    id: crypto.randomUUID(),
    userId: (await db.getOwner()) ?? '',
    isQuickPick: false,
    excludeFromStats: false,
    matchKeywords: null,
    color: null,
    sortOrder: all.reduce((max, c) => Math.max(max, c.sortOrder), -1) + 1,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    syncState: 'DIRTY',
  }
  await db.categories.add(row)
  return row.id
}

/** "+ Create …" in the transaction form: an Unlinked sub-category, without a color. An existing name is reused. */
export async function createCategoryFromForm(db: SaldoDb, name: string, income: boolean): Promise<string> {
  const trimmed = name.trim()
  return db.transaction('rw', db.categories, db.meta, async () => {
    const existing = (await db.categories.toArray()).find((c) => c.deletedAt === null && fold(c.name) === fold(trimmed))
    if (existing) return existing.id
    return insert(db, { name: trimmed, level: 'SUB', parentId: null, kind: income ? 'INCOME' : 'EXPENSE' })
  })
}

export function createCategory(db: SaldoDb, fields: CategoryFields): Promise<string> {
  return db.transaction('rw', db.categories, db.meta, () =>
    insert(db, { ...fields, name: fields.name.trim(), parentId: fields.level === 'SUB' ? fields.parentId : null }),
  )
}

export type CategoryChanges = Partial<Pick<Category, 'name' | 'level' | 'parentId' | 'kind' | 'isQuickPick' | 'excludeFromStats' | 'matchKeywords' | 'color'>>

export async function updateCategory(db: SaldoDb, id: string, changes: CategoryChanges): Promise<void> {
  await db.transaction('rw', db.categories, async () => {
    const current = await db.categories.get(id)
    if (!current) return
    const merged = { ...current, ...changes }
    await db.categories.update(id, {
      ...changes,
      name: merged.name.trim(),
      parentId: merged.level === 'MAIN' ? null : merged.parentId,
      updatedAt: nextUpdatedAt(current.updatedAt),
      syncState: 'DIRTY',
    })
  })
}

/** "LIDL, LIDL SRBIJA" <-> "LIDL|LIDL SRBIJA", as the phone stores keywords. */
export const keywordsToStored = (text: string) =>
  text.split(/[,|]/).map((word) => word.trim()).filter(Boolean).join('|') || null
export const keywordsToText = (stored: string | null) => (stored ?? '').replaceAll('|', ', ')

async function moveTransactions(db: SaldoDb, from: string, to: string | null, now: number) {
  await db.transactions
    .filter((t) => t.categoryId === from && t.deletedAt === null)
    .modify({ categoryId: to, updatedAt: now, syncState: 'DIRTY' })
}

async function moveChildren(db: SaldoDb, from: string, to: string | null, now: number) {
  await db.categories
    .filter((c) => c.parentId === from && c.deletedAt === null)
    .modify({ parentId: to, updatedAt: now, syncState: 'DIRTY' })
}

const softDelete = (db: SaldoDb, id: string, now: number) => db.categories.update(id, { deletedAt: now, updatedAt: now, syncState: 'DIRTY' })

/** Moves all transactions (and, for a main, its subs) into [toId], then deletes [fromId]. */
export async function mergeCategory(db: SaldoDb, fromId: string, toId: string): Promise<void> {
  if (fromId === toId) return
  await db.transaction('rw', db.categories, db.transactions, async () => {
    const [from, to] = await Promise.all([db.categories.get(fromId), db.categories.get(toId)])
    if (!from || !to) return
    const now = nextUpdatedAt(from.updatedAt)
    await moveTransactions(db, fromId, toId, now)
    await moveChildren(db, fromId, to.level === 'MAIN' ? toId : null, now)
    await softDelete(db, fromId, now)
  })
}

/** A sub: its transactions go to the parent, or to none. A main: its subs become Unlinked. */
export async function deleteCategory(db: SaldoDb, id: string): Promise<void> {
  await db.transaction('rw', db.categories, db.transactions, async () => {
    const category = await db.categories.get(id)
    if (!category) return
    const now = nextUpdatedAt(category.updatedAt)
    if (category.level === 'SUB') {
      await moveTransactions(db, id, category.parentId, now)
    } else {
      await moveTransactions(db, id, null, now)
      await moveChildren(db, id, null, now)
    }
    await softDelete(db, id, now)
  })
}
