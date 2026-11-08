/** Dates are always dd.MM.yyyy and times HH:mm, in the local zone. Stored as UTC epoch ms. */
const pad = (n: number) => String(n).padStart(2, '0')

export function formatDate(epochMs: number): string {
  const d = new Date(epochMs)
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`
}

export function formatTime(epochMs: number): string {
  const d = new Date(epochMs)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}
