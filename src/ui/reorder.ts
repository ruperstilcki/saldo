/** The geometry of dragging one card through a vertical list. Heights are of the other cards, in order. */

export function moveItem(ids: string[], id: string, target: number): string[] {
  const next = ids.filter((other) => other !== id)
  next.splice(target, 0, id)
  return next
}

/** Distance from the top of the list to the slot at [index], with the dragged card taken out. */
export function slotOffset(otherHeights: number[], index: number, gap: number): number {
  let offset = 0
  for (let i = 0; i < index; i++) offset += otherHeights[i]! + gap
  return offset
}

/**
 * Where the dragged card belongs. The line for passing a card lies halfway between that card's two
 * possible positions, so the order does not flicker when the pointer rests near the line.
 * [center] is the middle of the dragged card, measured from the top of the list.
 */
export function targetIndex(otherHeights: number[], gap: number, draggedHeight: number, center: number): number {
  let target = 0
  for (let i = 0; i < otherHeights.length; i++) {
    const middle = slotOffset(otherHeights, i, gap) + otherHeights[i]! / 2 + (draggedHeight + gap) / 2
    if (center > middle) target = i + 1
  }
  return target
}
