import { useLiveQuery } from 'dexie-react-hooks'
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { formatDate, formatTime, monthOf, monthTitle, yearMonthOf } from '../core/dates'
import { formatMoney, formatSigned } from '../core/money'
import { setArchived } from '../data/wallets'
import { db } from '../db/db'
import type { Category, Transaction, Wallet } from '../db/types'
import { computeBalances } from '../domain/balance'
import { noteForTable } from '../domain/noteDisplay'
import { buildRows, isIncoming, type TransactionRow } from '../domain/rows'
import { buildTable, defaultCollapsed, monthKey, yearKey, type TableItem } from '../domain/tableModel'
import { argbToHex, monthHeaderColor, monthRowColor } from '../ui/monthTints'
import { WalletAvatar } from './Common'
import { navigate } from './router'
import { syncManager } from './services'
import { useDarkTheme, useSettings } from './settings'
import { TransactionDetails } from './TransactionDetails'

const NO_TRANSACTIONS: Transaction[] = []

export function WalletPane({ walletId, categories }: { walletId: string; categories: Category[] }) {
  const wallet = useLiveQuery(() => db.wallets.get(walletId), [walletId], null as Wallet | null | undefined)
  const transactions = useLiveQuery(() => db.transactions.where('walletId').equals(walletId).toArray(), [walletId], NO_TRANSACTIONS)
  const settings = useSettings()
  const dark = useDarkTheme()

  // Manual expand and collapse last while the wallet is open, as on the phone. A new wallet is a new component.
  const [overrides, setOverrides] = useState<Record<string, boolean>>({})
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [flashId, setFlashId] = useState<string | null>(null)
  const [pendingScroll, setPendingScroll] = useState<string | null>(null)
  const scroller = useRef<HTMLDivElement>(null)

  const rows = useMemo(() => buildRows(transactions, categories), [transactions, categories])
  const nowYearMonth = yearMonthOf(Date.now())
  const collapsedState = (key: string) =>
    overrides[key] ?? defaultCollapsed(key, settings.monthsDefault, settings.yearsDefault, nowYearMonth)

  const items = useMemo(
    () => buildTable(rows, wallet?.openingBalanceMinor ?? 0, collapsedState),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, wallet?.openingBalanceMinor, overrides, settings.monthsDefault, settings.yearsDefault, nowYearMonth],
  )

  const toggle = (key: string) => setOverrides((current) => ({ ...current, [key]: !collapsedState(key) }))

  const checkerId = wallet?.checkerTransactionId ?? null
  const checkerRow = checkerId ? rows.find((r) => r.id === checkerId) : undefined
  const selected = selectedId ? rows.find((r) => r.id === selectedId) : undefined

  const goToChecker = () => {
    if (!checkerRow) return
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
        <button disabled={!checkerRow} onClick={goToChecker}>Go to checker</button>
        <button
          onClick={async () => {
            await setArchived(db, wallet.id, !wallet.isArchived)
            syncManager.notifyLocalChange()
            if (!wallet.isArchived) navigate('/')
          }}
        >
          {wallet.isArchived ? 'Unarchive' : 'Archive'}
        </button>
      </header>

      {rows.length === 0 && transactions !== NO_TRANSACTIONS ? (
        <p className="pane-empty muted">No transactions yet.</p>
      ) : (
        <>
          <div className="columns" aria-hidden="true">
            <span>Date</span>
            <span>Note</span>
            <span className="right">Amount</span>
          </div>
          <div className="table" ref={scroller}>
            {items.map((item) => {
              if (item.type === 'tx') {
                return (
                  <TxRow
                    key={item.key}
                    row={item.row}
                    background={monthRowColor(monthOf(item.yearMonth), settings.monthTint, dark)}
                    isChecker={item.row.id === checkerId}
                    flash={item.row.id === flashId}
                    onOpen={setSelectedId}
                  />
                )
              }
              return (
                <GroupHeader
                  key={item.key}
                  item={item}
                  currency={wallet.currencyCode}
                  background={item.type === 'month' ? monthHeaderColor(monthOf(item.yearMonth), settings.monthTint, dark) : undefined}
                  onToggle={toggle}
                />
              )
            })}
          </div>
        </>
      )}

      {selected && (
        <TransactionDetails
          row={selected}
          wallet={wallet}
          isChecker={selected.id === checkerId}
          onClose={() => setSelectedId(null)}
        />
      )}
    </section>
  )
}

type Group = Exclude<TableItem, { type: 'tx' }>

function GroupHeader({ item, currency, background, onToggle }: { item: Group; currency: string; background?: string; onToggle: (key: string) => void }) {
  const isYear = item.type === 'year'
  const title = isYear ? String(item.year) : monthTitle(item.yearMonth)
  return (
    <button
      className={isYear ? 'group year' : 'group month'}
      style={background ? { backgroundColor: background } : undefined}
      aria-expanded={!item.collapsed}
      onClick={() => onToggle(item.key)}
    >
      <span className="group-chevron" aria-hidden="true">{item.collapsed ? '▸' : '▾'}</span>
      <span className="group-title">{title}</span>
      <span className="group-figure"><small>Out</small> {formatSigned(item.outMinor, false)}</span>
      <span className="group-figure"><small>In</small> {formatSigned(item.inMinor, true)}</span>
      <span className="group-figure group-balance"><small>End balance</small> {formatMoney(item.endBalanceMinor)} {isYear ? currency : ''}</span>
      <span className="group-count">{item.count === 1 ? '1 item' : `${item.count} items`}</span>
    </button>
  )
}

interface TxRowProps {
  row: TransactionRow
  background: string | null
  isChecker: boolean
  flash: boolean
  onOpen: (id: string) => void
}

const TxRow = memo(function TxRow({ row, background, isChecker, flash, onOpen }: TxRowProps) {
  const color = row.categoryColor === null ? undefined : argbToHex(row.categoryColor)
  const className = ['tx', isChecker && 'checker', flash && 'flash'].filter(Boolean).join(' ')
  return (
    <button className={className} data-row-id={row.id} style={background ? { backgroundColor: background } : undefined} onClick={() => onOpen(row.id)}>
      <span className="tx-date">
        {isChecker && <span className="checker-dot" title="Checker" />}
        <span>{formatDate(row.occurredAt)}</span>
        <small>{formatTime(row.occurredAt)}</small>
      </span>
      <span className="tx-note">
        <span className="tx-note-text">{noteForTable(row.note) || '—'}</span>
        {row.categoryName && <CategoryChip name={row.categoryName} parent={row.parentName} color={color} />}
        {row.source === 'RECURRING' && <span title="Monthly fee"> 🔁</span>}
      </span>
      <span className="tx-amount">
        <span className="swatch" style={color ? { backgroundColor: color } : undefined} />
        {formatSigned(row.amountMinor, isIncoming(row.kind))}
      </span>
    </button>
  )
})

export function CategoryChip({ name, parent, color }: { name: string; parent: string | null; color?: string }) {
  return (
    <span className="chip" style={color ? { borderColor: color } : undefined}>
      {parent ? `${name} · ${parent}` : name}
    </span>
  )
}
