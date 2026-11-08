import { describe, expect, it } from 'vitest'
import { formatMoney, formatSigned, MINUS } from './money'

// Same expected values as android/app/src/test/.../core/MoneyTest.kt
describe('money format', () => {
  it('uses sr-RS grouping and two decimals', () => {
    expect(formatMoney(120511908)).toBe('1.205.119,08')
    expect(formatMoney(0)).toBe('0,00')
    expect(formatMoney(175)).toBe('1,75')
    expect(formatMoney(99999)).toBe('999,99')
    expect(formatMoney(100000)).toBe('1.000,00')
    expect(formatMoney(-470)).toBe(`${MINUS}4,70`)
  })

  it('formats signed amounts', () => {
    expect(formatSigned(18000000, true)).toBe('+180.000,00')
    expect(formatSigned(145996, false)).toBe(`${MINUS}1.459,96`)
  })
})
