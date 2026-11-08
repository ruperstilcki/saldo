import type { SupabaseClient } from '@supabase/supabase-js'

export type RemoteRow = Record<string, unknown>

/** Everything sync needs from the server, so the engine can be tested without a network. */
export interface RemoteApi {
  /** Server clock in epoch ms, or null if it cannot be read. */
  nowMs(): Promise<number | null>
  upsert(table: string, rows: RemoteRow[], onConflict: string): Promise<void>
  /** Rows of this user changed after [since], oldest first. */
  selectChanged(table: string, uid: string, since: number, offset: number, limit: number): Promise<RemoteRow[]>
  uploadImage(path: string, blob: Blob): Promise<void>
  removeImage(path: string): Promise<void>
  downloadImage(path: string): Promise<Blob>
}

const BUCKET = 'wallet-images'

export function supabaseRemote(client: SupabaseClient): RemoteApi {
  return {
    async nowMs() {
      const { data, error } = await client.rpc('saldo_now_ms')
      return error || typeof data !== 'number' ? null : data
    },
    async upsert(table, rows, onConflict) {
      const { error } = await client.from(table).upsert(rows, { onConflict })
      if (error) throw new Error(`Sending ${table} failed (${error.code || 'network'})`)
    },
    async selectChanged(table, uid, since, offset, limit) {
      const { data, error } = await client
        .from(table)
        .select('*')
        .eq('user_id', uid)
        .gt('updated_at', since)
        .order('updated_at', { ascending: true })
        .range(offset, offset + limit - 1)
      if (error) throw new Error(`Reading ${table} failed (${error.code || 'network'})`)
      return (data ?? []) as RemoteRow[]
    },
    async uploadImage(path, blob) {
      const { error } = await client.storage.from(BUCKET).upload(path, blob, { upsert: true, contentType: 'image/webp' })
      if (error) throw new Error('Uploading an image failed')
    },
    async removeImage(path) {
      const { error } = await client.storage.from(BUCKET).remove([path])
      if (error) throw new Error('Removing an image failed')
    },
    async downloadImage(path) {
      const { data, error } = await client.storage.from(BUCKET).download(path)
      if (error || !data) throw new Error('Downloading an image failed')
      return data
    },
  }
}
