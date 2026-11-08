import { useEffect, useRef, useState } from 'react'
import { formatDate } from '../core/dates'
import { formatMoney, formatSigned, MINUS } from '../core/money'
import { reorderWallets, setArchived } from '../data/wallets'
import { db } from '../db/db'
import { noteForTable } from '../domain/noteDisplay'
import { isIncoming } from '../domain/rows'
import type { CurrencySum, WalletSummary } from '../domain/walletSummaries'
import { moveItem } from '../ui/reorder'
import { WalletAvatar } from './Common'
import { navigate, newWalletPath, walletPath } from './router'
import { syncManager } from './services'
import { useCardDrag } from './useCardDrag'

interface Props {
  showArchived: boolean
  active: WalletSummary[]
  archived: WalletSummary[]
  totals: CurrencySum[]
  spent: CurrencySum[]
  selectedId: string | null
  loaded: boolean
}

export function WalletList({ showArchived, active, archived, totals, spent, selectedId, loaded }: Props) {
  if (showArchived) return <ArchivedList archived={archived} selectedId={selectedId} />
  return (
    <aside className="side" aria-label="Wallets">
      <section className="total-card" aria-label="Total">
        <h2>Total</h2>
        {totals.map((t) => (
          <p key={t.currency} className="total-amount">{formatMoney(t.minor)} {t.currency}</p>
        ))}
        {spent.length > 0 && (
          <p className="total-spent">
            This month spent: {spent.map((s) => `${MINUS}${formatMoney(s.minor)} ${s.currency}`).join('  ')}
          </p>
        )}
      </section>
      <button className="primary new-wallet" onClick={() => navigate(newWalletPath())}>New wallet</button>
      {loaded && active.length === 0 && <p className="muted empty">No wallets yet. Create your first one.</p>}
      <SortableWallets summaries={active} selectedId={selectedId} />
      <button className="link" onClick={() => navigate('/archived')}>Archived wallets ({archived.length})</button>
    </aside>
  )
}

function ArchivedList({ archived, selectedId }: { archived: WalletSummary[]; selectedId: string | null }) {
  return (
    <aside className="side" aria-label="Archived wallets">
      <button className="link" onClick={() => navigate('/')}>← All wallets</button>
      <h2>Archived</h2>
      {archived.length === 0 && <p className="muted empty">No archived wallets.</p>}
      <ul className="cards">
        {archived.map((summary) => (
          <li key={summary.wallet.id} className="card-item">
            <WalletCard summary={summary} selected={summary.wallet.id === selectedId} />
            <button
              onClick={async () => {
                await setArchived(db, summary.wallet.id, false)
                syncManager.notifyLocalChange()
              }}
            >
              Unarchive
            </button>
          </li>
        ))}
      </ul>
    </aside>
  )
}

function WalletCard({ summary, selected }: { summary: WalletSummary; selected: boolean }) {
  const { wallet, balanceMinor, lastTransaction: last, lastCategory } = summary
  const label = lastCategory ?? noteForTable(last?.note ?? null).slice(0, 28)
  return (
    <button className={selected ? 'wallet-card selected' : 'wallet-card'} onClick={() => navigate(walletPath(wallet.id))}>
      <WalletAvatar wallet={wallet} />
      <span className="wallet-card-text">
        <span className="wallet-name">{wallet.name}</span>
        <span className="wallet-balance">{formatMoney(balanceMinor)} {wallet.currencyCode}</span>
        {last && (
          <span className="wallet-last">
            {label || '—'} · {formatSigned(last.amountMinor, isIncoming(last.kind))} · {formatDate(last.occurredAt)}
          </span>
        )}
      </span>
    </button>
  )
}

/** Drag a card to change the order. With the keyboard: Alt + Up or Down on a focused card. */
function SortableWallets({ summaries, selectedId }: { summaries: WalletSummary[]; selectedId: string | null }) {
  const [draft, setDraft] = useState<string[] | null>(null)
  const list = useRef<HTMLUListElement>(null)

  const byId = new Map(summaries.map((s) => [s.wallet.id, s]))
  const saved = summaries.map((s) => s.wallet.id)
  const order = draft ? draft.filter((id) => byId.has(id)) : saved

  const save = (ids: string[]) => {
    setDraft(ids)
    void reorderWallets(db, ids).then(() => syncManager.notifyLocalChange())
  }

  const { draggingId, onPointerDown, cancelDrag } = useCardDrag({ list, order, setOrder: setDraft, onDrop: save })

  const savedKey = saved.join('|')
  const draftKey = draft?.join('|')
  useEffect(() => {
    if (draftKey === undefined || draggingId) return
    // The saved order has caught up, so the draft has done its job and the list never jumps back.
    if (draftKey === savedKey) setDraft(null)
  }, [draftKey, savedKey, draggingId])

  // A wallet added or removed by a sync in the middle of a drag makes the draft meaningless.
  const members = [...saved].sort().join('|')
  const previousMembers = useRef(members)
  useEffect(() => {
    if (previousMembers.current === members) return
    previousMembers.current = members
    cancelDrag()
    setDraft(null)
  }, [members, cancelDrag])

  return (
    <ul className="cards" ref={list}>
      {order.map((id, index) => {
        const summary = byId.get(id)!
        return (
          <li
            key={id}
            data-sort-id={id}
            className={draggingId === id ? 'card-item sortable dragging' : 'card-item sortable'}
            onPointerDown={(e) => onPointerDown(id, e)}
            onDragStart={(e) => e.preventDefault()}
            onContextMenu={(e) => {
              if (e.nativeEvent instanceof PointerEvent && e.nativeEvent.pointerType === 'touch') e.preventDefault()
            }}
            onKeyDown={(e) => {
              if (!e.altKey) return
              const target = e.key === 'ArrowUp' ? index - 1 : e.key === 'ArrowDown' ? index + 1 : -1
              if (target < 0 || target >= order.length) return
              e.preventDefault()
              save(moveItem(order, id, target))
            }}
          >
            <WalletCard summary={summary} selected={id === selectedId} />
          </li>
        )
      })}
    </ul>
  )
}
