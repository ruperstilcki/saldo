import { useSyncExternalStore } from 'react'

export type WalletForm =
  | { type: 'newTransaction' }
  | { type: 'editTransaction'; transactionId: string }
  | { type: 'duplicateTransaction'; transactionId: string }
  | { type: 'editWallet' }

export type Route =
  | { page: 'wallets' }
  | { page: 'archived' }
  | { page: 'newWallet' }
  | { page: 'wallet'; id: string; form?: WalletForm }

const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

/** Asked before Back leaves the page. Returning false keeps the user here. */
let guard: (() => boolean) | null = null
export const setNavigationGuard = (next: (() => boolean) | null) => {
  guard = next
}

let shownPath = location.pathname

const onPopState = () => {
  if (guard && !guard()) {
    history.pushState(null, '', shownPath)
    return
  }
  shownPath = location.pathname
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

export function parseRoute(pathname: string): Route {
  if (pathname === '/archived') return { page: 'archived' }
  if (pathname === '/new-wallet') return { page: 'newWallet' }
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

export function usePathname(): string {
  return useSyncExternalStore(subscribe, () => location.pathname)
}
