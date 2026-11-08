/** Dates are always dd.MM.yyyy and times HH:mm, in the local zone. Stored as UTC epoch ms. */
const pad = (n: number) => String(n).padStart(2, '0')

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December',
]

export function formatDate(epochMs: number): string {
  const d = new Date(epochMs)
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`
}

export function formatTime(epochMs: number): string {
  const d = new Date(epochMs)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** "2026-11" */
export function yearMonthOf(epochMs: number): string {
  const d = new Date(epochMs)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
}

export const yearOf = (yearMonth: string) => Number(yearMonth.slice(0, 4))
export const monthOf = (yearMonth: string) => Number(yearMonth.slice(5, 7))

/** "November 2026" */
export const monthTitle = (yearMonth: string) => `${MONTHS[monthOf(yearMonth) - 1]} ${yearOf(yearMonth)}`

/** The local start of this month and of the next one: [from, to). */
export function monthRange(now: Date): { from: number; to: number } {
  return {
    from: new Date(now.getFullYear(), now.getMonth(), 1).getTime(),
    to: new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime(),
  }
}
