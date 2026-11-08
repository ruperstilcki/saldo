import type { Table } from 'dexie'
import type { SaldoDb, SyncTableName } from '../db/db'
import type { ImageRow } from '../db/types'
import { nextCursor } from './cursor'
import type { RemoteApi, RemoteRow } from './remote'
import { PULL_ORDER, PUSH_ORDER, TABLES, toLocal, toRemote, type TableSpec } from './tables'

export const PAGE = 500

export interface SyncReport {
  pushed: number
  pulled: number
}

type LooseRow = Record<string, unknown>
const looseTable = (db: SaldoDb, name: SyncTableName) => db.table(name) as Table<LooseRow, string>
const cursorKey = (table: string) => `sync_cursor_${table}`

/**
 * One sync round, same behavior as Android's SyncEngine.kt: push DIRTY rows, then pull what changed
 * on the server. A row that is DIRTY locally is not overwritten: it wins and goes out next round.
 */
export async function runRound(db: SaldoDb, remote: RemoteApi, uid: string): Promise<SyncReport> {
  let pushed = await pushImages(db, remote, uid)
  for (const name of PUSH_ORDER) pushed += await pushTable(db, remote, TABLES[name], uid)

  let pulled = 0
  for (const name of PULL_ORDER) pulled += await pullTable(db, remote, TABLES[name], uid)
  return { pushed, pulled }
}

async function pushTable(db: SaldoDb, remote: RemoteApi, spec: TableSpec, uid: string): Promise<number> {
  const table = looseTable(db, spec.name)
  const dirty = await table.where('syncState').equals('DIRTY').toArray()
  for (let i = 0; i < dirty.length; i += PAGE) {
    const batch = dirty.slice(i, i + PAGE)
    await remote.upsert(spec.name, batch.map((row) => toRemote(spec, row, uid)), spec.onConflict)
    await markClean(db, spec, batch, uid)
  }
  return dirty.length
}

/** A row changed while it was being sent has a newer updatedAt and stays DIRTY for the next round. */
async function markClean(db: SaldoDb, spec: TableSpec, sent: LooseRow[], uid: string, extra: LooseRow = {}) {
  const table = looseTable(db, spec.name)
  await db.transaction('rw', table, async () => {
    for (const row of sent) {
      const key = row[spec.key] as string
      const current = await table.get(key)
      if (current && current.updatedAt === row.updatedAt) {
        await table.update(key, { syncState: 'CLEAN', userId: uid, ...extra })
      }
    }
  })
}

export interface ImagePlan {
  action: { type: 'upload' | 'delete'; path: string } | null
  remotePath: string | null
}

/** Same rule as Android's ImagePush.kt: remote_path says nothing about the file, so a live changed image is always uploaded. */
export function planImagePush(uid: string, row: Pick<ImageRow, 'hash' | 'remotePath' | 'deletedAt' | 'blob'>): ImagePlan {
  const path = row.remotePath ?? `${uid}/${row.hash}.webp`
  if (row.deletedAt !== null) return { action: { type: 'delete', path }, remotePath: null }
  if (row.blob) return { action: { type: 'upload', path }, remotePath: path }
  return { action: null, remotePath: row.remotePath }
}

async function pushImages(db: SaldoDb, remote: RemoteApi, uid: string): Promise<number> {
  const spec = TABLES.images
  const dirty = await db.images.where('syncState').equals('DIRTY').toArray()
  for (const row of dirty) {
    const plan = planImagePush(uid, row)
    if (plan.action?.type === 'delete') {
      await remote.removeImage(plan.action.path).catch(() => undefined)
    } else if (plan.action?.type === 'upload') {
      await remote.uploadImage(plan.action.path, row.blob!)
    }
    const remoteRow = toRemote(spec, { ...row, remotePath: plan.remotePath }, uid)
    await remote.upsert(spec.name, [remoteRow], spec.onConflict)
    await markClean(db, spec, [row as unknown as LooseRow], uid, { remotePath: plan.remotePath })
  }
  return dirty.length
}

async function pullTable(db: SaldoDb, remote: RemoteApi, spec: TableSpec, uid: string): Promise<number> {
  const key = cursorKey(spec.name)
  const stored = await db.meta.get(key)
  const since = typeof stored?.value === 'number' ? stored.value : 0
  // Read before the first query: rows committed after this moment are found next time.
  const serverNow = await remote.nowMs()

  let offset = 0
  let maxSeen = since
  while (true) {
    const page = await remote.selectChanged(spec.name, uid, since, offset, PAGE)
    if (page.length === 0) break
    if (spec.name === 'images') await receiveImages(db, remote, page)
    else await applyPage(db, spec, page)
    for (const row of page) {
      const updatedAt = row.updated_at
      if (typeof updatedAt === 'number' && updatedAt > maxSeen) maxSeen = updatedAt
    }
    offset += page.length
    if (page.length < PAGE) break
  }

  const next = nextCursor(since, maxSeen, serverNow)
  if (next > since) await db.meta.put({ key, value: next })
  return offset
}

async function applyPage(db: SaldoDb, spec: TableSpec, page: RemoteRow[]) {
  const table = looseTable(db, spec.name)
  await db.transaction('rw', table, async () => {
    const existing = await table.bulkGet(page.map((row) => row[spec.key] as string))
    const incoming = page.filter((_, i) => existing[i]?.syncState !== 'DIRTY').map((row) => toLocal(spec, row))
    await table.bulkPut(incoming)
  })
}

/** Files are fetched outside the database transaction. A failed download must not stop the sync. */
async function receiveImages(db: SaldoDb, remote: RemoteApi, page: RemoteRow[]) {
  const spec = TABLES.images
  for (const row of page) {
    const hash = row.hash as string
    const before = await db.images.get(hash)
    if (before?.syncState === 'DIRTY') continue

    let blob: Blob | undefined
    if (row.deleted_at === null || row.deleted_at === undefined) {
      blob = before?.blob
      if (!blob && typeof row.remote_path === 'string') {
        blob = await remote.downloadImage(row.remote_path).catch(() => undefined)
      }
    }

    await db.transaction('rw', db.images, async () => {
      const current = await db.images.get(hash)
      if (current?.syncState === 'DIRTY') return
      await db.images.put({ ...(toLocal(spec, row) as unknown as ImageRow), blob })
    })
  }
}
