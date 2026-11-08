import { useEffect, useSyncExternalStore } from 'react'
import type { GroupDefault } from '../domain/tableModel'
import type { MonthTintStrength } from '../ui/monthTints'

export type ThemeMode = 'SYSTEM' | 'LIGHT' | 'DARK'

/** Local to this browser, like on the phone: these are not synced. */
export interface AppSettings {
  theme: ThemeMode
  monthTint: MonthTintStrength
  monthsDefault: GroupDefault
  yearsDefault: GroupDefault
  showQuickPicksInAutocomplete: boolean
}

const DEFAULTS: AppSettings = { theme: 'SYSTEM', monthTint: 'NORMAL', monthsDefault: 'EXPANDED', yearsDefault: 'EXPANDED', showQuickPicksInAutocomplete: true }
const KEY = 'saldo.settings'

function load(): AppSettings {
  try {
    return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<AppSettings>) }
  } catch {
    return DEFAULTS
  }
}

let current = load()
const listeners = new Set<() => void>()

export function updateSettings(change: Partial<AppSettings>) {
  current = { ...current, ...change }
  try {
    localStorage.setItem(KEY, JSON.stringify(current))
  } catch {
    // Without storage the choice still holds until the page closes.
  }
  applyTheme()
  listeners.forEach((l) => l())
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const useSettings = () => useSyncExternalStore(subscribe, () => current)

export function applyTheme() {
  if (current.theme === 'SYSTEM') document.documentElement.removeAttribute('data-theme')
  else document.documentElement.setAttribute('data-theme', current.theme.toLowerCase())
}

/** Whether the dark theme is showing, following the system when the choice is System. */
export function useDarkTheme(): boolean {
  const { theme } = useSettings()
  const systemDark = useSyncExternalStore(
    (listener) => {
      const query = matchMedia('(prefers-color-scheme: dark)')
      query.addEventListener('change', listener)
      return () => query.removeEventListener('change', listener)
    },
    () => matchMedia('(prefers-color-scheme: dark)').matches,
  )
  useEffect(applyTheme, [theme])
  return theme === 'SYSTEM' ? systemDark : theme === 'DARK'
}
