import { fold } from '../core/strings'
import type { Category } from '../db/types'

/** A category as shown in the picker: "Maxi · Groceries". Same rules as Android's CategorySuggest.kt. */
export interface CategoryOption {
  id: string
  name: string
  parentName: string | null
  color: number | null
  isQuickPick: boolean
  unlinked: boolean
  label: string
}

export function categoryOptions(all: Category[]): CategoryOption[] {
  const byId = new Map(all.map((c) => [c.id, c]))
  return all.map((c) => {
    const parent = c.parentId ? byId.get(c.parentId) : undefined
    const unlinked = c.level === 'SUB' && !parent
    return {
      id: c.id,
      name: c.name,
      parentName: parent?.name ?? null,
      color: c.color ?? parent?.color ?? null,
      isQuickPick: c.isQuickPick,
      unlinked,
      label: parent ? `${c.name} · ${parent.name}` : unlinked ? `${c.name} · (Unlinked)` : c.name,
    }
  })
}

export const kindAllows = (kind: string, income: boolean) =>
  kind === 'BOTH' || (income && kind === 'INCOME') || (!income && kind === 'EXPENSE')

/**
 * Matches the name of the category or of its parent, ignoring case and diacritics. Order: the name
 * starts with the query, then contains it, then the parent's name; within that, most used first.
 * Without [showQuickPicks], categories that have a quick chip are left out.
 */
export function suggestCategories(
  query: string,
  all: Category[],
  usage: Map<string, number>,
  income: boolean,
  showQuickPicks: boolean,
  limit = 8,
): CategoryOption[] {
  const q = fold(query.trim())
  if (!q) return []
  const kinds = new Map(all.map((c) => [c.id, c.kind]))

  const rankOf = (option: CategoryOption) => {
    const name = fold(option.name)
    const parent = option.parentName ? fold(option.parentName) : ''
    if (name.startsWith(q)) return 0
    if (name.includes(q)) return 1
    if (parent.startsWith(q)) return 2
    if (parent.includes(q)) return 3
    return null
  }

  return categoryOptions(all)
    .filter((o) => kindAllows(kinds.get(o.id)!, income) && (showQuickPicks || !o.isQuickPick))
    .flatMap((option) => {
      const rank = rankOf(option)
      return rank === null ? [] : [{ option, rank, used: usage.get(option.id) ?? 0, name: option.name.toLowerCase() }]
    })
    .sort((a, b) => a.rank - b.rank || b.used - a.used || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .slice(0, limit)
    .map((entry) => entry.option)
}

/** "+ Create …" is offered when nothing has exactly this name. */
export function canCreateCategory(query: string, all: Category[]): boolean {
  const q = fold(query.trim())
  return q !== '' && !all.some((c) => fold(c.name) === q)
}
