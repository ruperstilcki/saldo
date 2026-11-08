import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { initials } from '../core/strings'
import { db } from '../db/db'
import type { Wallet } from '../db/types'
import { argbToHex } from '../ui/monthTints'

/** The wallet image, or its initials in the wallet color. */
export function WalletAvatar({ wallet, large }: { wallet: Wallet; large?: boolean }) {
  const image = useLiveQuery(async () => (wallet.imageHash ? db.images.get(wallet.imageHash) : undefined), [wallet.imageHash])
  const [url, setUrl] = useState<string | null>(null)
  const blob = image && image.deletedAt === null ? image.blob : undefined

  useEffect(() => {
    if (!blob) {
      setUrl(null)
      return
    }
    const objectUrl = URL.createObjectURL(blob)
    setUrl(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [blob])

  const className = large ? 'avatar large' : 'avatar'
  if (url) return <img className={className} src={url} alt="" draggable={false} />
  return (
    <span className={className} style={{ backgroundColor: argbToHex(wallet.color) }} aria-hidden="true">
      {initials(wallet.name)}
    </span>
  )
}

/** A dialog on a wide screen, a sheet from the bottom on a phone. */
export function Modal({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    panel.current?.focus()
    return () => previous?.focus?.()
  }, [])

  return (
    <div
      className="backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={panel}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            onClose()
          }
        }}
      >
        {children}
      </div>
    </div>
  )
}
