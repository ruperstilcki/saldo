import { useEffect, useRef, useState } from 'react'
import { formatDate } from '../core/dates'
import { formatMoney, formatSigned, MINUS } from '../core/money'
import { reorderWallets, setArchived } from '../data/wallets'
import { db } from '../db/db'
import { noteForTable } from '../domain/noteDisplay'
import { isIncoming } from '../domain/rows'
import type { CurrencySum, WalletSummary } from '../domain/walletSummaries'
import { WalletAvatar } from './Common'
import { navigate, walletPath } from './router'
import { syncManager } from './services'

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
      {loaded && active.length === 0 && <p className="muted empty">No wallets yet.</p>}
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

/** Drag the handle to change the order, with a mouse or a finger. Arrow keys work too. */
function SortableWallets({ summaries, selectedId }: { summaries: WalletSummary[]; selectedId: string | null }) {
  const [draft, setDraft] = useState<string[] | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const list = useRef<HTMLUListElement>(null)

  // A sync can change the list during a drag: wallets no longer here must not stay in the draft.
  useEffect(() => {
    if (!draft) return
    const known = new Set(summaries.map((s) => s.wallet.id))
    if (draft.some((id) => !known.has(id)) || draft.length !== known.size) {
      setDraft(null)
      setDraggingId(null)
    }
  }, [summaries, draft])

  const byId = new Map(summaries.map((s) => [s.wallet.id, s]))
  const ordered = draft ? draft.flatMap((id) => byId.get(id) ?? []) : summaries

  const save = async (ids: string[]) => {
    await reorderWallets(db, ids)
    syncManager.notifyLocalChange()
    setDraft(null)
  }

  const moveTo = (id: string, clientY: number) => {
    const items = [...(list.current?.children ?? [])]
    let target = items.length - 1
    for (const [index, item] of items.entries()) {
      const box = item.getBoundingClientRect()
      if (clientY < box.top + box.height / 2) {
        target = index
        break
      }
    }
    setDraft((current) => {
      const ids = current ?? summaries.map((s) => s.wallet.id)
      const from = ids.indexOf(id)
      if (from < 0 || from === target) return current ?? ids
      const next = [...ids]
      next.splice(from, 1)
      next.splice(target, 0, id)
      return next
    })
  }

  return (
    <ul className="cards" ref={list}>
      {ordered.map((summary, index) => {
        const { id } = summary.wallet
        return (
          <li key={id} className={draggingId === id ? 'card-item sortable dragging' : 'card-item sortable'}>
            <WalletCard summary={summary} selected={id === selectedId} />
            <button
              className="handle"
              aria-label="Reorder"
              title="Drag to reorder"
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId)
                setDraggingId(id)
              }}
              onPointerMove={(e) => {
                if (draggingId === id) moveTo(id, e.clientY)
              }}
              onPointerUp={() => {
                setDraggingId(null)
                if (draft) void save(draft)
              }}
              onPointerCancel={() => {
                setDraggingId(null)
                setDraft(null)
              }}
              onKeyDown={(e) => {
                const delta = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0
                const target = index + delta
                if (delta === 0 || target < 0 || target >= ordered.length) return
                e.preventDefault()
                const ids = ordered.map((s) => s.wallet.id)
                ids.splice(index, 1)
                ids.splice(target, 0, id)
                void save(ids)
              }}
            >
              <span aria-hidden="true">⋮⋮</span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
