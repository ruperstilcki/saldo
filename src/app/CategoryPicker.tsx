import { useId, useMemo, useState } from 'react'
import type { Category } from '../db/types'
import { canCreateCategory, categoryOptions, kindAllows, suggestCategories, type CategoryOption } from '../domain/categorySuggest'
import { argbToHex } from '../ui/monthTints'

interface Props {
  selectedId: string | null
  categories: Category[]
  usage: Map<string, number>
  income: boolean
  showQuickPicks: boolean
  /** False while the account has no categories at all: the phone must create the initial ones first. */
  allowCreate: boolean
  onSelect: (id: string | null) => void
  onCreate: (name: string) => void
}

const Swatch = ({ color }: { color: number | null }) => (
  <span className="swatch" style={color === null ? undefined : { backgroundColor: argbToHex(color) }} />
)

function selectedText(option: CategoryOption) {
  if (option.parentName) return `${option.name} › ${option.parentName}`
  return option.unlinked ? `${option.name} (Unlinked)` : option.name
}

/** The category field: autocomplete with "+ Create", quick chips, and what is selected. Category is optional. */
export function CategoryPicker({ selectedId, categories, usage, income, showQuickPicks, allowCreate, onSelect, onCreate }: Props) {
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const fieldId = useId()

  const options = useMemo(() => new Map(categoryOptions(categories).map((o) => [o.id, o])), [categories])
  const suggestions = useMemo(
    () => suggestCategories(query, categories, usage, income, showQuickPicks),
    [query, categories, usage, income, showQuickPicks],
  )
  const canCreate = allowCreate && canCreateCategory(query, categories)
  const quick = useMemo(() => {
    const kinds = new Map(categories.map((c) => [c.id, c.kind]))
    return [...options.values()]
      .filter((o) => o.isQuickPick && kindAllows(kinds.get(o.id)!, income))
      .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
  }, [categories, options, income])

  const count = suggestions.length + (canCreate ? 1 : 0)
  const selected = selectedId ? options.get(selectedId) : undefined

  const reset = () => {
    setQuery('')
    setHighlight(0)
  }
  const choose = (index: number) => {
    const option = suggestions[index]
    if (option) onSelect(option.id)
    else if (canCreate) onCreate(query.trim())
    reset()
  }

  return (
    <div className="category-picker">
      <label className="stack" htmlFor={fieldId}>Category</label>
      <input
        id={fieldId}
        value={query}
        autoComplete="off"
        placeholder="Type to search, e.g. maxi"
        aria-expanded={count > 0}
        role="combobox"
        aria-autocomplete="list"
        onChange={(e) => {
          setQuery(e.target.value)
          setHighlight(0)
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && count > 0) {
            e.preventDefault()
            setHighlight((h) => (h + 1) % count)
          } else if (e.key === 'ArrowUp' && count > 0) {
            e.preventDefault()
            setHighlight((h) => (h - 1 + count) % count)
          } else if (e.key === 'Enter' && count > 0) {
            // Enter picks the category here, it must not save the form.
            e.preventDefault()
            choose(highlight)
          } else if (e.key === 'Escape' && query) {
            e.stopPropagation()
            reset()
          }
        }}
      />
      {count > 0 && (
        <ul className="suggestions" role="listbox" aria-label="Category suggestions">
          {suggestions.map((option, index) => (
            <li key={option.id} role="option" aria-selected={index === highlight}>
              <button type="button" className={index === highlight ? 'suggestion active' : 'suggestion'} onClick={() => choose(index)}>
                <Swatch color={option.color} />
                {option.label}
              </button>
            </li>
          ))}
          {canCreate && (
            <li role="option" aria-selected={highlight === suggestions.length}>
              <button
                type="button"
                className={highlight === suggestions.length ? 'suggestion active' : 'suggestion'}
                onClick={() => choose(suggestions.length)}
              >
                + Create "{query.trim()}"
              </button>
            </li>
          )}
        </ul>
      )}

      {quick.length > 0 && (
        <div className="quick-chips" role="group" aria-label="Quick picks">
          {quick.map((option) => (
            <button
              key={option.id}
              type="button"
              className={option.id === selectedId ? 'quick-chip on' : 'quick-chip'}
              aria-pressed={option.id === selectedId}
              onClick={() => onSelect(option.id === selectedId ? null : option.id)}
            >
              <Swatch color={option.color} />
              {option.name}
            </button>
          ))}
        </div>
      )}

      <div className="selected-category">
        <span className={selected ? 'muted' : 'muted none'}>{selected ? `Selected: ${selectedText(selected)}` : 'No category'}</span>
        {selected && <button type="button" className="link" onClick={() => onSelect(null)}>Clear</button>}
      </div>
    </div>
  )
}
