import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState } from 'react'
import { monthTitle, yearMonthOf } from '../core/dates'
import { formatMoney, MINUS, parseMoney, toEditable } from '../core/money'
import { deleteRule, saveRule, setRuleActive } from '../data/rules'
import { db } from '../db/db'
import type { Category, RecurringRule, Wallet } from '../db/types'
import { DEFAULT_FEE_TEMPLATE, renderFeeNote } from '../domain/monthlyFee'
import { nextMonth } from '../domain/stats'
import { ConfirmDialog, Modal, SavedCheckbox } from './Common'
import { FieldError } from './FormShell'
import { syncManager } from './services'

const NO_RULES: RecurringRule[] = []
const PHONE_NOTE = 'Your phone books the fees, on the last day of each month at 23:59, when Saldo runs there. Months it missed are caught up. Changing the amount does not change fees already booked.'

interface Props {
  /** With a wallet, only its rules are shown. */
  walletId: string | null
  wallets: Wallet[]
  categories: Category[]
}

export function FeesPage({ walletId, wallets, categories }: Props) {
  const stored = useLiveQuery(() => db.recurring_rules.toArray(), [], NO_RULES)
  const [editing, setEditing] = useState<RecurringRule | 'new' | null>(null)

  const liveWallets = useMemo(() => wallets.filter((w) => w.deletedAt === null), [wallets])
  const activeWallets = useMemo(() => liveWallets.filter((w) => !w.isArchived).sort((a, b) => a.sortOrder - b.sortOrder), [liveWallets])
  const liveCategories = useMemo(() => categories.filter((c) => c.deletedAt === null), [categories])
  const rules = useMemo(
    () => stored.filter((r) => r.deletedAt === null && (!walletId || r.walletId === walletId)).sort((a, b) => a.createdAt - b.createdAt),
    [stored, walletId],
  )
  const fixedWallet = walletId ? liveWallets.find((w) => w.id === walletId) : undefined
  const thisMonth = yearMonthOf(Date.now())

  return (
    <main className="page">
      <header className="page-header">
        <h1>Monthly fees{fixedWallet ? `: ${fixedWallet.name}` : ''}</h1>
        <span className="spacer" />
        <button className="primary" disabled={activeWallets.length === 0} onClick={() => setEditing('new')}>New monthly fee</button>
      </header>
      <div className="page-scroll">
        <p className="notice fee-note">{PHONE_NOTE}</p>
        {stored !== NO_RULES && rules.length === 0 && <p className="muted empty">No monthly fees yet.</p>}
        <ul className="fee-list">
          {rules.map((rule) => {
            const wallet = liveWallets.find((w) => w.id === rule.walletId)
            return (
              <li key={rule.id} className="fee-card">
                <button className="fee-open" onClick={() => setEditing(rule)}>
                  <span className="wallet-balance">{MINUS}{formatMoney(rule.amountMinor)} {wallet?.currencyCode ?? ''}</span>
                  <span>{wallet?.name ?? '(deleted wallet)'}</span>
                  <small className="muted">"{renderFeeNote(rule.noteTemplate, thisMonth)}"</small>
                  <small className="muted">
                    From {monthTitle(rule.startPeriod)}
                    {rule.lastGeneratedPeriod ? ` · last booked ${monthTitle(rule.lastGeneratedPeriod)}` : ' · not booked yet'}
                  </small>
                </button>
                <label className="quick-toggle">
                  <SavedCheckbox
                    label={`Active: ${renderFeeNote(rule.noteTemplate, thisMonth)}`}
                    checked={rule.isActive}
                    onSave={async (isActive) => {
                      await setRuleActive(db, rule.id, isActive)
                      syncManager.notifyLocalChange()
                    }}
                  />
                  Active
                </label>
              </li>
            )
          })}
        </ul>
      </div>
      {editing && (
        <FeeDialog
          key={editing === 'new' ? 'new' : editing.id}
          rule={editing === 'new' ? null : editing}
          fixedWalletId={walletId}
          wallets={activeWallets}
          categories={liveCategories}
          onClose={() => setEditing(null)}
        />
      )}
    </main>
  )
}

interface DialogProps {
  rule: RecurringRule | null
  fixedWalletId: string | null
  wallets: Wallet[]
  categories: Category[]
  onClose: () => void
}

function FeeDialog({ rule, fixedWalletId, wallets, categories, onClose }: DialogProps) {
  const thisMonth = yearMonthOf(Date.now())
  const [walletId, setWalletId] = useState(rule?.walletId ?? fixedWalletId ?? wallets[0]?.id ?? '')
  const [amount, setAmount] = useState(rule ? toEditable(rule.amountMinor) : '')
  const [amountError, setAmountError] = useState<string | null>(null)
  const [template, setTemplate] = useState(rule?.noteTemplate ?? DEFAULT_FEE_TEMPLATE)
  const [start, setStart] = useState(rule?.startPeriod ?? thisMonth)
  const [categoryId, setCategoryId] = useState<string | null>(
    rule ? rule.categoryId : categories.find((c) => c.name === 'Account maintenance')?.id ?? null,
  )
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const currency = wallets.find((w) => w.id === walletId)?.currencyCode ?? ''
  const sortedCategories = useMemo(() => [...categories].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase())), [categories])
  // An archived wallet is not offered for new rules, but its own rule must keep showing it.
  const walletOptions = useMemo(() => wallets, [wallets])

  return (
    <Modal label={rule ? 'Edit monthly fee' : 'New monthly fee'} onClose={onClose} wide>
      <form
        className="form"
        noValidate
        onSubmit={async (e) => {
          e.preventDefault()
          const parsed = parseMoney(amount)
          if (!walletId) {
            setAmountError('Create a wallet first')
            return
          }
          if (parsed.type !== 'ok' || parsed.minor <= 0) {
            setAmountError('Enter an amount (max 2 decimals)')
            return
          }
          await saveRule(db, {
            id: rule?.id ?? null,
            walletId,
            amountMinor: parsed.minor,
            categoryId,
            noteTemplate: template.trim() ? template : DEFAULT_FEE_TEMPLATE,
            startPeriod: start,
            isActive: rule?.isActive ?? true,
          })
          syncManager.notifyLocalChange()
          onClose()
        }}
      >
        <header className="form-header">
          <button type="button" aria-label="Close" onClick={onClose}>✕</button>
          <h2>{rule ? 'Edit monthly fee' : 'New monthly fee'}</h2>
          <span className="spacer" />
          <button type="submit" className="primary">Save</button>
        </header>
        {!fixedWalletId && (
          <div className="stack">
            <label htmlFor="fee-wallet">Wallet</label>
            <select id="fee-wallet" value={walletId} onChange={(e) => setWalletId(e.target.value)}>
              {!walletOptions.some((w) => w.id === walletId) && <option value={walletId}>(archived or deleted wallet)</option>}
              {walletOptions.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
        )}
        <div className="stack">
          <label htmlFor="fee-amount">Amount taken every month</label>
          <div className="with-suffix">
            <input
              id="fee-amount"
              inputMode="decimal"
              autoComplete="off"
              autoFocus={!rule}
              value={amount}
              aria-invalid={!!amountError}
              onChange={(e) => {
                setAmount(e.target.value)
                setAmountError(null)
              }}
            />
            <span className="muted">{currency}</span>
          </div>
          <FieldError id="fee-amount-error" text={amountError} />
        </div>
        <div className="stack">
          <label htmlFor="fee-template">Note text</label>
          <textarea id="fee-template" rows={2} value={template} onChange={(e) => setTemplate(e.target.value)} />
          <small className="muted">Tokens: {'{month} {Month} {mm} {year}'}</small>
          <small aria-label="Preview">Preview: {renderFeeNote(template.trim() ? template : DEFAULT_FEE_TEMPLATE, thisMonth)}</small>
        </div>
        <div className="stack">
          <label htmlFor="fee-category">Category</label>
          <select id="fee-category" value={categoryId ?? ''} onChange={(e) => setCategoryId(e.target.value || null)}>
            <option value="">No category</option>
            {sortedCategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="stack">
          <span>Starts with</span>
          <div className="month-stepper">
            <button type="button" aria-label="Previous month" onClick={() => setStart(nextMonth(start, -1))}>‹</button>
            <strong>{monthTitle(start)}</strong>
            <button type="button" aria-label="Next month" onClick={() => setStart(nextMonth(start))}>›</button>
          </div>
        </div>
        <small className="muted">{PHONE_NOTE}</small>
        {rule && (
          <div className="actions">
            <button type="button" className="danger" onClick={() => setConfirmingDelete(true)}>Delete rule</button>
          </div>
        )}
      </form>
      {confirmingDelete && rule && (
        <ConfirmDialog
          title="Delete this monthly fee?"
          text="Fees already booked stay in the wallet."
          confirmLabel="Delete"
          onCancel={() => setConfirmingDelete(false)}
          onConfirm={async () => {
            await deleteRule(db, rule.id)
            syncManager.notifyLocalChange()
            onClose()
          }}
        />
      )}
    </Modal>
  )
}
