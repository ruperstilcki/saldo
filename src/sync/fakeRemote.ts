import type { RemoteApi, RemoteRow } from './remote'

/** In-memory stand-in for Supabase: sets updated_at like the server trigger. Tests only. */
export class FakeRemote implements RemoteApi {
  tables = new Map<string, Map<string, RemoteRow>>()
  files = new Map<string, Blob>()
  clock = 1_000_000
  clockAvailable = true
  failWrites = false
  failDownloads = false
  upserts: { table: string; rows: RemoteRow[]; onConflict: string }[] = []
  selects: { table: string; since: number }[] = []
  /** Runs while an upsert is in flight, to simulate a local edit during sending. */
  duringUpsert?: () => Promise<void>

  private rowsOf(table: string) {
    let rows = this.tables.get(table)
    if (!rows) this.tables.set(table, (rows = new Map()))
    return rows
  }

  private keyOf(table: string, row: RemoteRow) {
    return String(table === 'images' ? row.hash : row.id)
  }

  /** A change made by another device. */
  seed(table: string, row: RemoteRow) {
    this.clock += 1
    this.rowsOf(table).set(this.keyOf(table, row), { ...row, updated_at: this.clock })
  }

  async nowMs() {
    return this.clockAvailable ? this.clock : null
  }

  async upsert(table: string, rows: RemoteRow[], onConflict: string) {
    if (this.failWrites) throw new Error('offline')
    this.upserts.push({ table, rows, onConflict })
    await this.duringUpsert?.()
    for (const row of rows) {
      this.clock += 1
      const key = this.keyOf(table, row)
      // Like an SQL upsert: columns that were not sent keep their value.
      this.rowsOf(table).set(key, { ...this.rowsOf(table).get(key), ...row, updated_at: this.clock })
    }
  }

  async selectChanged(table: string, uid: string, since: number, offset: number, limit: number) {
    this.selects.push({ table, since })
    return [...this.rowsOf(table).values()]
      .filter((row) => row.user_id === uid && (row.updated_at as number) > since)
      .sort((a, b) => (a.updated_at as number) - (b.updated_at as number))
      .slice(offset, offset + limit)
  }

  async uploadImage(path: string, blob: Blob) {
    if (this.failWrites) throw new Error('offline')
    this.files.set(path, blob)
  }

  async removeImage(path: string) {
    this.files.delete(path)
  }

  async downloadImage(path: string) {
    const file = this.files.get(path)
    if (this.failDownloads || !file) throw new Error('not found')
    return file
  }
}
