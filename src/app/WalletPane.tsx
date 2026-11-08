import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useRef, useState } from 'react'
import { yearMonthOf } from '../core/dates'
import { formatMoney } from '../core/money'
import { deleteWallet, setArchived } from '../data/wallets'
import { db } from '../db/db'
import type { Category, Transaction, Wallet } from '../db/types'
import { computeBalances } from '../domain/balance'
import { buildRows } from '../domain/rows'
import { buildTable, defaultCollapsed, monthKey, yearKey } from '../domain/tableModel'
import { applyFilter, EMPTY_FILTER, searchText, summarizeFilter, type TxFilter } from '../domain/txFilter'
import { ConfirmDialog, Menu, WalletAvatar } from './Common'
import { FilterBar, SummaryBar } from './FilterBar'
import { editWalletPath, feesPath, navigate, newTransactionPath, statisticsPath } from './router'
import { syncManager } from './services'
import { useSettings } from './settings'
import { TransactionDetails } from './TransactionDetails'
import { TxTable } from './TxTable'

const NO_TRANSACTIONS: Transaction[] = []

interface Props {
  walletId: string
  categories: Category[]
  onDeleteTransaction: (id: string) => void
}

export function WalletPane({ walletId, categories, onDeleteTransaction }: Props) {
  const wallet = useLiveQuery(() => db.wallets.get(walletId), [walletId], null as Wallet | null | undefined)
  const transactions = useLiveQuery(() => db.transactions.where('walletId').equals(walletId).toArray(), [walletId], NO_TRANSACTIONS)
  const settings = useSettings()

  // Manual expand and collapse last while the wallet is open, as on the phone. A new wallet is a new component.
  const [overrides, setOverrides] = useState<Record<string, boolean>>({})
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [flashId, setFlashId] = useState<string | null>(null)
  const [pendingScroll, setPendingScroll] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [searching, setSearching] = useState(false)
  const [filter, setFilter] = useState<TxFilter>(EMPTY_FILTER)
  // In search everything starts expanded, so whatever it finds is visible.
  const [searchOverrides, setSearchOverrides] = useState<Record<string, boolean>>({})
  const scroller = useRef<HTMLDivElement>(null)

  const liveCategories = useMemo(() => categories.filter((c) => c.deletedAt === null), [categories])
  const rows = useMemo(() => buildRows(transactions, categories), [transactions, categories])
  const texts = useMemo(() => new Map(rows.map((r) => [r.id, searchText(r)])), [rows])
  const found = useMemo(
    () => (searching ? applyFilter(rows, filter, liveCategories, new Date(), (r) => texts.get(r.id)!) : rows),
    [searching, rows, filter, liveCategories, texts],
  )
  const nowYearMonth = yearMonthOf(Date.now())
  const collapsedState = (key: string) =>
    overrides[key] ?? defaultCollapsed(key, settings.monthsDefault, settings.yearsDefault, nowYearMonth)

  const items = useMemo(
    () =>
      searching
        ? buildTable(found, 0, (key) => searchOverrides[key] ?? false)
        : buildTable(rows, wallet?.openingBalanceMinor ?? 0, collapsedState),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [searching, found, rows, searchOverrides, wallet?.openingBalanceMinor, overrides, settings.monthsDefault, settings.yearsDefault, nowYearMonth],
  )

  const toggle = (key: string) => {
    if (searching) setSearchOverrides((current) => ({ ...current, [key]: !(current[key] ?? false) }))
    else setOverrides((current) => ({ ...current, [key]: !collapsedState(key) }))
  }

  const closeSearch = () => {
    setSearching(false)
    setFilter(EMPTY_FILTER)
    setSearchOverrides({})
  }

  const checkerId = wallet?.checkerTransactionId ?? null
  const checkerRow = checkerId ? rows.find((r) => r.id === checkerId) : undefined
  const selected = selectedId ? rows.find((r) => r.id === selectedId) : undefined

  const goToChecker = () => {
    if (!checkerRow) return
    closeSearch()
    const yearMonth = yearMonthOf(checkerRow.occurredAt)
    setOverrides((current) => ({ ...current, [yearKey(Number(yearMonth.slice(0, 4)))]: false, [monthKey(yearMonth)]: false }))
    setPendingScroll(checkerRow.id)
  }

  // Once the opened month is on screen: put the row in the middle and make it blink.
  useEffect(() => {
    if (!pendingScroll) return
    const element = scroller.current?.querySelector(`[data-row-id="${CSS.escape(pendingScroll)}"]`)
    if (!element) return
    element.scrollIntoView({ block: 'center' })
    setPendingScroll(null)
    setFlashId(pendingScroll)
    const timer = setTimeout(() => setFlashId(null), 1000)
    return () => clearTimeout(timer)
  }, [pendingScroll, items])

  if (wallet === undefined || wallet?.deletedAt) {
    return <div className="pane-empty muted">This wallet does not exist.</div>
  }
  if (!wallet) return <div className="pane" />

  const balance = computeBalances([wallet], transactions).get(wallet.id) ?? 0
  const hasRows = rows.length > 0 || transactions === NO_TRANSACTIONS

  return (
    <section className="pane" aria-label={wallet.name}>
      <header className="pane-header">
        <button className="back" aria-label="Back to wallets" onClick={() => navigate('/')}>←</button>
        <WalletAvatar wallet={wallet} large />
        <div className="pane-title">
          <h2>{wallet.name}</h2>
          <p className="pane-balance">{formatMoney(balance)} {wallet.currencyCode}</p>
        </div>
        <span className="spacer" />
        <button className="primary" onClick={() => navigate(newTransactionPath(wallet.id))}>New transaction</button>
        <button aria-pressed={searching} onClick={() => (searching ? closeSearch() : setSearching(true))}>
          {searching ? 'Close search' : 'Search in wallet'}
        </button>
        <button disabled={!checkerRow} onClick={goToChecker}>Go to checker</button>
        <Menu label="More">
          <button onClick={() => navigate(editWalletPath(wallet.id))}>Edit wallet</button>
          <button onClick={() => navigate(statisticsPath(wallet.id))}>Wallet statistics</button>
          <button onClick={() => navigate(feesPath(wallet.id))}>Wallet monthly fees</button>
          <button
            onClick={async () => {
              await setArchived(db, wallet.id, !wallet.isArchived)
              syncManager.notifyLocalChange()
              if (!wallet.isArchived) navigate('/')
            }}
          >
            {wallet.isArchived ? 'Unarchive' : 'Archive'}
          </button>
          <button className="danger-text" onClick={() => setConfirmDelete(true)}>Delete wallet</button>
        </Menu>
      </header>

      {searching && <FilterBar filter={filter} categories={liveCategories} onChange={setFilter} />}

      {!hasRows && <p className="pane-empty muted">No transactions yet. Use New transaction to add one.</p>}
      {hasRows && searching && found.length === 0 && <p className="pane-empty muted">Nothing found.</p>}
      {hasRows && (!searching || found.length > 0) && (
        <TxTable
          items={items}
          currency={wallet.currencyCode}
          showBalance={!searching}
          checkerId={checkerId}
          flashId={flashId}
          scrollerRef={scroller}
          onToggle={toggle}
          onOpen={setSelectedId}
        />
      )}
      {searching && <SummaryBar summary={summarizeFilter(found)} currency={wallet.currencyCode} />}

      {selected && (
        <TransactionDetails
          row={selected}
          wallet={wallet}
          isChecker={selected.id === checkerId}
          onClose={() => setSelectedId(null)}
          onDelete={(id) => {
            setSelectedId(null)
            onDeleteTransaction(id)
          }}
        />
      )}
      {confirmDelete && (
        <ConfirmDialog
          title="Delete wallet?"
          text={`Delete "${wallet.name}" and ${rows.length} transactions? This cannot be undone.`}
          confirmLabel="Delete"
          onCancel={() => setConfirmDelete(false)}
          onConfirm={async () => {
            await deleteWallet(db, wallet.id)
            syncManager.notifyLocalChange()
            navigate('/', { replace: true })
          }}
        />
      )}
    </section>
  )
}
