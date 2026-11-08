import { describe, expect, it } from 'vitest'
import { moveItem, slotOffset, targetIndex } from './reorder'

describe('dragging a card', () => {
  const heights = [100, 100, 100]
  const gap = 10

  it('moves an item to its new place', () => {
    expect(moveItem(['a', 'b', 'c'], 'a', 2)).toEqual(['b', 'c', 'a'])
    expect(moveItem(['a', 'b', 'c'], 'c', 0)).toEqual(['c', 'a', 'b'])
    expect(moveItem(['a', 'b', 'c'], 'b', 1)).toEqual(['a', 'b', 'c'])
  })

  it('finds the slots', () => {
    expect(slotOffset(heights, 0, gap)).toBe(0)
    expect(slotOffset(heights, 2, gap)).toBe(220)
  })

  it('stays first above the first card and goes last below the last one', () => {
    expect(targetIndex(heights, gap, 100, -500)).toBe(0)
    expect(targetIndex(heights, gap, 100, 5000)).toBe(3)
  })

  it('passes a card only at the line between its two positions', () => {
    // The first card sits at 0..100 or, with the dragged card above it, at 110..210: the line is at 105.
    expect(targetIndex(heights, gap, 100, 105)).toBe(0)
    expect(targetIndex(heights, gap, 100, 106)).toBe(1)
  })

  it('does not flicker: both sides of a line agree with where the card then sits', () => {
    for (let center = -50; center < 500; center++) {
      const target = targetIndex(heights, gap, 100, center)
      const others = slotOffset(heights, target, gap) + 50
      // Resting in its slot, a card must decide on that same slot.
      expect(targetIndex(heights, gap, 100, others)).toBe(target)
    }
  })

  it('works with cards of different heights', () => {
    expect(targetIndex([60, 140], 8, 100, 80)).toBe(0)
    expect(targetIndex([60, 140], 8, 100, 90)).toBe(1)
    expect(targetIndex([60, 140], 8, 100, 200)).toBe(2)
  })
})
