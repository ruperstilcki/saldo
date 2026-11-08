import { beforeEach, describe, expect, it } from 'vitest'
import { SaldoDb } from '../db/db'
import type { Wallet } from '../db/types'
import { nextUpdatedAt } from './transactions'
import { reorderWallets, setChecker } from './wallets'

const wallet = (id: string, sortOrder: number) =>
  ({ id, sortOrder, updatedAt: 10, syncState: 'CLEAN', checkerTransactionId: null }) as Wallet

let db: SaldoDb
let counter = 0
beforeEach(() => {
  db = new SaldoDb(`wallets-${counter++}`)
})

describe('wallet changes', () => {
  it('marks the wallet for sync when the checker moves', async () => {
    await db.wallets.put(wallet('w', 0))
    await setChecker(db, 'w', 't1')
    await setChecker(db, 'w', 't2')
    expect(await db.wallets.get('w')).toMatchObject({ checkerTransactionId: 't2', syncState: 'DIRTY' })
    await setChecker(db, 'w', null)
    expect((await db.wallets.get('w'))?.checkerTransactionId).toBeNull()
  })

  it('sends only the wallets that really moved', async () => {
    await db.wallets.bulkPut([wallet('a', 0), wallet('b', 1), wallet('c', 2)])
    await reorderWallets(db, ['b', 'a', 'c'])
    expect(await db.wallets.get('b')).toMatchObject({ sortOrder: 0, syncState: 'DIRTY' })
    expect(await db.wallets.get('a')).toMatchObject({ sortOrder: 1, syncState: 'DIRTY' })
    expect(await db.wallets.get('c')).toMatchObject({ sortOrder: 2, syncState: 'CLEAN' })
  })

  it('each change is strictly newer, even with a clock behind the server', () => {
    expect(nextUpdatedAt(100, 50)).toBe(101)
    expect(nextUpdatedAt(100, 500)).toBe(500)
  })
})
