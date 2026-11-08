# Saldo Web: specifikacija

Web verzija postojeće Android aplikacije Saldo (lično praćenje stanja i potrošnje po novčanicima). Korisnici su autor i porodica. Android aplikacija već radi i sinhronizuje se sa Supabase-om; web se priključuje na **istu bazu i isti sync protokol**.

## Početni prompt za Claude Code

Otvori folder `Saldo/` u VS Code-u i nalepi:

> Pravimo web aplikaciju Saldo u folderu `web/`. Pročitaj ceo `web/SPEC.md`, pa odgovarajuće Kotlin fajlove koje on navodi kao referencu za poslovna pravila. Pre pisanja koda napravi plan po fazama W1–W5 i pokaži mi ga. Razgovaraj sa mnom na srpskom, a UI aplikacije je na engleskom. Ne menjaj ništa u `android/` ni `BankingAccounts/` i ne čitaj `legacy-data/` (privatni podaci). Radi fazu po fazu, sa testovima. Sve što treba da uradim ručno (Supabase, Cloudflare) napiši kao tačne korake.

---

## 1. Tehnologija i hosting

| Šta | Izbor | Zašto |
|---|---|---|
| Jezik i framework | TypeScript, React, Vite | Statična aplikacija: nema sopstvenog servera ni troška |
| Lokalna baza | IndexedDB preko Dexie | Web ima svoju lokalnu bazu i radi offline, kao Android |
| Server | Postojeći Supabase projekat (`supabase-js`) | Isti Postgres, Auth i Storage kao Android |
| Grafikoni | Recharts ili SVG | Dovoljno za statistiku iz §5 |
| Testovi | Vitest, Playwright za glavne tokove | |
| **Hosting** | **Cloudflare Pages, besplatan plan** | Statičan sajt, bez naplate; limit od 500 build-ova mesečno je daleko iznad potreba |

Rezerva za hosting: Vercel Hobby, koji je besplatan samo za ličnu, nekomercijalnu upotrebu.

Ciljani trošak je 0. Ne uvodi ništa što traži karticu ili plaćeni plan. Pre deploy-a proveri aktuelne limite na zvaničnim stranicama.

**Podržani pregledači:** Chrome na Android-u i desktop pregledači. Safari i iPhone nisu u planu, pa za WebP nije potreban dodatni enkoder.

**Bez SSR-a i bez sopstvenog backend-a.** Pošto je aplikacija SPA, dodaj `public/_redirects` sa redom `/* /index.html 200`.

### Konfiguracija

`web/.env.local` (van git-a) i `web/.env.example` (u git-u, bez vrednosti):

```
VITE_SUPABASE_URL=
VITE_SUPABASE_KEY=
```

Vrednosti su iste kao `supabase.url` i `supabase.key` iz `android/local.properties`. Ključ je `sb_publishable_…`: sme da bude u klijentu, a podatke štiti RLS. **`service_role` i `sb_secret_` ključevi nikad ne ulaze u web aplikaciju.**

### Ručni koraci za korisnika (daj ih kao uputstvo kad dođu na red)

1. Cloudflare → Workers & Pages → Pages → poveži privatni GitHub repo. Na GitHub ide samo web aplikacija (`android/` ostaje lokalno), pa je root aplikacije koren repo-a. Build `npm run build`, izlaz `dist`, env promenljive iz `.env.example`.
2. Supabase → Authentication → URL Configuration: **Site URL** je produkcioni URL; u **Redirect URLs** dodaj `https://<projekat>.pages.dev/**` i `http://localhost:5173/**`.
3. Google OAuth **Web** klijent i Google provider u Supabase-u su već podešeni. Prijava ide kroz Supabase callback, pa u Google Cloud ne treba ništa novo. Prijaviti se mogu samo nalozi dodati kao Test users.

## 2. Autentifikacija

- Samo Google: `supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } })`, PKCE tok.
- Isti Google nalog daje isti `user_id` kao na Android-u, pa korisnik vidi iste podatke.
- **Za razliku od Android-a, web traži prijavu.** Bez prijave se prikazuje samo ekran za prijavu.
- **Trajanje prijave:** korisnik ostaje prijavljen dok se ne odjavi ili dok ne istekne sesija. Sesija traje 30 dana, a svako otvaranje aplikacije u tom roku vraća je na punih 30 dana.
  - Istek proverava web aplikacija, jer Supabase podešavanje važi za ceo projekat i izbacivalo bi i telefon. To je pravilo aplikacije, a ne serverska zaštita.
  - Prekid mreže, neuspelo osvežavanje tokena ili pauziran projekat nisu odjava i ne brišu lokalne podatke.
- **Istek sesije:** posle isteka korisnik mora ponovo da se prijavi. Prvo se pokuša slanje neposlatih izmena, pa se lokalni podaci brišu kao kod odjave. Ako nema mreže, izmene ostaju sačuvane iza ekrana za prijavu i šalju se kad se isti nalog ponovo prijavi. Pre prijave drugog naloga prikaži upozorenje, pa obriši te izmene.
- **Sign out dugme odjavljuje samo web:** `signOut({ scope: 'local' })`. Podrazumevani `global` bi odjavio i telefon. Odjava sa svih uređaja nije predviđena.
- **Rad bez veze:** dok nema pristupa bazi, izmene se čuvaju lokalno i šalju čim se veza vrati.
- **Odjava briše IndexedDB** i kursore, ali tek pošto se pokuša slanje neposlatih izmena. Ako slanje ne uspe, odjava se završi, a izmene ostaju sačuvane iza ekrana za prijavu, isto kao kod isteka sesije.

## 3. Model podataka

Izvor istine je `supabase/migrations/20261108000000_initial.sql`. Tabele: `wallets`, `images`, `categories`, `transactions`, `recurring_rules`, `balance_checks`.

**Pravila koja se ne smeju prekršiti:**

- **Novac** je ceo broj u parama/centima (`*_minor`). Nikad `number` sa decimalama u računu: 145996 je 1.459,96.
- **Vreme** je epoch u milisekundama, UTC. Prikaz je u lokalnoj zoni.
- **ID** je tekstualni UUID koji generiše klijent. Primarni ključ na serveru je `(user_id, id)`, a kod `images` `(user_id, hash)`.
- **Stanje se nikad ne čuva**: `opening_balance_minor + Σ(INCOME, TRANSFER_IN) − Σ(EXPENSE, TRANSFER_OUT)`, bez redova koji imaju `deleted_at`.
- **Nema fizičkog brisanja**: brisanje postavlja `deleted_at`. RLS i ne dozvoljava DELETE.
- **Boje** su potpisan 32-bitni ARGB int, jer tako ih čuva Android (npr. `-14787912`). Pretvaranje: `'#' + ((c >>> 0) & 0xffffff).toString(16).padStart(6, '0')`. Pri upisu vrati potpisan int.
- **Enum vrednosti** su tekst: `kind` EXPENSE, INCOME, TRANSFER_OUT, TRANSFER_IN; `wallet_type` BANK, CARD, CASH, SAVINGS, ONLINE; `source` MANUAL, SMS_PASTE, RECURRING, IMPORT; `level` MAIN, SUB; kind kategorije EXPENSE, INCOME, BOTH.

**Promene šeme:** isključivo aditivne, kao nova numerisana migracija. Android je već u upotrebi i stare kolone moraju ostati.

## 4. Sinhronizacija

Mora se ponašati isto kao `android/app/src/main/java/rs/saldo/app/data/sync/SyncEngine.kt`.

Lokalno svaki red ima `syncState` (`CLEAN` ili `DIRTY`) i `updatedAt`. Svaka lokalna izmena postavlja `DIRTY` i `updatedAt = Date.now()`.

**Jedan krug sinhronizacije:**

1. **Push** redosledom: images, wallets, categories, recurring_rules, transactions, balance_checks.
   - `upsert` sa `onConflict: 'user_id,id'` (kod slika `'user_id,hash'`), u paketima do 500.
   - **Uvek šalji `deleted_at`, i kad je `null`**: inače vraćanje obrisanog reda (Undo) ne bi radilo na serveru.
   - Uvek šalji `created_at`. **Ne šalji `updated_at`**: postavlja ga serverski trigger.
   - Red postaje `CLEAN` samo ako mu se `updatedAt` nije promenio dok je slanje trajalo.
2. **Pull** redosledom: wallets, categories, recurring_rules, transactions, balance_checks, images.
   - Po tabeli: `eq('user_id', uid)`, `gt('updated_at', kursor)`, sortirano po `updated_at`, stranice po 500.
   - Lokalni red koji je `DIRTY` se ne prepisuje. On pobeđuje i šalje se u sledećem krugu.
   - Primljeni redovi se upisuju kao `CLEAN`.

**Kursor (važno):** kursor prati vreme servera, ne najnoviji red.

- Pre prvog upita u tabeli pročitaj vreme servera; posle pull-a `kursor = max(stari, vremeServera − 60000)`.
- Da je kursor vezan za najnoviji red, redovi poslati u istom minutu preuzimali bi se pri svakom sync-u. Ta greška je već ispravljena na Android-u (`SyncCursor.kt`).
- Android čita vreme iz HTTP `Date` zaglavlja, ali ga pregledač kroz CORS ne vidi. Zato koristi `supabase.rpc('saldo_now_ms')`. Ako poziv ne prolazi zbog prava, dodaj migraciju `grant execute on function public.saldo_now_ms() to authenticated;` i daj korisniku da je pokrene u SQL Editor-u.

**Kada se pokreće:** pri otvaranju i povratku na tab (`visibilitychange`), 5 sekundi posle poslednje izmene, odmah kad tab ode u pozadinu ili pre odjave ako ima neposlatih izmena, ručno preko dugmeta, i na događaj `online`. Tokom kruga drugi krug ne sme da krene (lock, i između tabova: Web Locks API).

**Slike:** privatni bucket `wallet-images`, putanja `<user_id>/<sha256>.webp`. Čitanje preko `download` ili kratkotrajnih potpisanih URL-ova, keširano lokalno. Upload pretvara sliku u kvadrat 256×256 WebP, ime je sha256 sadržaja. Sliku koju više ne koristi nijedan wallet soft-obriši i ukloni iz bucket-a, ali tek posle uspešnog pull-a, da se ne obriše slika wallet-a koji još nije preuzet.

**Pravilo za `remote_path`:** obrisana slika dobija `remote_path = null`. Izmenjena slika koja nije obrisana uvek se šalje u bucket (upsert), bez oslanjanja na `remote_path`, jer stari redovi mogu da imaju putanju bez fajla. Slika koja ne može da se preuzme ne prekida sync; wallet tada prikazuje inicijale.

### Šta web namerno NE radi u prvoj verziji

- **Ne pravi početne kategorije (seed) ni determinističke ID-jeve.** Seed sadrži lične ključne reči, a JS sajta može da pročita svako, pa ne sme u bundle ni na GitHub. Svi korisnici imaju telefon, a telefon već pravi seed. Ako nalog posle pull-a nema nijedan red kategorije, računajući i obrisane, web prikazuje poruku da se aplikacija prvo otvori na telefonu i ne dozvoljava pravljenje kategorija, da ne bi sprečio seed na telefonu.
- **Ne generiše mesečne naknade.** To radi samo telefon, kad se aplikacija otvori. Pravila se na webu pregledaju, prave, menjaju i brišu, a UI napominje da naknadu knjiži telefon. Generisanje sa dva mesta moglo bi da vrati naknadu koju je korisnik obrisao. Zato web pri slanju pravila izostavlja `last_generated_period`, da zastareo red ne bi vratio tu vrednost unazad.
- **Nema uvoza stare baze.** Taj uvoz je jednokratan i već je urađen na Android-u.
- **Nema "Paste bank SMS"** dok se ne napravi na Android-u.

## 5. Ekrani

Isti tokovi kao na telefonu (`SPEC.md` §3), ali iskoristi širinu ekrana. Na telefonu mora da radi jedna kolona, bez horizontalnog skrolovanja stranice. Na desktopu: lista wallet-a levo, tabela desno. UI je na engleskom; korisnički tekstovi ostaju kakvi jesu.

- **Wallets:** kartica Total po valuti (valute se nikad ne sabiraju međusobno), potrošnja u ovom mesecu, kartice sa slikom ili inicijalima, stanjem i poslednjom transakcijom. Prevlačenje menja redosled. Arhivirani su u posebnom prikazu.
- **Wallet (tabela):** kolone Date, Note, Amount. Header godine, zatim sticky header meseca (izlaz, ulaz, stanje na kraju meseca). Skupljanje i širenje meseci i godina. Klik na red otvara detalje sa Edit, Duplicate, Set/Remove checker, Delete + Undo.
- **Checker:** jedan po wallet-u (`wallets.checker_transaction_id`). Kružić i okvir oko reda; "Go to checker" raširi mesec i postavi red na sredinu ekrana. Isti je kao na telefonu.
- **Forma transakcije:** Expense/Income, iznos, datum i vreme, kategorija (autocomplete, quick chipovi, `Create "…"`), beleška, opciono strana valuta.
- **Forma wallet-a:** naziv (obavezan), tip, valuta (lista sa pretragom; zaključana kad wallet ima transakcije), početno stanje, boja, slika, beleška.
- **Pretraga i filteri:** tekst, period, tip, iznos, kategorija; na dnu broj stavki, ulaz, izlaz i neto.
- **Statistics:** po jednoj valuti; mesečna potrošnja sa prosekom, po kategorijama sa podkategorijama, ulaz i izlaz, top 10, klik vodi na filtrirane transakcije.
- **Categories:** Main/Sub/Unlinked, roditelj, boja, Quick pick, keywords, Merge, Delete.
- **Monthly fees:** lista, pravljenje, izmena i brisanje pravila, sa pregledom teksta i napomenom da naknadu knjiži telefon.
- **Settings:** nalog i status sync-a, tema (System/Light/Dark), jačina boja meseci, podrazumevano skupljanje meseci i godina, opcija "Show quick picks in autocomplete", odjava.

### Format prikaza

- Iznos je uvek `1.205.119,08` (tačka za hiljade, zarez za decimale), sa pravim minusom `−`. Znak `+` ili `−` razlikuje ulaz i izlaz; **iznosi nemaju zelenu ili crvenu boju**.
- Datum je uvek `dd.MM.yyyy`, vreme `HH:mm`.
- Boja kategorije je mali kvadratić levo od iznosa i okvir čipa. Podkategorija bez boje nasleđuje boju roditelja.

### Boje meseci

Redovi imaju blagu nijansu meseca, a zaglavlja meseca jaču nijansu iste boje. Tekst mora imati kontrast od najmanje 4.5:1.

| Mesec | Red, svetlo | Zaglavlje, svetlo | Osnova za tamnu temu |
|---|---|---|---|
| Jan | `#C9DCF7` | `#8FB8F0` | `#3D7BE0` |
| Feb | `#D7E6F7` | `#A6C8F2` | `#5B90E0` |
| Mar | `#D9EFE6` | `#9FD9C6` | `#3FB59A` |
| Apr | `#D8F0D8` | `#9DDB9F` | `#45B04A` |
| Maj | `#E8EFD9` | `#C9DB9A` | `#9DB04A` |
| Jun | `#FBE6E3` | `#F2B8B0` | `#E07A6E` |
| Jul | `#F8DAD7` | `#EC9F98` | `#E0574A` |
| Avg | `#FBE6E3` | `#F2B8B0` | `#E07A6E` |
| Sep | `#FCEAD8` | `#F5C79A` | `#E0954A` |
| Okt | `#FBF0C8` | `#F2D777` | `#E0C23D` |
| Nov | `#EDEDDD` | `#CFCFA8` | `#A9A98A` |
| Dec | `#DCE4F2` | `#A9BCE0` | `#6E8FC8` |

Tamna tema: osnova preko površine, alfa 18 % za red i 42 % za zaglavlje. Zaglavlje mora biti neprovidno, jer je sticky. "Subtle": 9 % i 28 % u tamnoj temi; u svetloj 50 % mešavine sa površinom za red i 60 % za zaglavlje. "Off": bez boje reda, zaglavlje neutralno.

## 6. Referentna pravila u Android kodu

Prenesi logiku u TypeScript i prenesi i testove iz `android/app/src/test/`, sa istim očekivanim vrednostima. Sve putanje su pod `android/app/src/main/java/rs/saldo/app/`.

| Oblast | Fajl |
|---|---|
| Parsiranje i format iznosa (`2.1091` je greška) | `core/Money.kt` |
| Grupisanje, zbirovi, stanja na kraju meseca | `ui/wallet/TableModel.kt` |
| Pretraga i filteri | `domain/search/TxFilter.kt` |
| Statistika | `domain/stats/Stats.kt` |
| Autocomplete kategorija | `domain/categorize/CategorySuggest.kt` |
| Prikaz beleške sa nalepljenim SMS-om | `domain/categorize/NoteDisplay.kt`, `domain/categorize/Categorizer.kt` |
| Šablon naknade | `domain/fee/MonthlyFee.kt` |
| Brisanje i spajanje kategorija | `data/repo/CategoryRepository.kt` |
| Sync | `data/sync/SyncEngine.kt`, `data/sync/SyncCursor.kt`, `data/sync/RemoteModels.kt` |

## 7. Bezbednost i privatnost

- Ovo su stvarni finansijski podaci. **Ne loguj beleške, iznose ni tokene.** Bez analitike i spoljnih trackera.
- U testovima i fixture-ima koristi samo izmišljene podatke. `legacy-data/` se ne čita i ne ide u git.
- Dodaj Content-Security-Policy preko `public/_headers`, dozvoli samo sopstveni origin i Supabase domen, plus `blob:` za lokalno keširane slike. Supabase domen se upisuje u build koraku iz env promenljive.
- Proveri RLS stvarnim testom: drugi nalog ne sme da vidi tuđe redove.

## 8. Faze

| Faza | Sadržaj | Provera |
|---|---|---|
| **W1** | Backup (§10), Vite projekat, Google prijava i sesija, Dexie šema, sync (push pa pull), spisak wallet-a sa stanjima, mali dijalog za izmenu beleške radi testa push-a, deploy na Cloudflare Pages | Podaci sa telefona se vide na webu; stanja wallet-a su ista kao na telefonu, do pare |
| **W2** | Wallets i tabela, boje meseci, skupljanje, checker, detalji | Izgled i zbirovi po mesecima se slažu sa telefonom |
| **W3** | Forme, brisanje + Undo, slike | Izmena na webu se vidi na telefonu i obrnuto; Undo ostaje vraćen i posle sync-a |
| **W4** | Pretraga, filteri, statistika, kategorije, naknade, podešavanja | Isti filter daje isti broj stavki i zbir kao na telefonu |
| **W5** | Responzivnost, PWA sa service worker-om (obavezno, da se sajt otvori i bez interneta), offline test, završno uputstvo | Izmene napravljene offline stižu na telefon posle povezivanja |

## 9. Završetak W1: test koji mora da prođe

1. Korisnik izmeni transakciju na telefonu; posle sync-a je ista na webu.
2. Korisnik izmeni transakciju na webu; posle otvaranja aplikacije je ista na telefonu.
3. Drugi sync bez izmena preuzima **najviše redove iz poslednjeg minuta**, ne celu tabelu.
4. Na serveru nema dupliranih kategorija po istom nazivu.

## 10. Backup

Nedeljni backup ide na Google Drive, a kopija na računaru se može dodati kasnije. Mora da postoji i da je proveren pre prvog upisa sa weba u stvarne podatke.

- Pokreće ga GitHub Action iz web repo-a (`.github/workflows/backup.yml`), nedeljno i ručno. Lozinke su samo u GitHub Secrets i ne ulaze u web aplikaciju.
- Backup je `pg_dump` šema `public` i `auth`. Slike nisu obuhvaćene (odluka korisnika).
- Fajl se šifruje sa `gpg` pre slanja, pa Google i GitHub ne vide podatke. Lozinka za šifrovanje se čuva i van GitHub-a, jer se bez nje backup ne može vratiti.
- Na Drive-u se čuva poslednjih 12 nedelja.
- Svaki backup proverava da li se fajl dešifruje i da li sadrži svih 6 tabela. Pre prvog upisa sa weba jednom se proverava i pravo vraćanje u privremenu lokalnu bazu.
