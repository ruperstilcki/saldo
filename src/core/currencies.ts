import { fold } from './strings'

export const COMMON_CURRENCIES = ['RSD', 'EUR', 'USD', 'CHF', 'GBP', 'MKD', 'BAM', 'HUF']
export const DEFAULT_CURRENCY = 'RSD'

export interface CurrencyItem {
  code: string
  name: string
}

const names = new Intl.DisplayNames(['en'], { type: 'currency' })

export function currencyName(code: string): string {
  try {
    return names.of(code) ?? code
  } catch {
    return code
  }
}

let cached: CurrencyItem[] | null = null

function allCurrencies(): CurrencyItem[] {
  if (!cached) {
    const codes = new Set([...COMMON_CURRENCIES, ...Intl.supportedValuesOf('currency')])
    cached = [...codes].map((code) => ({ code, name: currencyName(code) })).sort((a, b) => a.code.localeCompare(b.code))
  }
  return cached
}

/** Search by code or name, ignoring case and diacritics. Common currencies come first. */
export function searchCurrencies(query: string): CurrencyItem[] {
  const q = fold(query.trim())
  const list = q ? allCurrencies().filter((c) => fold(c.code).includes(q) || fold(c.name).includes(q)) : allCurrencies()
  const common = list
    .filter((c) => COMMON_CURRENCIES.includes(c.code))
    .sort((a, b) => COMMON_CURRENCIES.indexOf(a.code) - COMMON_CURRENCIES.indexOf(b.code))
  return [...common, ...list.filter((c) => !COMMON_CURRENCIES.includes(c.code))]
}
