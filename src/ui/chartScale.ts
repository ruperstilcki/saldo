/** A clean top value and ticks for a bar chart, from a maximum in minor units. */
export function chartScale(maxMinor: number, tickCount = 4): { maxMinor: number; ticks: number[] } {
  const units = Math.max(maxMinor, 100) / 100
  const raw = units / tickCount
  const power = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((n) => n * power).find((candidate) => candidate >= raw)!
  const stepMinor = Math.round(step * 100)
  return { maxMinor: stepMinor * tickCount, ticks: Array.from({ length: tickCount + 1 }, (_, i) => i * stepMinor) }
}

const trim = (value: number) => String(Math.round(value * 10) / 10).replace('.', ',')

/** An axis label: "2.500" in full below 10.000, then "25K" and "1,2M". */
export function formatAxis(minor: number): string {
  const units = minor / 100
  if (units >= 1_000_000) return `${trim(units / 1_000_000)}M`
  if (units >= 10_000) return `${trim(units / 1_000)}K`
  return String(Math.round(units)).replace(/\B(?=(\d{3})+$)/g, '.')
}
