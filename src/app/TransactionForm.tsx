import { useEffect, useMemo, useRef, useState } from 'react'
import { combineDateTime, formatDate, formatTime, fromDateInput, parseDateText, parseTimeText, toDateInput } from '../core/dates'
import { parseMoney, toEditable, type ParseResult } from '../core/money'
import { createCategoryFromForm } from '../data/categories'
import { saveTransaction } from '../data/transactions'
import { db } from '../db/db'
import type { Category, Transaction, Wallet } from '../db/types'
import { isIncoming } from '../domain/rows'
import { CategoryPicker } from './CategoryPicker'
import { CurrencyPicker } from './CurrencyPicker'
import { FieldError, FormShell, leaveSavedForm } from './FormShell'
import { walletPath } from './router'
import { syncManager } from './services'
import { useSettings } from './settings'

interface Props {
  wallet: Wallet
  /** The row to edit, or to copy when [duplicate] is set. */
  sourceId: string | null
  duplicate: boolean
  categories: Category[]
  transactions: Transaction[]
  allowCreateCategory: boolean
}

interface Errors {
  amount: string | null
  date: string | null
  time: string | null
  original: string | null
}

const NO_ERRORS: Errors = { amount: null, date: null, time: null, original: null }

function amountMessage(result: ParseResult): string | null {
  switch (result.type) {
    case 'ok': return result.minor > 0 ? null : 'Amount must not be zero'
    case 'empty': return 'Enter an amount'
    case 'tooManyDecimals': return 'Max 2 decimals'
    case 'invalid': return 'Invalid amount'
  }
}

export function TransactionForm({ wallet, sourceId, duplicate, categories, transactions, allowCreateCategory }: Props) {
  const settings = useSettings()
  const closeTo = walletPath(wallet.id)
  const isEdit = sourceId !== null && !duplicate
  const now = useRef(Date.now()).current

  const [loaded, setLoaded] = useState(sourceId === null)
  const [dirty, setDirty] = useState(duplicate)
  const [income, setIncome] = useState(false)
  const [amount, setAmount] = useState('')
  const [dateText, setDateText] = useState(formatDate(now))
  const [timeText, setTimeText] = useState(formatTime(now))
  const [note, setNote] = useState('')
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [foreignOpen, setForeignOpen] = useState(false)
  const [originalAmount, setOriginalAmount] = useState('')
  const [originalCurrency, setOriginalCurrency] = useState<string | null>(null)
  const [currencyOpen, setCurrencyOpen] = useState(false)
  const [errors, setErrors] = useState<Errors>(NO_ERRORS)
  const [saving, setSaving] = useState(false)
  const nativeDate = useRef<HTMLInputElement>(null)

  // Read once. A sync while the form is open must not overwrite what is being typed.
  useEffect(() => {
    if (sourceId === null) return
    let active = true
    void db.transactions.get(sourceId).then((source) => {
      if (!active) return
      if (!source || source.deletedAt !== null) {
        leaveSavedForm(closeTo)
        return
      }
      setIncome(isIncoming(source.kind))
      setAmount(toEditable(source.amountMinor))
      if (!duplicate) {
        setDateText(formatDate(source.occurredAt))
        setTimeText(formatTime(source.occurredAt))
      }
      setNote(source.note ?? '')
      setCategoryId(source.categoryId)
      setForeignOpen(source.originalAmountMinor !== null)
      setOriginalAmount(source.originalAmountMinor === null ? '' : toEditable(source.originalAmountMinor))
      setOriginalCurrency(source.originalCurrency)
      setLoaded(true)
    })
    return () => {
      active = false
    }
  }, [sourceId, duplicate, closeTo])

  const usage = useMemo(() => {
    const counts = new Map<string, number>()
    for (const tx of transactions) {
      if (tx.deletedAt === null && tx.categoryId) counts.set(tx.categoryId, (counts.get(tx.categoryId) ?? 0) + 1)
    }
    return counts
  }, [transactions])
  const liveCategories = useMemo(() => categories.filter((c) => c.deletedAt === null), [categories])

  const touch = () => setDirty(true)

  const save = async () => {
    const amountResult = parseMoney(amount)
    const date = parseDateText(dateText)
    const time = parseTimeText(timeText)
    const next: Errors = {
      amount: amountMessage(amountResult),
      date: date ? null : 'Enter the date as dd.MM.yyyy',
      time: time ? null : 'Enter the time as HH:mm',
      original: null,
    }

    let originalMinor: number | null = null
    let currency: string | null = null
    if (originalAmount.trim()) {
      const parsed = parseMoney(originalAmount)
      if (parsed.type === 'ok') {
        originalMinor = parsed.minor
        currency = originalCurrency
        if (!currency) next.original = 'Choose the currency'
      } else {
        next.original = parsed.type === 'tooManyDecimals' ? 'Max 2 decimals' : 'Invalid amount'
      }
    }

    setErrors(next)
    if (next.amount || next.date || next.time || next.original || amountResult.type !== 'ok' || !date || !time) {
      if (next.original) setForeignOpen(true)
      return
    }

    setSaving(true)
    await saveTransaction(db, {
      id: isEdit ? sourceId : null,
      walletId: wallet.id,
      kind: income ? 'INCOME' : 'EXPENSE',
      amountMinor: amountResult.minor,
      occurredAt: combineDateTime(date, time),
      note,
      categoryId,
      originalAmountMinor: originalMinor,
      originalCurrency: currency,
    })
    syncManager.notifyLocalChange()
    leaveSavedForm(closeTo)
  }

  const title = isEdit ? 'Edit transaction' : duplicate ? 'Duplicate transaction' : 'New transaction'
  const pickedDate = parseDateText(dateText)

  return (
    <FormShell
      title={title}
      dirty={dirty}
      discardText="This transaction will not be saved."
      saving={saving || !loaded}
      closeTo={closeTo}
      onSave={save}
    >
      {loaded && (
        <>
          <div className="segmented" role="radiogroup" aria-label="Type">
            {[false, true].map((value) => (
              <button
                key={String(value)}
                type="button"
                role="radio"
                aria-checked={income === value}
                className={income === value ? 'on' : ''}
                onClick={() => {
                  setIncome(value)
                  touch()
                }}
              >
                {value ? 'Income' : 'Expense'}
              </button>
            ))}
          </div>

          <div className="stack">
            <label htmlFor="tx-amount">Amount</label>
            <div className="with-suffix">
              <input
                id="tx-amount"
                className="amount-input"
                inputMode="decimal"
                autoComplete="off"
                autoFocus={!amount}
                value={amount}
                aria-invalid={!!errors.amount}
                aria-describedby="tx-amount-error"
                onChange={(e) => {
                  setAmount(e.target.value)
                  setErrors((current) => ({ ...current, amount: null }))
                  touch()
                }}
              />
              <span className="muted">{wallet.currencyCode}</span>
            </div>
            <FieldError id="tx-amount-error" text={errors.amount} />
          </div>

          <div className="row-fields">
            <div className="stack grow">
              <label htmlFor="tx-date">Date</label>
              <div className="with-suffix">
                <input
                  id="tx-date"
                  autoComplete="off"
                  inputMode="numeric"
                  placeholder="dd.MM.yyyy"
                  value={dateText}
                  aria-invalid={!!errors.date}
                  aria-describedby="tx-date-error"
                  onChange={(e) => {
                    setDateText(e.target.value)
                    setErrors((current) => ({ ...current, date: null }))
                    touch()
                  }}
                />
                <button type="button" aria-label="Open calendar" onClick={() => nativeDate.current?.showPicker()}>📅</button>
                <input
                  ref={nativeDate}
                  className="hidden-date"
                  type="date"
                  tabIndex={-1}
                  aria-hidden="true"
                  value={pickedDate ? toDateInput(combineDateTime(pickedDate, { hour: 12, minute: 0 })) : ''}
                  onChange={(e) => {
                    const text = fromDateInput(e.target.value)
                    if (!text) return
                    setDateText(text)
                    setErrors((current) => ({ ...current, date: null }))
                    touch()
                  }}
                />
              </div>
              <FieldError id="tx-date-error" text={errors.date} />
            </div>
            <div className="stack time-field">
              <label htmlFor="tx-time">Time</label>
              <input
                id="tx-time"
                autoComplete="off"
                inputMode="numeric"
                placeholder="HH:mm"
                value={timeText}
                aria-invalid={!!errors.time}
                aria-describedby="tx-time-error"
                onChange={(e) => {
                  setTimeText(e.target.value)
                  setErrors((current) => ({ ...current, time: null }))
                  touch()
                }}
              />
              <FieldError id="tx-time-error" text={errors.time} />
            </div>
          </div>

          <CategoryPicker
            selectedId={categoryId}
            categories={liveCategories}
            usage={usage}
            income={income}
            showQuickPicks={settings.showQuickPicksInAutocomplete}
            allowCreate={allowCreateCategory}
            onSelect={(id) => {
              setCategoryId(id)
              touch()
            }}
            onCreate={(name) => {
              void createCategoryFromForm(db, name, income).then((id) => {
                setCategoryId(id)
                touch()
                syncManager.notifyLocalChange()
              })
            }}
          />

          <div className="stack">
            <label htmlFor="tx-note">Note</label>
            <textarea
              id="tx-note"
              rows={3}
              value={note}
              onChange={(e) => {
                setNote(e.target.value)
                touch()
              }}
            />
          </div>

          <button type="button" className="link" aria-expanded={foreignOpen} onClick={() => setForeignOpen((open) => !open)}>
            {foreignOpen ? '▾' : '▸'} Foreign currency (optional)
          </button>
          {foreignOpen && (
            <div className="row-fields">
              <div className="stack grow">
                <label htmlFor="tx-original">Original amount</label>
                <input
                  id="tx-original"
                  inputMode="decimal"
                  autoComplete="off"
                  value={originalAmount}
                  aria-invalid={!!errors.original}
                  aria-describedby="tx-original-error"
                  onChange={(e) => {
                    setOriginalAmount(e.target.value)
                    setErrors((current) => ({ ...current, original: null }))
                    touch()
                  }}
                />
                {errors.original
                  ? <FieldError id="tx-original-error" text={errors.original} />
                  : <small className="muted">e.g. 607,00 EUR paid from an RSD wallet</small>}
              </div>
              <div className="stack">
                <span>Currency</span>
                <button type="button" onClick={() => setCurrencyOpen(true)}>{originalCurrency ?? 'Choose'}</button>
              </div>
            </div>
          )}
          {currencyOpen && (
            <CurrencyPicker
              onClose={() => setCurrencyOpen(false)}
              onPick={(code) => {
                setOriginalCurrency(code)
                setErrors((current) => ({ ...current, original: null }))
                touch()
              }}
            />
          )}
        </>
      )}
    </FormShell>
  )
}
