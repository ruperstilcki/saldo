import { currencyName } from '../core/currencies'
import { formatDate, formatTime } from '../core/dates'
import { formatMoney, formatSigned } from '../core/money'
import { setChecker } from '../data/wallets'
import { db } from '../db/db'
import type { Wallet } from '../db/types'
import { isIncoming, type TransactionRow } from '../domain/rows'
import { argbToHex } from '../ui/monthTints'
import { Modal } from './Common'
import { duplicateTransactionPath, editTransactionPath, navigate } from './router'
import { syncManager } from './services'
import { CategoryChip } from './WalletPane'

const SOURCE_LABELS: Record<string, string> = {
  MANUAL: 'Manual',
  SMS_PASTE: 'SMS paste',
  RECURRING: 'Monthly fee',
  IMPORT: 'Imported',
}

interface Props {
  row: TransactionRow
  wallet: Wallet
  isChecker: boolean
  onClose: () => void
  onDelete: (id: string) => void
}

export function TransactionDetails({ row, wallet, isChecker, onClose, onDelete }: Props) {
  const incoming = isIncoming(row.kind)
  const go = (path: string) => {
    onClose()
    navigate(path)
  }

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
        <button onClick={() => go(editTransactionPath(wallet.id, row.id))}>Edit</button>
        <button onClick={() => go(duplicateTransactionPath(wallet.id, row.id))}>Duplicate</button>
        <button
          onClick={async () => {
            await setChecker(db, wallet.id, isChecker ? null : row.id)
            syncManager.notifyLocalChange()
            onClose()
          }}
        >
          {isChecker ? 'Remove checker' : 'Set checker'}
        </button>
        <button className="danger" onClick={() => onDelete(row.id)}>Delete</button>
        <button onClick={onClose}>Close</button>
      </div>
    </Modal>
  )
}
