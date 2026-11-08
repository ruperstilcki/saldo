import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEBOUNCE_MS, SyncManager } from './manager'

const okRound = () => Promise.resolve({ pushed: 0, pulled: 0 })

describe('SyncManager', () => {
  beforeEach(() => void vi.useFakeTimers())
  afterEach(() => void vi.useRealTimers())

  it('runs once, 5 s after the last local change', async () => {
    const round = vi.fn(okRound)
    const manager = new SyncManager({ round })
    manager.notifyLocalChange()
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS - 1)
    manager.notifyLocalChange()
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS - 1)
    expect(round).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(round).toHaveBeenCalledTimes(1)
  })

  it('never runs two rounds at once, and follows up on a request made during a round', async () => {
    let finish!: () => void
    const round = vi.fn(() => new Promise<{ pushed: number; pulled: number }>((resolve) => {
      finish = () => resolve({ pushed: 0, pulled: 0 })
    }))
    const manager = new SyncManager({ round })
    const first = manager.requestRound()
    await manager.requestRound()
    expect(round).toHaveBeenCalledTimes(1)
    finish()
    await vi.advanceTimersByTimeAsync(0)
    expect(round).toHaveBeenCalledTimes(2)
    finish()
    await first
  })

  it('reports a failure and recovers on the next round', async () => {
    const round = vi.fn(okRound).mockRejectedValueOnce(new Error('offline'))
    const manager = new SyncManager({ round })
    await manager.requestRound()
    expect(manager.getStatus()).toMatchObject({ state: 'failed', message: 'offline' })
    await manager.requestRound()
    expect(manager.getStatus().state).toBe('idle')
  })

  it('finalRound says whether it worked and drops the waiting timer', async () => {
    const round = vi.fn(okRound).mockRejectedValueOnce(new Error('offline'))
    const manager = new SyncManager({ round })
    manager.notifyLocalChange()
    expect(await manager.finalRound()).toBe(false)
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)
    expect(round).toHaveBeenCalledTimes(1)
    expect(await manager.finalRound()).toBe(true)
  })
})
