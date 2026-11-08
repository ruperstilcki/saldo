import { beforeEach, describe, expect, it } from 'vitest'
import { SaldoDb } from '../db/db'
import type { Category, RecurringRule, Transaction, Wallet } from '../db/types'
import { createCategoryFromForm } from './categories'
import { centerSquare, sha256Hex } from './images'
import { deleteWallet, saveWallet, type WalletDraft } from './wallets'

const walletDraft = (extra: Partial<WalletDraft> = {}): WalletDraft => ({
  id: null, name: ' Cash ', walletType: 'CASH', currencyCode: 'RSD', openingBalanceMinor: 100, imageHash: null, newImage: null,
  color: -1, note: '  ', ...extra,
})
const image = (hash: string) => ({ hash, blob: new Blob(['abc']), byteSize: 3 })

let db: SaldoDb
let counter = 0
beforeEach(async () => {
  db = new SaldoDb(`forms-${counter++}`)
  await db.setOwner('u')
})

describe('saving a wallet', () => {
  it('creates a wallet at the end of the list, marked for sync', async () => {
    await db.wallets.bulkPut([
      { id: 'a', sortOrder: 4, deletedAt: null } as Wallet,
      { id: 'gone', sortOrder: 9, deletedAt: 1 } as Wallet,
    ])
    const id = await saveWallet(db, walletDraft())
    expect(await db.wallets.get(id)).toMatchObject({
      name: 'Cash', note: null, sortOrder: 5, syncState: 'DIRTY', isArchived: false, deletedAt: null, userId: 'u',
    })
  })

  it('an edit keeps the order, the archive state and the checker', async () => {
    await db.wallets.put({ id: 'w', sortOrder: 3, isArchived: true, checkerTransactionId: 't', legacyId: 9, createdAt: 1, updatedAt: 2 } as Wallet)
    await saveWallet(db, walletDraft({ id: 'w', name: 'New name' }))
    expect(await db.wallets.get('w')).toMatchObject({
      name: 'New name', sortOrder: 3, isArchived: true, checkerTransactionId: 't', legacyId: 9, createdAt: 1, syncState: 'DIRTY',
    })
  })

  it('stores a picked image only on save, ready for upload', async () => {
    const id = await saveWallet(db, walletDraft({ newImage: image('h1') }))
    expect((await db.wallets.get(id))?.imageHash).toBe('h1')
    expect(await db.images.get('h1')).toMatchObject({ syncState: 'DIRTY', deletedAt: null, byteSize: 3 })
  })

  it('picking a previously deleted image brings it back for upload', async () => {
    await db.images.put({ hash: 'h1', deletedAt: 5, remotePath: null, createdAt: 1, updatedAt: 6, syncState: 'CLEAN' } as never)
    await saveWallet(db, walletDraft({ newImage: image('h1') }))
    const row = await db.images.get('h1')
    expect(row).toMatchObject({ deletedAt: null, syncState: 'DIRTY', createdAt: 1 })
    expect(row?.blob).toBeTruthy()
    expect(row!.updatedAt).toBeGreaterThan(6)
  })

  it('removing the image clears the reference', async () => {
    await db.wallets.put({ id: 'w', imageHash: 'h1', updatedAt: 1 } as Wallet)
    await saveWallet(db, walletDraft({ id: 'w', imageHash: null }))
    expect((await db.wallets.get('w'))?.imageHash).toBeNull()
  })
})

describe('deleting a wallet', () => {
  it('marks the wallet, its transactions and its rules, and nothing else', async () => {
    await db.wallets.bulkPut([{ id: 'w', updatedAt: 1, deletedAt: null } as Wallet, { id: 'other', updatedAt: 1, deletedAt: null } as Wallet])
    await db.transactions.bulkPut([
      { id: 't1', walletId: 'w', deletedAt: null, syncState: 'CLEAN' } as Transaction,
      { id: 't2', walletId: 'other', deletedAt: null, syncState: 'CLEAN' } as Transaction,
      { id: 'old', walletId: 'w', deletedAt: 3, updatedAt: 3, syncState: 'CLEAN' } as Transaction,
    ])
    await db.recurring_rules.bulkPut([
      { id: 'r1', walletId: 'w', deletedAt: null } as RecurringRule,
      { id: 'r2', walletId: 'other', deletedAt: null } as RecurringRule,
    ])

    await deleteWallet(db, 'w')

    expect((await db.wallets.get('w'))?.deletedAt).toBeGreaterThan(0)
    expect((await db.wallets.get('other'))?.deletedAt).toBeNull()
    expect(await db.transactions.get('t1')).toMatchObject({ syncState: 'DIRTY' })
    expect((await db.transactions.get('t1'))?.deletedAt).toBeGreaterThan(0)
    expect((await db.transactions.get('t2'))?.deletedAt).toBeNull()
    expect(await db.transactions.get('old')).toMatchObject({ deletedAt: 3, syncState: 'CLEAN' })
    expect((await db.recurring_rules.get('r1'))?.deletedAt).toBeGreaterThan(0)
    expect((await db.recurring_rules.get('r2'))?.deletedAt).toBeNull()
  })
})

describe('creating a category from the form', () => {
  it('makes an Unlinked sub-category of the right kind, last in order', async () => {
    await db.categories.put({ id: 'a', name: 'Food', sortOrder: 7, deletedAt: null } as Category)
    const id = await createCategoryFromForm(db, ' Shell ', false)
    expect(await db.categories.get(id)).toMatchObject({
      name: 'Shell', level: 'SUB', parentId: null, kind: 'EXPENSE', color: null, sortOrder: 8, syncState: 'DIRTY',
    })
    const income = await createCategoryFromForm(db, 'Gift', true)
    expect((await db.categories.get(income))?.kind).toBe('INCOME')
  })

  it('reuses a category of the same name, ignoring case and diacritics', async () => {
    await db.categories.put({ id: 'a', name: 'Šuma', sortOrder: 0, deletedAt: null } as Category)
    expect(await createCategoryFromForm(db, 'SUMA', false)).toBe('a')
    expect(await db.categories.count()).toBe(1)
  })

  it('does not reuse a deleted one', async () => {
    await db.categories.put({ id: 'a', name: 'Old', sortOrder: 0, deletedAt: 1 } as Category)
    expect(await createCategoryFromForm(db, 'Old', false)).not.toBe('a')
  })
})

describe('image helpers', () => {
  it('finds the centered square', () => {
    expect(centerSquare(400, 200)).toEqual({ x: 100, y: 0, side: 200 })
    expect(centerSquare(200, 400)).toEqual({ x: 0, y: 100, side: 200 })
    expect(centerSquare(301, 300)).toEqual({ x: 0, y: 0, side: 300 })
  })

  it('names by sha256', async () => {
    const bytes = new TextEncoder().encode('abc')
    expect(await sha256Hex(bytes.buffer as ArrayBuffer)).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
})
