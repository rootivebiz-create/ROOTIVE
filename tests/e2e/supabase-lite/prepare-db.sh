#!/usr/bin/env bash
# E2E 用 DB の準備：ローカル PostgreSQL（既定 127.0.0.1:54329）を起動し、指定 DB を作り直して
# tests/sql/auth_stub.sql と supabase/migrations/*.sql を適用する（tests/sql/run.sh と同じ手順）
#
# 使い方: bash tests/e2e/supabase-lite/prepare-db.sh [dbname]   （既定 rootive_e2e）
#   環境変数 TEST_DATABASE_URL を指定すると既存の PostgreSQL を使う（DB は作り直される）
#   TEST_PG_PORT（既定 54329）、PG_BIN（既定 /usr/lib/postgresql/<最新>/bin）
# 最後に "PG_STARTED=0|1" と "DB_URL=..." を出力する（呼び出し側が読む）
set -euo pipefail
export PGOPTIONS="${PGOPTIONS:---client-min-messages=warning}"
cd "$(dirname "$0")/../../.."
ROOT="$(pwd)"
PG_BIN="${PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
PORT="${TEST_PG_PORT:-54329}"
DBNAME="${1:-rootive_e2e}"
STARTED=0

log() { echo "[e2e:db] $*"; }

start_local_pg() {
  local DATA="$ROOT/tests/sql/.pg/data"
  if pg_isready -h 127.0.0.1 -p "$PORT" >/dev/null 2>&1; then
    log "PostgreSQL は既に起動しています (port $PORT)"
    return
  fi
  if [ ! -f "$DATA/PG_VERSION" ]; then
    mkdir -p "$ROOT/tests/sql/.pg"
    if [ "$(id -u)" = "0" ]; then
      chown -R postgres:postgres "$ROOT/tests/sql/.pg"
      su postgres -c "$PG_BIN/initdb -D '$DATA' -U postgres --auth=trust -E UTF8 --locale=C.UTF-8" >/dev/null
    else
      "$PG_BIN/initdb" -D "$DATA" -U postgres --auth=trust -E UTF8 --locale=C.UTF-8 >/dev/null
    fi
  fi
  local CMD="$PG_BIN/pg_ctl -D '$DATA' -o '-p $PORT -c listen_addresses=127.0.0.1' -l '$ROOT/tests/sql/.pg/pg.log' start"
  if [ "$(id -u)" = "0" ]; then su postgres -c "$CMD" >/dev/null; else eval "$CMD" >/dev/null; fi
  STARTED=1
  for _ in $(seq 1 30); do pg_isready -h 127.0.0.1 -p "$PORT" >/dev/null 2>&1 && break; sleep 0.5; done
  log "PostgreSQL を起動しました (port $PORT)"
}

if [ -n "${TEST_DATABASE_URL:-}" ]; then
  ADMIN_URL="$TEST_DATABASE_URL"
else
  start_local_pg
  ADMIN_URL="postgresql://postgres@127.0.0.1:$PORT/postgres"
fi

BASE_URL="${ADMIN_URL%/*}"
DB_URL="$BASE_URL/$DBNAME"

log "DB を作り直します: $DBNAME"
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -q -c "drop database if exists $DBNAME with (force)" -c "create database $DBNAME"

log "auth スタブを適用"
psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f tests/sql/auth_stub.sql

for f in supabase/migrations/*.sql; do
  log "適用: $f"
  psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f "$f"
done

echo "PG_STARTED=$STARTED"
echo "DB_URL=$DB_URL"
