import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState, useSyncExternalStore } from 'react'
import { formatTime, monthRange } from '../core/dates'
import { db } from '../db/db'
import type { Category, Transaction, Wallet } from '../db/types'
import { spentByCurrency, summarize, totalsByCurrency } from '../domain/walletSummaries'
import { navigate, parseRoute, usePathname } from './router'
import { syncManager } from './services'
import { SettingsDialog } from './SettingsDialog'
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

const NO_WALLETS: Wallet[] = []
const NO_TRANSACTIONS: Transaction[] = []
const NO_CATEGORIES: Category[] = []

export function Home({ email, onSignOut }: { email: string | null; onSignOut: () => void }) {
  const route = parseRoute(usePathname())
  const [settingsOpen, setSettingsOpen] = useState(false)
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
          <WalletPane key={selectedId} walletId={selectedId} categories={categories} />
        ) : (
          <div className="pane-empty muted">Choose a wallet to see its transactions.</div>
        )}
      </div>
      {settingsOpen && <SettingsDialog email={email} onSignOut={onSignOut} onClose={() => setSettingsOpen(false)} />}
    </div>
  )
}
