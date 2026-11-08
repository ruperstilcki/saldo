import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { ConfirmDialog, Modal } from './Common'
import { navigate, setNavigationGuard } from './router'

interface Props {
  title: string
  dirty: boolean
  discardText: string
  saving: boolean
  /** Where Close, Discard and a finished save lead. */
  closeTo: string
  onSave: () => void | Promise<void>
  children: ReactNode
}

/** A form with Close and Save on top. Leaving with unsaved changes asks first, also through Back. */
export function FormShell({ title, dirty, discardText, saving, closeTo, onSave, children }: Props) {
  const [confirming, setConfirming] = useState(false)
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty

  useEffect(() => {
    setNavigationGuard(() => {
      if (!dirtyRef.current) return true
      setConfirming(true)
      return false
    })
    const warn = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current) e.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => {
      setNavigationGuard(null)
      window.removeEventListener('beforeunload', warn)
    }
  }, [])

  const leave = () => {
    setNavigationGuard(null)
    navigate(closeTo, { replace: true })
  }
  const requestClose = () => (dirty ? setConfirming(true) : leave())

  const submit = (e: FormEvent) => {
    e.preventDefault()
    void onSave()
  }

  return (
    <Modal label={title} onClose={requestClose} wide>
      <form className="form" onSubmit={submit} noValidate>
        <header className="form-header">
          <button type="button" aria-label="Close" onClick={requestClose}>✕</button>
          <h2>{title}</h2>
          <span className="spacer" />
          <button type="submit" className="primary" disabled={saving}>Save</button>
        </header>
        {children}
      </form>
      {confirming && (
        <ConfirmDialog
          title="Discard changes?"
          text={discardText}
          confirmLabel="Discard"
          onConfirm={leave}
          onCancel={() => setConfirming(false)}
        />
      )}
    </Modal>
  )
}

/** After a successful save: go on without asking, the changes are safe. */
export function leaveSavedForm(path: string) {
  setNavigationGuard(null)
  navigate(path, { replace: true })
}

export function FieldError({ id, text }: { id: string; text: string | null }) {
  if (!text) return null
  return <p className="field-error" id={id} role="alert">{text}</p>
}
