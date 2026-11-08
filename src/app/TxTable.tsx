import { memo, type Ref } from 'react'
import { formatDate, formatTime, monthOf, monthTitle } from '../core/dates'
import { formatMoney, formatSigned } from '../core/money'
import { noteForTable } from '../domain/noteDisplay'
import { isIncoming, type TransactionRow } from '../domain/rows'
import type { TableItem } from '../domain/tableModel'
import { argbToHex, monthHeaderColor, monthRowColor } from '../ui/monthTints'
import { useDarkTheme, useSettings } from './settings'

interface Props {
  items: TableItem[]
  /** Currency for the year headers, when one wallet is shown. */
  currency: string
  /** Off in search results: a balance would be wrong for a subset of rows. */
  showBalance: boolean
  showWallet?: boolean
  checkerId?: string | null
  flashId?: string | null
  scrollerRef?: Ref<HTMLDivElement>
  onToggle: (key: string) => void
  onOpen: (id: string) => void
}

export function TxTable({ items, currency, showBalance, showWallet, checkerId, flashId, scrollerRef, onToggle, onOpen }: Props) {
  const settings = useSettings()
  const dark = useDarkTheme()
  return (
    <>
      <div className="columns" aria-hidden="true">
        <span>Date</span>
        <span>Note</span>
        <span className="right">Amount</span>
      </div>
      <div className="table" ref={scrollerRef}>
        {items.map((item) => {
          if (item.type === 'tx') {
            return (
              <TxRow
                key={item.key}
                row={item.row}
                background={monthRowColor(monthOf(item.yearMonth), settings.monthTint, dark)}
                isChecker={item.row.id === checkerId}
                flash={item.row.id === flashId}
                showWallet={!!showWallet}
                onOpen={onOpen}
              />
            )
          }
          return (
            <GroupHeader
              key={item.key}
              item={item}
              currency={currency}
              showBalance={showBalance}
              background={item.type === 'month' ? monthHeaderColor(monthOf(item.yearMonth), settings.monthTint, dark) : undefined}
              onToggle={onToggle}
            />
          )
        })}
      </div>
    </>
  )
}

type Group = Exclude<TableItem, { type: 'tx' }>

interface GroupProps {
  item: Group
  currency: string
  showBalance: boolean
  background?: string
  onToggle: (key: string) => void
}

function GroupHeader({ item, currency, showBalance, background, onToggle }: GroupProps) {
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
      <span className="group-figure group-balance">
        {showBalance && <><small>End balance</small> {formatMoney(item.endBalanceMinor)} {isYear ? currency : ''}</>}
      </span>
      <span className="group-count">{item.count === 1 ? '1 item' : `${item.count} items`}</span>
    </button>
  )
}

interface TxRowProps {
  row: TransactionRow
  background: string | null
  isChecker: boolean
  flash: boolean
  showWallet: boolean
  onOpen: (id: string) => void
}

const TxRow = memo(function TxRow({ row, background, isChecker, flash, showWallet, onOpen }: TxRowProps) {
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
        {showWallet && row.walletName && <small className="muted">{row.walletName}</small>}
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
