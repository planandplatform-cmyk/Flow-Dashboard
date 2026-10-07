#!/usr/bin/env bash
# Spins up a throwaway Postgres, applies a Supabase shim + all migrations +
# the demo seed, then runs the RLS test. No Docker or Supabase CLI needed.
#
#   npm run test:rls
#
# To run the same test against a real Supabase project instead:
#   psql "$DATABASE_URL" -f supabase/tests/rls.test.sql
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PG_BIN="${PG_BIN:-$(dirname "$(command -v pg_ctl 2>/dev/null || ls /usr/lib/postgresql/*/bin/pg_ctl | tail -1)")}"
WORK="$(mktemp -d)"
PORT="${RLS_TEST_PORT:-54329}"

cleanup() {
  "$PG_BIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

# initdb refuses to run as root; use a dedicated user when needed.
RUN=()
if [ "$(id -u)" = "0" ]; then
  id pgtest >/dev/null 2>&1 || useradd -M -s /bin/false pgtest
  chown -R pgtest "$WORK"
  chmod o+rx "$ROOT" "$ROOT/supabase" "$ROOT/supabase/migrations" "$ROOT/supabase/tests" 2>/dev/null || true
  RUN=(runuser -u pgtest --)
fi

"${RUN[@]}" "$PG_BIN/initdb" -D "$WORK/data" -U postgres --auth=trust >/dev/null
"${RUN[@]}" "$PG_BIN/pg_ctl" -D "$WORK/data" -o "-p $PORT -k $WORK -c listen_addresses=''" -l "$WORK/log" -w start >/dev/null

PSQL=(psql -h "$WORK" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q -X)

echo "Applying Supabase shim"
"${PSQL[@]}" -f "$ROOT/supabase/tests/supabase-shim.sql"

for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "Applying $(basename "$f")"
  "${PSQL[@]}" -f "$f"
done

echo "Loading seed"
"${PSQL[@]}" -f "$ROOT/supabase/seed.sql"
"${PSQL[@]}" -t -c "select 'seed rows: ' || count(*) from public.metrics_daily"

echo "Running RLS test"
"${PSQL[@]}" -t -f "$ROOT/supabase/tests/rls.test.sql"
