import { createClient } from '@supabase/supabase-js'
import { createHmac } from 'node:crypto'
import { createServer, request, type Server } from 'node:http'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { deleteTransaction, restoreTransaction, saveTransaction } from '../data/transactions'
import { deleteWallet, saveWallet, setChecker } from '../data/wallets'
import { SaldoDb } from '../db/db'
import type { RecurringRule } from '../db/types'
import { SAFETY_MS } from './cursor'
import { PAGE, runRound } from './engine'
import { supabaseRemote, type RemoteApi } from './remote'

/** Only with `npm run test:db`: a real Postgres and PostgREST in Docker, with the real migration and made-up data. */
const API = process.env.SALDO_TEST_API
const SECRET = process.env.SALDO_TEST_SECRET ?? ''
const ALICE = '11111111-1111-4111-8111-111111111111'
const BOB = '22222222-2222-4222-8222-222222222222'

const base64Url = (value: string) => Buffer.from(value).toString('base64url')
function tokenFor(uid: string) {
  const payload = `${base64Url('{"alg":"HS256","typ":"JWT"}')}.${base64Url(JSON.stringify({ sub: uid, role: 'authenticated', exp: 4102444800 }))}`
  return `${payload}.${createHmac('sha256', SECRET).update(payload).digest('base64url')}`
}

let proxy: Server
let proxyUrl = ''
let counter = 0
const unique = (prefix: string) => `${prefix}-${Date.now()}-${counter++}`

/** supabase-js expects the API under /rest/v1, as on Supabase. */
function startProxy(): Promise<void> {
  const target = new URL(API!)
  proxy = createServer((incoming, outgoing) => {
    const forward = request(
      { host: target.hostname, port: target.port, path: incoming.url!.replace('/rest/v1', ''), method: incoming.method, headers: incoming.headers },
      (answer) => {
        outgoing.writeHead(answer.statusCode!, answer.headers)
        answer.pipe(outgoing)
      },
    )
    incoming.pipe(forward)
  })
  return new Promise((resolve) => {
    proxy.listen(0, '127.0.0.1', () => {
      proxyUrl = `http://127.0.0.1:${(proxy.address() as { port: number }).port}`
      resolve()
    })
  })
}

const clientFor = (uid: string | null) =>
  createClient(proxyUrl, 'test-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: uid ? { Authorization: `Bearer ${tokenFor(uid)}` } : {} },
  })

/** The real database and API. Only file storage stays in memory. */
function remoteFor(uid: string): RemoteApi & { files: Map<string, Blob> } {
  const files = new Map<string, Blob>()
  return {
    ...supabaseRemote(clientFor(uid)),
    files,
    uploadImage: async (path, blob) => void files.set(path, blob),
    removeImage: async (path) => void files.delete(path),
    downloadImage: async (path) => {
      const file = files.get(path)
      if (!file) throw new Error('not found')
      return file
    },
  }
}

function device(uid: string) {
  return { db: new SaldoDb(`device-${counter++}`), remote: remoteFor(uid), uid }
}

type Device = ReturnType<typeof device>
const sync = (d: Device) => runRound(d.db, d.remote, d.uid)

async function newWalletOn(d: Device, name = unique('Wallet')) {
  await d.db.setOwner(d.uid)
  return saveWallet(d.db, {
    id: null, name, walletType: 'BANK', currencyCode: 'RSD', openingBalanceMinor: 100000, imageHash: null, newImage: null, color: -1, note: '',
  })
}

const expense = (walletId: string, amountMinor = 145996, note = 'Made up') => ({
  id: null, walletId, kind: 'EXPENSE', amountMinor, occurredAt: Date.UTC(2026, 9, 15), note, categoryId: null,
  originalAmountMinor: null, originalCurrency: null,
})

describe.skipIf(!API)('against a real database', () => {
  let web: Device
  let phone: Device

  beforeAll(startProxy)
  afterAll(() => void proxy?.close())
  beforeEach(() => {
    web = device(ALICE)
    phone = device(ALICE)
  })

  it('reads the server clock through the RPC the browser uses', async () => {
    const now = await web.remote.nowMs()
    expect(typeof now).toBe('number')
    expect(Math.abs(now! - Date.now())).toBeLessThan(60_000)
  })

  it('carries a new wallet and transaction from one device to another, unchanged', async () => {
    const walletId = await newWalletOn(web)
    const id = await saveTransaction(web.db, { ...expense(walletId), note: 'Šđčćž\nsecond line' })
    await sync(web)
    await sync(phone)

    expect(await phone.db.wallets.get(walletId)).toMatchObject({ openingBalanceMinor: 100000, currencyCode: 'RSD', syncState: 'CLEAN', userId: ALICE })
    const row = await phone.db.transactions.get(id)
    expect(row).toMatchObject({
      walletId, kind: 'EXPENSE', amountMinor: 145996, note: 'Šđčćž\nsecond line', source: 'MANUAL', deletedAt: null, syncState: 'CLEAN',
    })
    expect((await web.db.transactions.get(id))?.syncState).toBe('CLEAN')
  })

  it('lets the server set updated_at, ignoring the clock of the device', async () => {
    const walletId = await newWalletOn(web)
    const id = await saveTransaction(web.db, expense(walletId))
    const serverBefore = await web.remote.nowMs()
    await sync(web)
    const after = await web.db.transactions.get(id)
    expect(after!.updatedAt).toBeGreaterThanOrEqual(serverBefore!)
  })

  it('applies an edit in both directions', async () => {
    const walletId = await newWalletOn(web)
    const id = await saveTransaction(web.db, expense(walletId))
    await sync(web)
    await sync(phone)

    await saveTransaction(phone.db, { ...expense(walletId, 200), id, note: 'From phone' })
    await sync(phone)
    await sync(web)
    expect(await web.db.transactions.get(id)).toMatchObject({ note: 'From phone', amountMinor: 200 })

    await saveTransaction(web.db, { ...expense(walletId, 300), id, note: 'From web' })
    await sync(web)
    await sync(phone)
    expect(await phone.db.transactions.get(id)).toMatchObject({ note: 'From web', amountMinor: 300 })
  })

  it('a second round without changes reads only rows from the last minute, not the whole table', async () => {
    const walletId = await newWalletOn(web)
    for (let i = 0; i < 5; i++) await saveTransaction(web.db, expense(walletId, 100 + i))
    await sync(web)
    await sync(phone)
    const cursor = await phone.db.meta.get('sync_cursor_transactions')
    const now = await phone.remote.nowMs()
    expect(Math.abs(now! - SAFETY_MS - (cursor!.value as number))).toBeLessThan(5_000)
  })

  it('pages through more rows than one page holds', async () => {
    const walletId = await newWalletOn(web)
    await web.db.setOwner(ALICE)
    const now = Date.now()
    await web.db.transactions.bulkPut(Array.from({ length: PAGE + 5 }, (_, i) => ({
      ...expense(walletId, 1 + i), id: unique('bulk'), userId: ALICE, transferId: null, source: 'MANUAL', recurringRuleId: null, periodKey: null,
      legacyId: null, createdAt: now, updatedAt: now, deletedAt: null, syncState: 'DIRTY' as const,
    })))
    await sync(web)
    expect(await web.db.dirtyCount()).toBe(0)
    await sync(phone)
    expect(await phone.db.transactions.where('walletId').equals(walletId).count()).toBe(PAGE + 5)
  })

  it('a deletion travels, and Undo stays undone after every sync', async () => {
    const walletId = await newWalletOn(web)
    const id = await saveTransaction(web.db, expense(walletId))
    await sync(web)
    await sync(phone)

    await deleteTransaction(web.db, id)
    await sync(web)
    await sync(phone)
    expect((await phone.db.transactions.get(id))?.deletedAt).toBeGreaterThan(0)

    await restoreTransaction(web.db, id, null)
    await sync(web)
    await sync(phone)
    expect((await phone.db.transactions.get(id))?.deletedAt).toBeNull()
    await sync(web)
    expect((await web.db.transactions.get(id))?.deletedAt).toBeNull()
  })

  it('a row changed locally wins over the server and goes out next', async () => {
    const walletId = await newWalletOn(web)
    const id = await saveTransaction(web.db, expense(walletId))
    await sync(web)
    await sync(phone)

    await saveTransaction(phone.db, { ...expense(walletId), id, note: 'Phone first' })
    await sync(phone)
    await saveTransaction(web.db, { ...expense(walletId), id, note: 'Web later' })
    await sync(web)
    expect((await web.db.transactions.get(id))?.note).toBe('Web later')
    await sync(phone)
    expect((await phone.db.transactions.get(id))?.note).toBe('Web later')
  })

  it('the checker and a deleted wallet with its rows reach the other device', async () => {
    const walletId = await newWalletOn(web)
    const id = await saveTransaction(web.db, expense(walletId))
    await setChecker(web.db, walletId, id)
    await sync(web)
    await sync(phone)
    expect((await phone.db.wallets.get(walletId))?.checkerTransactionId).toBe(id)

    await deleteWallet(web.db, walletId)
    await sync(web)
    await sync(phone)
    expect((await phone.db.wallets.get(walletId))?.deletedAt).toBeGreaterThan(0)
    expect((await phone.db.transactions.get(id))?.deletedAt).toBeGreaterThan(0)
  })

  it('a stale fee rule from the web does not move last_generated_period back', async () => {
    const walletId = await newWalletOn(phone)
    const ruleId = unique('rule')
    await clientFor(ALICE).from('recurring_rules').insert({
      id: ruleId, user_id: ALICE, wallet_id: walletId, amount_minor: 100, note_template: 'Fee', start_period: '2026-01', last_generated_period: '2026-11', created_at: 1,
    })
    const stale: RecurringRule = {
      id: ruleId, userId: ALICE, walletId, kind: 'EXPENSE', amountMinor: 999, categoryId: null, noteTemplate: 'Edited on the web', schedule: 'MONTHLY_LAST_DAY',
      timeOfDay: '23:59', monthNameLocale: 'sr-Latn', startPeriod: '2026-01', lastGeneratedPeriod: '2026-10', isActive: true, createdAt: 1, updatedAt: 5, deletedAt: null, syncState: 'DIRTY',
    }
    await web.db.recurring_rules.put(stale)
    await sync(web)

    const { data } = await clientFor(ALICE).from('recurring_rules').select('*').eq('id', ruleId).single()
    expect(data).toMatchObject({ last_generated_period: '2026-11', note_template: 'Edited on the web', amount_minor: 999 })
    expect((await web.db.recurring_rules.get(ruleId))?.lastGeneratedPeriod).toBe('2026-11')
  })

  it('a new fee rule from the web can be created without last_generated_period', async () => {
    const walletId = await newWalletOn(web)
    const ruleId = unique('rule')
    await web.db.recurring_rules.put({
      id: ruleId, userId: ALICE, walletId, kind: 'EXPENSE', amountMinor: 999, categoryId: null, noteTemplate: 'New', schedule: 'MONTHLY_LAST_DAY',
      timeOfDay: '23:59', monthNameLocale: 'sr-Latn', startPeriod: '2026-01', lastGeneratedPeriod: null, isActive: true, createdAt: 1, updatedAt: 5, deletedAt: null, syncState: 'DIRTY',
    })
    await sync(web)
    const { data } = await clientFor(ALICE).from('recurring_rules').select('*').eq('id', ruleId).single()
    expect(data).toMatchObject({ last_generated_period: null, note_template: 'New' })
  })

  it('a failed push keeps the row for later instead of losing it', async () => {
    const walletId = await newWalletOn(web)
    await sync(web)
    const id = unique('bad')
    await web.db.transactions.put({
      ...expense(walletId, 0), id, userId: ALICE, transferId: null, source: 'MANUAL', recurringRuleId: null, periodKey: null, legacyId: null,
      createdAt: 1, updatedAt: 1, deletedAt: null, syncState: 'DIRTY',
    })
    await expect(sync(web)).rejects.toThrow() // the server refuses amount_minor = 0
    expect((await web.db.transactions.get(id))?.syncState).toBe('DIRTY')
  })

  describe('privacy between accounts', () => {
    it('another account does not receive my rows', async () => {
      const walletId = await newWalletOn(web)
      await saveTransaction(web.db, expense(walletId))
      await sync(web)

      const bob = device(BOB)
      await sync(bob)
      expect(await bob.db.wallets.get(walletId)).toBeUndefined()
      expect(await bob.db.transactions.count()).toBe(0)
    })

    it('another account cannot read my rows even when asking for them directly', async () => {
      const walletId = await newWalletOn(web)
      await sync(web)
      const { data, error } = await clientFor(BOB).from('wallets').select('*').eq('id', walletId).eq('user_id', ALICE)
      expect(error).toBeNull()
      expect(data).toEqual([])
    })

    it('another account cannot write in my name', async () => {
      const { error } = await clientFor(BOB).from('wallets').upsert({ id: unique('x'), user_id: ALICE, name: 'x', currency_code: 'RSD', color: 1 })
      expect(error).not.toBeNull()
    })

    it('another account cannot change my row', async () => {
      const walletId = await newWalletOn(web, 'Original')
      await sync(web)
      await clientFor(BOB).from('wallets').update({ name: 'Hacked' }).eq('id', walletId).eq('user_id', ALICE)
      const { data } = await clientFor(ALICE).from('wallets').select('name').eq('id', walletId).single()
      expect(data?.name).toBe('Original')
    })

    it('the same ids can exist for two accounts without touching each other', async () => {
      const shared = unique('same-id')
      await clientFor(ALICE).from('wallets').upsert({ id: shared, user_id: ALICE, name: 'Alice', currency_code: 'RSD', color: 1 }, { onConflict: 'user_id,id' })
      await clientFor(BOB).from('wallets').upsert({ id: shared, user_id: BOB, name: 'Bob', currency_code: 'RSD', color: 1 }, { onConflict: 'user_id,id' })
      const { data } = await clientFor(ALICE).from('wallets').select('name').eq('id', shared)
      expect(data).toEqual([{ name: 'Alice' }])
    })

    it('without signing in nothing can be read or written', async () => {
      const anonymous = clientFor(null)
      const read = await anonymous.from('wallets').select('*')
      expect(read.error ?? read.data).toSatisfy((r: unknown) => r !== null && (!Array.isArray(r) || r.length === 0))
      const write = await anonymous.from('wallets').insert({ id: unique('x'), user_id: ALICE, name: 'x', currency_code: 'RSD', color: 1 })
      expect(write.error).not.toBeNull()
    })

    it('nobody can physically delete a row', async () => {
      const walletId = await newWalletOn(web, 'Stays')
      await sync(web)
      await clientFor(ALICE).from('wallets').delete().eq('id', walletId)
      const { data } = await clientFor(ALICE).from('wallets').select('name').eq('id', walletId)
      expect(data).toEqual([{ name: 'Stays' }])
    })
  })
})
