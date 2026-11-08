import { describe, expect, it } from 'vitest'
import { noteForTable as show } from './noteDisplay'

// Same data and expected values as android/app/src/test/.../domain/NoteDisplayTest.kt
describe('note in the table', () => {
  it('shows plain notes as they are', () => {
    expect(show('Lidl')).toBe('Lidl')
    expect(show('\n  prva linija\ndruga')).toBe('prva linija')
    expect(show(null)).toBe('')
  })

  it('shows the merchant of an SMS', () => {
    expect(show('Placeno kart.br. 111111_2222 / LIDL 124 BEOGRAD / Beograd RS / RSD 1.437,04 / Raspolozivo: RSD 1,00')).toBe('LIDL 124 BEOGRAD')
    expect(show('Koriscenje kartice br. 111111******2222 kod LIDL SRBIJA KD           NOVI BEOGRAD RS, u iznosu od 143.74 RSD. Raspolozivo stanje: 1.00 RSD.\nVasa Banka Postanska stedionica')).toBe('LIDL SRBIJA KD')
  })

  it('prefers the words of the user before the SMS', () => {
    expect(show('Temu prva pošiljka 17.31€\nKoriscenje kartice br. 1 kod TEMU.COM      IE, u iznosu od 2,019.00 RSD.')).toBe('Temu prva pošiljka 17.31€')
  })

  it('shortens ATM and incoming payments', () => {
    expect(show('Isplata na bankomatu: ATM POSTA 11916 / BEOGRAD RS / RSD 5.000,00 / Raspolozivo: RSD 1,00')).toBe('ATM POSTA 11916')
    expect(show('Evidentirana je uplata u iznosu od 1.000,00 RSD, na Vas racun 123. Nalogodavac uplate je ACME DOO BEOGRAD. Raspolozivo stanje: 1,00 RSD.')).toBe('Uplata · ACME DOO BEOGRAD')
  })

  it('falls back to the first line for an account SMS without a merchant', () => {
    const note = 'Evidentiran je odliv sa racuna 1234 u iznosu od 5.000,00 RSD. Raspolozivo stanje: 1,00 RSD.'
    expect(show(note)).toBe(note)
  })
})
