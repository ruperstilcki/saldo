/** Month colors, the same palette as Android's Palettes.kt. [month] is 1..12. */
export type MonthTintStrength = 'OFF' | 'SUBTLE' | 'NORMAL'

const LIGHT_ROW = ['#C9DCF7', '#D7E6F7', '#D9EFE6', '#D8F0D8', '#E8EFD9', '#FBE6E3', '#F8DAD7', '#FBE6E3', '#FCEAD8', '#FBF0C8', '#EDEDDD', '#DCE4F2']
const LIGHT_HEADER = ['#8FB8F0', '#A6C8F2', '#9FD9C6', '#9DDB9F', '#C9DB9A', '#F2B8B0', '#EC9F98', '#F2B8B0', '#F5C79A', '#F2D777', '#CFCFA8', '#A9BCE0']
const DARK_BASE = ['#3D7BE0', '#5B90E0', '#3FB59A', '#45B04A', '#9DB04A', '#E07A6E', '#E0574A', '#E07A6E', '#E0954A', '#E0C23D', '#A9A98A', '#6E8FC8']

export const THEME_COLORS = {
  light: { surface: '#FBF8FF', text: '#1B1B21', headerOff: '#E9E7EF' },
  dark: { surface: '#111318', text: '#E3E1E9', headerOff: '#282A2F' },
}

const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))

/** [amount] of [top] over [bottom]. The result is opaque, so a sticky header covers the rows under it. */
function mix(bottom: string, top: string, amount: number): string {
  const b = channels(bottom)
  const t = channels(top)
  return '#' + b.map((value, i) => Math.round(value + (t[i]! - value) * amount).toString(16).padStart(2, '0')).join('')
}

const palette = (dark: boolean) => (dark ? THEME_COLORS.dark : THEME_COLORS.light)

export function monthHeaderColor(month: number, strength: MonthTintStrength, dark: boolean): string {
  const { surface, headerOff } = palette(dark)
  if (strength === 'OFF') return headerOff
  const i = month - 1
  if (dark) return mix(surface, DARK_BASE[i]!, strength === 'NORMAL' ? 0.42 : 0.28)
  return strength === 'NORMAL' ? LIGHT_HEADER[i]! : mix(surface, LIGHT_HEADER[i]!, 0.6)
}

/** null means no tint: the row keeps the normal background. */
export function monthRowColor(month: number, strength: MonthTintStrength, dark: boolean): string | null {
  if (strength === 'OFF') return null
  const { surface } = palette(dark)
  const i = month - 1
  if (dark) return mix(surface, DARK_BASE[i]!, strength === 'NORMAL' ? 0.18 : 0.09)
  return strength === 'NORMAL' ? LIGHT_ROW[i]! : mix(surface, LIGHT_ROW[i]!, 0.5)
}

/** A stored color is a signed 32-bit ARGB int, as Android keeps it. */
export const argbToHex = (color: number) => '#' + ((color >>> 0) & 0xffffff).toString(16).padStart(6, '0')

function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((value) => {
    const c = value / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}
