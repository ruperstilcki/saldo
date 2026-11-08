import { useSyncExternalStore } from 'react'

export type Route = { page: 'wallets' } | { page: 'archived' } | { page: 'wallet'; id: string }

const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

const subscribe = (listener: () => void) => {
  if (listeners.size === 0) window.addEventListener('popstate', emit)
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) window.removeEventListener('popstate', emit)
  }
}

export function navigate(path: string) {
  history.pushState(null, '', path)
  emit()
}

export const walletPath = (id: string) => `/wallet/${encodeURIComponent(id)}`

export function parseRoute(pathname: string): Route {
  const wallet = /^\/wallet\/([^/]+)$/.exec(pathname)
  if (wallet) return { page: 'wallet', id: decodeURIComponent(wallet[1]!) }
  if (pathname === '/archived') return { page: 'archived' }
  return { page: 'wallets' }
}

export function usePathname(): string {
  return useSyncExternalStore(subscribe, () => location.pathname)
}
