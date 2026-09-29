#!/usr/bin/env bash
# 手元で「Vercel と同じく、追跡されたファイルだけ」の状態で PDF が描けるかを確かめる。
#
#   bash scripts/check-pdf-bundle.sh
#
# Next.js の standalone ビルド（.next-bundle-check/standalone）は node_modules を追跡された分しか持たない。
# Vercel の関数と同じなので、手元の完全な node_modules では起きない「ファイルが見つからない」をここで再現できる
# （例：pdfkit の標準フォント #standard-fonts/Helvetica は追跡されず、本番だけ PDF が失敗した）。
# /api/health/pdf を呼び、ok でなければ 1 で終わる。
set -euo pipefail
cd "$(dirname "$0")/.."
PORT="${PORT:-3199}"
DIST=".next-bundle-check"

echo "[check-pdf-bundle] standalone でビルドします（$DIST）"
# next build は distDir が違うと tsconfig.json を書き換える（include に $DIST/types を足す・整形し直す）ので、終わったら元に戻す
cp tsconfig.json "$DIST.tsconfig.bak"
restore_tsconfig() { [ -f "$DIST.tsconfig.bak" ] && mv -f "$DIST.tsconfig.bak" tsconfig.json; }
BUILD_OK=1
NEXT_BUNDLE_CHECK=1 npx next build >"$DIST.build.log" 2>&1 || BUILD_OK=0
restore_tsconfig
[ "$BUILD_OK" = 1 ] || { tail -40 "$DIST.build.log"; exit 1; }

cd "$DIST/standalone"
# Supabase の設定は無しで起動する（/api/health/pdf は会社の情報を使わない）
env -u NEXT_PUBLIC_SUPABASE_URL -u NEXT_PUBLIC_SUPABASE_ANON_KEY PORT="$PORT" HOSTNAME=127.0.0.1 node server.js >"../server.log" 2>&1 &
PID=$!
trap 'kill $PID 2>/dev/null || true' EXIT
for _ in $(seq 1 60); do
  curl -s -o /dev/null "http://127.0.0.1:$PORT/api/health/pdf" && break
  sleep 0.5
done
BODY="$(curl -s "http://127.0.0.1:$PORT/api/health/pdf" || true)"
echo "[check-pdf-bundle] /api/health/pdf → $BODY"
case "$BODY" in
  *'"ok":true'*) echo "[check-pdf-bundle] OK：追跡されたファイルだけで PDF を描けました" ;;
  *) echo "[check-pdf-bundle] NG：本番（Vercel）でも失敗します"; exit 1 ;;
esac
