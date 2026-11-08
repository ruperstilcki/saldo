import { beforeEach, describe, expect, it } from 'vitest'
import { SaldoDb } from '../db/db'
import type { ImageRow, RecurringRule, Transaction } from '../db/types'
import { nextCursor, SAFETY_MS } from './cursor'
import { PAGE, planImagePush, runRound } from './engine'
import { FakeRemote } from './fakeRemote'

const UID = 'user-1'
let db: SaldoDb
let remote: FakeRemote
let dbCounter = 0

const serverTx = (id: string, extra: Record<string, unknown> = {}) => ({
  id, user_id: UID, wallet_id: 'w1', kind: 'EXPENSE', amount_minor: 100, occurred_at: 1, category_id: null,
  note: 'server', original_amount_minor: null, original_currency: null, transfer_id: null, source: 'MANUAL',
  recurring_rule_id: null, period_key: null, legacy_id: null, created_at: 5, deleted_at: null, ...extra,
})

const localTx = (id: string, extra: Partial<Transaction> = {}): Transaction => ({
  id, userId: UID, walletId: 'w1', kind: 'EXPENSE', amountMinor: 100, occurredAt: 1, categoryId: null, note: 'local',
  originalAmountMinor: null, originalCurrency: null, transferId: null, source: 'MANUAL', recurringRuleId: null,
  periodKey: null, legacyId: null, createdAt: 5, updatedAt: 10, deletedAt: null, syncState: 'DIRTY', ...extra,
})

const localImage = (hash: string, extra: Partial<ImageRow> = {}): ImageRow => ({
  hash, userId: UID, remotePath: null, byteSize: 3, createdAt: 1, updatedAt: 2, deletedAt: null, syncState: 'DIRTY', ...extra,
})

beforeEach(() => {
  db = new SaldoDb(`test-${dbCounter++}`)
  remote = new FakeRemote()
})

describe('cursor', () => {
  it('follows the server clock, not the newest row', () => {
    expect(nextCursor(0, 500_000, 1_000_000)).toBe(1_000_000 - SAFETY_MS)
  })
  it('never moves backwards', () => {
    expect(nextCursor(2_000_000, 0, 1_000_000)).toBe(2_000_000)
  })
  it('falls back to the newest row without a server clock', () => {
    expect(nextCursor(0, 500_000, null)).toBe(500_000 - SAFETY_MS)
  })
})

describe('push', () => {
  it('always sends deleted_at and created_at, never updated_at', async () => {
    await db.transactions.put(localTx('t1'))
    await runRound(db, remote, UID)

    const row = remote.upserts.find((u) => u.table === 'transactions')!.rows[0]!
    expect(row).toHaveProperty('deleted_at', null)
    expect(row).toHaveProperty('created_at', 5)
    expect(row).not.toHaveProperty('updated_at')
    expect(row).not.toHaveProperty('syncState')
    expect(row).toHaveProperty('user_id', UID)
  })

  it('sends tables in dependency order, with the right conflict target', async () => {
    await db.transactions.put(localTx('t1'))
    await db.images.put(localImage('h1', { blob: new Blob(['abc']) }))
    await db.wallets.put({ id: 'w1', userId: UID, syncState: 'DIRTY', createdAt: 1, updatedAt: 1, deletedAt: null } as never)
    await runRound(db, remote, UID)

    expect(remote.upserts.map((u) => [u.table, u.onConflict])).toEqual([
      ['images', 'user_id,hash'],
      ['wallets', 'user_id,id'],
      ['transactions', 'user_id,id'],
    ])
  })

  it(`splits into batches of ${PAGE}`, async () => {
    await db.transactions.bulkPut(Array.from({ length: PAGE + 1 }, (_, i) => localTx(`t${i}`)))
    await runRound(db, remote, UID)
    expect(remote.upserts.map((u) => u.rows.length)).toEqual([PAGE, 1])
    expect(await db.dirtyCount()).toBe(0)
  })

  it('keeps a row DIRTY when it changes while being sent', async () => {
    await db.transactions.put(localTx('t1'))
    remote.duringUpsert = async () => {
      remote.duringUpsert = undefined
      await db.transactions.update('t1', { note: 'newer', updatedAt: 11 })
    }
    await runRound(db, remote, UID)

    const row = await db.transactions.get('t1')
    expect(row?.syncState).toBe('DIRTY')
    expect(row?.note).toBe('newer')
  })

  it('keeps rows DIRTY when sending fails', async () => {
    await db.transactions.put(localTx('t1'))
    remote.failWrites = true
    await expect(runRound(db, remote, UID)).rejects.toThrow()
    expect((await db.transactions.get('t1'))?.syncState).toBe('DIRTY')
  })

  it('restoring a deleted row reaches the server (Undo)', async () => {
    remote.seed('transactions', serverTx('t1', { deleted_at: 99 }))
    await db.transactions.put(localTx('t1', { deletedAt: null }))
    await runRound(db, remote, UID)
    expect(remote.tables.get('transactions')!.get('t1')!.deleted_at).toBeNull()
  })

  it('does not move last_generated_period of a fee rule back', async () => {
    remote.seed('recurring_rules', { id: 'r1', user_id: UID, last_generated_period: '2026-11', note_template: 'x' })
    const stale = { id: 'r1', userId: UID, noteTemplate: 'edited', lastGeneratedPeriod: '2026-10', createdAt: 1, updatedAt: 2, deletedAt: null, syncState: 'DIRTY' } as RecurringRule
    await db.recurring_rules.put(stale)
    await runRound(db, remote, UID)

    const sent = remote.upserts.find((u) => u.table === 'recurring_rules')!.rows[0]!
    expect(sent).not.toHaveProperty('last_generated_period')
    const onServer = remote.tables.get('recurring_rules')!.get('r1')!
    expect(onServer.last_generated_period).toBe('2026-11')
    expect(onServer.note_template).toBe('edited')
    expect((await db.recurring_rules.get('r1'))?.lastGeneratedPeriod).toBe('2026-11')
  })

  it('never creates fee transactions by itself', async () => {
    remote.seed('recurring_rules', { id: 'r1', user_id: UID, is_active: true, start_period: '2020-01', note_template: 'x' })
    await runRound(db, remote, UID)
    expect(await db.transactions.count()).toBe(0)
    expect(remote.upserts).toEqual([])
  })
})

describe('pull', () => {
  it('stores received rows as CLEAN, with the server updated_at', async () => {
    remote.seed('transactions', serverTx('t1'))
    await runRound(db, remote, UID)
    const row = await db.transactions.get('t1')
    expect(row?.syncState).toBe('CLEAN')
    expect(row?.note).toBe('server')
    expect(row?.updatedAt).toBeGreaterThan(1_000_000)
  })

  it('does not overwrite a local DIRTY row', async () => {
    remote.seed('transactions', serverTx('t1'))
    await db.transactions.put(localTx('t1', { note: 'mine' }))
    remote.failWrites = false
    await runRound(db, remote, UID)
    expect((await db.transactions.get('t1'))?.note).toBe('mine')
    expect(remote.tables.get('transactions')!.get('t1')!.note).toBe('mine')
  })

  it('reads pages until the table is done', async () => {
    for (let i = 0; i < PAGE + 3; i++) remote.seed('transactions', serverTx(`t${i}`))
    const report = await runRound(db, remote, UID)
    expect(report.pulled).toBe(PAGE + 3)
    expect(await db.transactions.count()).toBe(PAGE + 3)
  })

  it('a second round without changes downloads nothing older than the safety window', async () => {
    for (let i = 0; i < 20; i++) remote.seed('transactions', serverTx(`t${i}`))
    await runRound(db, remote, UID)
    remote.clock += 10 * SAFETY_MS
    await runRound(db, remote, UID)
    remote.clock += 10 * SAFETY_MS
    const third = await runRound(db, remote, UID)
    expect(third.pulled).toBe(0)
    const lastSelect = remote.selects.filter((s) => s.table === 'transactions').at(-1)!
    expect(lastSelect.since).toBeGreaterThan(1_000_000)
  })

  it('keeps data of other users out', async () => {
    remote.seed('transactions', serverTx('t1', { user_id: 'someone-else' }))
    await runRound(db, remote, UID)
    expect(await db.transactions.count()).toBe(0)
  })
})

describe('images', () => {
  it('a deleted image loses its remote path and its file', async () => {
    remote.files.set(`${UID}/h1.webp`, new Blob(['x']))
    await db.images.put(localImage('h1', { remotePath: `${UID}/h1.webp`, deletedAt: 9 }))
    await runRound(db, remote, UID)
    expect(remote.files.has(`${UID}/h1.webp`)).toBe(false)
    expect(remote.tables.get('images')!.get('h1')!.remote_path).toBeNull()
    expect((await db.images.get('h1'))?.remotePath).toBeNull()
  })

  it('a changed live image is uploaded even if it already has a remote path', async () => {
    await db.images.put(localImage('h1', { remotePath: `${UID}/h1.webp`, blob: new Blob(['abc']) }))
    await runRound(db, remote, UID)
    expect(remote.files.has(`${UID}/h1.webp`)).toBe(true)
  })

  it('does not claim a file it cannot upload', () => {
    expect(planImagePush(UID, { hash: 'h', remotePath: null, deletedAt: null })).toEqual({ action: null, remotePath: null })
  })

  it('a failed download does not stop the sync', async () => {
    remote.seed('images', { hash: 'h1', user_id: UID, remote_path: 'missing.webp', byte_size: 1, created_at: 1, deleted_at: null })
    remote.seed('transactions', serverTx('t1'))
    remote.failDownloads = true
    await runRound(db, remote, UID)
    expect((await db.images.get('h1'))?.blob).toBeUndefined()
    expect(await db.transactions.count()).toBe(1)
  })

  it('removes the cached file of an image deleted elsewhere', async () => {
    await db.images.put(localImage('h1', { syncState: 'CLEAN', blob: new Blob(['abc']) }))
    remote.seed('images', { hash: 'h1', user_id: UID, remote_path: null, byte_size: 1, created_at: 1, deleted_at: 7 })
    await runRound(db, remote, UID)
    const row = await db.images.get('h1')
    expect(row?.deletedAt).toBe(7)
    expect(row?.blob).toBeUndefined()
  })
})
