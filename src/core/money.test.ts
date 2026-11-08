import { describe, expect, it } from 'vitest'
import { formatMoney, formatSigned, MINUS, parseMoney, toEditable, type ParseResult } from './money'

// Same expected values as android/app/src/test/.../core/MoneyTest.kt
const ok = (minor: number): ParseResult => ({ type: 'ok', minor })
const TOO_MANY: ParseResult = { type: 'tooManyDecimals' }
const INVALID: ParseResult = { type: 'invalid' }

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

describe('money input', () => {
  it('accepts comma and dot as the decimal separator', () => {
    expect(parseMoney('1459,96')).toEqual(ok(145996))
    expect(parseMoney('1459.96')).toEqual(ok(145996))
    expect(parseMoney('1.459,96')).toEqual(ok(145996))
    expect(parseMoney('1,459.96')).toEqual(ok(145996))
    expect(parseMoney(' 1 459,96 ')).toEqual(ok(145996))
    expect(parseMoney('12,5')).toEqual(ok(1250))
    expect(parseMoney('340')).toEqual(ok(34000))
    expect(parseMoney(',5')).toEqual(ok(50))
  })

  it('reads one separator and three digits as thousands', () => {
    expect(parseMoney('1.459')).toEqual(ok(145900))
    expect(parseMoney('1,459')).toEqual(ok(145900))
    expect(parseMoney('1.234.567')).toEqual(ok(123456700))
  })

  it('rejects the old typo 2.1091', () => {
    expect(parseMoney('2.1091')).toEqual(TOO_MANY)
    expect(parseMoney('1,2345')).toEqual(TOO_MANY)
  })

  it('rejects invalid input', () => {
    expect(parseMoney('  ')).toEqual({ type: 'empty' })
    expect(parseMoney('abc')).toEqual(INVALID)
    expect(parseMoney('1.2.3')).toEqual(INVALID)
    expect(parseMoney('12,')).toEqual(INVALID)
    expect(parseMoney('-5')).toEqual(INVALID)
    expect(parseMoney('-5', true)).toEqual(ok(-500))
    expect(parseMoney(`${MINUS}5`, true)).toEqual(ok(-500))
  })

  it('does not drift when adding up', () => {
    const sum = ['0,1', '0,2', '0,3'].reduce((total, text) => {
      const parsed = parseMoney(text)
      return total + (parsed.type === 'ok' ? parsed.minor : 0)
    }, 0)
    expect(sum).toBe(60)
    expect(formatMoney(sum)).toBe('0,60')
  })

  it('survives a round trip through the edit field', () => {
    for (const minor of [0, 5, 145996, 120511908, -470]) {
      expect(parseMoney(toEditable(minor), true)).toEqual(ok(minor))
    }
  })

  it('refuses amounts too large to stay exact, instead of rounding them', () => {
    expect(parseMoney('9999999999999')).toEqual(ok(999999999999900))
    expect(parseMoney('99999999999999')).toEqual(INVALID)
  })
})
