import { describe, expect, it } from 'vitest'
import { combineDateTime, formatDate, formatTime, parseDateText, parseTimeText, toDateInput } from './dates'

describe('date input', () => {
  it('reads dd.MM.yyyy, also with short day and month', () => {
    expect(parseDateText('05.11.2026')).toEqual({ year: 2026, month: 11, day: 5 })
    expect(parseDateText('5.1.2026')).toEqual({ year: 2026, month: 1, day: 5 })
    expect(parseDateText(' 05.11.2026. ')).toEqual({ year: 2026, month: 11, day: 5 })
  })

  it('refuses dates that do not exist', () => {
    expect(parseDateText('31.02.2026')).toBeNull()
    expect(parseDateText('29.02.2026')).toBeNull()
    expect(parseDateText('29.02.2028')).toEqual({ year: 2028, month: 2, day: 29 })
    expect(parseDateText('2026-11-05')).toBeNull()
    expect(parseDateText('')).toBeNull()
  })

  it('reads HH:mm', () => {
    expect(parseTimeText('14:22')).toEqual({ hour: 14, minute: 22 })
    expect(parseTimeText('9:05')).toEqual({ hour: 9, minute: 5 })
    expect(parseTimeText('24:00')).toBeNull()
    expect(parseTimeText('12:60')).toBeNull()
    expect(parseTimeText('abc')).toBeNull()
  })

  it('makes a moment in the local zone that shows as the same text', () => {
    const at = combineDateTime({ year: 2026, month: 11, day: 5 }, { hour: 14, minute: 22 })
    expect(formatDate(at)).toBe('05.11.2026')
    expect(formatTime(at)).toBe('14:22')
    expect(toDateInput(at)).toBe('2026-11-05')
  })
})
