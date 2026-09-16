#!/usr/bin/env bash
# SQL 結合テスト：ローカル PostgreSQL に auth スタブ＋全マイグレーションを適用し、test.sql を実行する
# 使い方: npm run test:sql
#   環境変数 TEST_DATABASE_URL を指定すると既存の PostgreSQL を使う（DB は作り直される）
#   未指定なら tests/sql/.pg に一時クラスタを作成して起動する（postgres ユーザーで実行）
set -euo pipefail
cd "$(dirname "$0")/../.."
ROOT="$(pwd)"
PG_BIN="${PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
PORT="${TEST_PG_PORT:-54329}"
DBNAME="rootive_test"
STARTED=0

log() { echo "[test:sql] $*"; }

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
}

if [ -n "${TEST_DATABASE_URL:-}" ]; then
  ADMIN_URL="$TEST_DATABASE_URL"
else
  start_local_pg
  ADMIN_URL="postgresql://postgres@127.0.0.1:$PORT/postgres"
fi

BASE_URL="${ADMIN_URL%/*}"
DB_URL="$BASE_URL/$DBNAME"

log "テスト DB を作り直します: $DBNAME"
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -q -c "drop database if exists $DBNAME" -c "create database $DBNAME"

log "auth スタブを適用"
psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f tests/sql/auth_stub.sql

for f in supabase/migrations/*.sql; do
  log "適用: $f"
  psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f "$f"
done

log "テストを実行: tests/sql/test.sql"
psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f tests/sql/test.sql
log "すべての SQL テストが通りました"

if [ "$STARTED" = "1" ] && [ "${KEEP_PG:-0}" != "1" ]; then
  CMD="$PG_BIN/pg_ctl -D '$ROOT/tests/sql/.pg/data' stop -m fast"
  if [ "$(id -u)" = "0" ]; then su postgres -c "$CMD" >/dev/null; else eval "$CMD" >/dev/null; fi
fi
