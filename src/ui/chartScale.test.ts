import { describe, expect, it } from 'vitest'
import { renderFeeNote, DEFAULT_FEE_TEMPLATE } from '../domain/monthlyFee'
import { chartScale, formatAxis } from './chartScale'

describe('chart scale', () => {
  it('rounds up to clean ticks that hold the maximum', () => {
    expect(chartScale(13_000_000).maxMinor).toBe(20_000_000)
    expect(chartScale(500_000)).toEqual({ maxMinor: 800_000, ticks: [0, 200_000, 400_000, 600_000, 800_000] })
    for (const max of [1, 99, 100, 12345, 987654, 123456789]) {
      expect(chartScale(max).maxMinor).toBeGreaterThanOrEqual(max)
    }
  })

  it('stays usable with nothing to show', () => {
    expect(chartScale(0).maxMinor).toBeGreaterThan(0)
  })
})

describe('axis labels', () => {
  it('are full below 10.000 and compact above', () => {
    expect(formatAxis(0)).toBe('0')
    expect(formatAxis(250_000)).toBe('2.500')
    expect(formatAxis(1_000_000)).toBe('10K')
    expect(formatAxis(2_500_000)).toBe('25K')
    expect(formatAxis(120_000_000)).toBe('1,2M')
  })
})

// Same expected values as android/app/src/test/.../domain/MonthlyFeeTest.kt
describe('monthly fee note', () => {
  it('fills in the tokens', () => {
    expect(renderFeeNote(DEFAULT_FEE_TEMPLATE, '2026-10')).toBe('održavanje računa za mesec oktobar 2026.')
    expect(renderFeeNote('{Month} / {mm} / {year}', '2026-10')).toBe('Oktobar / 10 / 2026')
    expect(renderFeeNote('održavanje za {month}', '2026-08')).toBe('održavanje za avgust')
  })
})
