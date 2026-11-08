import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { formatTime, monthRange } from '../core/dates'
import { deleteTransaction, restoreTransaction } from '../data/transactions'
import { db } from '../db/db'
import type { Category, Transaction, Wallet } from '../db/types'
import { spentByCurrency, summarize, totalsByCurrency } from '../domain/walletSummaries'
import { navigate, parseRoute, usePathname } from './router'
import { syncManager } from './services'
import { SettingsDialog } from './SettingsDialog'
import { TransactionForm } from './TransactionForm'
import { WalletForm } from './WalletForm'
import { WalletList } from './WalletList'
import { WalletPane } from './WalletPane'

export function useSyncText() {
  const status = useSyncExternalStore(syncManager.subscribe, syncManager.getStatus)
  const unsent = useLiveQuery(() => db.dirtyCount(), [], 0)
  let text = 'Not synced yet'
  if (status.state === 'running') text = 'Syncing…'
  else if (status.state === 'failed') text = `Sync failed: ${status.message}. Changes stay here until it works.`
  else if (status.lastSyncedAt) text = `Synced at ${formatTime(status.lastSyncedAt)}`
  return unsent > 0 ? `${text} · ${unsent} unsent` : text
}

const UNDO_MS = 8_000

interface DeletedTransaction {
  id: string
  checkerWalletId: string | null
}

const NO_WALLETS: Wallet[] = []
const NO_TRANSACTIONS: Transaction[] = []
const NO_CATEGORIES: Category[] = []

export function Home({ email, onSignOut }: { email: string | null; onSignOut: () => void }) {
  const route = parseRoute(usePathname())
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [deleted, setDeleted] = useState<DeletedTransaction | null>(null)
  const syncText = useSyncText()
  const status = useSyncExternalStore(syncManager.subscribe, syncManager.getStatus)

  const wallets = useLiveQuery(() => db.wallets.toArray(), [], NO_WALLETS)
  const transactions = useLiveQuery(() => db.transactions.toArray(), [], NO_TRANSACTIONS)
  const categories = useLiveQuery(() => db.categories.toArray(), [], NO_CATEGORIES)
  const categoryRows = useLiveQuery(() => db.categories.count(), [], null as number | null)

  const summaries = useMemo(() => summarize(wallets, transactions, categories), [wallets, transactions, categories])
  const active = useMemo(() => summaries.filter((s) => !s.wallet.isArchived), [summaries])
  const archived = useMemo(() => summaries.filter((s) => s.wallet.isArchived), [summaries])
  const totals = useMemo(() => totalsByCurrency(active), [active])
  const spent = useMemo(() => {
    const { from, to } = monthRange(new Date())
    return spentByCurrency(wallets, transactions, categories, from, to)
  }, [wallets, transactions, categories])

  const selectedId = route.page === 'wallet' ? route.id : null
  const noCategories = categoryRows === 0 && status.lastSyncedAt !== null
  const form = route.page === 'wallet' ? route.form : undefined
  const formWallet = selectedId ? wallets.find((w) => w.id === selectedId && w.deletedAt === null) : undefined

  useEffect(() => {
    if (!deleted) return
    const timer = setTimeout(() => setDeleted(null), UNDO_MS)
    return () => clearTimeout(timer)
  }, [deleted])

  const onDeleteTransaction = async (id: string) => {
    const { checkerWalletId } = await deleteTransaction(db, id)
    syncManager.notifyLocalChange()
    setDeleted({ id, checkerWalletId })
  }

  const undoDelete = async () => {
    if (!deleted) return
    await restoreTransaction(db, deleted.id, deleted.checkerWalletId)
    syncManager.notifyLocalChange()
    setDeleted(null)
  }

  return (
    <div className={selectedId ? 'app wallet-open' : 'app'}>
      <header className="bar">
        <button className="brand" onClick={() => navigate('/')}>Saldo</button>
        <span className="status" role="status">{syncText}</span>
        <span className="spacer" />
        <button onClick={() => void syncManager.requestRound()}>Sync now</button>
        <button onClick={() => setSettingsOpen(true)}>Settings</button>
      </header>
      {noCategories && <p className="notice">No categories yet. Open Saldo on your phone once to create them.</p>}
      <div className="layout">
        <WalletList
          showArchived={route.page === 'archived'}
          active={active}
          archived={archived}
          totals={totals}
          spent={spent}
          selectedId={selectedId}
          loaded={wallets !== NO_WALLETS}
        />
        {selectedId ? (
          <WalletPane key={selectedId} walletId={selectedId} categories={categories} onDeleteTransaction={(id) => void onDeleteTransaction(id)} />
        ) : (
          <div className="pane-empty muted">Choose a wallet to see its transactions.</div>
        )}
      </div>
      {route.page === 'newWallet' && <WalletForm walletId={null} />}
      {form?.type === 'editWallet' && <WalletForm key={selectedId} walletId={selectedId} />}
      {formWallet && form && form.type !== 'editWallet' && (
        <TransactionForm
          key={form.type === 'newTransaction' ? form.type : `${form.type}-${form.transactionId}`}
          wallet={formWallet}
          sourceId={form.type === 'newTransaction' ? null : form.transactionId}
          duplicate={form.type === 'duplicateTransaction'}
          categories={categories}
          transactions={transactions}
          allowCreateCategory={!!categoryRows}
        />
      )}
      {deleted && (
        <div className="snackbar" role="alert">
          <span>Deleted</span>
          <button className="link" onClick={() => void undoDelete()}>Undo</button>
          <button aria-label="Dismiss" className="link" onClick={() => setDeleted(null)}>✕</button>
        </div>
      )}
      {settingsOpen && <SettingsDialog email={email} onSignOut={onSignOut} onClose={() => setSettingsOpen(false)} />}
    </div>
  )
}
