/**
 * The note of a monthly fee, same as Android's MonthlyFee.kt. Only the phone books fees, so the web
 * has rules and their preview, and no generator: two generators could bring back a deleted fee.
 */
export const DEFAULT_FEE_TEMPLATE = 'održavanje računa za mesec {month} {year}.'

const SR_MONTHS = ['januar', 'februar', 'mart', 'april', 'maj', 'jun', 'jul', 'avgust', 'septembar', 'oktobar', 'novembar', 'decembar']

/** Tokens: {month} oktobar, {Month} Oktobar, {mm} 10, {year} 2026. */
export function renderFeeNote(template: string, yearMonth: string): string {
  const [year, month] = yearMonth.split('-') as [string, string]
  const name = SR_MONTHS[Number(month) - 1]!
  return template
    .replaceAll('{month}', name)
    .replaceAll('{Month}', name[0]!.toUpperCase() + name.slice(1))
    .replaceAll('{mm}', month)
    .replaceAll('{year}', year)
}
