import { createClient } from '@supabase/supabase-js'
import { db } from '../db/db'
import { runRound } from '../sync/engine'
import { SyncManager } from '../sync/manager'
import { supabaseRemote } from '../sync/remote'

export const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_KEY, {
  auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
})

const remote = supabaseRemote(supabase)

/** Set while someone is signed in. Sync always runs for this account only. */
let currentUid: string | null = null
export const setCurrentUid = (uid: string | null) => {
  currentUid = uid
}

export const syncManager = new SyncManager({
  locks: navigator.locks,
  round: () => {
    if (!currentUid) return Promise.resolve({ pushed: 0, pulled: 0 })
    return runRound(db, remote, currentUid)
  },
})
