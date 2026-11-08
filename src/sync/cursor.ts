/**
 * Pull cursor, same rule as Android's SyncCursor.kt. It follows the server clock minus a safety
 * margin, not the newest row: a cursor tied to the newest row would download every row of a bulk
 * upload again on each sync. It never moves backwards.
 */
export const SAFETY_MS = 60_000

export function nextCursor(current: number, maxSeen: number, serverNow: number | null): number {
  const candidate = serverNow !== null ? serverNow - SAFETY_MS : maxSeen - SAFETY_MS
  return Math.max(current, candidate)
}
