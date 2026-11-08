# Backup

Weekly encrypted `pg_dump` to Google Drive, in the `SaldoBackup` folder. Run by `.github/workflows/backup.yml`.

## Setup

Add three secrets in GitHub: repo → Settings → Secrets and variables → Actions → New repository secret.

**`BACKUP_DB_URL`**: Supabase → Connect → Session pooler → copy the URI and put in the database password. Special characters in the password must be URL-encoded. GitHub runners use IPv4, so the Direct connection does not work on the free plan.

**`BACKUP_PASSPHRASE`**: generate it with `openssl rand -base64 32`. Save it in a password manager too: without it no backup can ever be restored.

**`RCLONE_CONFIG_B64`**:

```sh
sudo apt install rclone
rclone config create gdrive drive scope=drive.file
base64 -w0 ~/.config/rclone/rclone.conf
```

The second command opens a browser for the Google sign-in. Paste the output of the third one as the secret. It gives access to your Drive, so do not share it anywhere else.

Then run it: repo → Actions → Database backup → Run workflow.

## Restore test

Needs Docker, and only touches a temporary local database. Download the newest file from Drive to an empty folder and run this there:

```sh
gpg --output saldo.dump --decrypt saldo-*.dump.gpg
docker run -d --name saldo-restore -e POSTGRES_PASSWORD=temp postgres:17
sleep 5
docker cp saldo.dump saldo-restore:/saldo.dump
docker exec saldo-restore psql -U postgres -c "drop schema public cascade; create role anon; create role authenticated; create role service_role;"
docker exec saldo-restore pg_restore -U postgres -d postgres --no-owner --no-privileges /saldo.dump
docker exec saldo-restore psql -U postgres -c "select w.name, w.currency_code, (w.opening_balance_minor + coalesce(sum(case when t.kind in ('INCOME','TRANSFER_IN') then t.amount_minor else -t.amount_minor end) filter (where t.deleted_at is null), 0)) / 100.0 as balance from public.wallets w left join public.transactions t on t.user_id = w.user_id and t.wallet_id = w.id where w.deleted_at is null group by w.user_id, w.id order by w.name;"
docker rm -f saldo-restore
rm saldo.dump
```

The balances must match the app, to the para. The last two commands remove the decrypted copies: they hold real financial data.
