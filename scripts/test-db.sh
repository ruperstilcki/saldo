#!/usr/bin/env bash
# Runs src/sync/database.test.ts against a real, throwaway Postgres and PostgREST in Docker, with the
# real migration and made-up data. It never connects to Supabase. Needs the migration from the local
# Saldo repo, one level above this one. Usage: npm run test:db
set -euo pipefail
cd "$(dirname "$0")/.."

MIGRATION=../supabase/migrations/20261108000000_initial.sql
NET=saldo-test-net
DB=saldo-test-db
API=saldo-test-api
PORT=3999
SECRET=test-secret-test-secret-test-secret-1234

cleanup() { docker rm -f "$DB" "$API" >/dev/null 2>&1 || true; docker network rm "$NET" >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup
docker network create "$NET" >/dev/null

docker run -d --name "$DB" --network "$NET" -e POSTGRES_PASSWORD=temp postgres:17 >/dev/null
for _ in $(seq 40); do docker exec "$DB" pg_isready -U postgres -h 127.0.0.1 >/dev/null 2>&1 && break; sleep 1; done
sleep 2

# What Supabase provides around the migration. Storage is tested separately, so that part is left out.
{
  cat <<'SQL'
create role anon nologin;
create role authenticated nologin;
create role authenticator login password 'temp' noinherit;
grant anon, authenticated to authenticator;
create schema auth;
grant usage on schema auth to anon, authenticated;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(nullif(current_setting('request.jwt.claims', true), '')::json->>'sub', '')::uuid
$$;
grant usage on schema public to anon, authenticated;
insert into auth.users values
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222');
SQL
  python3 -c "import sys; print(open(sys.argv[1]).read().split('-- ---------------------------------------------------------------- storage')[0])" "$MIGRATION"
} | docker exec -i "$DB" psql -q -v ON_ERROR_STOP=1 -U postgres

docker run -d --name "$API" --network "$NET" -p "127.0.0.1:$PORT:3000" \
  -e PGRST_DB_URI="postgres://authenticator:temp@$DB:5432/postgres" \
  -e PGRST_DB_SCHEMAS=public -e PGRST_DB_ANON_ROLE=anon -e PGRST_JWT_SECRET="$SECRET" \
  postgrest/postgrest:v12.2.3 >/dev/null
for _ in $(seq 40); do curl -fs "http://127.0.0.1:$PORT/" >/dev/null 2>&1 && break; sleep 1; done

SALDO_TEST_API="http://127.0.0.1:$PORT" SALDO_TEST_SECRET="$SECRET" npx vitest run src/sync/database.test.ts
