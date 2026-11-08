import type { SaldoDb } from '../db/db'

/** Sliding session: each opening of the app gives a full 30 days again. Enforced here, not on the server. */
export const SESSION_MS = 30 * 24 * 60 * 60 * 1000
const LAST_OPENED_KEY = 'saldo.lastOpenedAt'

export interface KeyValueStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/** A clock that moved backwards does not end the session. */
export function isSessionExpired(lastOpenedAt: number | null, now: number): boolean {
  return lastOpenedAt !== null && now - lastOpenedAt >= SESSION_MS
}

export function readLastOpened(store: KeyValueStore): number | null {
  const value = Number(store.getItem(LAST_OPENED_KEY))
  return Number.isFinite(value) && value > 0 ? value : null
}

export const markOpened = (store: KeyValueStore, now: number) => store.setItem(LAST_OPENED_KEY, String(now))
export const clearOpened = (store: KeyValueStore) => store.removeItem(LAST_OPENED_KEY)

/** After the session ended: nothing left to send means nothing to keep. Unsent changes wait for the same account. */
export async function cleanUpLocalData(db: SaldoDb): Promise<void> {
  if ((await db.dirtyCount()) === 0) await db.wipe()
}

interface LeaveDeps {
  db: SaldoDb
  store: KeyValueStore
  /** One last attempt to send. Must not throw. */
  finalRound: () => Promise<unknown>
  /** Ends this browser's session only: the phone stays signed in. */
  endSession: () => Promise<unknown>
}

/** Both the Sign out button and an expired session end up here. */
export async function leaveSession({ db, store, finalRound, endSession }: LeaveDeps): Promise<void> {
  await finalRound()
  await cleanUpLocalData(db)
  clearOpened(store)
  await endSession()
}

export type OwnerCheck = { ok: true } | { ok: false; unsentChanges: number }

/**
 * Local data belongs to one account. Another account clears it first, but unsent changes need a
 * confirmation from the user ([discardOtherAccount]).
 */
export async function claimLocalData(db: SaldoDb, uid: string): Promise<OwnerCheck> {
  const owner = await db.getOwner()
  if (owner === uid) return { ok: true }
  if (owner !== null) {
    const unsentChanges = await db.dirtyCount()
    if (unsentChanges > 0) return { ok: false, unsentChanges }
    await db.wipe()
  }
  await db.setOwner(uid)
  return { ok: true }
}

export async function discardOtherAccount(db: SaldoDb, uid: string): Promise<void> {
  await db.wipe()
  await db.setOwner(uid)
}
