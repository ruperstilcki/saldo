import { useMemo, useState, type ReactNode } from 'react'
import { formatDate, monthOf, monthTitle, yearMonthOf, yearOf } from '../core/dates'
import { formatMoney, formatSigned } from '../core/money'
import type { Category, Transaction, Wallet } from '../db/types'
import { noteForTable } from '../domain/noteDisplay'
import { buildRows } from '../domain/rows'
import { computeStats, nextMonth, type CategoryTotal, type MonthTotals } from '../domain/stats'
import { UNCATEGORIZED } from '../domain/txFilter'
import { chartScale, formatAxis } from '../ui/chartScale'
import { argbToHex } from '../ui/monthTints'
import { navigate, searchPath } from './router'
import { sortedCurrencies } from './SearchPage'

type StatsPeriod = 'LAST_12' | 'THIS_YEAR' | 'LAST_YEAR' | 'ALL'
const PERIODS: [StatsPeriod, string][] = [['LAST_12', 'Last 12 months'], ['THIS_YEAR', 'This year'], ['LAST_YEAR', 'Last year'], ['ALL', 'All time']]
const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

interface Props {
  walletId: string | null
  wallets: Wallet[]
  transactions: Transaction[]
  categories: Category[]
}

export function StatisticsPage({ walletId: initialWallet, wallets, transactions, categories }: Props) {
  const live = useMemo(() => wallets.filter((w) => w.deletedAt === null), [wallets])
  const [walletId, setWalletId] = useState(initialWallet)
  const [chosenCurrency, setChosenCurrency] = useState<string | null>(null)
  const [period, setPeriod] = useState<StatsPeriod>('LAST_12')
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null)

  const wallet = walletId ? live.find((w) => w.id === walletId) : undefined
  const currencies = useMemo(() => sortedCurrencies(live), [live])
  const currency = wallet?.currencyCode
    ?? (chosenCurrency && currencies.includes(chosenCurrency) ? chosenCurrency : currencies.includes('RSD') ? 'RSD' : currencies[0] ?? '')

  const rows = useMemo(() => {
    const ids = new Set(live.filter((w) => (wallet ? w.id === wallet.id : w.currencyCode === currency)).map((w) => w.id))
    const names = new Map(live.map((w) => [w.id, w.name]))
    return buildRows(transactions.filter((t) => ids.has(t.walletId)), categories).map((r) => ({ ...r, walletName: names.get(r.walletId) }))
  }, [live, wallet, currency, transactions, categories])

  const liveCategories = useMemo(() => categories.filter((c) => c.deletedAt === null), [categories])
  const now = yearMonthOf(Date.now())
  const [from, to] = useMemo((): [string, string] => {
    const year = yearOf(now)
    switch (period) {
      case 'LAST_12': return [nextMonth(now, -11), now]
      case 'THIS_YEAR': return [`${year}-01`, now]
      case 'LAST_YEAR': return [`${year - 1}-01`, `${year - 1}-12`]
      case 'ALL': return [rows.length ? yearMonthOf(rows[rows.length - 1]!.occurredAt) : now, now]
    }
  }, [period, now, rows])

  const month = selectedMonth && selectedMonth >= from && selectedMonth <= to ? selectedMonth : null
  const stats = useMemo(() => computeStats(rows, liveCategories, from, to, month), [rows, liveCategories, from, to, month])
  const periodLabel = month ? monthTitle(month) : PERIODS.find(([value]) => value === period)![1]
  const totalIn = stats.months.reduce((sum, m) => sum + m.inMinor, 0)
  const totalOut = stats.months.reduce((sum, m) => sum + m.outMinor, 0)

  const openTransactions = (categoryId: string | null) => {
    const [startYear, startMonth] = (month ?? from).split('-').map(Number) as [number, number]
    const [endYear, endMonth] = (month ?? to).split('-').map(Number) as [number, number]
    navigate(searchPath({
      currency,
      wallet: wallet?.id ?? null,
      category: categoryId ?? UNCATEGORIZED,
      from: { year: startYear, month: startMonth, day: 1 },
      to: { year: endYear, month: endMonth, day: new Date(endYear, endMonth, 0).getDate() },
    }))
  }

  return (
    <main className="page stats-page">
      <header className="page-header">
        <h1>Statistics</h1>
        <div className="stats-filters">
          <select
            aria-label="Wallet"
            value={wallet?.id ?? ''}
            onChange={(e) => {
              setWalletId(e.target.value || null)
              setSelectedMonth(null)
            }}
          >
            <option value="">All wallets</option>
            {live.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
          {!wallet && currencies.length > 1 && (
            <select
              aria-label="Currency"
              value={currency}
              onChange={(e) => {
                setChosenCurrency(e.target.value)
                setSelectedMonth(null)
              }}
            >
              {currencies.map((code) => <option key={code} value={code}>{code}</option>)}
            </select>
          )}
          <div className="chips" role="group" aria-label="Period">
            {PERIODS.map(([value, label]) => (
              <button
                key={value}
                className={value === period ? 'quick-chip on' : 'quick-chip'}
                aria-pressed={value === period}
                onClick={() => {
                  setPeriod(value)
                  setSelectedMonth(null)
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="stats-grid">
        <section className="stat-card" aria-label="Monthly spending">
          <h2>Monthly spending</h2>
          <p className="muted">Average {formatMoney(stats.averageOutMinor)} {currency}. Choose a month for its details.</p>
          <SpendingChart months={stats.months} average={stats.averageOutMinor} selected={month} currency={currency} onSelect={(m) => setSelectedMonth(m === month ? null : m)} />
          {month && <p className="strong">{monthTitle(month)}: {formatMoney(stats.months.find((m) => m.yearMonth === month)!.outMinor)} {currency}</p>}
          <MonthTable months={stats.months} currency={currency} />
        </section>

        <section className="stat-card" aria-label="Income vs expense">
          <h2>Income vs expense</h2>
          <p className="muted">In {formatMoney(totalIn)} · Out {formatMoney(totalOut)} · Net {formatMoney(totalIn - totalOut)} {currency}</p>
          <IncomeExpenseChart months={stats.months} currency={currency} />
        </section>

        <section className="stat-card" aria-label="By category">
          <h2>By category · {periodLabel}</h2>
          <p className="muted">Spent {formatMoney(stats.totalOutMinor)} {currency} · income {formatMoney(stats.totalInMinor)}</p>
          {stats.byCategory.length === 0 && <p>No expenses in this period.</p>}
          <ul className="category-totals">
            {stats.byCategory.map((total) => <CategoryRow key={total.id ?? 'none'} total={total} onOpen={openTransactions} />)}
          </ul>
        </section>

        <section className="stat-card" aria-label="Top expenses">
          <h2>Top {stats.topExpenses.length} expenses · {periodLabel}</h2>
          <ol className="top-list">
            {stats.topExpenses.map((row) => (
              <li key={row.id}>
                <span className="top-text">
                  <span>{noteForTable(row.note) || '—'}</span>
                  <small className="muted">
                    {formatDate(row.occurredAt)}
                    {row.categoryName ? ` · ${row.categoryName}` : ''}
                    {!wallet && row.walletName ? ` · ${row.walletName}` : ''}
                  </small>
                </span>
                <span className="tx-amount">
                  <span className="swatch" style={row.categoryColor === null ? undefined : { backgroundColor: argbToHex(row.categoryColor) }} />
                  {formatSigned(row.amountMinor, false)}
                </span>
              </li>
            ))}
          </ol>
        </section>
      </div>
      <p className="muted stats-note">Transfers and categories marked "exclude from statistics" (e.g. Balance adjustment) are not counted.</p>
    </main>
  )
}

/** Up to a year every month has a label; beyond that January and every third month. */
function monthLabel(yearMonth: string, index: number, count: number): { wide: string; narrow: string } {
  const month = monthOf(yearMonth)
  const short = SHORT_MONTHS[month - 1]!
  if (count <= 13) return { wide: short, narrow: short[0]! }
  if (month === 1) {
    const year = `'${String(yearOf(yearMonth)).slice(2)}`
    return { wide: year, narrow: year }
  }
  return index % 3 === 0 && count <= 40 ? { wide: short, narrow: '' } : { wide: '', narrow: '' }
}

interface PlotProps {
  months: MonthTotals[]
  maxMinor: number
  ticks: number[]
  overlay?: ReactNode
  renderColumn: (month: MonthTotals, index: number, label: ReactNode) => ReactNode
}

/** One shared frame for both charts: a single axis, hairline grid, one column per month. */
function Plot({ months, maxMinor, ticks, overlay, renderColumn }: PlotProps) {
  return (
    <div className="plot">
      <div className="plot-axis" aria-hidden="true">
        {ticks.map((tick) => <span key={tick} style={{ bottom: `${(tick / maxMinor) * 100}%` }}>{formatAxis(tick)}</span>)}
      </div>
      <div className="plot-area">
        <div className="plot-canvas">
          {ticks.map((tick) => <span key={tick} className="grid-line" style={{ bottom: `${(tick / maxMinor) * 100}%` }} />)}
          {overlay}
        </div>
        <div className="plot-columns">
          {months.map((month, index) => {
            const label = monthLabel(month.yearMonth, index, months.length)
            return renderColumn(month, index, (
              <span className="col-label" aria-hidden="true">
                <span className="label-wide">{label.wide}</span>
                <span className="label-narrow">{label.narrow}</span>
              </span>
            ))
          })}
        </div>
      </div>
    </div>
  )
}

interface SpendingProps {
  months: MonthTotals[]
  average: number
  selected: string | null
  currency: string
  onSelect: (yearMonth: string) => void
}

function SpendingChart({ months, average, selected, currency, onSelect }: SpendingProps) {
  const { maxMinor, ticks } = useMemo(() => chartScale(Math.max(0, ...months.map((m) => m.outMinor))), [months])
  const averageLine = average > 0 && (
    <span className="average-line" style={{ bottom: `${(average / maxMinor) * 100}%` }}>
      <span className="average-label">avg</span>
    </span>
  )
  return (
    <Plot
      months={months}
      maxMinor={maxMinor}
      ticks={ticks}
      overlay={averageLine}
      renderColumn={(month, _index, label) => {
        const text = `${monthTitle(month.yearMonth)}: ${formatMoney(month.outMinor)} ${currency}`
        return (
          <button
            key={month.yearMonth}
            className={selected && selected !== month.yearMonth ? 'column dim' : 'column'}
            aria-label={text}
            aria-pressed={selected === month.yearMonth}
            onClick={() => onSelect(month.yearMonth)}
          >
            <span className="tip" role="tooltip">{text}</span>
            <span className="bars"><span className="chart-bar series-out" style={{ height: `${(month.outMinor / maxMinor) * 100}%` }} /></span>
            {label}
          </button>
        )
      }}
    />
  )
}

function IncomeExpenseChart({ months, currency }: { months: MonthTotals[]; currency: string }) {
  const { maxMinor, ticks } = useMemo(() => chartScale(Math.max(0, ...months.flatMap((m) => [m.inMinor, m.outMinor]))), [months])
  return (
    <>
      <div className="legend">
        <span><span className="legend-mark series-in" /> In</span>
        <span><span className="legend-mark series-out" /> Out</span>
      </div>
      <Plot
        months={months}
        maxMinor={maxMinor}
        ticks={ticks}
        renderColumn={(month, _index, label) => {
          const text = `${monthTitle(month.yearMonth)}: in ${formatMoney(month.inMinor)}, out ${formatMoney(month.outMinor)}, net ${formatMoney(month.netMinor)} ${currency}`
          return (
            <div key={month.yearMonth} className="column" tabIndex={0} role="img" aria-label={text}>
              <span className="tip" role="tooltip">
                <strong>{monthTitle(month.yearMonth)}</strong><br />
                In {formatMoney(month.inMinor)}<br />
                Out {formatMoney(month.outMinor)}<br />
                Net {formatMoney(month.netMinor)} {currency}
              </span>
              <span className="bars pair">
                <span className="chart-bar series-in" style={{ height: `${(month.inMinor / maxMinor) * 100}%` }} />
                <span className="chart-bar series-out" style={{ height: `${(month.outMinor / maxMinor) * 100}%` }} />
              </span>
              {label}
            </div>
          )
        }}
      />
    </>
  )
}

function MonthTable({ months, currency }: { months: MonthTotals[]; currency: string }) {
  return (
    <details className="month-table">
      <summary>Show as table</summary>
      <div className="table-scroll">
        <table>
          <thead><tr><th>Month</th><th>Out</th><th>In</th><th>Net ({currency})</th></tr></thead>
          <tbody>
            {[...months].reverse().map((m) => (
              <tr key={m.yearMonth}>
                <td>{monthTitle(m.yearMonth)}</td>
                <td>{formatMoney(m.outMinor)}</td>
                <td>{formatMoney(m.inMinor)}</td>
                <td>{formatMoney(m.netMinor)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )
}

const percent = (share: number) => `${Math.round(share * 100)} %`

function CategoryRow({ total, onOpen }: { total: CategoryTotal; onOpen: (id: string | null) => void }) {
  const [open, setOpen] = useState(false)
  const color = total.color === null ? undefined : argbToHex(total.color)
  return (
    <li>
      <div className="category-total">
        <span className="swatch" style={color ? { backgroundColor: color } : undefined} />
        <div className="category-total-main">
          {total.subs.length > 0 ? (
            <button className="plain-link" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
              {open ? '▾' : '▸'} {total.name}
            </button>
          ) : (
            <span className="strong">{total.name}</span>
          )}
          <span className="category-amount">{formatMoney(total.amountMinor)} · {percent(total.share)}</span>
          <span className="share-track"><span className="share-fill" style={{ width: `${total.share * 100}%`, ...(color ? { backgroundColor: color } : {}) }} /></span>
        </div>
        <button className="link" aria-label={`Show transactions: ${total.name}`} onClick={() => onOpen(total.id)}>Show</button>
      </div>
      {open && (
        <ul className="category-subs">
          {total.subs.map((sub) => (
            <li key={`${sub.id}-${sub.name}`} className="category-sub">
              <span className="swatch" style={sub.color === null ? undefined : { backgroundColor: argbToHex(sub.color) }} />
              <span className="grow-text">{sub.name}</span>
              <span className="category-amount">{formatMoney(sub.amountMinor)} · {percent(sub.share)}</span>
              <button className="link" aria-label={`Show transactions: ${sub.name}`} onClick={() => onOpen(sub.id)}>Show</button>
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}
