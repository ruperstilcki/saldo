import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SaldoDb } from '../db/db'
import type { Transaction } from '../db/types'
import {
  claimLocalData, discardOtherAccount, isSessionExpired, leaveSession, markOpened, readLastOpened, SESSION_MS, type KeyValueStore,
} from './lifecycle'

function memoryStore(): KeyValueStore {
  const map = new Map<string, string>()
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  }
}

const tx = (syncState: 'CLEAN' | 'DIRTY') => ({ id: 't1', walletId: 'w1', syncState, updatedAt: 1 }) as Transaction

let db: SaldoDb
let counter = 0
beforeEach(() => {
  db = new SaldoDb(`lifecycle-${counter++}`)
})

describe('session lifetime', () => {
  it('lasts 30 days', () => {
    expect(SESSION_MS).toBe(2_592_000_000)
    expect(isSessionExpired(1000, 1000 + SESSION_MS - 1)).toBe(false)
    expect(isSessionExpired(1000, 1000 + SESSION_MS)).toBe(true)
  })

  it('starts again on every opening', () => {
    const store = memoryStore()
    markOpened(store, 1000)
    const later = 1000 + SESSION_MS - 1
    expect(isSessionExpired(readLastOpened(store), later)).toBe(false)
    markOpened(store, later)
    expect(isSessionExpired(readLastOpened(store), later + SESSION_MS - 1)).toBe(false)
  })

  it('does not end when the clock moves backwards or nothing is stored', () => {
    expect(isSessionExpired(5000, 1000)).toBe(false)
    expect(isSessionExpired(null, 1000)).toBe(false)
  })
})

describe('leaving the session', () => {
  it('sends first, then wipes when nothing is left', async () => {
    await db.transactions.put(tx('DIRTY'))
    await db.setOwner('a')
    const store = memoryStore()
    markOpened(store, 1)
    const order: string[] = []

    await leaveSession({
      db,
      store,
      finalRound: async () => {
        order.push('send')
        await db.transactions.update('t1', { syncState: 'CLEAN' })
      },
      endSession: async () => void order.push('end'),
    })

    expect(order).toEqual(['send', 'end'])
    expect(await db.transactions.count()).toBe(0)
    expect(await db.getOwner()).toBeNull()
    expect(readLastOpened(store)).toBeNull()
  })

  it('keeps unsent changes when sending fails, and still ends the session', async () => {
    await db.transactions.put(tx('DIRTY'))
    await db.setOwner('a')
    const endSession = vi.fn(async () => undefined)

    await leaveSession({ db, store: memoryStore(), finalRound: async () => false, endSession })

    expect(endSession).toHaveBeenCalledOnce()
    expect((await db.transactions.get('t1'))?.syncState).toBe('DIRTY')
    expect(await db.getOwner()).toBe('a')
  })
})

describe('signing in with local data present', () => {
  it('the same account keeps its unsent changes', async () => {
    await db.setOwner('a')
    await db.transactions.put(tx('DIRTY'))
    expect(await claimLocalData(db, 'a')).toEqual({ ok: true })
    expect(await db.dirtyCount()).toBe(1)
  })

  it('another account needs a confirmation before unsent changes are removed', async () => {
    await db.setOwner('a')
    await db.transactions.put(tx('DIRTY'))
    expect(await claimLocalData(db, 'b')).toEqual({ ok: false, unsentChanges: 1 })
    expect(await db.dirtyCount()).toBe(1)

    await discardOtherAccount(db, 'b')
    expect(await db.dirtyCount()).toBe(0)
    expect(await db.getOwner()).toBe('b')
  })

  it('another account replaces data that was fully sent', async () => {
    await db.setOwner('a')
    await db.transactions.put(tx('CLEAN'))
    expect(await claimLocalData(db, 'b')).toEqual({ ok: true })
    expect(await db.transactions.count()).toBe(0)
    expect(await db.getOwner()).toBe('b')
  })
})
