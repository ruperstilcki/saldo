import { useEffect, useRef, useState } from 'react'
import { currencyName, DEFAULT_CURRENCY } from '../core/currencies'
import { parseMoney, toEditable } from '../core/money'
import { prepareImage, type PreparedImage } from '../data/images'
import { saveWallet } from '../data/wallets'
import { db } from '../db/db'
import { argbToHex, hexToArgb } from '../ui/monthTints'
import { WalletAvatar } from './Common'
import { CurrencyPicker } from './CurrencyPicker'
import { FieldError, FormShell, leaveSavedForm } from './FormShell'
import { walletPath } from './router'
import { syncManager } from './services'

const WALLET_TYPES: [string, string][] = [
  ['BANK', 'Bank account'],
  ['CARD', 'Card'],
  ['CASH', 'Cash'],
  ['SAVINGS', 'Savings'],
  ['ONLINE', 'Online'],
]
const SWATCHES = ['#1E5BB8', '#00897B', '#43A047', '#FB8C00', '#E53935', '#8E24AA', '#6D4C41', '#546E7A'].map(hexToArgb)

export function WalletForm({ walletId }: { walletId: string | null }) {
  const closeTo = walletId ? walletPath(walletId) : '/'
  const [loaded, setLoaded] = useState(walletId === null)
  const [dirty, setDirty] = useState(false)
  const [name, setName] = useState('')
  const [type, setType] = useState('BANK')
  const [currency, setCurrency] = useState(DEFAULT_CURRENCY)
  const [currencyLocked, setCurrencyLocked] = useState(false)
  const [opening, setOpening] = useState('')
  const [color, setColor] = useState(SWATCHES[0]!)
  const [note, setNote] = useState('')
  const [imageHash, setImageHash] = useState<string | null>(null)
  const [newImage, setNewImage] = useState<PreparedImage | null>(null)
  const [imageBusy, setImageBusy] = useState(false)
  const [imageError, setImageError] = useState<string | null>(null)
  const [nameError, setNameError] = useState<string | null>(null)
  const [openingError, setOpeningError] = useState<string | null>(null)
  const [currencyOpen, setCurrencyOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const filePicker = useRef<HTMLInputElement>(null)

  // Read once, so a sync while the form is open does not overwrite what is being typed.
  useEffect(() => {
    if (walletId === null) return
    let active = true
    void Promise.all([
      db.wallets.get(walletId),
      db.transactions.where('walletId').equals(walletId).filter((t) => t.deletedAt === null).count(),
    ]).then(([wallet, count]) => {
      if (!active) return
      if (!wallet || wallet.deletedAt !== null) {
        leaveSavedForm('/')
        return
      }
      setName(wallet.name)
      setType(wallet.walletType)
      setCurrency(wallet.currencyCode)
      setCurrencyLocked(count > 0)
      setOpening(wallet.openingBalanceMinor === 0 ? '' : toEditable(wallet.openingBalanceMinor))
      setColor(wallet.color)
      setNote(wallet.note ?? '')
      setImageHash(wallet.imageHash)
      setLoaded(true)
    })
    return () => {
      active = false
    }
  }, [walletId])

  const touch = () => setDirty(true)
  const hasImage = newImage !== null || imageHash !== null

  const save = async () => {
    const trimmed = name.trim()
    const parsed = parseMoney(opening, true)
    const nameProblem = trimmed ? null : 'Name is required'
    const openingProblem =
      parsed.type === 'tooManyDecimals' ? 'Max 2 decimals' : parsed.type === 'invalid' ? 'Invalid amount' : null
    setNameError(nameProblem)
    setOpeningError(openingProblem)
    if (nameProblem || openingProblem) return

    setSaving(true)
    const id = await saveWallet(db, {
      id: walletId,
      name: trimmed,
      walletType: type,
      currencyCode: currency,
      openingBalanceMinor: parsed.type === 'ok' ? parsed.minor : 0,
      imageHash,
      newImage,
      color,
      note,
    })
    syncManager.notifyLocalChange()
    leaveSavedForm(walletPath(id))
  }

  return (
    <FormShell
      title={walletId ? 'Edit wallet' : 'New wallet'}
      dirty={dirty}
      discardText={walletId ? 'Your changes to this wallet will be lost.' : 'This wallet will not be saved.'}
      saving={saving || !loaded || imageBusy}
      closeTo={closeTo}
      onSave={save}
    >
      {loaded && (
        <>
          <div className="image-row">
            <WalletAvatar wallet={{ name: name || '?', color, imageHash: newImage ? null : imageHash }} preview={newImage?.blob} large />
            <button type="button" disabled={imageBusy} onClick={() => filePicker.current?.click()}>
              {imageBusy ? 'Processing…' : 'Choose image'}
            </button>
            {hasImage && (
              <button
                type="button"
                className="link"
                onClick={() => {
                  setImageHash(null)
                  setNewImage(null)
                  touch()
                }}
              >
                Remove image
              </button>
            )}
            <input
              ref={filePicker}
              className="hidden-file"
              type="file"
              accept="image/*"
              aria-label="Wallet image file"
              tabIndex={-1}
              onChange={async (e) => {
                const file = e.target.files?.[0]
                e.target.value = ''
                if (!file) return
                setImageBusy(true)
                setImageError(null)
                try {
                  setNewImage(await prepareImage(file))
                  touch()
                } catch {
                  setImageError('This image could not be read.')
                } finally {
                  setImageBusy(false)
                }
              }}
            />
          </div>
          <FieldError id="wallet-image-error" text={imageError} />

          <div className="stack">
            <label htmlFor="wallet-name">Name</label>
            <input
              id="wallet-name"
              autoFocus={!walletId}
              autoComplete="off"
              placeholder="e.g. Tekući račun"
              value={name}
              aria-invalid={!!nameError}
              aria-describedby="wallet-name-error"
              onChange={(e) => {
                setName(e.target.value)
                setNameError(null)
                touch()
              }}
            />
            <FieldError id="wallet-name-error" text={nameError} />
          </div>

          <div className="stack">
            <label htmlFor="wallet-type">Type</label>
            <select
              id="wallet-type"
              value={type}
              onChange={(e) => {
                setType(e.target.value)
                touch()
              }}
            >
              {WALLET_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </div>

          <div className="stack">
            <span>Currency</span>
            <div className="with-suffix">
              <span className="currency-value">{currency} · {currencyName(currency)}</span>
              {!currencyLocked && <button type="button" onClick={() => setCurrencyOpen(true)}>Change</button>}
            </div>
            {currencyLocked && <small className="muted">Locked: the wallet already has transactions</small>}
          </div>

          <div className="stack">
            <label htmlFor="wallet-opening">Opening balance</label>
            <div className="with-suffix">
              <input
                id="wallet-opening"
                inputMode="decimal"
                autoComplete="off"
                placeholder="0,00"
                value={opening}
                aria-invalid={!!openingError}
                aria-describedby="wallet-opening-error"
                onChange={(e) => {
                  setOpening(e.target.value)
                  setOpeningError(null)
                  touch()
                }}
              />
              <span className="muted">{currency}</span>
            </div>
            {openingError
              ? <FieldError id="wallet-opening-error" text={openingError} />
              : <small className="muted">Balance before the first recorded transaction</small>}
          </div>

          <div className="stack">
            <span id="wallet-color-label">Color</span>
            <div className="swatches" role="radiogroup" aria-labelledby="wallet-color-label">
              {(SWATCHES.includes(color) ? SWATCHES : [color, ...SWATCHES]).map((swatch) => {
                const hex = argbToHex(swatch)
                return (
                  <button
                    key={swatch}
                    type="button"
                    role="radio"
                    aria-checked={swatch === color}
                    aria-label={`Color ${hex}`}
                    className={swatch === color ? 'color-dot on' : 'color-dot'}
                    style={{ backgroundColor: hex }}
                    onClick={() => {
                      setColor(swatch)
                      touch()
                    }}
                  />
                )
              })}
            </div>
          </div>

          <div className="stack">
            <label htmlFor="wallet-note">Note</label>
            <textarea
              id="wallet-note"
              rows={2}
              value={note}
              onChange={(e) => {
                setNote(e.target.value)
                touch()
              }}
            />
          </div>

          {currencyOpen && (
            <CurrencyPicker
              onClose={() => setCurrencyOpen(false)}
              onPick={(code) => {
                setCurrency(code)
                touch()
              }}
            />
          )}
        </>
      )}
    </FormShell>
  )
}
