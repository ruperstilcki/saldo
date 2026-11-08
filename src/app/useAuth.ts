import { useCallback, useEffect, useRef, useState } from 'react'
import {
  claimLocalData, cleanUpLocalData, clearOpened, discardOtherAccount, isSessionExpired, leaveSession, markOpened, readLastOpened,
} from '../auth/lifecycle'
import { db } from '../db/db'
import { setCurrentUid, supabase, syncManager } from './services'

export type AuthState =
  | { status: 'loading' }
  | { status: 'signedOut' }
  | { status: 'otherAccount'; uid: string; unsentChanges: number }
  | { status: 'signedIn'; uid: string; email: string | null }

const FINAL_ROUND_LIMIT_MS = 15_000

/** The final attempt must not keep the user waiting on a connection that hangs. */
const finalRound = () =>
  Promise.race([
    syncManager.finalRound().catch(() => false),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), FINAL_ROUND_LIMIT_MS)),
  ])

export function useAuth() {
  const [state, setState] = useState<AuthState>({ status: 'loading' })
  const stateRef = useRef(state)
  stateRef.current = state
  const leaving = useRef(false)

  const leave = useCallback(async () => {
    if (leaving.current) return
    leaving.current = true
    setState({ status: 'loading' })
    try {
      await leaveSession({
        db,
        store: localStorage,
        finalRound,
        // Local only: the default ("global") would also sign the phone out.
        endSession: () => supabase.auth.signOut({ scope: 'local' }),
      })
    } finally {
      setCurrentUid(null)
      leaving.current = false
      setState({ status: 'signedOut' })
    }
  }, [])

  const enter = useCallback(async (uid: string, email: string | null) => {
    const check = await claimLocalData(db, uid)
    if (!check.ok) {
      setState({ status: 'otherAccount', uid, unsentChanges: check.unsentChanges })
      return
    }
    setCurrentUid(uid)
    setState({ status: 'signedIn', uid, email })
    void syncManager.requestRound()
  }, [])

  /** Runs on every opening and return to the tab. */
  const checkOpening = useCallback(async () => {
    const { data } = await supabase.auth.getSession()
    const session = data.session
    if (!session) {
      setState({ status: 'signedOut' })
      return
    }
    if (isSessionExpired(readLastOpened(localStorage), Date.now())) {
      setCurrentUid(session.user.id)
      await claimLocalData(db, session.user.id)
      await leave()
      return
    }
    markOpened(localStorage, Date.now())
    const current = stateRef.current
    if (current.status === 'signedIn' && current.uid === session.user.id) void syncManager.requestRound()
    else if (current.status !== 'otherAccount') await enter(session.user.id, session.user.email ?? null)
  }, [enter, leave])

  useEffect(() => {
    void checkOpening()

    // Supabase calls must not run inside this callback, or its internal lock can deadlock.
    const { data: subscription } = supabase.auth.onAuthStateChange((event, session) => {
      setTimeout(() => {
        if (leaving.current) return
        const current = stateRef.current
        if (event === 'SIGNED_OUT') {
          // Also comes from another tab, or from a session the server no longer accepts.
          setCurrentUid(null)
          clearOpened(localStorage)
          setState({ status: 'signedOut' })
          void cleanUpLocalData(db)
        } else if (session && (current.status === 'signedOut' || (current.status === 'signedIn' && current.uid !== session.user.id))) {
          markOpened(localStorage, Date.now())
          void enter(session.user.id, session.user.email ?? null)
        }
      }, 0)
    })

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void checkOpening()
      } else if (stateRef.current.status === 'signedIn') {
        // Leaving the tab: send now, the browser may stop the page at any moment.
        void db.dirtyCount().then((count) => {
          if (count > 0) void syncManager.requestRound()
        })
      }
    }
    const onOnline = () => {
      if (stateRef.current.status === 'signedIn') void syncManager.requestRound()
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('online', onOnline)
    return () => {
      subscription.subscription.unsubscribe()
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('online', onOnline)
    }
  }, [checkOpening, enter])

  const signIn = useCallback(async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      // With the trailing slash, so it matches the "<origin>/**" entries in Supabase's Redirect URLs.
      options: { redirectTo: `${window.location.origin}/` },
    })
    if (error) throw error
  }, [])

  const confirmOtherAccount = useCallback(async () => {
    const current = stateRef.current
    if (current.status !== 'otherAccount') return
    await discardOtherAccount(db, current.uid)
    const { data } = await supabase.auth.getSession()
    await enter(current.uid, data.session?.user.email ?? null)
  }, [enter])

  /** The new account gave way: the kept changes stay for the account they belong to. */
  const cancelOtherAccount = useCallback(async () => {
    clearOpened(localStorage)
    await supabase.auth.signOut({ scope: 'local' })
    setState({ status: 'signedOut' })
  }, [])

  return { state, signIn, signOut: leave, confirmOtherAccount, cancelOtherAccount }
}
