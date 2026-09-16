#!/usr/bin/env bash
# =============================================================================
# ROOTIVE 利益管理システム  Supabase 自動セットアップ（Management API 版）
#
#   Supabase プロジェクトの作成 → スキーマ適用 → 会社・オーナー招待の作成
#   → 認証設定（自由登録 OFF・URL・日本語メールテンプレート）→ API キー取得
#   を 1 回で行います。何度実行しても壊れません（冪等）。
#
# 使い方:
#   export SUPABASE_ACCESS_TOKEN=sbp_xxxxxxxx      # 必須（Account → Access Tokens）
#   export SUPABASE_ORG_ID=xxxxxxxx                # 新規作成時（組織が 1 つなら自動検出）
#   export APP_URL=https://rootive-profit.vercel.app  # 本番 URL（未定なら省略可。後で deploy-vercel.sh が更新）
#   bash scripts/setup-supabase.sh [--write-env]
#
# 環境変数:
#   SUPABASE_ACCESS_TOKEN  必須。Personal Access Token
#   SUPABASE_ORG_ID        新規作成時に必須（組織 slug）。組織が 1 つだけなら省略可
#   SUPABASE_PROJECT_REF   既存プロジェクトを使う場合の参照 ID（例 abcdefghijklmnopqrst）
#   SUPABASE_PROJECT_NAME  作成するプロジェクト名（既定 rootive-profit。同名があれば再利用）
#   SUPABASE_DB_PASSWORD   新規作成時の DB パスワード（未指定なら生成して表示）
#   APP_URL                本番 URL（Site URL・招待リンクに使用。未定なら後で更新できます）
#   OWNER_EMAIL            オーナーのメール（既定 rootive.biz@gmail.com）
#   COMPANY_NAME           会社名（既定 株式会社ROOTIVE）
#
# オプション:
#   --write-env   取得したキーを .env.production.local に書き込む（既定は画面表示のみ）
#
# 必要なコマンド: bash 4 以上、curl、jq
# =============================================================================
set -euo pipefail

API="https://api.supabase.com/v1"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEMPLATE_DIR="$ROOT/supabase/email-templates"
MIGRATION_DIR="$ROOT/supabase/migrations"
SETUP_ALL="$ROOT/supabase/setup_all.sql"

# 貼り付け時に混入しがちな前後の空白・改行を除去
SUPABASE_ACCESS_TOKEN="$(printf '%s' "${SUPABASE_ACCESS_TOKEN:-}" | tr -d '[:space:]')"
OWNER_EMAIL="${OWNER_EMAIL:-rootive.biz@gmail.com}"
COMPANY_NAME="${COMPANY_NAME:-株式会社ROOTIVE}"
APP_URL="${APP_URL:-}"
APP_URL="${APP_URL%/}"
SUPABASE_PROJECT_NAME="${SUPABASE_PROJECT_NAME:-rootive-profit}"
SUPABASE_PROJECT_REF="${SUPABASE_PROJECT_REF:-}"
SUPABASE_ORG_ID="${SUPABASE_ORG_ID:-}"
SUPABASE_DB_PASSWORD="${SUPABASE_DB_PASSWORD:-}"
WRITE_ENV=0

usage() {
  sed -n '2,30p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

for a in "$@"; do
  case "$a" in
    --write-env) WRITE_ENV=1 ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      echo "不明な引数です: $a" >&2
      usage
      exit 1
      ;;
  esac
done

# ---------- 表示 ----------
log() { printf '\033[1;34m[setup-supabase]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[注意]\033[0m %s\n' "$*" >&2; }
die() {
  printf '\033[1;31m[エラー]\033[0m %s\n' "$*" >&2
  exit 1
}
hr() { printf '%s\n' "----------------------------------------------------------------"; }

# ---------- 前提チェック ----------
if ! command -v jq >/dev/null 2>&1; then
  cat >&2 <<'EOF'
[エラー] jq が見つかりません。次のいずれかでインストールしてから再実行してください。
  macOS   : brew install jq
  Ubuntu  : sudo apt-get install -y jq
  Windows : winget install jqlang.jq  （Git Bash か WSL で実行）
  その他  : https://jqlang.github.io/jq/download/
EOF
  exit 1
fi
command -v curl >/dev/null 2>&1 || die "curl が見つかりません。インストールしてから再実行してください。"
[ -n "${SUPABASE_ACCESS_TOKEN:-}" ] || die "SUPABASE_ACCESS_TOKEN が未設定です。Supabase ダッシュボード → 右上のアイコン → Account Settings → Access Tokens で発行し、export SUPABASE_ACCESS_TOKEN=... を実行してください。"
[ -d "$MIGRATION_DIR" ] || [ -f "$SETUP_ALL" ] || die "supabase/migrations も supabase/setup_all.sql も見つかりません。リポジトリのルートで実行してください。"
[ -d "$TEMPLATE_DIR" ] || die "supabase/email-templates が見つかりません。"

# ---------- Management API 呼び出し ----------
# api METHOD PATH [JSON_BODY]  → 成功時は本文を標準出力へ。失敗時は HTTP ステータスと本文を表示して終了
api() {
  local method="$1" path="$2" body="${3:-}"
  local out status bodyfile=""
  out="$(mktemp)"
  local -a args=(-sS -o "$out" -w '%{http_code}' -X "$method" "$API$path"
    -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Accept: application/json")
  if [ -n "$body" ]; then
    bodyfile="$(mktemp)"
    printf '%s' "$body" >"$bodyfile"
    args+=(-H "Content-Type: application/json" --data-binary "@$bodyfile")
  fi
  if ! status="$(curl "${args[@]}")"; then
    rm -f "$out"
    if [ -n "$bodyfile" ]; then rm -f "$bodyfile"; fi
    die "curl の実行に失敗しました（$method $path）。ネットワーク接続を確認してください。"
  fi
  if [ "$status" -lt 200 ] || [ "$status" -ge 300 ]; then
    printf '\033[1;31m[エラー]\033[0m Supabase API が失敗しました: %s %s → HTTP %s\n' "$method" "$path" "$status" >&2
    if [ -s "$out" ]; then
      printf '応答本文:\n' >&2
      (jq . "$out" 2>/dev/null || cat "$out") >&2
      echo >&2
    fi
    case "$status" in
      401) echo "→ SUPABASE_ACCESS_TOKEN が正しいか（期限切れでないか）確認してください。" >&2 ;;
      403) echo "→ このトークンには対象の組織・プロジェクトへの権限がありません。" >&2 ;;
      404) echo "→ プロジェクト参照 ID（SUPABASE_PROJECT_REF）や組織 ID が正しいか確認してください。" >&2 ;;
      429) echo "→ API の呼び出し回数制限です。1 分ほど待ってから再実行してください。" >&2 ;;
    esac
    rm -f "$out"
    if [ -n "$bodyfile" ]; then rm -f "$bodyfile"; fi
    exit 1
  fi
  cat "$out"
  rm -f "$out"
  if [ -n "$bodyfile" ]; then rm -f "$bodyfile"; fi
}

# api_try METHOD PATH JSON_BODY → 失敗しても終了しない。HTTP ステータスを標準出力へ、本文を API_TRY_BODY へ
API_TRY_BODY=""
api_try() {
  local method="$1" path="$2" body="${3:-}"
  local out bodyfile="" status
  out="$(mktemp)"
  local -a args=(-sS -o "$out" -w '%{http_code}' -X "$method" "$API$path"
    -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Accept: application/json")
  if [ -n "$body" ]; then
    bodyfile="$(mktemp)"
    printf '%s' "$body" >"$bodyfile"
    args+=(-H "Content-Type: application/json" --data-binary "@$bodyfile")
  fi
  status="$(curl "${args[@]}" || echo 000)"
  API_TRY_BODY="$(cat "$out" 2>/dev/null || true)"
  rm -f "$out"
  if [ -n "$bodyfile" ]; then rm -f "$bodyfile"; fi
  printf '%s' "$status"
}

# run_sql REF SQL_TEXT [LABEL] → SQL を実行し、結果 JSON（最後の文の行配列）を標準出力へ
run_sql() {
  local ref="$1" sql="$2" label="${3:-SQL}"
  local body attempt result
  body="$(jq -cn --arg q "$sql" '{query: $q}')"
  for attempt in 1 2 3 4 5; do
    if result="$(api POST "/projects/$ref/database/query" "$body" 2>/tmp/setup-supabase-sql.err)"; then
      printf '%s' "$result"
      rm -f /tmp/setup-supabase-sql.err
      return 0
    fi
    # api() は失敗時に exit するため通常ここには来ないが、サブシェル内なので続行できる
    if grep -q 'HTTP 5' /tmp/setup-supabase-sql.err 2>/dev/null && [ "$attempt" -lt 5 ]; then
      warn "$label: データベースの準備待ちのため ${attempt} 回目の再試行を 15 秒後に行います"
      sleep 15
      continue
    fi
    cat /tmp/setup-supabase-sql.err >&2
    rm -f /tmp/setup-supabase-sql.err
    return 1
  done
  return 1
}

sql_quote() { # 文字列を SQL リテラル用にエスケープ（' → ''）
  printf '%s' "$1" | sed "s/'/''/g"
}

# =============================================================================
hr
log "ROOTIVE 利益管理システム  Supabase セットアップを開始します"
log "オーナー: $OWNER_EMAIL / 会社名: $COMPANY_NAME / 本番 URL: ${APP_URL:-（未定）}"
hr

# ---------- (1) プロジェクトの作成または確認 ----------
if [ -n "$SUPABASE_PROJECT_REF" ]; then
  log "(1/6) 既存プロジェクトを使用します: $SUPABASE_PROJECT_REF"
  proj="$(api GET "/projects/$SUPABASE_PROJECT_REF")"
  PROJECT_REF="$SUPABASE_PROJECT_REF"
  log "  名前: $(jq -r .name <<<"$proj") / リージョン: $(jq -r .region <<<"$proj") / 状態: $(jq -r .status <<<"$proj")"
else
  log "(1/6) プロジェクトを確認しています（名前: $SUPABASE_PROJECT_NAME）"
  if [ -z "$SUPABASE_ORG_ID" ]; then
    orgs="$(api GET "/organizations")"
    org_count="$(jq 'length' <<<"$orgs")"
    if [ "$org_count" = "1" ]; then
      SUPABASE_ORG_ID="$(jq -r '.[0].id' <<<"$orgs")"
      log "  組織を自動検出しました: $(jq -r '.[0].name' <<<"$orgs") ($SUPABASE_ORG_ID)"
    else
      echo "組織が複数（または 0 件）あります。SUPABASE_ORG_ID に使用する組織の ID を指定してください:" >&2
      jq -r '.[] | "  \(.id)\t\(.name)"' <<<"$orgs" >&2
      exit 1
    fi
  fi
  existing="$(api GET "/projects" | jq -r --arg n "$SUPABASE_PROJECT_NAME" --arg o "$SUPABASE_ORG_ID" \
    '[.[] | select(.name == $n and .organization_id == $o)] | first | .id // empty')"
  if [ -n "$existing" ]; then
    PROJECT_REF="$existing"
    log "  同名のプロジェクトが既にあるため再利用します: $PROJECT_REF"
  else
    if [ -z "$SUPABASE_DB_PASSWORD" ]; then
      SUPABASE_DB_PASSWORD="$(LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 28)"
      GENERATED_PW=1
    else
      GENERATED_PW=0
    fi
    log "  新規プロジェクトを作成します（リージョン: ap-northeast-1 / 東京、プラン: free）"
    create_body="$(jq -cn --arg name "$SUPABASE_PROJECT_NAME" --arg org "$SUPABASE_ORG_ID" --arg pw "$SUPABASE_DB_PASSWORD" \
      '{name: $name, organization_id: $org, db_pass: $pw, region: "ap-northeast-1", plan: "free"}')"
    created="$(api POST "/projects" "$create_body")"
    PROJECT_REF="$(jq -r '.id' <<<"$created")"
    [ -n "$PROJECT_REF" ] && [ "$PROJECT_REF" != "null" ] || die "プロジェクトの作成応答に id がありません: $created"
    hr
    log "  プロジェクトを作成しました: $PROJECT_REF"
    if [ "$GENERATED_PW" = "1" ]; then
      printf '  \033[1mDB パスワード（生成）: %s\033[0m\n' "$SUPABASE_DB_PASSWORD"
      echo "  ※ このパスワードは今回しか表示されません。パスワード管理アプリ等に必ず控えてください。"
      echo "    （アプリの動作には不要です。移行 CLI の --apply や DB へ直接接続する時に使います）"
    fi
    hr
  fi
fi

# 起動待ち
log "  プロジェクトの起動を待っています（ACTIVE_HEALTHY になるまで。新規作成は 1〜3 分かかります）"
for i in $(seq 1 60); do
  status="$(api GET "/projects/$PROJECT_REF" | jq -r '.status')"
  if [ "$status" = "ACTIVE_HEALTHY" ]; then
    log "  起動しました（$status）"
    break
  fi
  if [ "$i" = "60" ]; then
    die "10 分待ってもプロジェクトが起動しませんでした（状態: $status）。ダッシュボードで状態を確認し、再実行してください。"
  fi
  printf '    %2d 回目: %s … 10 秒待ちます\n' "$i" "$status"
  sleep 10
done
SUPABASE_URL="https://$PROJECT_REF.supabase.co"

# ---------- (2) スキーマの適用 ----------
log "(2/6) データベースにスキーマを適用します（何度実行しても安全です）"
if [ -d "$MIGRATION_DIR" ] && ls "$MIGRATION_DIR"/*.sql >/dev/null 2>&1; then
  for f in "$MIGRATION_DIR"/*.sql; do
    name="$(basename "$f")"
    log "  適用: $name ($(wc -c <"$f" | tr -d ' ') バイト)"
    run_sql "$PROJECT_REF" "$(cat "$f")" "$name" >/dev/null || die "$name の適用に失敗しました。上のエラー内容を確認してください。"
  done
else
  log "  適用: supabase/setup_all.sql"
  run_sql "$PROJECT_REF" "$(cat "$SETUP_ALL")" "setup_all.sql" >/dev/null || die "setup_all.sql の適用に失敗しました。"
fi
# 確認：主要テーブルとバケット
check="$(run_sql "$PROJECT_REF" "select
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('companies','profiles','invitations','work_entries','month_closings'))::int as tables,
  (select count(*) from storage.buckets where id = 'backups')::int as buckets,
  (select count(*) from pg_trigger where tgname = 'on_auth_user_created')::int as auth_trigger;" "確認")"
log "  確認: テーブル $(jq -r '.[0].tables' <<<"$check")/5、backups バケット $(jq -r '.[0].buckets' <<<"$check")、招待トリガー $(jq -r '.[0].auth_trigger' <<<"$check")"
[ "$(jq -r '.[0].tables' <<<"$check")" = "5" ] || die "テーブルが揃っていません。SQL のエラーを確認してください。"

# ---------- (3) 会社とオーナー招待 ----------
log "(3/6) 会社「$COMPANY_NAME」とオーナー招待（$OWNER_EMAIL）を作成します"
q_email="$(sql_quote "$OWNER_EMAIL")"
q_company="$(sql_quote "$COMPANY_NAME")"
bootstrap_sql="do \$\$
declare
  v_owner_email text := '$q_email';
  v_company_name text := '$q_company';
  v_company_id uuid;
  v_token text;
begin
  select id into v_company_id from public.companies where name = v_company_name limit 1;
  if v_company_id is null then
    insert into public.companies (name, rounding_mode, default_royalty_rate, default_mgmt_fee, payout_month_offset, payout_day)
    values (v_company_name, 'none', 0.1, 15000, 1, 0)
    returning id into v_company_id;
  end if;
  -- 有効な招待（未取消・リンク未使用・期限内）があればそのまま使う。無ければ新しく発行する
  select token into v_token from public.invitations
   where company_id = v_company_id and lower(email) = lower(v_owner_email)
     and cancelled_at is null and link_used_at is null and expires_at > now()
   order by created_at desc limit 1;
  if v_token is null then
    update public.invitations set cancelled_at = now()
     where company_id = v_company_id and lower(email) = lower(v_owner_email) and accepted_at is null and cancelled_at is null;
    insert into public.invitations (company_id, email, role, display_name, expires_at)
    values (v_company_id, lower(v_owner_email), 'owner', 'オーナー', now() + interval '30 days');
  end if;
end \$\$;"
run_sql "$PROJECT_REF" "$bootstrap_sql" "bootstrap" >/dev/null || die "会社・招待の作成に失敗しました。"
inv="$(run_sql "$PROJECT_REF" "select i.token, i.email, to_char(i.expires_at at time zone 'Asia/Tokyo', 'YYYY-MM-DD HH24:MI') as expires_at,
  exists (select 1 from public.profiles p where lower(p.email) = lower(i.email) and p.is_active) as has_profile
  from public.invitations i
 where lower(i.email) = lower('$q_email') and i.cancelled_at is null and i.link_used_at is null and i.expires_at > now()
 order by i.created_at desc limit 1;" "招待の取得")"
INVITE_TOKEN="$(jq -r '.[0].token // empty' <<<"$inv")"
[ -n "$INVITE_TOKEN" ] || die "招待トークンを取得できませんでした: $inv"
INVITE_EXPIRES="$(jq -r '.[0].expires_at' <<<"$inv")"
HAS_PROFILE="$(jq -r '.[0].has_profile' <<<"$inv")"

# ---------- (4) 認証設定 ----------
log "(4/6) 認証設定を更新します（自由登録 OFF・Site URL・Redirect URLs・日本語メールテンプレート）"
for t in magic-link invite recovery confirmation email-change; do
  [ -f "$TEMPLATE_DIR/$t.html" ] || die "テンプレートが見つかりません: supabase/email-templates/$t.html"
done
current_auth="$(api GET "/projects/$PROJECT_REF/config/auth")"
current_allow="$(jq -r '.uri_allow_list // ""' <<<"$current_auth")"
if [ -n "$APP_URL" ]; then
  new_allow="$(printf '%s,%s/auth/confirm,%s/auth/callback,%s/**' "$current_allow" "$APP_URL" "$APP_URL" "$APP_URL" \
    | tr ',' '\n' | sed '/^[[:space:]]*$/d' | awk '!seen[$0]++' | paste -sd, -)"
else
  new_allow="$current_allow"
fi
# (4a) 基本設定：自由登録 OFF・Site URL・Redirect URLs（失敗したら終了）
auth_body="$(jq -cn --arg site "$APP_URL" --arg allow "$new_allow" \
  '{ disable_signup: true, external_email_enabled: true }
   + (if $site != "" then {site_url: $site, uri_allow_list: $allow} else {} end)')"
api PATCH "/projects/$PROJECT_REF/config/auth" "$auth_body" >/dev/null
log "  自由登録を OFF にしました"

# (4b) 日本語メールテンプレート（無料プランで標準メールを使う場合は API から変更できないため、失敗しても続行）
tmpl_body="$(jq -cn \
  --rawfile magic "$TEMPLATE_DIR/magic-link.html" \
  --rawfile invite "$TEMPLATE_DIR/invite.html" \
  --rawfile recovery "$TEMPLATE_DIR/recovery.html" \
  --rawfile confirmation "$TEMPLATE_DIR/confirmation.html" \
  --rawfile change "$TEMPLATE_DIR/email-change.html" \
  '{
    mailer_subjects_magic_link: "【ROOTIVE 利益管理】ログイン用リンク",
    mailer_templates_magic_link_content: $magic,
    mailer_subjects_invite: "【ROOTIVE 利益管理】招待のご案内",
    mailer_templates_invite_content: $invite,
    mailer_subjects_recovery: "【ROOTIVE 利益管理】パスワード再設定",
    mailer_templates_recovery_content: $recovery,
    mailer_subjects_confirmation: "【ROOTIVE 利益管理】メールアドレスの確認",
    mailer_templates_confirmation_content: $confirmation,
    mailer_subjects_email_change: "【ROOTIVE 利益管理】メールアドレス変更の確認",
    mailer_templates_email_change_content: $change
  }')"
tmpl_status="$(api_try PATCH "/projects/$PROJECT_REF/config/auth" "$tmpl_body")"
if [ "$tmpl_status" -ge 200 ] && [ "$tmpl_status" -lt 300 ]; then
  log "  日本語メールテンプレートを設定しました"
else
  warn "メールテンプレートは API から設定できませんでした（HTTP $tmpl_status）。無料プランで Supabase 標準メールを使う場合はこの制限があります。"
  warn "  → カスタム SMTP（Resend など）を設定すると API／画面から変更できます。それまでは Authentication → Email Templates に supabase/email-templates/*.html を手で貼り付けてください（docs/SETUP.md 手順 5）。"
  [ -n "$API_TRY_BODY" ] && warn "  応答: $(printf '%s' "$API_TRY_BODY" | tr -d '\n' | cut -c1-200)"
fi
if [ -n "$APP_URL" ]; then
  log "  Site URL = $APP_URL / Redirect URLs = $new_allow"
else
  warn "APP_URL が未指定のため Site URL と Redirect URLs は変更していません。scripts/deploy-vercel.sh が本番 URL 決定後に自動更新します（SUPABASE_ACCESS_TOKEN と SUPABASE_PROJECT_REF を渡した場合）。"
fi

# ---------- (5) API キー ----------
log "(5/6) API キーを取得します"
keys="$(api GET "/projects/$PROJECT_REF/api-keys?reveal=true")"
ANON_KEY="$(jq -r '(map(select(.name == "anon")) | first | .api_key) // (map(select(.type == "publishable")) | first | .api_key) // empty' <<<"$keys")"
SERVICE_KEY="$(jq -r '(map(select(.name == "service_role")) | first | .api_key) // (map(select(.type == "secret")) | first | .api_key) // empty' <<<"$keys")"
[ -n "$ANON_KEY" ] || die "anon（または publishable）キーが見つかりません。ダッシュボードの Project Settings → API Keys を確認してください。"
if [ -z "$SERVICE_KEY" ]; then
  warn "service_role（または secret）キーを取得できませんでした。ダッシュボードの Project Settings → API Keys からコピーして SUPABASE_SERVICE_ROLE_KEY に設定してください。"
  SERVICE_KEY="<Project Settings → API Keys からコピー>"
fi

ENV_TEXT="# Supabase（scripts/setup-supabase.sh が生成）
NEXT_PUBLIC_SUPABASE_URL=$SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=$ANON_KEY
# サーバー専用。絶対に公開しない（ブラウザ・Git・チャットに貼らない）
SUPABASE_SERVICE_ROLE_KEY=$SERVICE_KEY
# 公開 URL（Vercel の本番 URL。deploy-vercel.sh が自動設定します）
NEXT_PUBLIC_APP_URL=${APP_URL:-https://<本番URL>}
# 任意：AI 月次分析を使う場合のみ
# ANTHROPIC_API_KEY=sk-ant-...
# ANTHROPIC_MODEL=
# deploy-vercel.sh が Supabase の Site URL を自動更新するために使用
SUPABASE_PROJECT_REF=$PROJECT_REF"

if [ "$WRITE_ENV" = "1" ]; then
  printf '%s\n' "$ENV_TEXT" >"$ROOT/.env.production.local"
  chmod 600 "$ROOT/.env.production.local" 2>/dev/null || true
  log "  .env.production.local に書き込みました（.gitignore 済み。service_role キーを含むので取り扱い注意）"
fi

# ---------- (6) 結果 ----------
hr
log "(6/6) セットアップが完了しました"
hr
echo
echo "■ Supabase プロジェクト"
echo "  参照 ID    : $PROJECT_REF"
echo "  URL        : $SUPABASE_URL"
echo "  ダッシュボード: https://supabase.com/dashboard/project/$PROJECT_REF"
echo
echo "■ オーナー招待リンク（ブラウザで開いて「ログインして始める」を押すだけでログインできます）"
if [ -n "$APP_URL" ]; then
  printf '  \033[1m%s/invite/%s\033[0m\n' "$APP_URL" "$INVITE_TOKEN"
else
  printf '  \033[1m<本番URL>/invite/%s\033[0m\n' "$INVITE_TOKEN"
  echo "  ※ <本番URL> は scripts/deploy-vercel.sh の実行後に表示される URL（例 https://rootive-profit.vercel.app）に置き換えてください"
fi
echo "  有効期限   : $INVITE_EXPIRES（日本時間）／1 回のみ使用可。期限切れになったらこのスクリプトを再実行すると新しいリンクが出ます"
if [ "$HAS_PROFILE" = "true" ]; then
  echo "  ※ このメールアドレスは既にログイン済みです。通常はログイン画面からメールアドレスでログインできます"
fi
echo
echo "■ 環境変数（Vercel に設定する値。--write-env を付けると .env.production.local に保存されます）"
hr
if [ "$WRITE_ENV" = "1" ]; then
  printf '%s\n' "$ENV_TEXT" | sed -E 's/^(SUPABASE_SERVICE_ROLE_KEY=).*/\1（.env.production.local に保存済み）/'
else
  printf '%s\n' "$ENV_TEXT"
fi
hr
echo
echo "■ 次のステップ"
echo "  1. Vercel のトークンを用意して scripts/deploy-vercel.sh を実行します（docs/QUICKSTART.md 参照）:"
echo "       export VERCEL_TOKEN=..."
if [ "$WRITE_ENV" = "1" ]; then
  echo "       export SUPABASE_ACCESS_TOKEN=$SUPABASE_ACCESS_TOKEN"
  echo "       bash scripts/deploy-vercel.sh        # .env.production.local の値を自動で読み込みます"
else
  echo "       export NEXT_PUBLIC_SUPABASE_URL=$SUPABASE_URL"
  echo "       export NEXT_PUBLIC_SUPABASE_ANON_KEY=...   # 上の値"
  echo "       export SUPABASE_SERVICE_ROLE_KEY=...       # 上の値"
  echo "       export SUPABASE_PROJECT_REF=$PROJECT_REF SUPABASE_ACCESS_TOKEN=..."
  echo "       bash scripts/deploy-vercel.sh"
fi
echo "  2. デプロイ後に表示される本番 URL で招待リンクを開き、ログインします"
echo "  3. メールを本格的に使う場合はカスタム SMTP を設定します（docs/SETUP.md 手順 12）"
echo
