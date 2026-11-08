import { isAuthRetryableFetchError, type Session } from '@supabase/supabase-js'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  claimLocalData, cleanUpLocalData, clearOpened, discardOtherAccount, isSessionExpired, leaveSession, markOpened, readLastOpened,
} from '../auth/lifecycle'
import { db } from '../db/db'
import { forgetStoredSession, setCurrentUid, storedUser, supabase, syncManager } from './services'

export type AuthState =
  | { status: 'loading' }
  | { status: 'signedOut' }
  | { status: 'otherAccount'; uid: string; unsentChanges: number }
  | { status: 'signedIn'; uid: string; email: string | null }

const FINAL_ROUND_LIMIT_MS = 8_000
const SIGN_OUT_LIMIT_MS = 3_000
/** With an old token the library keeps retrying for half a minute. The app must not wait that long to open. */
const SESSION_LIMIT_MS = 3_000

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** The session, null when there is none, or 'unreachable' when only the server could tell. */
async function readSession(): Promise<Session | null | 'unreachable'> {
  if (!navigator.onLine) return 'unreachable'
  const result = await Promise.race([supabase.auth.getSession(), wait(SESSION_LIMIT_MS).then(() => null)])
  if (!result) return 'unreachable'
  if (result.data.session) return result.data.session
  return result.error && isAuthRetryableFetchError(result.error) ? 'unreachable' : null
}

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

  const leave = useCallback(async (unreachable = false) => {
    if (leaving.current) return
    leaving.current = true
    const offline = unreachable || !navigator.onLine
    setState({ status: 'loading' })
    try {
      await leaveSession({
        db,
        store: localStorage,
        // Without a connection there is nothing to try: unsent changes simply stay.
        finalRound: offline ? async () => false : finalRound,
        // Local only: the default ("global") would also sign the phone out.
        endSession: async () => {
          const signOut = supabase.auth.signOut({ scope: 'local' }).catch(() => undefined)
          await (offline ? Promise.resolve() : Promise.race([signOut, wait(SIGN_OUT_LIMIT_MS)]))
          forgetStoredSession()
        },
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
    const found = await readSession()
    const unreachable = found === 'unreachable'
    // Without the server, the saved session decides: a lost connection is not a sign-out.
    const user = unreachable ? storedUser() : found ? { id: found.user.id, email: found.user.email ?? null } : null
    if (!user) {
      setState({ status: 'signedOut' })
      return
    }
    if (isSessionExpired(readLastOpened(localStorage), Date.now())) {
      setCurrentUid(user.id)
      await claimLocalData(db, user.id)
      await leave(unreachable)
      return
    }
    markOpened(localStorage, Date.now())
    const current = stateRef.current
    if (current.status === 'signedIn' && current.uid === user.id) void syncManager.requestRound()
    else if (current.status !== 'otherAccount') await enter(user.id, user.email)
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

  return { state, signIn, signOut: () => leave(), confirmOtherAccount, cancelOtherAccount }
}
