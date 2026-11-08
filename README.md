# Saldo Web

Web verzija aplikacije Saldo za lično praćenje stanja i potrošnje po novčanicima. Koristi istu bazu kao Android aplikacija, radi i bez interneta, a korisnici su autor i porodica.

Sajt: https://saldo-49s.pages.dev

## Pregled

| Deo | Šta je korišćeno | Gde je |
|---|---|---|
| **Frontend** | TypeScript, React 19, Vite 8 | Statičan sajt na Cloudflare Pages |
| **Backend** | Nema sopstvenog servera. Aplikacija direktno koristi Supabase, a podatke štite RLS pravila u bazi | Supabase |
| **Baza** | PostgreSQL | Supabase |
| **Prijava** | Supabase Auth, samo Google nalog | Supabase i Google Cloud (OAuth klijent) |
| **Slike wallet-a** | Supabase Storage, privatni bucket `wallet-images` | Supabase |
| **Lokalna baza** | IndexedDB preko biblioteke Dexie | U pregledaču korisnika |
| **Rad bez interneta** | Service worker čuva samo aplikaciju, a podaci su u IndexedDB | U pregledaču korisnika |
| **Kod** | Privatni repo `ruperstilcki/saldo`, samo web aplikacija | GitHub |
| **Backup** | GitHub Action, nedeljni šifrovan `pg_dump` | Google Drive, folder `SaldoBackup` |
| **Android aplikacija** | Kotlin, Compose, Room | Samo lokalno kod autora, nije na GitHub-u |

Svi servisi rade na besplatnom planu. Ne uvodi ništa što traži karticu ili plaćeni plan.

```
Android (Room)  ⇄  Supabase (Postgres, Auth, Storage)  ⇄  Web (IndexedDB)
```

Android i web se ne povezuju direktno. Svaki ima svoju lokalnu bazu i sinhronizuje se sa serverom.

## Pokretanje u lokalu

Potrebni su Node 22 (`.nvmrc`) i npm.

1. Instaliraj pakete:
   ```sh
   npm install
   ```
2. Napravi `.env.local` po uzoru na `.env.example`. Vrednosti su iste kao `supabase.url` i `supabase.key` u `android/local.properties`, a ključ počinje sa `sb_publishable_`:
   ```
   VITE_SUPABASE_URL=
   VITE_SUPABASE_KEY=
   ```
3. Pokreni aplikaciju:
   ```sh
   npm run dev
   ```
4. Otvori http://localhost:5173. Za prijavu `http://localhost:5173/**` mora da postoji u Supabase → Authentication → URL Configuration → Redirect URLs.

> **Pažnja:** lokalna verzija koristi **istu, pravu bazu** kao sajt. Svaka izmena u lokalu ide u stvarne podatke i stiže na telefon. Za probu koristi probni wallet.

`service_role` i `sb_secret_` ključevi nikad ne ulaze u web aplikaciju. Service worker radi samo u build-u, ne u `npm run dev`.

## Testovi

| Komanda | Šta proverava | Šta traži |
|---|---|---|
| `npm test` | Računanje i logiku, sa istim očekivanim vrednostima kao Android testovi | Ništa |
| `npm run e2e` | Ceo tok u Chromium-u, protiv lažnog servera | Jednom `npx playwright install chromium` |
| `npm run test:db` | Sync između dva uređaja i izolaciju naloga, na pravom Postgres-u i PostgREST-u | Docker i lokalni repo sa `supabase/migrations` |
| `npm run build` | Tipove i produkcioni build, u `dist/` | `.env.local` |

Testovi nikad ne koriste pravi Supabase i rade samo sa izmišljenim podacima. Ne pokrivaju Supabase Storage ni pravu Android aplikaciju. To se proverava ručno, po listi u [docs/PROVERA.md](docs/PROVERA.md).

## Deploy

`git push` na `main` pokreće build na Cloudflare Pages i objavljuje novu verziju za minut-dva. Pregledač je preuzme u pozadini, a prikazuje je od sledećeg otvaranja.

Podešavanja na Cloudflare-u:

- build komanda `npm run build`, izlaz `dist`, root prazan;
- env promenljive `VITE_SUPABASE_URL` i `VITE_SUPABASE_KEY`.

Build pravi i `dist/_headers` (CSP sa Supabase domenom) i `dist/sw.js` (service worker sa spiskom fajlova). `public/_redirects` šalje sve adrese na `index.html`.

## Baza

- **Šema:** `supabase/migrations/` u lokalnom Saldo repo-u. Taj folder **nije u ovom repo-u ni na GitHub-u**, kao ni Android kod. Migracija se pokreće ručno u Supabase SQL Editor-u.
- **Tabele:** `wallets`, `images`, `categories`, `transactions`, `recurring_rules`, `balance_checks`.
- **Promene šeme:** samo aditivne, kao nova migracija, jer Android već koristi postojeće kolone.
- **Pravila koja se ne krše:**
  - novac je ceo broj u parama, nikad decimalni broj;
  - vreme je epoch u milisekundama, UTC;
  - stanje se ne čuva, nego se računa;
  - nema fizičkog brisanja, nego se postavlja `deleted_at`;
  - `updated_at` postavlja server.

## Struktura

```
src/
  core/     novac, datumi, valute, tekst
  db/       Dexie šema i tipovi
  domain/   računanje: stanja, tabela, filteri, statistika, kategorije
  data/     izmene u lokalnoj bazi
  sync/     sinhronizacija sa Supabase-om
  auth/     trajanje sesije i odjava
  ui/       boje meseci, skala grafikona, prevlačenje
  app/      React ekrani
e2e/        testovi u pregledaču
scripts/    test baza, service worker, ikone
docs/       uputstva
.github/    backup workflow
```

## Važne odluke

- **Mesečne naknade knjiži samo telefon.** Web samo čuva pravila i nikad ne šalje `last_generated_period`.
- **Početne kategorije pravi samo telefon.** One sadrže lične reči, a JavaScript sajta može da pročita svako, pa ne smeju u ovaj repo ni u bundle.
- **Sesija traje 30 dana od poslednjeg otvaranja.** To proverava web aplikacija, jer bi Supabase podešavanje važilo i za telefon.
- **Sign out odjavljuje samo web.** Koristi `scope: 'local'`, jer bi podrazumevani `global` odjavio i telefon.
- **Prekid mreže nije odjava.** Neposlate izmene ostaju lokalno i šalju se čim se veza vrati.

## Dokumentacija

| Fajl | Sadržaj |
|---|---|
| [SPEC.md](SPEC.md) | Specifikacija, sync protokol, pravila i status faza |
| [docs/PROVERA.md](docs/PROVERA.md) | Instalacija, ručna provera, novi član porodice, rešavanje problema |
| [docs/BACKUP.md](docs/BACKUP.md) | Podešavanje backup-a i test vraćanja |
