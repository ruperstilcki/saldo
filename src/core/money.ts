/** Money is always an integer in minor units. Same rules as Android's core/Money.kt. */
export const MINUS = '−'

/** 145996 -> "1.459,96"; -470 -> "−4,70" */
export function formatMoney(minor: number): string {
  const abs = Math.abs(minor)
  const whole = Math.floor(abs / 100)
  const frac = abs % 100
  const grouped = String(whole).replace(/\B(?=(\d{3})+$)/g, '.')
  return (minor < 0 ? MINUS : '') + grouped + ',' + String(frac).padStart(2, '0')
}

/** Signed for tables: income "+1.000,00", expense "−1.000,00". */
export function formatSigned(minor: number, isIncome: boolean): string {
  return (isIncome ? '+' : MINUS) + formatMoney(Math.abs(minor))
}

/** Minor units -> editable text, e.g. 145996 -> "1459,96": no grouping, so it is easy to change. */
export function toEditable(minor: number): string {
  const abs = Math.abs(minor)
  return (minor < 0 ? '-' : '') + String(Math.floor(abs / 100)) + ',' + String(abs % 100).padStart(2, '0')
}

export type ParseResult =
  | { type: 'ok'; minor: number }
  | { type: 'empty' }
  | { type: 'invalid' }
  | { type: 'tooManyDecimals' }

const OK = (minor: number): ParseResult => ({ type: 'ok', minor })
const INVALID: ParseResult = { type: 'invalid' }

/** More whole digits than this would no longer be exact in a JavaScript number once in minor units. */
const MAX_WHOLE_DIGITS = 13

/** "1.234.567" style grouping: the first group has 1-3 digits, the rest exactly 3. */
function validGrouping(text: string): boolean {
  const groups = text.split(/[.,]/)
  if (groups.length === 1) return groups[0] !== ''
  if (groups[0] === '' || groups[0]!.length > 3) return false
  return groups.slice(1).every((group) => group.length === 3)
}

/**
 * Accepts both "," and "." as the decimal separator:
 *  - "1459,96", "1459.96", "1.459,96", "1,459.96", "1 459,96" -> 145996
 *  - "1.459" or "1,459" (one separator and exactly 3 digits after it) -> 1459, a thousands separator
 *  - "2.1091" -> too many decimals
 * A leading minus is allowed only with [allowNegative].
 */
export function parseMoney(input: string, allowNegative = false): ParseResult {
  let text = input.replace(/\s/g, '')
  if (text === '') return { type: 'empty' }
  let negative = false
  if (text.startsWith('-') || text.startsWith(MINUS)) {
    if (!allowNegative) return INVALID
    negative = true
    text = text.slice(1)
  }
  if (text === '' || !/^[0-9.,]+$/.test(text) || /^[.,]$/.test(text)) return INVALID

  const lastSeparator = Math.max(text.lastIndexOf('.'), text.lastIndexOf(','))
  let whole: string
  let fraction = ''
  if (lastSeparator < 0) {
    whole = text
  } else {
    const separator = text[lastSeparator]!
    const count = text.split(separator).length - 1
    const other = separator === '.' ? ',' : '.'
    const digitsAfter = text.length - lastSeparator - 1
    if (!text.includes(other) && (count > 1 || digitsAfter === 3)) {
      if (!validGrouping(text)) return INVALID
      whole = text.replace(/[.,]/g, '')
    } else {
      const head = text.slice(0, lastSeparator)
      if (head.includes(separator)) return INVALID
      if (head !== '' && !validGrouping(head)) return INVALID
      whole = head.replace(/[.,]/g, '') || '0'
      fraction = text.slice(lastSeparator + 1)
      if (fraction === '') return INVALID
      if (fraction.length > 2) return { type: 'tooManyDecimals' }
    }
  }
  if (whole.length > MAX_WHOLE_DIGITS) return INVALID
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, '0') || '0')
  return OK(negative ? -minor : minor)
}
