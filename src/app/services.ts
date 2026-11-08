import { createClient } from '@supabase/supabase-js'
import { db } from '../db/db'
import { runRound } from '../sync/engine'
import { SyncManager } from '../sync/manager'
import { supabaseRemote } from '../sync/remote'

export const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_KEY, {
  auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
})

const remote = supabaseRemote(supabase)

const AUTH_KEY = `sb-${new URL(import.meta.env.VITE_SUPABASE_URL).hostname.split('.')[0]}-auth-token`

/** The saved session's user, read without any network, for when the server cannot be reached. */
export function storedUser(): { id: string; email: string | null } | null {
  try {
    const user = JSON.parse(localStorage.getItem(AUTH_KEY) ?? 'null')?.user
    return typeof user?.id === 'string' ? { id: user.id, email: user.email ?? null } : null
  } catch {
    return null
  }
}

export const forgetStoredSession = () => localStorage.removeItem(AUTH_KEY)

/** Set while someone is signed in. Sync always runs for this account only. */
let currentUid: string | null = null
export const setCurrentUid = (uid: string | null) => {
  currentUid = uid
}

export const syncManager = new SyncManager({
  locks: navigator.locks,
  round: () => {
    if (!currentUid) return Promise.resolve({ pushed: 0, pulled: 0 })
    // Without a network, refreshing an old token would keep retrying for half a minute before failing.
    if (!navigator.onLine) return Promise.reject(new Error('Offline'))
    return runRound(db, remote, currentUid)
  },
})
