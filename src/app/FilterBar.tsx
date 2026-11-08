import { useMemo, useState } from 'react'
import { formatDate, parseDateText, type DateParts } from '../core/dates'
import { formatMoney, formatSigned, parseMoney, toEditable } from '../core/money'
import type { Category } from '../db/types'
import { EMPTY_FILTER, isFilterEmpty, UNCATEGORIZED, type FilterSummary, type PeriodPreset, type TxFilter, type TypeFilter } from '../domain/txFilter'
import { argbToHex } from '../ui/monthTints'
import { Modal } from './Common'

const PERIODS: [PeriodPreset, string][] = [
  ['ALL', 'All time'], ['THIS_MONTH', 'This month'], ['LAST_MONTH', 'Last month'], ['THIS_YEAR', 'This year'], ['LAST_YEAR', 'Last year'], ['CUSTOM', 'Custom…'],
]
const TYPES: [TypeFilter, string][] = [['ALL', 'In and out'], ['OUT', 'Out'], ['IN', 'In']]

const toText = (date: DateParts | null) => (date ? formatDate(new Date(date.year, date.month - 1, date.day).getTime()) : '')

interface Props {
  filter: TxFilter
  categories: Category[]
  onChange: (filter: TxFilter) => void
}

/** Everything in one row on a wide screen, wrapping on a phone. */
export function FilterBar({ filter, categories, onChange }: Props) {
  // Text as typed: a half-typed value must not disappear or be reformatted.
  const [from, setFrom] = useState(toText(filter.customFrom))
  const [to, setTo] = useState(toText(filter.customTo))
  const [min, setMin] = useState(filter.minMinor === null ? '' : toEditable(filter.minMinor))
  const [max, setMax] = useState(filter.maxMinor === null ? '' : toEditable(filter.maxMinor))
  const [choosingCategories, setChoosingCategories] = useState(false)

  const amount = (text: string) => {
    const parsed = parseMoney(text)
    return parsed.type === 'ok' ? parsed.minor : null
  }
  const badAmount = (text: string) => text.trim() !== '' && amount(text) === null

  return (
    <div className="filters" role="search">
      <input
        className="filter-query"
        autoFocus
        aria-label="Search"
        placeholder="Search note, category or amount"
        value={filter.query}
        onChange={(e) => onChange({ ...filter, query: e.target.value })}
      />
      <select aria-label="Period" value={filter.period} onChange={(e) => onChange({ ...filter, period: e.target.value as PeriodPreset })}>
        {PERIODS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
      {filter.period === 'CUSTOM' && (
        <>
          <input
            className="filter-small"
            aria-label="From date"
            placeholder="dd.MM.yyyy"
            value={from}
            aria-invalid={from.trim() !== '' && !parseDateText(from)}
            onChange={(e) => {
              setFrom(e.target.value)
              onChange({ ...filter, customFrom: parseDateText(e.target.value) })
            }}
          />
          <input
            className="filter-small"
            aria-label="To date"
            placeholder="dd.MM.yyyy"
            value={to}
            aria-invalid={to.trim() !== '' && !parseDateText(to)}
            onChange={(e) => {
              setTo(e.target.value)
              onChange({ ...filter, customTo: parseDateText(e.target.value) })
            }}
          />
        </>
      )}
      <select aria-label="Type" value={filter.type} onChange={(e) => onChange({ ...filter, type: e.target.value as TypeFilter })}>
        {TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
      <input
        className="filter-small"
        inputMode="decimal"
        aria-label="Minimum amount"
        placeholder="Min"
        value={min}
        aria-invalid={badAmount(min)}
        onChange={(e) => {
          setMin(e.target.value)
          onChange({ ...filter, minMinor: amount(e.target.value) })
        }}
      />
      <input
        className="filter-small"
        inputMode="decimal"
        aria-label="Maximum amount"
        placeholder="Max"
        value={max}
        aria-invalid={badAmount(max)}
        onChange={(e) => {
          setMax(e.target.value)
          onChange({ ...filter, maxMinor: amount(e.target.value) })
        }}
      />
      <button type="button" onClick={() => setChoosingCategories(true)}>
        {filter.categoryIds.size === 0 ? 'Category' : `Category (${filter.categoryIds.size})`}
      </button>
      {!isFilterEmpty(filter) && (
        <button
          type="button"
          className="link"
          onClick={() => {
            setFrom('')
            setTo('')
            setMin('')
            setMax('')
            onChange(EMPTY_FILTER)
          }}
        >
          Clear
        </button>
      )}
      {choosingCategories && (
        <CategoryChoice
          selected={filter.categoryIds}
          categories={categories}
          onClose={() => setChoosingCategories(false)}
          onApply={(categoryIds) => {
            onChange({ ...filter, categoryIds })
            setChoosingCategories(false)
          }}
        />
      )}
    </div>
  )
}

interface ChoiceProps {
  selected: ReadonlySet<string>
  categories: Category[]
  onClose: () => void
  onApply: (ids: ReadonlySet<string>) => void
}

/** Several can be chosen. A main includes all its subs, so they show as already chosen. */
function CategoryChoice({ selected, categories, onClose, onApply }: ChoiceProps) {
  const [chosen, setChosen] = useState<ReadonlySet<string>>(selected)
  const lines = useMemo(() => {
    const mains = categories.filter((c) => c.level === 'MAIN').sort((a, b) => a.sortOrder - b.sortOrder)
    const mainIds = new Set(mains.map((m) => m.id))
    const unlinked = categories.filter((c) => c.level === 'SUB' && !(c.parentId && mainIds.has(c.parentId)))
    return [
      { id: UNCATEGORIZED, name: 'Uncategorized', color: null as number | null, parentId: null as string | null, bold: false },
      ...mains.flatMap((main) => [
        { id: main.id, name: main.name, color: main.color, parentId: null, bold: true },
        ...categories.filter((c) => c.parentId === main.id).map((c) => ({ id: c.id, name: c.name, color: c.color ?? main.color, parentId: main.id, bold: false })),
      ]),
      ...unlinked.map((c) => ({ id: c.id, name: `${c.name} (Unlinked)`, color: c.color, parentId: null, bold: false })),
    ]
  }, [categories])

  return (
    <Modal label="Categories" onClose={onClose}>
      <h2>Categories</h2>
      <ul className="category-choice">
        {lines.map((line) => {
          const viaParent = line.parentId !== null && chosen.has(line.parentId)
          return (
            <li key={line.id} className={line.parentId ? 'indented' : undefined}>
              <label>
                <input
                  type="checkbox"
                  checked={chosen.has(line.id) || viaParent}
                  disabled={viaParent}
                  onChange={() => {
                    const next = new Set(chosen)
                    if (next.has(line.id)) next.delete(line.id)
                    else next.add(line.id)
                    setChosen(next)
                  }}
                />
                <span className="swatch" style={line.color === null ? undefined : { backgroundColor: argbToHex(line.color) }} />
                <span className={line.bold ? 'strong' : undefined}>{line.name}</span>
              </label>
            </li>
          )
        })}
      </ul>
      <div className="actions">
        <button type="button" onClick={() => onApply(new Set())}>Clear</button>
        <button type="button" onClick={onClose}>Cancel</button>
        <button type="button" className="primary" onClick={() => onApply(chosen)}>Apply</button>
      </div>
    </Modal>
  )
}

export function SummaryBar({ summary, currency }: { summary: FilterSummary; currency: string }) {
  return (
    <p className="summary" aria-label="Summary">
      <strong>{summary.count === 1 ? '1 item' : `${summary.count} items`}</strong>
      <span>Out {formatSigned(summary.outMinor, false)}</span>
      <span>In {formatSigned(summary.inMinor, true)}</span>
      <span>Net {formatMoney(summary.netMinor)} {currency}</span>
    </p>
  )
}
