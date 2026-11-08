import { describe, expect, it } from 'vitest'
import { argbToHex, contrast, hexToArgb, monthHeaderColor, monthRowColor, THEME_COLORS, type MonthTintStrength } from './monthTints'

const STRENGTHS: MonthTintStrength[] = ['NORMAL', 'SUBTLE', 'OFF']
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1)

describe('month colors', () => {
  it('keep text readable (at least 4.5:1) in every month, strength and theme', () => {
    for (const month of MONTHS) {
      for (const strength of STRENGTHS) {
        for (const dark of [false, true]) {
          const { text, surface } = dark ? THEME_COLORS.dark : THEME_COLORS.light
          const label = `${month} ${strength} ${dark ? 'dark' : 'light'}`
          expect(contrast(monthHeaderColor(month, strength, dark), text), `header ${label}`).toBeGreaterThanOrEqual(4.5)
          expect(contrast(monthRowColor(month, strength, dark) ?? surface, text), `row ${label}`).toBeGreaterThanOrEqual(4.5)
        }
      }
    }
  })

  it('use the agreed palette in the light theme', () => {
    expect(monthRowColor(1, 'NORMAL', false)).toBe('#C9DCF7')
    expect(monthHeaderColor(1, 'NORMAL', false)).toBe('#8FB8F0')
    expect(monthRowColor(10, 'NORMAL', false)).toBe('#FBF0C8')
    expect(monthHeaderColor(7, 'NORMAL', false)).toBe('#EC9F98')
  })

  it('headers are always opaque, because they are sticky', () => {
    for (const month of MONTHS) {
      for (const strength of STRENGTHS) {
        for (const dark of [false, true]) expect(monthHeaderColor(month, strength, dark)).toMatch(/^#[0-9a-fA-F]{6}$/)
      }
    }
  })

  it('off means no row tint', () => {
    expect(monthRowColor(3, 'OFF', true)).toBeNull()
  })

  it('subtle is closer to the surface than normal', () => {
    const { surface } = THEME_COLORS.light
    expect(contrast(monthRowColor(1, 'SUBTLE', false)!, surface)).toBeLessThan(contrast(monthRowColor(1, 'NORMAL', false)!, surface))
  })
})

describe('stored colors', () => {
  it('turn from a signed ARGB int into hex', () => {
    expect(argbToHex(-14787912)).toBe('#1e5ab8')
    expect(argbToHex(-16777216)).toBe('#000000')
    expect(argbToHex(-1)).toBe('#ffffff')
    expect(hexToArgb('#000000')).toBe(-16777216)
    expect(hexToArgb('#ffffff')).toBe(-1)
    expect(argbToHex(hexToArgb('#1E5BB8'))).toBe('#1e5bb8')
    expect(hexToArgb('#1e5ab8')).toBe(-14787912)
  })
})
