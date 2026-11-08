import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { initials } from '../core/strings'
import { db } from '../db/db'
import { argbToHex } from '../ui/monthTints'

interface AvatarProps {
  wallet: { name: string; color: number; imageHash: string | null }
  large?: boolean
  /** A picture that is not saved yet, shown instead of the stored one. */
  preview?: Blob | null
}

/** The wallet image, or its initials in the wallet color. */
export function WalletAvatar({ wallet, large, preview }: AvatarProps) {
  const image = useLiveQuery(async () => (wallet.imageHash ? db.images.get(wallet.imageHash) : undefined), [wallet.imageHash])
  const [url, setUrl] = useState<string | null>(null)
  const stored = image && image.deletedAt === null ? image.blob : undefined
  const blob = preview ?? stored

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

interface ModalProps {
  label: string
  onClose: () => void
  children: ReactNode
  wide?: boolean
}

const openModals: symbol[] = []

/** A dialog on a wide screen, a sheet from the bottom on a phone. */
export function Modal({ label, onClose, children, wide }: ModalProps) {
  const panel = useRef<HTMLDivElement>(null)
  const close = useRef(onClose)
  close.current = onClose

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    // A field inside may have taken the focus already.
    if (!panel.current?.contains(document.activeElement)) panel.current?.focus()
    return () => previous?.focus?.()
  }, [])

  // On the window, because a button that just disappeared leaves the focus nowhere inside the dialog.
  // Only the top dialog reacts.
  useEffect(() => {
    const self = Symbol(label)
    openModals.push(self)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && openModals.at(-1) === self) close.current()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      openModals.splice(openModals.indexOf(self), 1)
      window.removeEventListener('keydown', onKey)
    }
  }, [label])

  return (
    <div
      className="backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={panel}
        className={wide ? 'modal wide' : 'modal'}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
      >
        {children}
      </div>
    </div>
  )
}

interface ConfirmProps {
  title: string
  text: string
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({ title, text, confirmLabel, onConfirm, onCancel }: ConfirmProps) {
  return (
    <Modal label={title} onClose={onCancel}>
      <h2>{title}</h2>
      <p>{text}</p>
      <div className="actions">
        <button type="button" onClick={onCancel}>Cancel</button>
        <button type="button" className="danger" onClick={onConfirm}>{confirmLabel}</button>
      </div>
    </Modal>
  )
}
