import { useMemo, useState } from 'react'
import { searchCurrencies } from '../core/currencies'
import { Modal } from './Common'

export function CurrencyPicker({ onPick, onClose }: { onPick: (code: string) => void; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const results = useMemo(() => searchCurrencies(query), [query])
  return (
    <Modal label="Choose currency" onClose={onClose}>
      <h2>Choose currency</h2>
      <input
        autoFocus
        aria-label="Search currencies"
        placeholder="Code or name, e.g. eur"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            if (results[0]) {
              onPick(results[0].code)
              onClose()
            }
          }
        }}
      />
      <ul className="currency-list">
        {results.map((currency) => (
          <li key={currency.code}>
            <button
              type="button"
              className="suggestion"
              onClick={() => {
                onPick(currency.code)
                onClose()
              }}
            >
              <strong>{currency.code}</strong> {currency.name}
            </button>
          </li>
        ))}
        {results.length === 0 && <li className="muted">Nothing found.</li>}
      </ul>
      <div className="actions">
        <button type="button" onClick={onClose}>Cancel</button>
      </div>
    </Modal>
  )
}
