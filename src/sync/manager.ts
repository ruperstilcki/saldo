import type { SyncReport } from './engine'

export type SyncStatus =
  | { state: 'idle'; lastSyncedAt: number | null }
  | { state: 'running'; lastSyncedAt: number | null }
  | { state: 'failed'; lastSyncedAt: number | null; message: string }

export const DEBOUNCE_MS = 5_000
const LOCK_NAME = 'saldo-sync'

interface ManagerDeps {
  round: () => Promise<SyncReport>
  /** Web Locks, so that two tabs never run a round at the same time. */
  locks?: LockManager
}

export class SyncManager {
  private status: SyncStatus = { state: 'idle', lastSyncedAt: null }
  private listeners = new Set<() => void>()
  private timer: ReturnType<typeof setTimeout> | null = null
  private running = false
  private requestedAgain = false

  constructor(private deps: ManagerDeps) {}

  getStatus = () => this.status

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private setStatus(status: SyncStatus) {
    this.status = status
    this.listeners.forEach((l) => l())
  }

  /** A local change: sync 5 s after the last one. */
  notifyLocalChange() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      void this.requestRound()
    }, DEBOUNCE_MS)
  }

  cancelPending() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.requestedAgain = false
  }

  /** Starts a round unless one is running; then one more follows, so a change is never left waiting. */
  async requestRound(): Promise<void> {
    if (this.running) {
      this.requestedAgain = true
      return
    }
    this.running = true
    try {
      await this.withLock(false, () => this.runOnce())
    } finally {
      this.running = false
    }
    if (this.requestedAgain) {
      this.requestedAgain = false
      await this.requestRound()
    }
  }

  /** Waits its turn and reports whether the round worked. Used before leaving the session. */
  async finalRound(): Promise<boolean> {
    this.cancelPending()
    let ok = false
    await this.withLock(true, async () => {
      ok = await this.runOnce()
    })
    return ok
  }

  private async runOnce(): Promise<boolean> {
    const lastSyncedAt = this.status.lastSyncedAt
    this.setStatus({ state: 'running', lastSyncedAt })
    try {
      await this.deps.round()
      this.setStatus({ state: 'idle', lastSyncedAt: Date.now() })
      return true
    } catch (e) {
      this.setStatus({ state: 'failed', lastSyncedAt, message: e instanceof Error ? e.message : 'Sync failed' })
      return false
    }
  }

  private async withLock(wait: boolean, work: () => Promise<unknown>) {
    const locks = this.deps.locks
    if (!locks) {
      await work()
      return
    }
    await locks.request(LOCK_NAME, { ifAvailable: !wait }, async (lock) => {
      if (lock) await work() // No lock: another tab is syncing right now.
    })
  }
}
