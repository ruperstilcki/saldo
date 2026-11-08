import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import { flushSync } from 'react-dom'
import { moveItem, slotOffset, targetIndex } from '../ui/reorder'

const LONG_PRESS_MS = 350
/** A finger that moves this much before the long press is scrolling, not dragging. */
const FINGER_SLOP = 8
const MOUSE_SLOP = 5
const EDGE = 56
const EDGE_SPEED = 9
const MOVE_MS = 160
const LIFT = 'scale(1.02)'

interface Session {
  id: string
  pointerId: number
  isTouch: boolean
  startX: number
  startY: number
  lastY: number
  /** Where the pointer holds the card, from the top of the card. */
  grab: number
  active: boolean
  element: HTMLElement
  height: number
  gap: number
  original: string[]
  timer?: ReturnType<typeof setTimeout>
  frame?: number
}

interface Options {
  list: RefObject<HTMLUListElement | null>
  /** The order on screen right now. */
  order: string[]
  setOrder: (ids: string[] | null) => void
  onDrop: (ids: string[]) => void
}

const itemOf = (list: HTMLElement, id: string) => list.querySelector<HTMLElement>(`[data-sort-id="${CSS.escape(id)}"]`)

/** Drag a card with the mouse right away, or with a finger after holding it, as on the phone. */
export function useCardDrag({ list, order, setOrder, onDrop }: Options) {
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const session = useRef<Session | null>(null)
  const orderRef = useRef(order)
  orderRef.current = order

  const place = useCallback(() => {
    const s = session.current
    const container = list.current
    if (!s?.active || !container) return

    const listTop = container.getBoundingClientRect().top
    const others = orderRef.current.filter((id) => id !== s.id)
    const elements = others.map((id) => itemOf(container, id)).filter((e): e is HTMLElement => !!e)
    const heights = elements.map((e) => e.offsetHeight)
    const center = s.lastY - s.grab + s.height / 2 - listTop
    const target = targetIndex(heights, s.gap, s.height, center)

    if (orderRef.current.indexOf(s.id) !== target) {
      // The other cards glide to their new places.
      const before = elements.map((e) => e.getBoundingClientRect().top)
      const next = moveItem(orderRef.current, s.id, target)
      orderRef.current = next
      flushSync(() => setOrder(next))
      elements.forEach((element, i) => {
        element.style.transition = 'none'
        element.style.transform = ''
        const shift = before[i]! - element.getBoundingClientRect().top
        element.style.transform = `translateY(${shift}px)`
        void element.offsetHeight
        element.style.transition = `transform ${MOVE_MS}ms ease`
        element.style.transform = ''
      })
    }

    const slotTop = listTop + slotOffset(heights, target, s.gap)
    s.element.style.transform = `translateY(${s.lastY - s.grab - slotTop}px) ${LIFT}`
  }, [list, setOrder])

  const autoScroll = useCallback(() => {
    const s = session.current
    if (!s?.active) return
    const scroller = list.current?.closest<HTMLElement>('.side')
    if (scroller) {
      const box = scroller.getBoundingClientRect()
      const before = scroller.scrollTop
      if (s.lastY < box.top + EDGE) scroller.scrollTop -= EDGE_SPEED
      else if (s.lastY > box.bottom - EDGE) scroller.scrollTop += EDGE_SPEED
      if (scroller.scrollTop !== before) place()
    }
    s.frame = requestAnimationFrame(autoScroll)
  }, [list, place])

  const activate = useCallback(() => {
    const s = session.current
    const container = list.current
    if (!s || !container) return
    s.active = true
    s.gap = parseFloat(getComputedStyle(container).rowGap) || 0
    s.height = s.element.offsetHeight
    s.grab = s.startY - s.element.getBoundingClientRect().top
    s.element.style.transition = 'none'
    document.body.classList.add('reordering')
    setDraggingId(s.id)
    if (s.isTouch) navigator.vibrate?.(15)
    place()
    s.frame = requestAnimationFrame(autoScroll)
  }, [autoScroll, list, place])

  const end = useRef<(drop: boolean) => void>(() => undefined)

  const onMove = useCallback((e: PointerEvent) => {
    const s = session.current
    if (!s || e.pointerId !== s.pointerId) return
    s.lastY = e.clientY
    if (s.active) {
      place()
      return
    }
    const distance = Math.hypot(e.clientX - s.startX, e.clientY - s.startY)
    if (s.isTouch) {
      if (distance > FINGER_SLOP) end.current(false)
    } else if (distance > MOUSE_SLOP) {
      activate()
    }
  }, [activate, place])

  const onUp = useCallback((e: PointerEvent) => {
    if (e.pointerId === session.current?.pointerId) end.current(true)
  }, [])

  const onCancel = useCallback((e: PointerEvent) => {
    if (e.pointerId === session.current?.pointerId) end.current(false)
  }, [])

  const onKey = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape' && session.current?.active) end.current(false)
  }, [])

  end.current = (drop: boolean) => {
    const s = session.current
    if (!s) return
    session.current = null
    if (s.timer) clearTimeout(s.timer)
    if (s.frame) cancelAnimationFrame(s.frame)
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('pointercancel', onCancel)
    window.removeEventListener('keydown', onKey)
    if (!s.active) return

    document.body.classList.remove('reordering')
    setDraggingId(null)

    // The browser still sends a click at the end of a mouse drag: it must not open the wallet.
    const swallow = (e: MouseEvent) => {
      e.stopPropagation()
      e.preventDefault()
    }
    // That click comes right after this event, so a later click by the user is not affected.
    window.addEventListener('click', swallow, { capture: true, once: true })
    setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0)

    s.element.style.transition = `transform ${MOVE_MS}ms ease`
    s.element.style.transform = ''

    const changed = orderRef.current.some((id, i) => id !== s.original[i])
    if (drop && changed) onDrop(orderRef.current)
    else setOrder(null)
  }

  const onPointerDown = useCallback((id: string, e: ReactPointerEvent<HTMLElement>) => {
    if (session.current || (e.pointerType === 'mouse' && e.button !== 0)) return
    const isTouch = e.pointerType !== 'mouse'
    const s: Session = {
      id,
      pointerId: e.pointerId,
      isTouch,
      startX: e.clientX,
      startY: e.clientY,
      lastY: e.clientY,
      grab: 0,
      active: false,
      element: e.currentTarget,
      height: 0,
      gap: 0,
      original: orderRef.current,
    }
    session.current = s
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    window.addEventListener('keydown', onKey)
    if (isTouch) s.timer = setTimeout(activate, LONG_PRESS_MS)
  }, [activate, onCancel, onKey, onMove, onUp])

  // During a drag the finger moves the card, not the page. Registered up front because the browser
  // decides about scrolling when the touch begins, and it must wait for this answer.
  useEffect(() => {
    const container = list.current
    if (!container) return
    const hold = (e: TouchEvent) => {
      if (session.current?.active) e.preventDefault()
    }
    container.addEventListener('touchmove', hold, { passive: false })
    return () => container.removeEventListener('touchmove', hold)
  }, [list])

  // Leaving the screen in the middle of a drag.
  useEffect(() => () => end.current(false), [])

  const cancelDrag = useCallback(() => end.current(false), [])

  return { draggingId, onPointerDown, cancelDrag }
}
