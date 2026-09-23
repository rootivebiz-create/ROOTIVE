#!/usr/bin/env bash
# =============================================================================
# ROOTIVE 利益管理システム  Vercel 自動デプロイ
#
#   Vercel プロジェクトの作成・リンク → 環境変数の設定 → 本番デプロイ
#   → 本番 URL の確定と NEXT_PUBLIC_APP_URL の設定 → Supabase の Site URL 更新
#   を 1 回で行います。何度実行しても壊れません（再実行 = 再デプロイ）。
#
# 使い方:
#   export VERCEL_TOKEN=xxxxxxxx                         # 必須（Account Settings → Tokens）
#   bash scripts/deploy-vercel.sh
#
#   Supabase の値は環境変数か、scripts/setup-supabase.sh --write-env が作った
#   .env.production.local から自動で読み込みます（環境変数が優先）。
#
# 環境変数:
#   VERCEL_TOKEN                   必須。Vercel のアクセストークン
#   VERCEL_SCOPE                   任意。チームで使う場合のチーム slug
#   VERCEL_PROJECT_NAME            任意。プロジェクト名（既定 rootive-profit）
#   NEXT_PUBLIC_SUPABASE_URL       Supabase の URL（初回は必須）
#   NEXT_PUBLIC_SUPABASE_ANON_KEY  Supabase の anon キー（初回は必須）
#   SUPABASE_SERVICE_ROLE_KEY      Supabase の service_role キー（初回は必須）
#   NEXT_PUBLIC_APP_URL            任意。未指定なら Vercel の本番 URL を自動で使う
#   ANTHROPIC_API_KEY              任意。AI 月次分析を使う場合
#   ANTHROPIC_MODEL                任意。AI のモデル名を変える場合
#   RESEND_API_KEY / MAIL_FROM     任意。請求書をメールで送る場合（両方そろったときだけ画面に出る）
#   CRON_SECRET                    任意。定期アクセス（/api/cron/keepalive）の認証。未設定なら自動生成
#   NEXT_PUBLIC_VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY
#                                  任意。端末へのプッシュ通知の鍵。未設定なら自動生成（一度作ったら作り直さない）
#   VAPID_SUBJECT                  任意。プッシュ通知の連絡先（mailto:…）。未設定ならオーナーのメール
#   SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF
#                                  任意。両方あれば Supabase の Site URL / Redirect URLs を自動更新
#
# 必要なもの: Node.js 20 以上（npx）または Vercel CLI（npm i -g vercel）、curl、jq（任意）
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_NAME="${VERCEL_PROJECT_NAME:-rootive-profit}"
ENV_FILE="$ROOT/.env.production.local"

log() { printf '\033[1;34m[deploy-vercel]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[注意]\033[0m %s\n' "$*" >&2; }
die() {
  printf '\033[1;31m[エラー]\033[0m %s\n' "$*" >&2
  exit 1
}
hr() { printf '%s\n' "----------------------------------------------------------------"; }

for a in "$@"; do
  case "$a" in
    -h | --help)
      sed -n '2,30p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) die "不明な引数です: $a" ;;
  esac
done

# ---------- .env.production.local の読み込み（環境変数が未設定の項目のみ） ----------
if [ -f "$ENV_FILE" ]; then
  log ".env.production.local を読み込みます（既に設定済みの環境変数は上書きしません）"
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in '' | \#*) continue ;; esac
    key="${line%%=*}"
    val="${line#*=}"
    key="$(printf '%s' "$key" | tr -d '[:space:]')"
    [[ "$key" =~ ^[A-Z_][A-Z0-9_]*$ ]] || continue
    # 両端の引用符を外す
    val="${val#\"}"; val="${val%\"}"; val="${val#\'}"; val="${val%\'}"
    if [ -z "${!key:-}" ]; then
      export "$key=$val"
    fi
  done <"$ENV_FILE"
fi

# ---------- 前提チェック ----------
# 貼り付け時に混入しがちな前後の空白・改行を除去（Vercel CLI は改行入りトークンを拒否する）
VERCEL_TOKEN="$(printf '%s' "${VERCEL_TOKEN:-}" | tr -d '[:space:]')"
SUPABASE_ACCESS_TOKEN="$(printf '%s' "${SUPABASE_ACCESS_TOKEN:-}" | tr -d '[:space:]')"
VERCEL_SCOPE="$(printf '%s' "${VERCEL_SCOPE:-}" | tr -d '[:space:]')"
[ -n "${VERCEL_TOKEN:-}" ] || die "VERCEL_TOKEN が未設定です。Vercel → 右上のアイコン → Account Settings → Tokens → Create で発行し、export VERCEL_TOKEN=... を実行してください。"
command -v curl >/dev/null 2>&1 || die "curl が見つかりません。"
if command -v vercel >/dev/null 2>&1; then
  VC=(vercel)
elif command -v npx >/dev/null 2>&1; then
  VC=(npx --yes vercel@latest)
  log "Vercel CLI が無いので npx 経由で実行します（初回はダウンロードに時間がかかります）"
else
  die "vercel コマンドも npx も見つかりません。Node.js 20 以上をインストールするか、npm i -g vercel を実行してください。"
fi
HAS_JQ=0
command -v jq >/dev/null 2>&1 && HAS_JQ=1

VC_ARGS=(--token "$VERCEL_TOKEN")
[ -n "${VERCEL_SCOPE:-}" ] && VC_ARGS+=(--scope "$VERCEL_SCOPE")
vc() { "${VC[@]}" "$@" "${VC_ARGS[@]}"; }

NEXT_PUBLIC_APP_URL="${NEXT_PUBLIC_APP_URL:-}"
NEXT_PUBLIC_APP_URL="${NEXT_PUBLIC_APP_URL%/}"
# 未確定を示す仮の値（<本番URL> など）は未設定として扱う
case "$NEXT_PUBLIC_APP_URL" in *'<'* | *'>'* | *本番URL*) NEXT_PUBLIC_APP_URL="" ;; esac

cd "$ROOT"
hr
log "ROOTIVE 利益管理システム  Vercel デプロイを開始します（プロジェクト: $PROJECT_NAME）"
hr

# ---------- (1) プロジェクトのリンク ----------
log "(1/5) Vercel アカウントを確認します"
who_err="$(mktemp)"
who="$(vc whoami 2>"$who_err" || true)"
if [ -z "$who" ]; then
  warn "vercel whoami の出力:"
  sed 's/^/    /' "$who_err" >&2 || true
  rm -f "$who_err"
  die "Vercel にログインできません。VERCEL_TOKEN（Account Settings → Tokens で発行、期限切れでないこと）と、チームのプロジェクトなら VERCEL_SCOPE（チームの slug）を確認してください。"
fi
rm -f "$who_err"
log "  ユーザー: $who"

log "(1/5) プロジェクトを作成・リンクします（既にあればそのまま使います）"
vc project add "$PROJECT_NAME" >/dev/null 2>&1 || true
vc link --yes --project "$PROJECT_NAME" >/dev/null || die "vercel link に失敗しました。プロジェクト名（$PROJECT_NAME）と権限を確認してください。"
PROJECT_ID=""
ORG_ID=""
if [ -f "$ROOT/.vercel/project.json" ] && [ "$HAS_JQ" = "1" ]; then
  PROJECT_ID="$(jq -r '.projectId // empty' "$ROOT/.vercel/project.json")"
  ORG_ID="$(jq -r '.orgId // empty' "$ROOT/.vercel/project.json")"
fi
log "  リンク完了（projectId: ${PROJECT_ID:-不明}）"

# 本番ドメインの取得（Vercel API）。取得できなければ空
production_url() {
  [ -n "$PROJECT_ID" ] && [ "$HAS_JQ" = "1" ] || return 0
  local team=""
  case "$ORG_ID" in team_*) team="?teamId=$ORG_ID" ;; esac
  local res
  res="$(curl -sS -H "Authorization: Bearer $VERCEL_TOKEN" "https://api.vercel.com/v9/projects/$PROJECT_ID/domains$team" 2>/dev/null || true)"
  [ -n "$res" ] || return 0
  # 独自ドメインがあれば優先、無ければ *.vercel.app
  local custom
  custom="$(jq -r '[.domains[]? | select(.name | endswith(".vercel.app") | not) | .name] | first // empty' <<<"$res")"
  if [ -n "$custom" ]; then
    printf 'https://%s' "$custom"
    return 0
  fi
  local vapp
  vapp="$(jq -r '[.domains[]? | select(.name | endswith(".vercel.app")) | .name] | first // empty' <<<"$res")"
  [ -n "$vapp" ] && printf 'https://%s' "$vapp"
  return 0
}

# ---------- (2) 環境変数 ----------
log "(2/5) 本番（production）環境変数を設定します"
SENSITIVE_FLAG=()
if "${VC[@]}" env add --help 2>&1 | grep -q -- '--sensitive'; then
  SENSITIVE_FLAG=(--sensitive)
fi
env_exists() {
  vc env ls production 2>/dev/null | awk '{print $1}' | grep -qx "$1"
}
# 新しい CLI は「資格情報に見える値」で保存方法を対話で聞くため、種別を明示して非対話にする
TYPE_FLAG_SUPPORTED=0
if "${VC[@]}" env add --help 2>&1 | grep -q -- '--type'; then
  TYPE_FLAG_SUPPORTED=1
fi
# Vercel REST API 呼び出し（CLI の対話プロンプトを避けるため環境変数の登録はこちらを優先）
# ステータスはコマンド置換（サブシェル）の中からでも受け取れるよう一時ファイルに書く
VERCEL_API_STATUS_FILE="$(mktemp)"
api_status() { cat "$VERCEL_API_STATUS_FILE" 2>/dev/null || echo 000; }
vercel_api() { # vercel_api METHOD PATH [JSON_BODY] → 本文を標準出力へ。HTTP ステータスは api_status で取得
  local method="$1" path="$2" body="${3:-}"
  local url="https://api.vercel.com$path"
  case "$ORG_ID" in
    team_*)
      case "$url" in *\?*) url="$url&teamId=$ORG_ID" ;; *) url="$url?teamId=$ORG_ID" ;; esac
      ;;
  esac
  local out
  out="$(mktemp)"
  local -a args=(-sS -o "$out" -w '%{http_code}' -X "$method" "$url" -H "Authorization: Bearer $VERCEL_TOKEN")
  if [ -n "$body" ]; then args+=(-H "Content-Type: application/json" --data-binary "$body"); fi
  local status
  status="$(curl "${args[@]}" || echo 000)"
  printf '%s' "$status" >"$VERCEL_API_STATUS_FILE"
  cat "$out"
  rm -f "$out"
}

set_env() { # set_env NAME VALUE [sensitive]
  local name="$1" value="$2" sensitive="${3:-0}"
  # (1) REST API で upsert（非対話・確実）
  if [ -n "$PROJECT_ID" ] && [ "$HAS_JQ" = "1" ]; then
    local type="plain"
    [ "$sensitive" = "1" ] && type="sensitive"
    local body res
    body="$(jq -cn --arg k "$name" --arg v "$value" --arg t "$type" '{key: $k, value: $v, type: $t, target: ["production"]}')"
    res="$(vercel_api POST "/v10/projects/$PROJECT_ID/env?upsert=true" "$body")"
    local st
    st="$(api_status)"
    if [ "${st:-0}" -ge 200 ] 2>/dev/null && [ "${st:-0}" -lt 300 ] 2>/dev/null; then
      log "  設定: $name"
      return 0
    fi
    warn "Vercel API での登録に失敗しました（HTTP ${st:-?}）: $(printf '%s' "$res" | tr -d '\n' | cut -c1-160)。CLI で再試行します"
  fi
  # (2) CLI（フォールバック）
  local -a flags=()
  vc env rm "$name" production --yes >/dev/null 2>&1 || true
  if [ "$sensitive" = "1" ]; then
    if [ "$TYPE_FLAG_SUPPORTED" = "1" ]; then flags=(--type sensitive); elif [ "${#SENSITIVE_FLAG[@]}" -gt 0 ]; then flags=("${SENSITIVE_FLAG[@]}"); fi
  else
    if [ "$TYPE_FLAG_SUPPORTED" = "1" ]; then flags=(--type config); fi
  fi
  local out
  if ! out="$(printf '%s' "$value" | vc env add "$name" production ${flags[@]+"${flags[@]}"} 2>&1 </dev/stdin)"; then
    # 種別フラグが受け付けられない場合はフラグ無しで再試行
    out="$(printf '%s' "$value" | vc env add "$name" production 2>&1)" || true
  fi
  if ! env_exists "$name"; then
    printf '%s\n' "$out" | sed 's/^/    /' >&2
    die "環境変数 $name を Vercel に登録できませんでした。Vercel ダッシュボードの Settings → Environment Variables で手動登録してください。"
  fi
  log "  設定: $name"
}
require_env() { # 値が無く Vercel にも未設定なら中断
  local name="$1"
  if [ -z "${!name:-}" ] && ! env_exists "$name"; then
    die "$name が未設定です。環境変数で渡すか、scripts/setup-supabase.sh --write-env で .env.production.local を作成してください。"
  fi
}
require_env NEXT_PUBLIC_SUPABASE_URL
require_env NEXT_PUBLIC_SUPABASE_ANON_KEY
require_env SUPABASE_SERVICE_ROLE_KEY

[ -n "${NEXT_PUBLIC_SUPABASE_URL:-}" ] && set_env NEXT_PUBLIC_SUPABASE_URL "${NEXT_PUBLIC_SUPABASE_URL%/}"
[ -n "${NEXT_PUBLIC_SUPABASE_ANON_KEY:-}" ] && set_env NEXT_PUBLIC_SUPABASE_ANON_KEY "$NEXT_PUBLIC_SUPABASE_ANON_KEY"
[ -n "${SUPABASE_SERVICE_ROLE_KEY:-}" ] && set_env SUPABASE_SERVICE_ROLE_KEY "$SUPABASE_SERVICE_ROLE_KEY" 1
[ -n "${ANTHROPIC_API_KEY:-}" ] && set_env ANTHROPIC_API_KEY "$ANTHROPIC_API_KEY" 1
[ -n "${ANTHROPIC_MODEL:-}" ] && set_env ANTHROPIC_MODEL "$ANTHROPIC_MODEL"
# 請求書のメール送付（0028）。鍵はサーバーだけで読む
[ -n "${RESEND_API_KEY:-}" ] && set_env RESEND_API_KEY "$RESEND_API_KEY" 1
[ -n "${MAIL_FROM:-}" ] && set_env MAIL_FROM "$MAIL_FROM"
# Vercel Cron（/api/cron/keepalive：Supabase の一時停止防止）の認証用。未設定なら生成する（Vercel が Bearer に自動付与）
if [ -n "${CRON_SECRET:-}" ]; then
  set_env CRON_SECRET "$CRON_SECRET" 1
elif ! env_exists CRON_SECRET; then
  set_env CRON_SECRET "$(LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 32)" 1
fi

# 端末へのプッシュ通知の鍵（VAPID）。**一度作ったら作り直さない**
#   作り直すと、すでに購読している端末すべてに通知が届かなくなるため、
#   Vercel 側に既にあるときは触らない（env_exists で確認する）。
if [ -n "${NEXT_PUBLIC_VAPID_PUBLIC_KEY:-}" ] && [ -n "${VAPID_PRIVATE_KEY:-}" ]; then
  set_env NEXT_PUBLIC_VAPID_PUBLIC_KEY "$NEXT_PUBLIC_VAPID_PUBLIC_KEY"
  set_env VAPID_PRIVATE_KEY "$VAPID_PRIVATE_KEY" 1
elif ! env_exists NEXT_PUBLIC_VAPID_PUBLIC_KEY || ! env_exists VAPID_PRIVATE_KEY; then
  log "  プッシュ通知の鍵（VAPID）を新しく作ります"
  VAPID_PAIR="$(node -e '
    const crypto = require("crypto");
    const b64url = (b) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const ecdh = crypto.createECDH("prime256v1");
    ecdh.generateKeys();
    let priv = ecdh.getPrivateKey();
    if (priv.length < 32) priv = Buffer.concat([Buffer.alloc(32 - priv.length), priv]);
    process.stdout.write(b64url(ecdh.getPublicKey()) + " " + b64url(priv));
  ')"
  set_env NEXT_PUBLIC_VAPID_PUBLIC_KEY "${VAPID_PAIR%% *}"
  set_env VAPID_PRIVATE_KEY "${VAPID_PAIR##* }" 1
fi
if [ -n "${VAPID_SUBJECT:-}" ]; then
  set_env VAPID_SUBJECT "$VAPID_SUBJECT"
elif ! env_exists VAPID_SUBJECT && [ -n "${OWNER_EMAIL:-}" ]; then
  set_env VAPID_SUBJECT "mailto:$OWNER_EMAIL"
fi

APP_URL_SOURCE="指定値"
if [ -z "$NEXT_PUBLIC_APP_URL" ]; then
  NEXT_PUBLIC_APP_URL="$(production_url)"
  APP_URL_SOURCE="Vercel の本番ドメイン"
fi
NEED_REDEPLOY=0
if [ -n "$NEXT_PUBLIC_APP_URL" ]; then
  set_env NEXT_PUBLIC_APP_URL "$NEXT_PUBLIC_APP_URL"
  log "  NEXT_PUBLIC_APP_URL = $NEXT_PUBLIC_APP_URL（$APP_URL_SOURCE）"
else
  warn "本番ドメインをまだ取得できないため、デプロイ後に NEXT_PUBLIC_APP_URL を設定して再デプロイします"
  NEED_REDEPLOY=1
fi

# ---------- (3) 本番デプロイ ----------
log "(3/5) 本番デプロイを実行します（数分かかります。リージョン: hnd1 東京）"
DEPLOY_URL="$(vc deploy --prod --yes)" || die "デプロイに失敗しました。上のログ（Build 失敗の場合は Vercel ダッシュボードの Deployments → 該当デプロイ → Build Logs）を確認してください。"
DEPLOY_URL="$(printf '%s' "$DEPLOY_URL" | grep -Eo 'https://[^ ]+' | tail -1 || true)"
log "  デプロイ URL: ${DEPLOY_URL:-（取得できず）}"

# ---------- (4) 本番 URL の確定 ----------
log "(4/5) 本番 URL を確定します"
if [ "$NEED_REDEPLOY" = "1" ]; then
  NEXT_PUBLIC_APP_URL="$(production_url)"
  [ -n "$NEXT_PUBLIC_APP_URL" ] || NEXT_PUBLIC_APP_URL="$DEPLOY_URL"
  [ -n "$NEXT_PUBLIC_APP_URL" ] || die "本番 URL を取得できませんでした。Vercel ダッシュボードの Project → Domains で URL を確認し、NEXT_PUBLIC_APP_URL に指定して再実行してください。"
  set_env NEXT_PUBLIC_APP_URL "$NEXT_PUBLIC_APP_URL"
  log "  NEXT_PUBLIC_APP_URL = $NEXT_PUBLIC_APP_URL を設定したので再デプロイします"
  vc deploy --prod --yes >/dev/null || die "再デプロイに失敗しました。"
fi
PROD_URL="$NEXT_PUBLIC_APP_URL"

# ---------- (5) Supabase の Site URL ----------
log "(5/5) Supabase の認証 URL 設定"
SUPABASE_UPDATED=0
if [ -n "${SUPABASE_ACCESS_TOKEN:-}" ] && [ -n "${SUPABASE_PROJECT_REF:-}" ] && [ "$HAS_JQ" = "1" ]; then
  api_base="https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF/config/auth"
  current="$(curl -sS -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" "$api_base" || true)"
  current_allow="$(jq -r '.uri_allow_list // ""' <<<"$current" 2>/dev/null || true)"
  # 既存の許可 URL とマージ（仮の文字列 <本番URL> を含む古い項目は除去）
  new_allow="$(printf '%s,%s/auth/confirm,%s/auth/callback,%s/**' "$current_allow" "$PROD_URL" "$PROD_URL" "$PROD_URL" \
    | tr ',' '\n' | sed '/^[[:space:]]*$/d' | grep -v '<' | grep -v '本番URL' | awk '!seen[$0]++' | paste -sd, -)"
  body="$(jq -cn --arg site "$PROD_URL" --arg allow "$new_allow" '{site_url: $site, uri_allow_list: $allow, disable_signup: true}')"
  status="$(curl -sS -o /tmp/deploy-vercel-auth.out -w '%{http_code}' -X PATCH "$api_base" \
    -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" --data-binary "$body" || echo 000)"
  if [ "$status" -ge 200 ] && [ "$status" -lt 300 ]; then
    SUPABASE_UPDATED=1
    log "  Supabase の Site URL = $PROD_URL / Redirect URLs = $new_allow に更新しました"
  else
    warn "Supabase の更新に失敗しました（HTTP $status）: $(cat /tmp/deploy-vercel-auth.out 2>/dev/null)"
  fi
  rm -f /tmp/deploy-vercel-auth.out
fi

hr
log "デプロイが完了しました"
hr
echo
printf '■ 本番 URL: \033[1m%s\033[0m\n' "$PROD_URL"
echo "  Vercel ダッシュボード: https://vercel.com/dashboard"
echo
if [ "$SUPABASE_UPDATED" = "1" ]; then
  echo "■ Supabase の Site URL / Redirect URLs は自動更新済みです"
else
  echo "■ Supabase の認証 URL を手動で更新してください（メール内リンクを正しくするため）"
  echo "  Supabase ダッシュボード → Authentication → URL Configuration"
  echo "    Site URL      : $PROD_URL"
  echo "    Redirect URLs : $PROD_URL/auth/confirm、$PROD_URL/auth/callback、$PROD_URL/**  を追加"
  echo "  ※ SUPABASE_ACCESS_TOKEN と SUPABASE_PROJECT_REF を環境変数に入れて再実行すると自動更新されます"
fi
echo
echo "■ 次のステップ"
echo "  1. scripts/setup-supabase.sh で表示された招待リンクをブラウザで開きます"
echo "       $PROD_URL/invite/<トークン>"
echo "     「ログインして始める」を押すとダッシュボードが開きます"
echo "  2. docs/SETUP.md の「動作確認チェックリスト」を確認します"
echo "  3. 以後、コードを更新したときは bash scripts/deploy-vercel.sh を再実行すると再デプロイされます"
echo
