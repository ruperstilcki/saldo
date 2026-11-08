# Saldo Web: završno uputstvo

Sajt: https://saldo-49s.pages.dev

## Instalacija na telefon ili računar

- **Android (Chrome):** otvori sajt, pa ⋮ → **Add to Home screen** ili **Install app**.
- **Računar (Chrome ili Edge):** ikona za instalaciju na kraju adresne trake.

Instalacija nije obavezna. Sajt se i bez nje otvara bez interneta, ali tek pošto je jednom otvoren sa internetom u tom pregledaču.

## Rad bez interneta

- Sve radi kao i inače: pregled, unos, izmena, brisanje.
- Gore piše `Offline` i broj neposlatih izmena (`unsent`). One se šalju čim se veza vrati.
- Neposlate izmene ostaju sačuvane i ako se odjaviš ili ti sesija istekne bez interneta, i šalju se kad se isti nalog ponovo prijavi.
- Bez interneta ne može: prva prijava i prvo otvaranje sajta u tom pregledaču.

## Nova verzija sajta

Posle `git push` Cloudflare za minut-dva napravi novu verziju. Pregledač je preuzme u pozadini pri otvaranju, a prikazuje je **od sledećeg otvaranja**. Ako je sajt bio otvoren, zatvori ga i otvori ponovo, pa će nova verzija biti tu.

## Šta je još ostalo da proveriš

Ovo testovi nisu mogli da pokriju, jer traži pravi telefon ili pravi server. Koristi **probni wallet**, jer se brisanje wallet-a ne može poništiti.

1. [ ] **Slike:** napravi wallet sa slikom na webu, pa proveri da je slika i na telefonu. Zatim promeni sliku na telefonu i proveri na webu.
2. [ ] **Izmene:** dodaj i izmeni transakciju na webu, pa na telefonu, i proveri da su iste na oba mesta.
3. [ ] **Undo:** obriši transakciju na webu, klikni Sync now, pa Undo i ponovo Sync now. Transakcija mora da ostane i na telefonu.
4. [ ] **Kategorija:** preko `+ Create "..."` napravi kategoriju. Telefon je prikazuje kao Unlinked.
5. [ ] **Naknada:** napravi pravilo na webu, otvori aplikaciju na telefonu i proveri da je pravilo tu. Naknada se knjiži poslednjeg dana u mesecu; web je ne knjiži.
6. [ ] **Filter:** isti filter na webu i telefonu mora da da isti broj stavki i zbir.
7. [ ] **Statistika:** uporedi mesečnu potrošnju i kategorije sa telefonom.
8. [ ] **Offline:** uključi avionski režim, otvori instaliran sajt, unesi transakciju, isključi avionski režim i proveri da je stigla na telefon.
9. [ ] **Drugi nalog:** kad se prijavi drugi član porodice, ne sme da vidi tvoje podatke. Pravila su testirana na probnoj bazi, a ovo je provera na pravom serveru.
10. [ ] **Probni wallet:** obriši ga na kraju i proveri da je nestao i sa telefona.

## Backup

- Pravi se svakog ponedeljka u `SaldoBackup` na Google Drive-u, a čuva se 12 nedelja.
- Ako GitHub javi da workflow nije uspeo, proveri Actions → Database backup.
- Vraćanje backup-a još nije probano na pravom fajlu. Koraci su u [BACKUP.md](BACKUP.md). Lozinka iz menadžera se nalepi u terminal.

## Novi član porodice

1. Google Cloud → Google Auth Platform → Audience → **Test users**: dodaj njegov Google nalog.
2. Neka prvo instalira i otvori **Android aplikaciju**, koja pravi početne kategorije.
3. Posle toga može i na web, sa istim nalogom.

## Ako nešto ne radi

- **`Sync failed` iako ima interneta:** Supabase pauzira besplatan projekat posle oko 7 dana bez aktivnosti. Otvori dashboard i klikni **Resume**. Podaci se ne gube.
- **Prijava ne prolazi:** u Supabase → Authentication → URL Configuration mora da stoji adresa sajta, a u Redirect URLs `https://saldo-49s.pages.dev/**`.

## Za razvoj

```sh
npm run dev       # lokalno, na http://localhost:5173
npm test          # računanje i logika
npm run e2e       # ceo tok u pregledaču, protiv lažnog servera
npm run test:db   # sync i izolacija naloga na pravoj bazi u Docker-u, sa izmišljenim podacima
```
