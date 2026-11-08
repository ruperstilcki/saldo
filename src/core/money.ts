/** Money is always an integer in minor units. Same format as Android's core/Money.kt. */
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
