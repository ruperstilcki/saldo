import { useMemo, useState } from 'react'
import { COMMON_CURRENCIES } from '../core/currencies'
import type { Category, Transaction, Wallet } from '../db/types'
import { buildRows } from '../domain/rows'
import { buildTable } from '../domain/tableModel'
import { applyFilter, EMPTY_FILTER, searchText, summarizeFilter, type TxFilter } from '../domain/txFilter'
import { FilterBar, SummaryBar } from './FilterBar'
import type { SearchParams } from './router'
import { TransactionDetails } from './TransactionDetails'
import { TxTable } from './TxTable'

interface Props {
  params: SearchParams
  wallets: Wallet[]
  transactions: Transaction[]
  categories: Category[]
  onDeleteTransaction: (id: string) => void
}

/** All wallets of one currency: amounts in different currencies are never added together. */
export function SearchPage({ params, wallets, transactions, categories, onDeleteTransaction }: Props) {
  const live = useMemo(() => wallets.filter((w) => w.deletedAt === null), [wallets])
  const currencies = useMemo(() => sortedCurrencies(live), [live])
  const [chosenCurrency, setChosenCurrency] = useState(params.currency)
  const currency = chosenCurrency && currencies.includes(chosenCurrency) ? chosenCurrency : currencies.includes('RSD') ? 'RSD' : currencies[0] ?? ''

  const [filter, setFilter] = useState<TxFilter>(() => ({
    ...EMPTY_FILTER,
    period: params.from ? 'CUSTOM' : 'ALL',
    customFrom: params.from,
    customTo: params.to,
    categoryIds: new Set(params.category ? [params.category] : []),
  }))
  const [overrides, setOverrides] = useState<Record<string, boolean>>({})
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const liveCategories = useMemo(() => categories.filter((c) => c.deletedAt === null), [categories])
  const walletsById = useMemo(() => new Map(live.map((w) => [w.id, w])), [live])
  const rows = useMemo(() => {
    const inScope = transactions.filter((t) => {
      const wallet = walletsById.get(t.walletId)
      return wallet?.currencyCode === currency && (!params.wallet || t.walletId === params.wallet)
    })
    return buildRows(inScope, categories).map((r) => ({ ...r, walletName: walletsById.get(r.walletId)?.name }))
  }, [transactions, walletsById, currency, params.wallet, categories])
  const texts = useMemo(() => new Map(rows.map((r) => [r.id, searchText(r)])), [rows])
  const found = useMemo(() => applyFilter(rows, filter, liveCategories, new Date(), (r) => texts.get(r.id)!), [rows, filter, liveCategories, texts])
  const items = useMemo(() => buildTable(found, 0, (key) => overrides[key] ?? false), [found, overrides])

  const selected = selectedId ? rows.find((r) => r.id === selectedId) : undefined
  const selectedWallet = selected ? walletsById.get(selected.walletId) : undefined

  return (
    <main className="page search-page">
      <header className="page-header">
        <h1>Search{params.wallet && walletsById.get(params.wallet) ? `: ${walletsById.get(params.wallet)!.name}` : ''}</h1>
        {!params.wallet && currencies.length > 1 && (
          <div className="chips" role="group" aria-label="Currency">
            {currencies.map((code) => (
              <button key={code} className={code === currency ? 'quick-chip on' : 'quick-chip'} aria-pressed={code === currency} onClick={() => setChosenCurrency(code)}>
                {code}
              </button>
            ))}
          </div>
        )}
      </header>
      <FilterBar filter={filter} categories={liveCategories} onChange={setFilter} />
      {found.length === 0 ? (
        <p className="pane-empty muted">Nothing found.</p>
      ) : (
        <TxTable
          items={items}
          currency={currency}
          showBalance={false}
          showWallet={!params.wallet}
          onToggle={(key) => setOverrides((current) => ({ ...current, [key]: !(current[key] ?? false) }))}
          onOpen={setSelectedId}
        />
      )}
      <SummaryBar summary={summarizeFilter(found)} currency={currency} />
      {selected && selectedWallet && (
        <TransactionDetails
          row={selected}
          wallet={selectedWallet}
          isChecker={selectedWallet.checkerTransactionId === selected.id}
          onClose={() => setSelectedId(null)}
          onDelete={(id) => {
            setSelectedId(null)
            onDeleteTransaction(id)
          }}
        />
      )}
    </main>
  )
}

export function sortedCurrencies(wallets: Wallet[]): string[] {
  const rank = (code: string) => (COMMON_CURRENCIES.includes(code) ? COMMON_CURRENCIES.indexOf(code) : Infinity)
  return [...new Set(wallets.map((w) => w.currencyCode))].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
}
