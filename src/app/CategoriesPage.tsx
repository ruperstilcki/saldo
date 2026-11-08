import { useMemo, useState } from 'react'
import { fold } from '../core/strings'
import {
  createCategory, deleteCategory, keywordsToStored, keywordsToText, mergeCategory, updateCategory,
} from '../data/categories'
import { db } from '../db/db'
import type { Category, Transaction } from '../db/types'
import { argbToHex, hexToArgb } from '../ui/monthTints'
import { ConfirmDialog, Modal, SavedCheckbox } from './Common'
import { FieldError } from './FormShell'
import { syncManager } from './services'

const SWATCHES = [
  '#E53935', '#D81B60', '#8E24AA', '#5E35B1', '#3949AB', '#1E88E5', '#039BE5', '#00ACC1',
  '#00897B', '#43A047', '#7CB342', '#C0CA33', '#FDD835', '#FB8C00', '#6D4C41', '#757575',
].map(hexToArgb)

const KINDS: [string, string][] = [['EXPENSE', 'Expense'], ['INCOME', 'Income'], ['BOTH', 'Both']]
const transactionCount = (count: number) => (count === 1 ? '1 transaction' : `${count} transactions`)
const byName = (a: Category, b: Category) => a.name.toLowerCase().localeCompare(b.name.toLowerCase())

type Tab = 'MAIN' | 'SUB' | 'UNLINKED'

interface Props {
  categories: Category[]
  transactions: Transaction[]
  /** False while the account has no rows at all: the phone must create the initial categories first. */
  canCreate: boolean
}

export function CategoriesPage({ categories, transactions, canCreate }: Props) {
  const [tab, setTab] = useState<Tab>('MAIN')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const live = useMemo(
    () => categories.filter((c) => c.deletedAt === null).sort((a, b) => a.sortOrder - b.sortOrder || byName(a, b)),
    [categories],
  )
  const mains = useMemo(() => live.filter((c) => c.level === 'MAIN'), [live])
  const subs = useMemo(() => live.filter((c) => c.level === 'SUB'), [live])
  const unlinked = useMemo(() => {
    const ids = new Set(mains.map((m) => m.id))
    return subs.filter((s) => !s.parentId || !ids.has(s.parentId))
  }, [mains, subs])
  const usage = useMemo(() => {
    const counts = new Map<string, number>()
    for (const t of transactions) {
      if (t.deletedAt === null && t.categoryId) counts.set(t.categoryId, (counts.get(t.categoryId) ?? 0) + 1)
    }
    return counts
  }, [transactions])

  const countOf = (c: Category) =>
    (usage.get(c.id) ?? 0) + (c.level === 'MAIN' ? subs.filter((s) => s.parentId === c.id).reduce((sum, s) => sum + (usage.get(s.id) ?? 0), 0) : 0)
  const nameOf = (id: string | null) => live.find((c) => c.id === id)?.name
  const editing = live.find((c) => c.id === editingId)

  const row = (category: Category, indent: boolean, showParent: boolean) => {
    const parentColor = live.find((c) => c.id === category.parentId)?.color ?? null
    const color = category.color ?? parentColor
    const detail = [
      showParent ? nameOf(category.parentId) ?? 'Unlinked' : null,
      transactionCount(countOf(category)),
      category.excludeFromStats ? 'not in statistics' : null,
    ].filter(Boolean).join(' · ')
    return (
      <li key={category.id} className={indent ? 'category-row indented' : 'category-row'}>
        <button className="category-open" onClick={() => setEditingId(category.id)}>
          <span className="swatch" style={color === null ? undefined : { backgroundColor: argbToHex(color) }} />
          <span className="category-text">
            <span className={category.level === 'MAIN' ? 'strong' : undefined}>{category.name}</span>
            <small className="muted">{detail}</small>
          </span>
        </button>
        <label className="quick-toggle">
          <SavedCheckbox
            label={`Quick pick: ${category.name}`}
            checked={category.isQuickPick}
            onSave={async (isQuickPick) => {
              await updateCategory(db, category.id, { isQuickPick })
              syncManager.notifyLocalChange()
            }}
          />
          Quick
        </label>
      </li>
    )
  }

  const TABS: [Tab, string][] = [['MAIN', 'Main'], ['SUB', 'Sub'], ['UNLINKED', `Unlinked (${unlinked.length})`]]

  return (
    <main className="page">
      <header className="page-header">
        <h1>Categories</h1>
        <span className="spacer" />
        {canCreate && <button className="primary" onClick={() => setCreating(true)}>New category</button>}
      </header>
      {!canCreate && <p className="notice">No categories yet. Open Saldo on your phone once to create them.</p>}
      <div className="tabs" role="tablist" aria-label="Category groups">
        {TABS.map(([value, label]) => (
          <button key={value} role="tab" aria-selected={tab === value} className={tab === value ? 'on' : ''} onClick={() => setTab(value)}>{label}</button>
        ))}
      </div>
      <div className="page-scroll">
        <ul className="category-list">
          {tab === 'MAIN' && mains.flatMap((main) => [row(main, false, false), ...subs.filter((s) => s.parentId === main.id).map((s) => row(s, true, false))])}
          {tab === 'SUB' && [...subs].sort(byName).map((s) => row(s, false, true))}
          {tab === 'UNLINKED' && unlinked.map((s) => row(s, false, false))}
        </ul>
        {tab === 'UNLINKED' && unlinked.length === 0 && (
          <p className="muted empty">No unlinked categories. Categories you create from the transaction form land here until you link them.</p>
        )}
      </div>

      {editing && (
        <EditCategory
          key={editing.id}
          original={editing}
          all={live}
          mains={mains}
          count={countOf(editing)}
          onClose={() => setEditingId(null)}
        />
      )}
      {creating && <CreateCategory all={live} mains={mains} onClose={() => setCreating(false)} />}
    </main>
  )
}

const nameIsTaken = (name: string, all: Category[], ownId: string | null) =>
  all.some((c) => c.id !== ownId && fold(c.name) === fold(name.trim()))

function NameField({ value, taken, onChange }: { value: string; taken: boolean; onChange: (value: string) => void }) {
  return (
    <div className="stack">
      <label htmlFor="category-name">Name</label>
      <input id="category-name" autoComplete="off" value={value} aria-invalid={taken || !value.trim()} onChange={(e) => onChange(e.target.value)} />
      <FieldError id="category-name-error" text={taken ? 'Name already exists' : null} />
    </div>
  )
}

function ParentField({ mains, value, onChange }: { mains: Category[]; value: string | null; onChange: (id: string | null) => void }) {
  return (
    <div className="stack">
      <label htmlFor="category-parent">Parent (main category)</label>
      <select id="category-parent" value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">Unlinked</option>
        {mains.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
      </select>
    </div>
  )
}

function KindField({ value, onChange }: { value: string; onChange: (kind: string) => void }) {
  return (
    <div className="stack">
      <label htmlFor="category-kind">Used for</label>
      <select id="category-kind" value={value} onChange={(e) => onChange(e.target.value)}>
        {KINDS.map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}
      </select>
    </div>
  )
}

function LevelField({ value, disabled, onChange }: { value: string; disabled: boolean; onChange: (level: string) => void }) {
  return (
    <div className="stack">
      <label htmlFor="category-level">Level</label>
      <select id="category-level" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        <option value="MAIN">Main</option>
        <option value="SUB">Sub</option>
      </select>
      {disabled && <small className="muted">Has sub-categories, so it stays Main.</small>}
    </div>
  )
}

interface EditProps {
  original: Category
  all: Category[]
  mains: Category[]
  count: number
  onClose: () => void
}

function EditCategory({ original, all, mains, count, onClose }: EditProps) {
  const [name, setName] = useState(original.name)
  const [level, setLevel] = useState(original.level)
  const [parentId, setParentId] = useState(original.parentId)
  const [kind, setKind] = useState(original.kind)
  const [isQuickPick, setIsQuickPick] = useState(original.isQuickPick)
  const [excludeFromStats, setExcludeFromStats] = useState(original.excludeFromStats)
  const [color, setColor] = useState(original.color)
  const [keywords, setKeywords] = useState(keywordsToText(original.matchKeywords))
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [merging, setMerging] = useState(false)

  const hasChildren = all.some((c) => c.parentId === original.id)
  const taken = nameIsTaken(name, all, original.id)
  const parentName = all.find((c) => c.id === original.parentId)?.name

  const finish = () => {
    syncManager.notifyLocalChange()
    onClose()
  }
  const targets = all.filter((c) => c.id !== original.id && c.level === original.level).sort(byName)

  return (
    <Modal label="Edit category" onClose={onClose} wide>
      <form
        className="form"
        noValidate
        onSubmit={async (e) => {
          e.preventDefault()
          if (taken || !name.trim()) return
          await updateCategory(db, original.id, {
            name, level, parentId, kind, isQuickPick, excludeFromStats, color, matchKeywords: keywordsToStored(keywords),
          })
          finish()
        }}
      >
        <header className="form-header">
          <button type="button" aria-label="Close" onClick={onClose}>✕</button>
          <h2>Edit category</h2>
          <span className="spacer" />
          <button type="submit" className="primary" disabled={taken || !name.trim()}>Save</button>
        </header>
        <NameField value={name} taken={taken} onChange={setName} />
        <div className="row-fields">
          <div className="grow"><LevelField value={level} disabled={hasChildren} onChange={setLevel} /></div>
          <div className="grow"><KindField value={kind} onChange={setKind} /></div>
        </div>
        {level === 'SUB' && <ParentField mains={mains} value={parentId} onChange={setParentId} />}
        <label className="field">
          <span>Quick pick</span>
          <input type="checkbox" checked={isQuickPick} onChange={(e) => setIsQuickPick(e.target.checked)} />
        </label>
        <label className="field">
          <span>Exclude from statistics</span>
          <input type="checkbox" checked={excludeFromStats} onChange={(e) => setExcludeFromStats(e.target.checked)} />
        </label>
        <div className="stack">
          <span id="category-color-label">Color</span>
          <div className="swatches" role="radiogroup" aria-labelledby="category-color-label">
            <button type="button" role="radio" aria-checked={color === null} aria-label="No color" className={color === null ? 'color-dot none on' : 'color-dot none'} onClick={() => setColor(null)}>⊘</button>
            {SWATCHES.map((swatch) => {
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
                  onClick={() => setColor(swatch)}
                />
              )
            })}
          </div>
          {color === null && level === 'SUB' && <small className="muted">No color: uses the parent's color.</small>}
        </div>
        <div className="stack">
          <label htmlFor="category-keywords">Match keywords</label>
          <input id="category-keywords" autoComplete="off" value={keywords} onChange={(e) => setKeywords(e.target.value)} />
          <small className="muted">Comma separated, e.g. LIDL, LIDL SRBIJA (used by SMS paste and import)</small>
        </div>
        <p className="muted">{count === 1 ? '1 transaction uses' : `${count} transactions use`} this category.</p>
        <div className="actions">
          <button type="button" onClick={() => setMerging(true)}>Merge into…</button>
          <button type="button" className="danger" onClick={() => setConfirmingDelete(true)}>Delete</button>
        </div>
      </form>

      {confirmingDelete && (
        <ConfirmDialog
          title={`Delete "${original.name}"?`}
          text={original.level === 'SUB'
            ? `Its transactions move to ${parentName ?? 'no category'}.`
            : 'Its transactions get no category and its sub-categories become Unlinked.'}
          confirmLabel="Delete"
          onCancel={() => setConfirmingDelete(false)}
          onConfirm={async () => {
            await deleteCategory(db, original.id)
            finish()
          }}
        />
      )}
      {merging && (
        <Modal label="Merge category" onClose={() => setMerging(false)}>
          <h2>Merge "{original.name}" into…</h2>
          <ul className="currency-list">
            {targets.map((target) => (
              <li key={target.id}>
                <button
                  type="button"
                  className="suggestion"
                  onClick={async () => {
                    await mergeCategory(db, original.id, target.id)
                    finish()
                  }}
                >
                  {target.name}{all.find((c) => c.id === target.parentId) ? ` · ${all.find((c) => c.id === target.parentId)!.name}` : ''}
                </button>
              </li>
            ))}
            {targets.length === 0 && <li className="muted">Nothing to merge into.</li>}
          </ul>
          <div className="actions"><button type="button" onClick={() => setMerging(false)}>Cancel</button></div>
        </Modal>
      )}
    </Modal>
  )
}

function CreateCategory({ all, mains, onClose }: { all: Category[]; mains: Category[]; onClose: () => void }) {
  const [name, setName] = useState('')
  const [level, setLevel] = useState('SUB')
  const [parentId, setParentId] = useState<string | null>(null)
  const [kind, setKind] = useState('EXPENSE')
  const taken = nameIsTaken(name, all, null)
  return (
    <Modal label="New category" onClose={onClose}>
      <form
        className="form"
        noValidate
        onSubmit={async (e) => {
          e.preventDefault()
          if (taken || !name.trim()) return
          await createCategory(db, { name, level, parentId, kind })
          syncManager.notifyLocalChange()
          onClose()
        }}
      >
        <h2>New category</h2>
        <NameField value={name} taken={taken} onChange={setName} />
        <LevelField value={level} disabled={false} onChange={setLevel} />
        {level === 'SUB' && <ParentField mains={mains} value={parentId} onChange={setParentId} />}
        <KindField value={kind} onChange={setKind} />
        <div className="actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="submit" className="primary" disabled={taken || !name.trim()}>Create</button>
        </div>
      </form>
    </Modal>
  )
}
