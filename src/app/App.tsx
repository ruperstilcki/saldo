import { useState } from 'react'
import { Home } from './Home'
import { useDarkTheme } from './settings'
import { useAuth } from './useAuth'

export function App() {
  useDarkTheme()
  const auth = useAuth()
  const { state } = auth

  if (state.status === 'loading') return <main className="center">Loading…</main>
  if (state.status === 'signedOut') return <SignIn onSignIn={auth.signIn} />
  if (state.status === 'otherAccount') {
    return (
      <main className="center">
        <div className="card" role="alertdialog" aria-label="Unsent changes">
          <h1>Unsent changes</h1>
          <p>This browser holds {state.unsentChanges} unsent change(s) from another account. Continuing deletes them.</p>
          <div className="actions">
            <button onClick={() => void auth.cancelOtherAccount()}>Cancel</button>
            <button className="danger" onClick={() => void auth.confirmOtherAccount()}>Delete and continue</button>
          </div>
        </div>
      </main>
    )
  }
  return <Home email={state.email} onSignOut={() => void auth.signOut()} />
}

function SignIn({ onSignIn }: { onSignIn: () => Promise<void> }) {
  const [error, setError] = useState(() => new URLSearchParams(location.search).get('error_description'))
  return (
    <main className="center">
      <div className="card signin">
        <h1>Saldo</h1>
        <p className="muted">Track the balance and spending of your wallets.</p>
        <button
          className="primary"
          onClick={() => onSignIn().catch(() => setError('Could not start the sign-in. Check your connection.'))}
        >
          Sign in with Google
        </button>
        {error && <p role="alert">{error}</p>}
      </div>
    </main>
  )
}
