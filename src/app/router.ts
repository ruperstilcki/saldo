import { useSyncExternalStore } from 'react'
import type { DateParts } from '../core/dates'

export type WalletForm =
  | { type: 'newTransaction' }
  | { type: 'editTransaction'; transactionId: string }
  | { type: 'duplicateTransaction'; transactionId: string }
  | { type: 'editWallet' }

export interface SearchParams {
  currency: string | null
  wallet: string | null
  category: string | null
  from: DateParts | null
  to: DateParts | null
}

export type Route =
  | { page: 'wallets' }
  | { page: 'archived' }
  | { page: 'newWallet' }
  | { page: 'statistics'; walletId: string | null }
  | { page: 'search'; params: SearchParams }
  | { page: 'categories' }
  | { page: 'fees'; walletId: string | null }
  | { page: 'wallet'; id: string; form?: WalletForm }

const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

/** Asked before Back leaves the page. Returning false keeps the user here. */
let guard: (() => boolean) | null = null
export const setNavigationGuard = (next: (() => boolean) | null) => {
  guard = next
}

const currentUrl = () => location.pathname + location.search

let shownPath = currentUrl()

const onPopState = () => {
  if (guard && !guard()) {
    history.pushState(null, '', shownPath)
    return
  }
  shownPath = currentUrl()
  emit()
}

const subscribe = (listener: () => void) => {
  if (listeners.size === 0) window.addEventListener('popstate', onPopState)
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) window.removeEventListener('popstate', onPopState)
  }
}

export function navigate(path: string, { replace = false } = {}) {
  if (replace) history.replaceState(null, '', path)
  else history.pushState(null, '', path)
  shownPath = path
  emit()
}

const part = encodeURIComponent
export const walletPath = (id: string) => `/wallet/${part(id)}`
export const newWalletPath = () => '/new-wallet'
export const editWalletPath = (id: string) => `${walletPath(id)}/edit`
export const newTransactionPath = (walletId: string) => `${walletPath(walletId)}/new`
export const editTransactionPath = (walletId: string, id: string) => `${walletPath(walletId)}/tx/${part(id)}`
export const duplicateTransactionPath = (walletId: string, id: string) => `${walletPath(walletId)}/duplicate/${part(id)}`

const withWallet = (path: string, walletId: string | null) => (walletId ? `${path}?wallet=${part(walletId)}` : path)
export const statisticsPath = (walletId: string | null = null) => withWallet('/statistics', walletId)
export const feesPath = (walletId: string | null = null) => withWallet('/fees', walletId)

const dateToParam = (d: DateParts) => `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`
function dateFromParam(text: string | null): DateParts | null {
  const match = text ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(text) : null
  return match ? { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) } : null
}

export function searchPath(params: Partial<SearchParams> = {}): string {
  const query = new URLSearchParams()
  if (params.currency) query.set('currency', params.currency)
  if (params.wallet) query.set('wallet', params.wallet)
  if (params.category) query.set('category', params.category)
  if (params.from) query.set('from', dateToParam(params.from))
  if (params.to) query.set('to', dateToParam(params.to))
  const text = query.toString()
  return text ? `/search?${text}` : '/search'
}

export function parseRoute(url: string): Route {
  const [pathname = '/', search = ''] = url.split('?')
  const query = new URLSearchParams(search)
  if (pathname === '/archived') return { page: 'archived' }
  if (pathname === '/new-wallet') return { page: 'newWallet' }
  if (pathname === '/statistics') return { page: 'statistics', walletId: query.get('wallet') }
  if (pathname === '/fees') return { page: 'fees', walletId: query.get('wallet') }
  if (pathname === '/categories') return { page: 'categories' }
  if (pathname === '/search') {
    return {
      page: 'search',
      params: {
        currency: query.get('currency'),
        wallet: query.get('wallet'),
        category: query.get('category'),
        from: dateFromParam(query.get('from')),
        to: dateFromParam(query.get('to')),
      },
    }
  }
  const match = /^\/wallet\/([^/]+)(?:\/(edit|new|tx|duplicate)(?:\/([^/]+))?)?$/.exec(pathname)
  if (!match) return { page: 'wallets' }
  const id = decodeURIComponent(match[1]!)
  const [, , action, target] = match
  if (action === 'edit' && !target) return { page: 'wallet', id, form: { type: 'editWallet' } }
  if (action === 'new' && !target) return { page: 'wallet', id, form: { type: 'newTransaction' } }
  if (action === 'tx' && target) return { page: 'wallet', id, form: { type: 'editTransaction', transactionId: decodeURIComponent(target) } }
  if (action === 'duplicate' && target) return { page: 'wallet', id, form: { type: 'duplicateTransaction', transactionId: decodeURIComponent(target) } }
  return { page: 'wallet', id }
}

export function useUrl(): string {
  return useSyncExternalStore(subscribe, currentUrl)
}
