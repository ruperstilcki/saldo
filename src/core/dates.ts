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

export interface DateParts {
  year: number
  month: number
  day: number
}

export interface TimeParts {
  hour: number
  minute: number
}

/** "05.11.2026", also "5.11.2026." with the trailing dot common in Serbian. Null if there is no such date. */
export function parseDateText(text: string): DateParts | null {
  const match = /^(\d{1,2})\.(\d{1,2})\.(\d{4})\.?$/.exec(text.trim())
  if (!match) return null
  const [day, month, year] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const date = new Date(year, month - 1, day)
  const exists = date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
  return exists ? { year, month, day } : null
}

export function parseTimeText(text: string): TimeParts | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(text.trim())
  if (!match) return null
  const [hour, minute] = [Number(match[1]), Number(match[2])]
  return hour <= 23 && minute <= 59 ? { hour, minute } : null
}

export const combineDateTime = (date: DateParts, time: TimeParts) =>
  new Date(date.year, date.month - 1, date.day, time.hour, time.minute).getTime()

/** The format of the browser's own calendar: "2026-11-05". */
export function toDateInput(epochMs: number): string {
  const d = new Date(epochMs)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** "2026-11-05" -> "05.11.2026" */
export function fromDateInput(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  return match ? `${match[3]}.${match[2]}.${match[1]}` : null
}
