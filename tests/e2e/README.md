# E2E テスト基盤（Playwright ＋ supabase-lite）

Docker や PostgREST / GoTrue のバイナリが使えない環境でも、**ローカル PostgreSQL 16 だけで** Supabase 相当の環境を作り、
ブラウザ E2E（Playwright）と本番前の動作確認ができるようにするための仕組みです。

```
tests/e2e/
├── supabase-lite/
│   ├── server.mjs      Supabase 互換サーバー（Auth / PostgREST / Storage を Node.js で再現）
│   ├── prepare-db.sh   PostgreSQL の起動 → DB 作り直し → auth スタブ ＋ migrations 適用
│   └── selftest.mjs    supabase-js から server.mjs を検証する単体テスト（Playwright 不要）
├── global-setup.ts     DB → supabase-lite → 会社・招待の投入 → Next.js build/start → .state.json
├── global-teardown.ts  自分が起動したプロセスだけを停止
├── helpers.ts          固定ユーザー・招待トークン、adminSql、ログイン補助、supabase-js クライアント
├── auth.spec.ts        認証の主要導線（招待リンク／マジックリンク／ログアウト／不正トークン）
└── README.md           このファイル
```

生成物（git 管理外にすること）: `tests/e2e/.state.json`（起動状態）、`tests/e2e/.logs/`（各プロセスのログ）、
`tests/e2e/.storage/`（Storage のファイル）、`tests/e2e/.storage-selftest/`、`tests/sql/.pg/`（一時 PostgreSQL）。

## 使い方

### 1. supabase-lite の単体検証（最初にこれを通す）

```bash
node tests/e2e/supabase-lite/selftest.mjs
```

DB `rootive_selftest` を作り直し、ポート 54325 でサーバーを起動して、supabase-js で 35 項目を検証します
（createUser の招待制、generateLink → verifyOtp、CRUD、RPC、`v_month_summary` の §2.6 合計、締め済み月の拒否、viewer の RLS、Storage）。
終了コード 0 なら OK。既に起動しているサーバーを使う場合は `SELFTEST_EXTERNAL=1 SELFTEST_URL=http://127.0.0.1:54321`。

### 2. Playwright E2E

```bash
npm run test:e2e                      # build → start して全テスト（mobile / desktop の 2 プロジェクト）
E2E_SKIP_BUILD=1 npm run test:e2e     # 直前の next build を再利用
E2E_DEV=1 npm run test:e2e            # next dev で起動（build 不要。遅い）
E2E_SKIP_APP=1 npm run test:e2e       # Next.js を起動しない（DB と supabase-lite だけ。アプリを使うテストは skip）
npx playwright test tests/e2e/auth.spec.ts --project=desktop   # 1 ファイルだけ
```

global-setup が行うこと:

1. `pg_isready -h 127.0.0.1 -p 54329` で PostgreSQL を確認。無ければ `tests/sql/.pg/data` に initdb して起動（root なら `su postgres`）
2. DB `rootive_e2e` を `drop ... with (force)` → `create` → `tests/sql/auth_stub.sql` → `supabase/migrations/*.sql`
3. `supabase-lite` を `http://127.0.0.1:54321` で起動（同じ DB を向いたものが既に起動していれば再利用）
4. 会社「株式会社ROOTIVE」と、owner / admin / viewer の招待（`helpers.ts` の `E2E.users`）を投入
5. `next build` → `next start -p 3100`（環境変数 `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321` ほか）
6. `/login` が 200 になるまで待ち、`tests/e2e/.state.json` に URL・鍵・PID を保存

環境変数: `E2E_PORT`（アプリのポート、既定 3100）、`E2E_LITE_PORT`（既定 54321）、`TEST_PG_PORT`（既定 54329）、
`TEST_DATABASE_URL`（既存 PostgreSQL を使う）、`E2E_VERBOSE=1`（supabase-lite の全リクエストをログ）、`KEEP_PG=1`（起動した PostgreSQL を止めない）。

### 3. 手動で動作確認する（本番前チェック）

```bash
bash tests/e2e/supabase-lite/prepare-db.sh rootive_e2e
node tests/e2e/supabase-lite/server.mjs --port 54321 --db postgresql://postgres@127.0.0.1:54329/rootive_e2e --storage tests/e2e/.storage --verbose
# 別ターミナルで（鍵は起動時の stdout または --print-keys）
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=<ANON_KEY> \
SUPABASE_SERVICE_ROLE_KEY=<SERVICE_ROLE_KEY> NEXT_PUBLIC_APP_URL=http://localhost:3000 npm run dev
```

会社と招待は SQL で作れます（`supabase/seed/bootstrap_owner.sql` を psql で流すか、下記）。招待リンク `/invite/<token>` を開くだけでログインできます。

```sql
insert into public.companies (name) values ('株式会社ROOTIVE');
insert into public.invitations (company_id, email, role, display_name, token, expires_at)
select id, 'owner@example.com', 'owner', 'オーナー', 'e2e' || repeat('0', 44) || '1', now() + interval '30 days' from public.companies;
```

## helpers.ts の主な関数

| 関数 | 用途 |
|---|---|
| `E2E` | 固定値（DB 名・ポート・会社名・`users.owner/admin/viewer` のメールと招待トークン） |
| `readState()` / `requireState()` | `.state.json`（supabase-lite の URL・anon/service_role キー・会社 ID・アプリ URL） |
| `adminSql(sql)` | psql で SQL を実行（`-A -t`、タブ区切りの文字列を返す） |
| `createServiceClient()` / `createAnonClient()` | supabase-js クライアント |
| `sessionFor(email)` | そのユーザーでログイン済みの supabase-js クライアント（RLS 適用）。auth ユーザーが無ければ作る |
| `seedInitialData()` | owner として `rpc("seed_initial_data")`（§8.6 の初期データ。冪等） |
| `createInvitation({ email, role, displayName, driverId })` | 招待を作りトークンを返す（driver ロールは `driverId` 必須） |
| `loginViaInvite(page, token)` | `/invite/<token>` → 「ログインして始める」 |
| `loginViaMagicLink(page, email, next)` | `/auth/v1/otp` でリンク発行 → `/__test/last-otp` → `/auth/confirm?token_hash=…` |
| `logout(page)` | ユーザーメニュー → ログアウト |
| `lastOtp(email)` | 最後に発行された token_hash / メール OTP / PKCE コード |

招待トークンは `lib/actions/auth.ts` が **16 進 32〜128 文字** しか受け付けないため、固定トークンは `e2e` ＋ `0` × 44 ＋ 番号（48 文字）です。
招待リンクは 1 回限り（`link_used_at`）なので、ブラウザでの招待ログインはテストごとに `createInvitation()` で新しい招待を作ってください。

## supabase-lite が対応する API

すべて `--jwt-secret`（既定 `super-secret-jwt-token-with-at-least-32-characters-long`）で HS256 署名した JWT を使います。
anon / service_role キーは同じ secret で署名した `{ role: "anon" | "service_role" }`（iat 固定・有効期限 10 年）で、**再起動しても同じ値**です。

### PostgREST 互換 `/rest/v1/:table`（テーブル・ビュー共通）

- 各リクエストを 1 トランザクションで実行：`set local role <anon|authenticated|service_role>` → `set_config('request.jwt.claims' / 'request.jwt.claim.sub' / 'request.jwt.claim.role')`。service_role は DB ロール `service_role`（bypassrls）で実行するので RLS を無視する
- 行の JSON は PostgreSQL 側（`json_agg`）で生成するため、型の表現は本物の PostgREST と同じ：numeric / int8 → number、date → `"YYYY-MM-DD"`、timestamptz → ISO 8601、jsonb → オブジェクト、enum → 文字列
- `GET`：`select=`（列リスト、`*`、`alias:col`、`col::type`。**埋め込みリソース `drivers(name)` は 400**）、フィルタ `eq neq gt gte lt lte like ilike match imatch is in` と `not.<op>`、`or=(…)` / `and=(…)`（`and(...)` / `or(...)` のネスト可）、`order=col.asc|desc[.nullsfirst|nullslast]`（複数可）、`limit=` / `offset=` / `Range` ヘッダ、`Prefer: count=exact` → `Content-Range: 0-49/123`、`HEAD`（head: true）
- `Accept: application/vnd.pgrst.object+json`（`.single()`）：1 行だけ返し、0 行または複数行なら 406 `{ code: "PGRST116" }`。`.maybeSingle()` は supabase-js 側で配列を処理するので 0 行は `null`
- `POST`（insert）：オブジェクトまたは配列。`Prefer: return=representation` で行を返す（201）、無ければ 201 空。`Prefer: resolution=merge-duplicates` ＋ `on_conflict=a,b`（省略時は主キー）で `on conflict do update set 全列 = excluded.列`、`ignore-duplicates` は `do nothing`。配列でキーが無い行はその列に `DEFAULT`
- `PATCH` / `DELETE`：フィルタ必須（無いと 400）。`return=representation` で行を返す（200）、無ければ 204
- エラー：PG エラーを `{ code: sqlstate, message, details, hint }` で返す（`42501` → 401/403、`23505`/`23503` → 409、`42P01`/`42883` → 404、その他 400）。RLS で 0 行の update/delete はエラーではない
- RPC `POST /rest/v1/rpc/:fn`（GET も可）：body を名前付き引数で `fn(p_a := $1, …)`。戻り値は pg_proc から判定してキャッシュ：`void` → 204、スカラー／単一の複合型 → 値そのもの（`to_json`）、`setof` / `returns table` → 配列（`.single()` 可）

### GoTrue 互換 `/auth/v1`

ユーザーは `auth.users` に保存し、`public.on_auth_user_created` トリガー（招待制）がそのまま働きます。パスワードは Node の `crypto.scrypt`。
セッション（refresh_token）・OTP（token_hash）・PKCE コードはメモリ上（再起動で消える）。

| エンドポイント | 内容 |
|---|---|
| `POST /token?grant_type=password` | `{ email, password }` → セッション。未確認メールは `email_not_confirmed` |
| `POST /token?grant_type=refresh_token` | `{ refresh_token }` → 新セッション（ローテーション） |
| `POST /token?grant_type=pkce` | `{ auth_code, code_verifier }` → セッション（S256 検証。challenge が無ければ省略） |
| `GET /user`、`PUT /user` | Bearer のユーザー取得／更新（`password`、`data`、`email`）。無効な JWT は 401 `bad_jwt` |
| `POST /otp`（`/magiclink`） | 招待済みユーザーなら magiclink の token_hash を発行。存在しなくても 200（`/__test/last-otp` は 404） |
| `POST /verify`、`GET /verify` | `{ type, token_hash }` または `{ type, email, token }` → セッション。使用済み・不明は 403 `otp_expired` |
| `POST /recover` | recovery の token_hash を発行 |
| `POST /logout` | 204（そのユーザーの refresh_token を破棄） |
| `POST /signup` | 422 `signup_disabled`（自由登録なし） |
| `POST /admin/users` | service_role 必須。`auth.users` に INSERT（招待が無ければトリガーが失敗 → 500 `{ code: 500, error_code: "unexpected_failure", msg: "Database error creating new user" }`、重複は 422 `email_exists`） |
| `GET /admin/users?page=&per_page=` | `{ users, aud }` ＋ `X-Total-Count` |
| `GET / PUT / DELETE /admin/users/:id` | 取得／更新（`password`、`email`、`email_confirm`、`user_metadata`、`app_metadata`）／削除 |
| `POST /admin/generate_link` | `{ type: magiclink \| recovery \| invite \| signup, email }` → `{ action_link, email_otp, hashed_token, redirect_to, verification_type, …user }`。invite / signup はユーザーが無ければ作成 |
| `POST /invite` | ユーザー作成（無ければ）＋ invite の token_hash |
| `GET /settings`、`GET /health`、`GET /.well-known/jwks.json` | 固定値 |

`last_sign_in_at` はログイン（password / verify / refresh）で更新されます。

### Storage 互換 `/storage/v1`

ファイルは `--storage` ディレクトリ（`<bucket>/<path>`）に保存し、`storage.objects` にも登録するので `0006_storage_grants.sql` の RLS（自社フォルダのみ）がそのまま効きます。

| エンドポイント | 内容 |
|---|---|
| `POST /object/:bucket/*path` | アップロード（生バイト or multipart）。上書きは `x-upsert: true`。既存なら `{ statusCode: "409", error: "Duplicate" }` |
| `GET /object/:bucket/*path`、`GET /object/authenticated/:bucket/*path` | ダウンロード（RLS で見えなければ 404） |
| `POST /object/sign/:bucket/*path` | `{ expiresIn }` → `{ signedURL: "/object/sign/…?token=…" }`（supabase-js が `signedUrl` に絶対 URL を組み立てる） |
| `GET /object/sign/:bucket/*path?token=` | 署名付きダウンロード（認証不要） |
| `POST /object/list/:bucket` | `{ prefix, limit, offset, sortBy, search }` → `[{ name, id, updated_at, created_at, last_accessed_at, metadata }]`（フォルダは id 等が null） |
| `GET /object/info/:bucket/*path` | メタデータ |
| `DELETE /object/:bucket` | `{ prefixes: [...] }` で削除（supabase-js の `remove`） |
| `GET /bucket` | バケット一覧 |

### テスト補助 `/__test`

- `GET /__test/keys` → `{ anon, service_role }`
- `GET /__test/last-otp?email=` → `{ email, token_hash, type, link, email_otp, code, redirect_to }`（メールの代わり）
- `POST /__test/reset-auth` → メモリ上のセッション・OTP を全消去

## 制限事項（本物の Supabase との違い）

- 埋め込みリソース（`select("*, drivers(name)")`）、`cs` / `cd` / `ov` / `fts` などの配列・全文検索演算子、`referencedTable` 付きの order/limit、JSON パス（`col->>key`）、`Prefer: missing=default`、`tx=rollback`、CSV / GeoJSON / explain、Realtime、Edge Functions は未対応（CLAUDE.md の「supabase-js の使い方の制約」の範囲に限定）
- 配列型の列（`text[]` など）への insert は未対応（本スキーマには無い）。JSON の値は文字列としてパラメータ渡しし、型は PostgreSQL が列・引数から推論する
- 数値は JSON の number に変換されるため、`numeric` の桁数が 2^53 を超える値は丸められる（金額の範囲では問題なし）
- セッション・OTP はメモリ保持（サーバー再起動で失効）。`auth.sessions` テーブルは使わない。MFA・OAuth・電話認証・レート制限・メール送信は無い
- `GET /user` は JWT の署名と有効期限だけを検証する（ログアウト後でも有効期限内のアクセストークンは通る。本物の GoTrue と同じ挙動）
- `POST /otp` は存在しないメールでも 200（本物は設定により 422 `otp_disabled` を返すことがある）
- Storage の `list` はフォルダ階層をアプリ側で計算する簡易実装。画像変換（`render/image`）、公開バケット、再開可能アップロードは無い
- PostgREST の HTTP ステータスの細部（206 Partial Content、`Location` ヘッダなど）は省略。supabase-js が読む本文・`Content-Range`・`code`/`hint` は合わせてある
- 1 リクエスト＝1 トランザクションなので、`SET LOCAL ROLE` で必要なロール（`anon` / `authenticated` / `service_role` / `supabase_auth_admin`）が `tests/sql/auth_stub.sql` で作られている必要がある

## トラブルシューティング

- `PostgreSQL に接続できません`：`pg_isready -h 127.0.0.1 -p 54329` を確認。`bash tests/e2e/supabase-lite/prepare-db.sh` が起動と DB 作成を行う
- `ポート 54321 の supabase-lite は別の DB に接続しています`：古いサーバーを止める（`pkill -f supabase-lite/server.mjs`）
- `next build に失敗しました`：`tests/e2e/.logs/next-build.log` を確認。他の画面が未完成なら `E2E_SKIP_APP=1` で DB と supabase-lite だけ検証できる
- 招待リンクで「招待リンクが不正です」：トークンが 16 進でない。`createInvitation()` か `E2E.users.*.token` を使う
- リクエストの内容を見たい：`E2E_VERBOSE=1`（Playwright）または `--verbose`（手動起動）。ログは `tests/e2e/.logs/supabase-lite.log`
