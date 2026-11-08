import { useState } from 'react'
import { formatDate, formatTime } from '../core/dates'
import { formatMoney, formatSigned } from '../core/money'
import { updateTransactionNote } from '../data/transactions'
import { setChecker } from '../data/wallets'
import { db } from '../db/db'
import type { Wallet } from '../db/types'
import { isIncoming, type TransactionRow } from '../domain/rows'
import { argbToHex } from '../ui/monthTints'
import { Modal } from './Common'
import { syncManager } from './services'
import { CategoryChip } from './WalletPane'

const SOURCE_LABELS: Record<string, string> = {
  MANUAL: 'Manual',
  SMS_PASTE: 'SMS paste',
  RECURRING: 'Monthly fee',
  IMPORT: 'Imported',
}

function currencyName(code: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'currency' }).of(code) ?? code
  } catch {
    return code
  }
}

interface Props {
  row: TransactionRow
  wallet: Wallet
  isChecker: boolean
  onClose: () => void
}

export function TransactionDetails({ row, wallet, isChecker, onClose }: Props) {
  const [editing, setEditing] = useState(false)
  const incoming = isIncoming(row.kind)

  if (editing) return <NoteDialog row={row} onClose={onClose} />

  return (
    <Modal label="Transaction details" onClose={onClose}>
      <h2 className="details-amount">{formatSigned(row.amountMinor, incoming)} {wallet.currencyCode}</h2>
      <p className="muted">
        {formatDate(row.occurredAt)} {formatTime(row.occurredAt)} · {incoming ? 'Income' : 'Expense'} · {SOURCE_LABELS[row.source] ?? row.source}
      </p>
      {row.categoryName && (
        <p>
          <CategoryChip
            name={row.categoryName}
            parent={row.parentName}
            color={row.categoryColor === null ? undefined : argbToHex(row.categoryColor)}
          />
        </p>
      )}
      {row.originalAmountMinor !== null && row.originalCurrency && (
        <p>Original: {formatMoney(row.originalAmountMinor)} {row.originalCurrency} ({currencyName(row.originalCurrency)})</p>
      )}
      {row.note && <p className="details-note">{row.note}</p>}
      <div className="actions">
        <button onClick={() => setEditing(true)}>Edit note</button>
        <button
          onClick={async () => {
            await setChecker(db, wallet.id, isChecker ? null : row.id)
            syncManager.notifyLocalChange()
            onClose()
          }}
        >
          {isChecker ? 'Remove checker' : 'Set checker'}
        </button>
        <button onClick={onClose}>Close</button>
      </div>
    </Modal>
  )
}

function NoteDialog({ row, onClose }: { row: TransactionRow; onClose: () => void }) {
  const [note, setNote] = useState(row.note ?? '')
  const save = async () => {
    await updateTransactionNote(db, row.id, note)
    syncManager.notifyLocalChange()
    onClose()
  }
  return (
    <Modal label="Edit note" onClose={onClose}>
      <h2>Edit note</h2>
      <textarea aria-label="Note" rows={5} value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="actions">
        <button onClick={onClose}>Cancel</button>
        <button className="primary" onClick={() => void save()}>Save</button>
      </div>
    </Modal>
  )
}
