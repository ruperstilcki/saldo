/**
 * What the Note column shows (display only: the stored note never changes). Same as Android's
 * NoteDisplay.kt and the SMS part of Categorizer.kt. Many notes are a pasted bank SMS, so instead
 * of the whole message it shows the user's own words before it, or the merchant.
 */
const SMS_LINE = /Raspolo[zž]ivo|Odliv:|Priliv:|Evidentiran|Koriscenje kartice|Placeno kart|Isplata na bankomatu|^Racun:|^Vasa Banka|^Banka Postanska/i
const ATM = /Isplata na bankomatu:\s*([^/\n]+)/
const PAYER = /Nalogodavac uplate je\s+(.+?)(?:\.\s|\.$|\n|$)/

const SMS_HINT = /Raspolo[zž]ivo|Odliv:|Priliv:|Evidentiran|Koriscenje kartice|Placeno kart/i
const ISO = new Set(['RSD', 'EUR', 'USD', 'MKD', 'BAM', 'HUF', 'CHF', 'GBP', 'HRK', 'BGN', 'RON', 'TRY', 'CZK', 'PLN'])

/** Regex, then the group of the merchant (or null), and the group of the currency. */
const SMS_PATTERNS: [RegExp, number | null, number][] = [
  // Koriscenje kartice br. ... kod SOME SHOP   CITY RS, u iznosu od 1,459.96 RSD.
  [/kod\s+(.+?)\s{2,}.*?u iznosu od\s+[\d.,]+\s+([A-Z]{3})/s, 1, 2],
  // Placeno kart.br. 111111_2222 / SOME SHOP / City RS / RSD 3.924,00 / Raspolozivo: ...
  [/Placeno kart\.br\.\s*\S+\s*\/\s*([^/]+?)\s*\/[^/]*\/\s*([A-Z]{3})\s+[\d.,]+\s*\//, 1, 2],
  // Racun: ...  Odliv:  2,400.00 RSD . Datum: ...
  [/(?:Odliv|Priliv):\s+[\d.,]+\s+([A-Z]{3})/, null, 1],
  // Evidentiran je odliv sa racuna ... u iznosu od 5.000,00 RSD.
  [/Evidentiran[a]? je (?:odliv|priliv|uplata).*?u iznosu od\s+[\d.,]+\s+([A-Z]{3})/s, null, 1],
]

function smsMerchant(note: string): string | null {
  if (!SMS_HINT.test(note)) return null
  for (const [regex, merchantGroup, currencyGroup] of SMS_PATTERNS) {
    const match = regex.exec(note)
    if (!match || !ISO.has(match[currencyGroup]!.toUpperCase())) continue
    return merchantGroup === null ? null : match[merchantGroup]!.replace(/\s+/g, ' ').trim()
  }
  return null
}

export function noteForTable(note: string | null): string {
  if (!note || !note.trim()) return ''
  const first = note.split(/\r\n|\n|\r/).map((line) => line.trim()).find(Boolean)!
  if (!SMS_LINE.test(first)) return first
  const merchant = smsMerchant(note)
  if (merchant) return merchant
  const atm = ATM.exec(note)
  if (atm) return atm[1]!.trim()
  const payer = PAYER.exec(note)
  if (payer) return `Uplata · ${payer[1]!.trim()}`
  return first
}
