import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState, useSyncExternalStore } from 'react'
import { formatDate, formatTime } from '../core/dates'
import { formatMoney, formatSigned } from '../core/money'
import { updateTransactionNote } from '../data/transactions'
import { db } from '../db/db'
import type { Transaction, Wallet } from '../db/types'
import { computeBalances } from '../domain/balance'
import { syncManager } from './services'
import { useAuth } from './useAuth'

export function App() {
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
      <div className="card">
        <h1>Saldo</h1>
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

function SyncBar({ email, onSignOut }: { email: string | null; onSignOut: () => void }) {
  const status = useSyncExternalStore(syncManager.subscribe, syncManager.getStatus)
  const unsent = useLiveQuery(() => db.dirtyCount(), [], 0)
  let text = 'Not synced yet'
  if (status.state === 'running') text = 'Syncing…'
  else if (status.state === 'failed') text = `Sync failed: ${status.message}. Changes stay here until it works.`
  else if (status.lastSyncedAt) text = `Synced at ${formatTime(status.lastSyncedAt)}`

  return (
    <header className="bar">
      <strong>Saldo</strong>
      <span className="status" role="status">
        {text}
        {unsent > 0 && ` · ${unsent} unsent`}
      </span>
      <span className="spacer" />
      {email && <span className="muted">{email}</span>}
      <button onClick={() => void syncManager.requestRound()}>Sync now</button>
      <button onClick={onSignOut}>Sign out</button>
    </header>
  )
}

function Home({ email, onSignOut }: { email: string | null; onSignOut: () => void }) {
  const [selected, setSelected] = useState<string | null>(null)
  const wallets = useLiveQuery(() => db.wallets.toArray(), [], [] as Wallet[])
  const transactions = useLiveQuery(() => db.transactions.toArray(), [], [] as Transaction[])
  const categoryRows = useLiveQuery(() => db.categories.count(), [], null as number | null)
  const status = useSyncExternalStore(syncManager.subscribe, syncManager.getStatus)

  const visible = useMemo(
    () => wallets.filter((w) => w.deletedAt === null).sort((a, b) => a.sortOrder - b.sortOrder),
    [wallets],
  )
  const balances = useMemo(() => computeBalances(visible, transactions), [visible, transactions])
  const selectedWallet = visible.find((w) => w.id === selected) ?? null
  const noCategories = categoryRows === 0 && status.lastSyncedAt !== null

  return (
    <>
      <SyncBar email={email} onSignOut={onSignOut} />
      {noCategories && <p className="notice">No categories yet. Open Saldo on your phone once to create them.</p>}
      <main className="layout">
        <section aria-label="Wallets">
          <h2>Wallets</h2>
          <ul className="list">
            {visible.map((wallet) => (
              <li key={wallet.id}>
                <button
                  className={wallet.id === selected ? 'row selected' : 'row'}
                  onClick={() => setSelected(wallet.id)}
                >
                  <span>
                    {wallet.name}
                    {wallet.isArchived && <span className="muted"> · archived</span>}
                  </span>
                  <span className="amount">
                    {formatMoney(balances.get(wallet.id) ?? 0)} {wallet.currencyCode}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
        {selectedWallet && <WalletTransactions wallet={selectedWallet} transactions={transactions} />}
      </main>
    </>
  )
}

const RECENT = 50

function WalletTransactions({ wallet, transactions }: { wallet: Wallet; transactions: Transaction[] }) {
  const [editing, setEditing] = useState<Transaction | null>(null)
  const rows = useMemo(
    () =>
      transactions
        .filter((t) => t.walletId === wallet.id && t.deletedAt === null)
        .sort((a, b) => b.occurredAt - a.occurredAt)
        .slice(0, RECENT),
    [transactions, wallet.id],
  )
  return (
    <section aria-label="Transactions">
      <h2>{wallet.name}: latest {RECENT}</h2>
      <ul className="list">
        {rows.map((tx) => (
          <li key={tx.id}>
            <button className="row" onClick={() => setEditing(tx)}>
              <span className="muted date">{formatDate(tx.occurredAt)}</span>
              <span className="note">{tx.note ?? ''}</span>
              <span className="amount">{formatSigned(tx.amountMinor, tx.kind === 'INCOME' || tx.kind === 'TRANSFER_IN')}</span>
            </button>
          </li>
        ))}
      </ul>
      {editing && <NoteDialog tx={editing} onClose={() => setEditing(null)} />}
    </section>
  )
}

function NoteDialog({ tx, onClose }: { tx: Transaction; onClose: () => void }) {
  const [note, setNote] = useState(tx.note ?? '')
  const save = async () => {
    await updateTransactionNote(db, tx.id, note)
    syncManager.notifyLocalChange()
    onClose()
  }
  return (
    <div className="backdrop">
      <div className="card" role="dialog" aria-label="Edit note">
        <h2>Edit note</h2>
        <textarea aria-label="Note" rows={4} value={note} onChange={(e) => setNote(e.target.value)} />
        <div className="actions">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={() => void save()}>Save</button>
        </div>
      </div>
    </div>
  )
}
