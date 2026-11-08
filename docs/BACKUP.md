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
docker exec saldo-restore psql -U postgres -c "create role anon; create role authenticated; create role service_role;"
docker exec saldo-restore pg_restore -U postgres -d postgres --no-owner --no-privileges --exit-on-error /saldo.dump
docker exec saldo-restore psql -U postgres -c "select (select count(*) from public.wallets) wallets, (select count(*) from public.transactions) transactions, (select count(*) from public.categories) categories;"
docker rm -f saldo-restore
rm saldo.dump
```

The counts must match the app. Delete the decrypted file afterwards: it holds real financial data.
