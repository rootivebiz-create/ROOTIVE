-- =============================================================================
-- 0028 事務員ロール（2/2）・支払明細の LINE 送付・請求書のメール送付・月締めの手順の順番
--
--   1. 事務員（clerk）
--      入力・承認・請求・支払・月締めは管理者と同じ（is_admin() に入れる）。
--      そのうえで、経営のための情報だけを閉じる：
--        - 機密（振込口座・借入・納税・現金）は can_see_confidential の新しい段階 'clerk' で開けない限り見えない
--        - 監査ログ・外部連携の設定と記録・AI（分析と相談）・月次目標は見えない
--        - 経営のアラート（利益率の低下・赤字・目標未達・資金不足・納税・決裁の滞留・出力の急増）は見えない
--        - 資金繰り（cash_forecast）は呼べない
--      **事務員は請求（売上）と支払を扱うので、稼働の行ごとの売上と支払は見える**。
--      会社全体の利益・経営指標の画面はアプリ側で出さない（行から計算できてしまうため DB で隠す意味が薄い）。
--      判定は is_clerk() / is_manager()（owner・admin）/ can_see_management()（owner・admin・viewer）に集める。
--   2. 月締めの手順の順番
--      0026 では「支払明細の送付・振込」を締める前に置き、締めた月はチェックを拒否していた。
--      実際は「締めて金額を固めてから送付・振込」なので、締めたあとの手順としていつでも付けられるようにする
--   3. 支払明細の LINE 送付の記録（statement_deliveries）。送れば月締めの手順が自動で「済み」になる
--   4. 請求書のメール送付（clients.email と invoice_sends）
-- =============================================================================

-- ---------- 1. ロールの判定 ----------
-- owner / admin / clerk（登録・編集ができる）
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role in ('owner','admin','clerk') from public.profiles where id = auth.uid() and is_active limit 1), false);
$$;

-- owner / admin / clerk / viewer（スタッフの画面を使える）
create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role in ('owner','admin','clerk','viewer') from public.profiles where id = auth.uid() and is_active limit 1), false);
$$;

-- 事務員
create or replace function public.is_clerk()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'clerk' from public.profiles where id = auth.uid() and is_active limit 1), false);
$$;

-- owner / admin（経営の設定：外部連携・監査ログ・目標・バックアップ）
create or replace function public.is_manager()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role in ('owner','admin') from public.profiles where id = auth.uid() and is_active limit 1), false);
$$;

-- owner / admin / viewer（経営の数字を見てよい。事務員だけが外れる）
create or replace function public.can_see_management()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role in ('owner','admin','viewer') from public.profiles where id = auth.uid() and is_active limit 1), false);
$$;

comment on function public.is_clerk() is '事務員か（0028）';
comment on function public.is_manager() is '経営の設定ができるか（owner・admin。事務員は含めない）';
comment on function public.can_see_management() is '経営の数字を見てよいか（owner・admin・viewer。事務員は含めない）';

-- 機密の見せ方に段階 'clerk'（管理者と事務員）を足す
--   owner … 代表だけ / admin … 代表と管理者（事務員は含めない）/ clerk … 管理者と事務員まで / staff … スタッフ全員
create or replace function public.can_see_confidential(p_key text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare scope text;
begin
  if public.is_owner() then
    return true;
  end if;
  if not public.is_staff() then
    return false;
  end if;
  select coalesce(confidential_scope->>p_key, 'admin') into scope
    from public.companies where id = public.current_company_id();
  if scope = 'staff' then
    return true;
  end if;
  if scope = 'clerk' then
    return public.is_admin();
  end if;
  if scope = 'admin' then
    return public.is_manager();
  end if;
  return false;  -- 'owner' は上で返している
end $$;

comment on function public.can_see_confidential(text) is
  '機密（loans / cash / bank_account）を見てよいか。代表は常に true。段階は owner / admin / clerk / staff';

-- 経営のアラート（事務員には出さない）
create or replace function public.is_management_alert(p_code text)
returns boolean language sql immutable as $$
  select p_code in ('margin_drop', 'driver_loss', 'target_miss', 'cash_short', 'tax_due', 'tax_overdue', 'approval_pending', 'export_burst');
$$;

comment on function public.is_management_alert(text) is '経営のためのアラートか（事務員には見せない）';

-- ---------- 経営の情報を事務員から閉じる ----------
-- 監査ログ（口座の変更なども残るため、経営の設定ができる人だけ）
drop policy if exists audit_logs_select on public.audit_logs;
create policy audit_logs_select on public.audit_logs for select to authenticated
  using (company_id = public.current_company_id() and public.is_manager());

-- 外部連携の設定と実行記録
drop policy if exists integrations_select on public.integrations;
create policy integrations_select on public.integrations for select to authenticated
  using (company_id = public.current_company_id() and public.is_manager());
drop policy if exists integration_logs_select on public.integration_logs;
create policy integration_logs_select on public.integration_logs for select to authenticated
  using (company_id = public.current_company_id() and public.is_manager());

-- AI（月次分析・週次サマリー・相談）。for all のポリシーは select も通すので両方に入れる
drop policy if exists ai_insights_select on public.ai_insights;
create policy ai_insights_select on public.ai_insights for select to authenticated
  using (company_id = public.current_company_id() and public.can_see_management());
drop policy if exists ai_insights_write on public.ai_insights;
create policy ai_insights_write on public.ai_insights for all to authenticated
  using (company_id = public.current_company_id() and public.is_manager())
  with check (company_id = public.current_company_id() and public.is_manager());
drop policy if exists ai_conversations_select on public.ai_conversations;
create policy ai_conversations_select on public.ai_conversations for select to authenticated
  using (company_id = public.current_company_id() and public.can_see_management());
drop policy if exists ai_conversations_write on public.ai_conversations;
create policy ai_conversations_write on public.ai_conversations for all to authenticated
  using (company_id = public.current_company_id() and public.can_see_management())
  with check (company_id = public.current_company_id() and public.can_see_management());
drop policy if exists ai_messages_select on public.ai_messages;
create policy ai_messages_select on public.ai_messages for select to authenticated
  using (company_id = public.current_company_id() and public.can_see_management());
drop policy if exists ai_messages_write on public.ai_messages;
create policy ai_messages_write on public.ai_messages for all to authenticated
  using (company_id = public.current_company_id() and public.can_see_management())
  with check (company_id = public.current_company_id() and public.can_see_management());

-- アラート：経営のアラートは事務員に見せない（書き込みも for all なので同じ条件を入れる）
drop policy if exists alerts_select on public.alerts;
create policy alerts_select on public.alerts for select to authenticated
  using (company_id = public.current_company_id() and public.is_staff()
         and (not public.is_clerk() or not public.is_management_alert(code)));
drop policy if exists alerts_write on public.alerts;
create policy alerts_write on public.alerts for all to authenticated
  using (company_id = public.current_company_id() and public.is_admin()
         and (not public.is_clerk() or not public.is_management_alert(code)))
  with check (company_id = public.current_company_id() and public.is_admin()
         and (not public.is_clerk() or not public.is_management_alert(code)));

-- 月次目標（売上・営業利益の目標は経営のもの）
drop policy if exists month_targets_select on public.month_targets;
create policy month_targets_select on public.month_targets for select to authenticated
  using (company_id = public.current_company_id() and public.can_see_management());
drop policy if exists month_targets_write on public.month_targets;
create policy month_targets_write on public.month_targets for all to authenticated
  using (company_id = public.current_company_id() and public.is_manager())
  with check (company_id = public.current_company_id() and public.is_manager());

-- 締め時バックアップ（Storage）：全テーブルの控えなので、経営の設定ができる人だけが読める。
--   保存（insert）は今までどおり管理者以上（事務員が締めたときも本人の権限で保存できるように）
drop policy if exists backups_select on storage.objects;
create policy backups_select on storage.objects for select to authenticated
  using (bucket_id = 'backups' and public.is_manager() and (storage.foldername(name))[1] = public.current_company_id()::text);

-- 資金繰り：事務員は呼べない。借入の返済は「借入」を見てよい人にだけ返す
--   （0017 までは is_staff だけを見ていたため、借入を見られない閲覧者にも返済の行が返っていた）
create or replace function public.cash_forecast(p_from date, p_to date)
returns table (
  event_date date,
  kind text,
  label text,
  detail text,
  amount numeric,
  ref_id uuid,
  status text,
  month date
)
language plpgsql stable security definer set search_path = public as $$
declare cid uuid := public.current_company_id();
begin
  if not public.can_see_management() then
    raise exception '権限がありません' using errcode = 'P0001', hint = 'FORBIDDEN';
  end if;
  if cid is null then
    raise exception '会社が特定できません' using errcode = 'P0001';
  end if;
  return query
    select f.* from public.cash_forecast_for(cid, p_from, p_to) f
     where f.kind <> 'loan' or public.can_see_confidential('loans');
end $$;

-- ---------- 2. 月締めの手順：締めたあとの手順（支払明細の送付・振込）はいつでも付けられる ----------
drop trigger if exists t05_guard_month_closed on public.month_close_checks;
comment on table public.month_close_checks is
  '月締めのあとの手順（支払明細の送付・振込など）のチェック。誰がいつ付けたか。締めた月でも付けられる（0028）';

-- ---------- 3. 支払明細の送付の記録 ----------
create table if not exists public.statement_deliveries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  month date not null check (month = date_trunc('month', month)::date),
  driver_id uuid not null references public.drivers (id) on delete cascade,
  channel text not null default 'line' check (channel in ('line', 'push')),
  -- 送った時点の税込支払額（あとで締めを解除して直したとき、送り直しが要るか分かるように）
  payout_incl numeric(12,2),
  sent_at timestamptz not null default now(),
  sent_by uuid references public.profiles (id) on delete set null default auth.uid(),
  sent_by_name text not null default '',
  unique (company_id, month, driver_id)
);
comment on table public.statement_deliveries is '支払明細をドライバーへ送った記録（ドライバー × 月で 1 件。送り直すと上書き）';

create index if not exists statement_deliveries_company_month_idx on public.statement_deliveries (company_id, month);

alter table public.statement_deliveries enable row level security;
drop policy if exists statement_deliveries_select on public.statement_deliveries;
create policy statement_deliveries_select on public.statement_deliveries for select to authenticated
  using (company_id = public.current_company_id() and public.is_staff());
drop policy if exists statement_deliveries_write on public.statement_deliveries;
create policy statement_deliveries_write on public.statement_deliveries for all to authenticated
  using (company_id = public.current_company_id() and public.is_admin())
  with check (company_id = public.current_company_id() and public.is_admin());

create or replace function public.fill_sender_name()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.sent_by := coalesce(auth.uid(), new.sent_by);
  select coalesce(nullif(p.display_name, ''), p.email, '') into new.sent_by_name
    from public.profiles p where p.id = new.sent_by;
  new.sent_by_name := coalesce(new.sent_by_name, '');
  return new;
end $$;
drop trigger if exists t10_fill_sender_name on public.statement_deliveries;
create trigger t10_fill_sender_name before insert or update on public.statement_deliveries
  for each row execute function public.fill_sender_name();

-- 送った記録を残す（admin 以上。締めた月だけ＝金額が固まってから送る）
create or replace function public.record_statement_deliveries(p_month date, p_driver_ids uuid[], p_channel text default 'line')
returns integer language plpgsql security invoker set search_path = public as $$
declare
  cid uuid := public.current_company_id();
  m date := date_trunc('month', p_month)::date;
  n integer;
begin
  if cid is null or not public.is_admin() then
    raise exception '権限がありません' using errcode = 'P0001', hint = 'FORBIDDEN';
  end if;
  if p_channel not in ('line', 'push') then
    raise exception '送り方の指定が正しくありません' using errcode = 'P0001', hint = 'INVALID';
  end if;
  if not public.is_month_closed(cid, m) then
    raise exception '支払明細を送れるのは締めた月だけです（先に月を締めてください）' using errcode = 'P0001', hint = 'MONTH_NOT_CLOSED';
  end if;
  insert into public.statement_deliveries (company_id, month, driver_id, channel, payout_incl)
  select cid, m, d.id, p_channel, s.payout_incl
    from public.drivers d
    left join public.v_driver_month_summary s on s.company_id = cid and s.month = m and s.driver_id = d.id
   where d.company_id = cid and d.id = any (coalesce(p_driver_ids, '{}'::uuid[]))
  on conflict (company_id, month, driver_id) do update set
    channel = excluded.channel, payout_incl = excluded.payout_incl, sent_at = now();
  get diagnostics n = row_count;
  return n;
end $$;

comment on function public.record_statement_deliveries(date, uuid[], text) is
  '支払明細を送った記録を残す（admin 以上・締めた月だけ。同じ人は上書き）';

-- ---------- 4. 請求書のメール送付 ----------
alter table public.clients add column if not exists email text not null default '';
comment on column public.clients.email is '請求書を送るメールアドレス（カンマ区切りで複数可）';

create table if not exists public.invoice_sends (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  invoice_id uuid not null references public.invoices (id) on delete cascade,
  to_email text not null,
  subject text not null default '',
  status text not null default 'sent' check (status in ('sent', 'failed')),
  error text not null default '',
  provider_id text not null default '',
  sent_at timestamptz not null default now(),
  sent_by uuid references public.profiles (id) on delete set null default auth.uid(),
  sent_by_name text not null default ''
);
comment on table public.invoice_sends is '請求書をメールで送った記録（失敗も残す）';

create index if not exists invoice_sends_invoice_idx on public.invoice_sends (invoice_id, sent_at desc);

alter table public.invoice_sends enable row level security;
drop policy if exists invoice_sends_select on public.invoice_sends;
create policy invoice_sends_select on public.invoice_sends for select to authenticated
  using (company_id = public.current_company_id() and public.is_staff());
drop policy if exists invoice_sends_write on public.invoice_sends;
create policy invoice_sends_write on public.invoice_sends for all to authenticated
  using (company_id = public.current_company_id() and public.is_admin())
  with check (company_id = public.current_company_id() and public.is_admin());

drop trigger if exists t10_fill_sender_name on public.invoice_sends;
create trigger t10_fill_sender_name before insert or update on public.invoice_sends
  for each row execute function public.fill_sender_name();

-- 送った（送れなかった）記録を残す（admin 以上。自社の請求書だけ）
create or replace function public.record_invoice_send(
  p_invoice_id uuid, p_to text, p_subject text, p_status text default 'sent', p_error text default '', p_provider_id text default ''
) returns uuid language plpgsql security invoker set search_path = public as $$
declare
  cid uuid := public.current_company_id();
  new_id uuid;
begin
  if cid is null or not public.is_admin() then
    raise exception '権限がありません' using errcode = 'P0001', hint = 'FORBIDDEN';
  end if;
  if not exists (select 1 from public.invoices i where i.id = p_invoice_id and i.company_id = cid) then
    raise exception '請求書が見つかりません' using errcode = 'P0001', hint = 'NOT_FOUND';
  end if;
  if coalesce(p_status, '') not in ('sent', 'failed') then
    raise exception '送信の状態が正しくありません' using errcode = 'P0001', hint = 'INVALID';
  end if;
  insert into public.invoice_sends (company_id, invoice_id, to_email, subject, status, error, provider_id)
  values (cid, p_invoice_id, left(coalesce(p_to, ''), 500), left(coalesce(p_subject, ''), 300), p_status,
          left(coalesce(p_error, ''), 500), left(coalesce(p_provider_id, ''), 200))
  returning id into new_id;
  return new_id;
end $$;

comment on function public.record_invoice_send(uuid, text, text, text, text, text) is
  '請求書のメール送付を記録する（admin 以上。失敗も残す）';

-- =============================================================================
-- 復元で取引先のメールアドレスも戻す（それ以外は 0025 と同じ）
-- =============================================================================
create or replace function public.import_backup(p_data jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  cid uuid := public.current_company_id();
  c jsonb := p_data->'company';
  counts jsonb := '{}'::jsonb;
  n integer;
  conflict_name text;
begin
  if not public.is_owner() then
    raise exception '復元はオーナーのみ可能です' using errcode = 'P0001', hint = 'OWNER_ONLY';
  end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' then
    raise exception 'バックアップ JSON の形式が不正です' using errcode = 'P0001';
  end if;

  -- 他社 ID との衝突チェック（RLS を越えて確認）
  if public.import_has_id_conflict(cid, p_data) then
    raise exception '他社のデータと ID が衝突するため取り込めません' using errcode = 'P0001', hint = 'ID_CONFLICT';
  end if;

  -- 同名で ID が異なるマスタの検出（わかりやすいエラーにする）
  select x->>'name' into conflict_name
    from jsonb_array_elements(coalesce(p_data->'drivers','[]')) x
    join public.drivers t on t.company_id = cid and t.name = x->>'name' and t.id <> (x->>'id')::uuid
   limit 1;
  if conflict_name is not null then
    raise exception 'ドライバー「%」が既に別の ID で登録されています。既存のドライバー名を変更するか、取り込みデータを確認してください', conflict_name using errcode = 'P0001', hint = 'NAME_CONFLICT';
  end if;
  select x->>'name' into conflict_name
    from jsonb_array_elements(coalesce(p_data->'projects','[]')) x
    join public.projects t on t.company_id = cid and t.name = x->>'name' and t.id <> (x->>'id')::uuid
   limit 1;
  if conflict_name is not null then
    raise exception '案件「%」が既に別の ID で登録されています。既存の案件名を変更するか、取り込みデータを確認してください', conflict_name using errcode = 'P0001', hint = 'NAME_CONFLICT';
  end if;

  perform set_config('app.bypass_closing', 'on', true);
  perform set_config('app.skip_audit', 'on', true);

  -- 会社設定（ID は変更しない）
  if c is not null and jsonb_typeof(c) = 'object' then
    update public.companies set
      name = coalesce(c->>'name', name),
      rounding_mode = coalesce((c->>'rounding_mode')::public.rounding_mode, rounding_mode),
      default_royalty_rate = coalesce((c->>'default_royalty_rate')::numeric, default_royalty_rate),
      default_mgmt_fee = coalesce((c->>'default_mgmt_fee')::numeric, default_mgmt_fee),
      payout_month_offset = coalesce((c->>'payout_month_offset')::integer, payout_month_offset),
      payout_day = coalesce((c->>'payout_day')::integer, payout_day),
      statement_note = coalesce(c->>'statement_note', statement_note),
      invoice_reg_no = coalesce(c->>'invoice_reg_no', invoice_reg_no),
      address = coalesce(c->>'address', address),
      tel = coalesce(c->>'tel', tel),
      driver_portal_show_royalty = coalesce((c->>'driver_portal_show_royalty')::boolean, driver_portal_show_royalty),
      yayoi_accounts = coalesce(c->'yayoi_accounts', yayoi_accounts),
      -- 0008 で追加：消費税（ロゴ・認印の画像はバックアップに含まれないためパスは復元しない）
      tax_rate = coalesce((c->>'tax_rate')::numeric, tax_rate),
      tax_rounding = coalesce((c->>'tax_rounding')::public.rounding_mode, tax_rounding),
      -- 0014 で追加：決算月と全銀の依頼人情報
      fiscal_month = coalesce((c->>'fiscal_month')::integer, fiscal_month),
      fb_consignor_code = coalesce(c->>'fb_consignor_code', fb_consignor_code),
      fb_consignor_kana = coalesce(c->>'fb_consignor_kana', fb_consignor_kana),
      fb_bank_code = coalesce(c->>'fb_bank_code', fb_bank_code),
      fb_bank_name = coalesce(c->>'fb_bank_name', fb_bank_name),
      fb_branch_code = coalesce(c->>'fb_branch_code', fb_branch_code),
      fb_branch_name = coalesce(c->>'fb_branch_name', fb_branch_name),
      fb_account_type = coalesce((c->>'fb_account_type')::public.bank_account_type, fb_account_type),
      fb_account_number = coalesce(c->>'fb_account_number', fb_account_number),
      -- 0018 で追加：労務の基準
      labor_duty_limit_minutes = coalesce((c->>'labor_duty_limit_minutes')::integer, labor_duty_limit_minutes),
      labor_duty_max_minutes = coalesce((c->>'labor_duty_max_minutes')::integer, labor_duty_max_minutes),
      labor_rest_target_minutes = coalesce((c->>'labor_rest_target_minutes')::integer, labor_rest_target_minutes),
      labor_rest_min_minutes = coalesce((c->>'labor_rest_min_minutes')::integer, labor_rest_min_minutes),
      labor_month_duty_minutes = coalesce((c->>'labor_month_duty_minutes')::integer, labor_month_duty_minutes),
      labor_max_consecutive_days = coalesce((c->>'labor_max_consecutive_days')::integer, labor_max_consecutive_days)
    where id = cid;
  end if;

  insert into public.clients (id, company_id, name, honorific, address, tel, invoice_reg_no, payment_month_offset, payment_day, memo, is_active, sort_order, email)
  select (x->>'id')::uuid, cid, x->>'name', coalesce(x->>'honorific','御中'), coalesce(x->>'address',''), coalesce(x->>'tel',''),
         coalesce(x->>'invoice_reg_no',''), coalesce((x->>'payment_month_offset')::integer, 1), coalesce((x->>'payment_day')::integer, 0),
         coalesce(x->>'memo',''), coalesce((x->>'is_active')::boolean, true), coalesce((x->>'sort_order')::integer, 0),
         coalesce(x->>'email','')
    from jsonb_array_elements(coalesce(p_data->'clients','[]')) x
  on conflict (id) do update set
    name = excluded.name, honorific = excluded.honorific, address = excluded.address, tel = excluded.tel,
    invoice_reg_no = excluded.invoice_reg_no, payment_month_offset = excluded.payment_month_offset, payment_day = excluded.payment_day,
    memo = excluded.memo, is_active = excluded.is_active, sort_order = excluded.sort_order,
    -- 0028：請求書の送り先
    email = excluded.email;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('clients', n);

  -- 0023 の定休日（weekly_off）と 0024 の運転者台帳の項目まで戻す
  insert into public.drivers (id, company_id, name, kana, is_active, royalty_rate, mgmt_fee, rounding_mode, phone, email, bank_info, memo, sort_order,
                              tax_mode, invoice_reg_no, payout_month_offset, payout_day, weekly_off,
                              roster_no, birth_date, address, hired_on, appointed_on, retired_on, license_kinds, license_conditions,
                              line_user_id, line_linked_at)
  select (x->>'id')::uuid, cid, x->>'name', coalesce(x->>'kana',''), coalesce((x->>'is_active')::boolean, true),
         (x->>'royalty_rate')::numeric, coalesce((x->>'mgmt_fee')::numeric, 0), (x->>'rounding_mode')::public.rounding_mode,
         coalesce(x->>'phone',''), coalesce(x->>'email',''), coalesce(x->>'bank_info',''), coalesce(x->>'memo',''), coalesce((x->>'sort_order')::integer, 0),
         coalesce((x->>'tax_mode')::public.tax_mode, 'taxable'), coalesce(x->>'invoice_reg_no',''), (x->>'payout_month_offset')::integer, (x->>'payout_day')::integer,
         coalesce((select array_agg((w)::integer) from jsonb_array_elements_text(coalesce(x->'weekly_off','[]'::jsonb)) w), '{}'),
         coalesce(x->>'roster_no',''), (x->>'birth_date')::date, coalesce(x->>'address',''),
         (x->>'hired_on')::date, (x->>'appointed_on')::date, (x->>'retired_on')::date,
         coalesce(x->>'license_kinds',''), coalesce(x->>'license_conditions',''),
         coalesce(x->>'line_user_id',''), (x->>'line_linked_at')::timestamptz
    from jsonb_array_elements(coalesce(p_data->'drivers','[]')) x
  on conflict (id) do update set
    name = excluded.name, kana = excluded.kana, is_active = excluded.is_active, royalty_rate = excluded.royalty_rate,
    mgmt_fee = excluded.mgmt_fee, rounding_mode = excluded.rounding_mode, phone = excluded.phone, email = excluded.email,
    bank_info = excluded.bank_info, memo = excluded.memo, sort_order = excluded.sort_order,
    tax_mode = excluded.tax_mode, invoice_reg_no = excluded.invoice_reg_no, payout_month_offset = excluded.payout_month_offset, payout_day = excluded.payout_day,
    weekly_off = excluded.weekly_off,
    roster_no = excluded.roster_no, birth_date = excluded.birth_date, address = excluded.address,
    hired_on = excluded.hired_on, appointed_on = excluded.appointed_on, retired_on = excluded.retired_on,
    license_kinds = excluded.license_kinds, license_conditions = excluded.license_conditions,
    -- 0025：LINE の連携も戻す（書き出していたのに戻していなかった）
    line_user_id = excluded.line_user_id, line_linked_at = excluded.line_linked_at;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('drivers', n);

  insert into public.projects (id, company_id, name, client_name, client_id, is_active, memo, sort_order, target_margin)
  select (x->>'id')::uuid, cid, x->>'name', coalesce(x->>'client_name',''), (x->>'client_id')::uuid, coalesce((x->>'is_active')::boolean, true), coalesce(x->>'memo',''), coalesce((x->>'sort_order')::integer, 0), (x->>'target_margin')::numeric
    from jsonb_array_elements(coalesce(p_data->'projects','[]')) x
  on conflict (id) do update set
    name = excluded.name, client_name = excluded.client_name, client_id = excluded.client_id, is_active = excluded.is_active, memo = excluded.memo, sort_order = excluded.sort_order,
    target_margin = excluded.target_margin;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('projects', n);

  insert into public.project_items (id, company_id, project_id, name, unit, bill_rate, pay_rate, is_active, sort_order)
  select (x->>'id')::uuid, cid, (x->>'project_id')::uuid, coalesce(x->>'name','標準'), coalesce((x->>'unit')::public.item_unit, 'day'),
         coalesce((x->>'bill_rate')::numeric, 0), coalesce((x->>'pay_rate')::numeric, 0), coalesce((x->>'is_active')::boolean, true), coalesce((x->>'sort_order')::integer, 0)
    from jsonb_array_elements(coalesce(p_data->'project_items','[]')) x
  on conflict (id) do update set
    project_id = excluded.project_id, name = excluded.name, unit = excluded.unit, bill_rate = excluded.bill_rate,
    pay_rate = excluded.pay_rate, is_active = excluded.is_active, sort_order = excluded.sort_order;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('project_items', n);

  -- ドライバー別単価（bill_rate は 0007 で追加。どちらも無い行は取り込まない）
  insert into public.driver_pay_overrides (company_id, driver_id, project_item_id, pay_rate, bill_rate)
  select cid, (x->>'driver_id')::uuid, (x->>'project_item_id')::uuid, (x->>'pay_rate')::numeric, (x->>'bill_rate')::numeric
    from jsonb_array_elements(coalesce(p_data->'driver_pay_overrides','[]')) x
   where x->>'pay_rate' is not null or x->>'bill_rate' is not null
  on conflict (driver_id, project_item_id) do update set pay_rate = excluded.pay_rate, bill_rate = excluded.bill_rate;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('driver_pay_overrides', n);

  insert into public.driver_recurring_adjustments (id, company_id, driver_id, label, amount, count_as_profit, is_active, sort_order)
  select (x->>'id')::uuid, cid, (x->>'driver_id')::uuid, x->>'label', (x->>'amount')::numeric, coalesce((x->>'count_as_profit')::boolean, true),
         coalesce((x->>'is_active')::boolean, true), coalesce((x->>'sort_order')::integer, 0)
    from jsonb_array_elements(coalesce(p_data->'driver_recurring_adjustments','[]')) x
  on conflict (id) do update set
    driver_id = excluded.driver_id, label = excluded.label, amount = excluded.amount, count_as_profit = excluded.count_as_profit,
    is_active = excluded.is_active, sort_order = excluded.sort_order;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('driver_recurring_adjustments', n);

  insert into public.driver_months (id, company_id, month, driver_id, mgmt_fee, memo, tax_rate, tax_rounding, tax_mode)
  select (x->>'id')::uuid, cid, (x->>'month')::date, (x->>'driver_id')::uuid, coalesce((x->>'mgmt_fee')::numeric, 0), coalesce(x->>'memo',''),
         (x->>'tax_rate')::numeric, (x->>'tax_rounding')::public.rounding_mode, (x->>'tax_mode')::public.tax_mode
    from jsonb_array_elements(coalesce(p_data->'driver_months','[]')) x
  on conflict (id) do update set
    month = excluded.month, driver_id = excluded.driver_id, mgmt_fee = excluded.mgmt_fee, memo = excluded.memo,
    tax_rate = excluded.tax_rate, tax_rounding = excluded.tax_rounding, tax_mode = excluded.tax_mode;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('driver_months', n);

  insert into public.adjustments (id, company_id, driver_month_id, label, amount, count_as_profit, recurring_id, sort_order)
  select (x->>'id')::uuid, cid, (x->>'driver_month_id')::uuid, x->>'label', (x->>'amount')::numeric, coalesce((x->>'count_as_profit')::boolean, true),
         (x->>'recurring_id')::uuid, coalesce((x->>'sort_order')::integer, 0)
    from jsonb_array_elements(coalesce(p_data->'adjustments','[]')) x
  on conflict (id) do update set
    driver_month_id = excluded.driver_month_id, label = excluded.label, amount = excluded.amount,
    count_as_profit = excluded.count_as_profit, recurring_id = excluded.recurring_id, sort_order = excluded.sort_order;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('adjustments', n);

  insert into public.work_entries (id, company_id, month, driver_id, project_item_id, qty, bill_rate, pay_rate, royalty_rate, rounding_mode, memo, created_by, updated_by)
  select (x->>'id')::uuid, cid, (x->>'month')::date, (x->>'driver_id')::uuid, (x->>'project_item_id')::uuid,
         coalesce((x->>'qty')::numeric, 0), coalesce((x->>'bill_rate')::numeric, 0), coalesce((x->>'pay_rate')::numeric, 0),
         coalesce((x->>'royalty_rate')::numeric, 0), coalesce((x->>'rounding_mode')::public.rounding_mode, 'none'), coalesce(x->>'memo',''),
         (x->>'created_by')::uuid, (x->>'updated_by')::uuid
    from jsonb_array_elements(coalesce(p_data->'work_entries','[]')) x
  on conflict (id) do update set
    month = excluded.month, driver_id = excluded.driver_id, project_item_id = excluded.project_item_id, qty = excluded.qty,
    bill_rate = excluded.bill_rate, pay_rate = excluded.pay_rate, royalty_rate = excluded.royalty_rate,
    rounding_mode = excluded.rounding_mode, memo = excluded.memo;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('work_entries', n);

  insert into public.month_closings (company_id, month, status, closed_at, closed_by, reopened_at, reopened_by, backup_path, note)
  select cid, (x->>'month')::date, coalesce((x->>'status')::public.month_status, 'open'), (x->>'closed_at')::timestamptz, (x->>'closed_by')::uuid,
         (x->>'reopened_at')::timestamptz, (x->>'reopened_by')::uuid, x->>'backup_path', coalesce(x->>'note','')
    from jsonb_array_elements(coalesce(p_data->'month_closings','[]')) x
  on conflict (company_id, month) do update set
    status = excluded.status, closed_at = excluded.closed_at, closed_by = excluded.closed_by,
    reopened_at = excluded.reopened_at, reopened_by = excluded.reopened_by, backup_path = coalesce(excluded.backup_path, public.month_closings.backup_path), note = excluded.note;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('month_closings', n);

  -- 0009：経費・取引先・請求書・月次目標
  insert into public.expense_categories (id, company_id, name, kind, memo, is_active, sort_order)
  select (x->>'id')::uuid, cid, x->>'name', coalesce((x->>'kind')::public.expense_kind, 'variable'), coalesce(x->>'memo',''),
         coalesce((x->>'is_active')::boolean, true), coalesce((x->>'sort_order')::integer, 0)
    from jsonb_array_elements(coalesce(p_data->'expense_categories','[]')) x
  on conflict (id) do update set
    name = excluded.name, kind = excluded.kind, memo = excluded.memo, is_active = excluded.is_active, sort_order = excluded.sort_order;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('expense_categories', n);

  insert into public.recurring_expenses (id, company_id, category_id, label, amount, tax_mode, driver_id, project_id, vendor, start_month, end_month, is_active, sort_order, payment_day)
  select (x->>'id')::uuid, cid, (x->>'category_id')::uuid, x->>'label', coalesce((x->>'amount')::numeric, 0),
         coalesce((x->>'tax_mode')::public.tax_mode, 'taxable'), (x->>'driver_id')::uuid, (x->>'project_id')::uuid, coalesce(x->>'vendor',''),
         (x->>'start_month')::date, (x->>'end_month')::date, coalesce((x->>'is_active')::boolean, true), coalesce((x->>'sort_order')::integer, 0), (x->>'payment_day')::integer
    from jsonb_array_elements(coalesce(p_data->'recurring_expenses','[]')) x
  on conflict (id) do update set
    category_id = excluded.category_id, label = excluded.label, amount = excluded.amount, tax_mode = excluded.tax_mode,
    driver_id = excluded.driver_id, project_id = excluded.project_id, vendor = excluded.vendor,
    start_month = excluded.start_month, end_month = excluded.end_month, is_active = excluded.is_active, sort_order = excluded.sort_order,
    payment_day = excluded.payment_day;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('recurring_expenses', n);

  insert into public.expenses (id, company_id, month, category_id, label, amount, tax_mode, incurred_on, driver_id, project_id, vendor, memo, recurring_id, created_by, updated_by)
  select (x->>'id')::uuid, cid, (x->>'month')::date, (x->>'category_id')::uuid, x->>'label', coalesce((x->>'amount')::numeric, 0),
         coalesce((x->>'tax_mode')::public.tax_mode, 'taxable'), (x->>'incurred_on')::date, (x->>'driver_id')::uuid, (x->>'project_id')::uuid,
         coalesce(x->>'vendor',''), coalesce(x->>'memo',''), (x->>'recurring_id')::uuid, (x->>'created_by')::uuid, (x->>'updated_by')::uuid
    from jsonb_array_elements(coalesce(p_data->'expenses','[]')) x
  on conflict (id) do update set
    month = excluded.month, category_id = excluded.category_id, label = excluded.label, amount = excluded.amount, tax_mode = excluded.tax_mode,
    incurred_on = excluded.incurred_on, driver_id = excluded.driver_id, project_id = excluded.project_id, vendor = excluded.vendor,
    memo = excluded.memo, recurring_id = excluded.recurring_id;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('expenses', n);

  insert into public.invoices (id, company_id, client_id, month, invoice_no, status, issue_date, due_date, tax_rate, tax_rounding, paid_on, note, created_by)
  select (x->>'id')::uuid, cid, (x->>'client_id')::uuid, (x->>'month')::date, x->>'invoice_no',
         coalesce((x->>'status')::public.invoice_status, 'draft'), coalesce((x->>'issue_date')::date, current_date), (x->>'due_date')::date,
         coalesce((x->>'tax_rate')::numeric, 0.10), coalesce((x->>'tax_rounding')::public.rounding_mode, 'floor'),
         (x->>'paid_on')::date, coalesce(x->>'note',''), (x->>'created_by')::uuid
    from jsonb_array_elements(coalesce(p_data->'invoices','[]')) x
  on conflict (id) do update set
    client_id = excluded.client_id, month = excluded.month, invoice_no = excluded.invoice_no, status = excluded.status,
    issue_date = excluded.issue_date, due_date = excluded.due_date, tax_rate = excluded.tax_rate, tax_rounding = excluded.tax_rounding,
    paid_on = excluded.paid_on, note = excluded.note;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('invoices', n);

  delete from public.invoice_items it
   where it.company_id = cid
     and it.invoice_id in (select (x->>'id')::uuid from jsonb_array_elements(coalesce(p_data->'invoices','[]')) x)
     and it.id not in (select (x->>'id')::uuid from jsonb_array_elements(coalesce(p_data->'invoice_items','[]')) x);
  insert into public.invoice_items (id, company_id, invoice_id, project_id, project_item_id, name, unit, qty, unit_price, sort_order)
  select (x->>'id')::uuid, cid, (x->>'invoice_id')::uuid, (x->>'project_id')::uuid, (x->>'project_item_id')::uuid, x->>'name',
         (x->>'unit')::public.item_unit, coalesce((x->>'qty')::numeric, 0), coalesce((x->>'unit_price')::numeric, 0), coalesce((x->>'sort_order')::integer, 0)
    from jsonb_array_elements(coalesce(p_data->'invoice_items','[]')) x
  on conflict (id) do update set
    invoice_id = excluded.invoice_id, project_id = excluded.project_id, project_item_id = excluded.project_item_id,
    name = excluded.name, unit = excluded.unit, qty = excluded.qty, unit_price = excluded.unit_price, sort_order = excluded.sort_order;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('invoice_items', n);

  insert into public.month_targets (company_id, month, bill_target, profit_target, memo, expense_target, driver_target)
  select cid, (x->>'month')::date, coalesce((x->>'bill_target')::numeric, 0), coalesce((x->>'profit_target')::numeric, 0), coalesce(x->>'memo',''),
         coalesce((x->>'expense_target')::numeric, 0), coalesce((x->>'driver_target')::integer, 0)
    from jsonb_array_elements(coalesce(p_data->'month_targets','[]')) x
  on conflict (company_id, month) do update set
    bill_target = excluded.bill_target, profit_target = excluded.profit_target, memo = excluded.memo,
    expense_target = excluded.expense_target, driver_target = excluded.driver_target;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('month_targets', n);

  -- 0010：現金残高のスナップショット
  insert into public.cash_snapshots (id, company_id, as_of, balance, memo, created_by)
  select (x->>'id')::uuid, cid, (x->>'as_of')::date, coalesce((x->>'balance')::numeric, 0), coalesce(x->>'memo',''), (x->>'created_by')::uuid
    from jsonb_array_elements(coalesce(p_data->'cash_snapshots','[]')) x
  on conflict (id) do update set
    as_of = excluded.as_of, balance = excluded.balance, memo = excluded.memo;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('cash_snapshots', n);

  -- 0012：運行管理と法令対応（車両 → 書類・日報 → 日別の稼働 の順で入れる）
  insert into public.vehicles (id, company_id, plate, maker, model, ownership, driver_id, lease_monthly, odometer, memo, is_active, sort_order)
  select (x->>'id')::uuid, cid, x->>'plate', coalesce(x->>'maker',''), coalesce(x->>'model',''),
         coalesce((x->>'ownership')::public.vehicle_ownership, 'owned'), (x->>'driver_id')::uuid,
         coalesce((x->>'lease_monthly')::numeric, 0), coalesce((x->>'odometer')::numeric, 0), coalesce(x->>'memo',''),
         coalesce((x->>'is_active')::boolean, true), coalesce((x->>'sort_order')::integer, 0)
    from jsonb_array_elements(coalesce(p_data->'vehicles','[]')) x
  on conflict (id) do update set
    plate = excluded.plate, maker = excluded.maker, model = excluded.model, ownership = excluded.ownership,
    driver_id = excluded.driver_id, lease_monthly = excluded.lease_monthly, odometer = excluded.odometer,
    memo = excluded.memo, is_active = excluded.is_active, sort_order = excluded.sort_order;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('vehicles', n);

  insert into public.safety_managers (id, company_id, name, office, profile_id, driver_id, appointed_on, training_on, training_expires_on, notified_on, memo, is_active)
  select (x->>'id')::uuid, cid, x->>'name', coalesce(x->>'office',''), (x->>'profile_id')::uuid, (x->>'driver_id')::uuid,
         (x->>'appointed_on')::date, (x->>'training_on')::date, (x->>'training_expires_on')::date, (x->>'notified_on')::date,
         coalesce(x->>'memo',''), coalesce((x->>'is_active')::boolean, true)
    from jsonb_array_elements(coalesce(p_data->'safety_managers','[]')) x
  on conflict (id) do update set
    name = excluded.name, office = excluded.office, profile_id = excluded.profile_id, driver_id = excluded.driver_id,
    appointed_on = excluded.appointed_on, training_on = excluded.training_on, training_expires_on = excluded.training_expires_on,
    notified_on = excluded.notified_on, memo = excluded.memo, is_active = excluded.is_active;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('safety_managers', n);

  insert into public.documents (id, company_id, kind, driver_id, vehicle_id, label, number, issued_on, expires_on, reminder_days, file_path, memo, is_active)
  select (x->>'id')::uuid, cid, (x->>'kind')::public.document_kind, (x->>'driver_id')::uuid, (x->>'vehicle_id')::uuid,
         coalesce(x->>'label',''), coalesce(x->>'number',''), (x->>'issued_on')::date, (x->>'expires_on')::date,
         coalesce((x->>'reminder_days')::integer, 60), coalesce(x->>'file_path',''), coalesce(x->>'memo',''), coalesce((x->>'is_active')::boolean, true)
    from jsonb_array_elements(coalesce(p_data->'documents','[]')) x
  on conflict (id) do update set
    kind = excluded.kind, driver_id = excluded.driver_id, vehicle_id = excluded.vehicle_id, label = excluded.label,
    number = excluded.number, issued_on = excluded.issued_on, expires_on = excluded.expires_on,
    reminder_days = excluded.reminder_days, file_path = excluded.file_path, memo = excluded.memo, is_active = excluded.is_active;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('documents', n);

  -- 日報（month は t00_set_month トリガーが入れる）
  insert into public.daily_reports (id, company_id, work_date, driver_id, vehicle_id,
                                    pre_at, pre_method, pre_alcohol, pre_alcohol_ok, pre_health_ok, pre_inspection_ok, pre_instruction, pre_by,
                                    post_at, post_method, post_alcohol, post_alcohol_ok, post_condition_ok, post_incident, post_by,
                                    start_at, end_at, break_minutes, distance_km, odo_start, odo_end, memo, created_by, updated_by)
  select (x->>'id')::uuid, cid, (x->>'work_date')::date, (x->>'driver_id')::uuid, (x->>'vehicle_id')::uuid,
         (x->>'pre_at')::timestamptz, (x->>'pre_method')::public.roll_call_method, (x->>'pre_alcohol')::numeric,
         (x->>'pre_alcohol_ok')::boolean, (x->>'pre_health_ok')::boolean, (x->>'pre_inspection_ok')::boolean, coalesce(x->>'pre_instruction',''), (x->>'pre_by')::uuid,
         (x->>'post_at')::timestamptz, (x->>'post_method')::public.roll_call_method, (x->>'post_alcohol')::numeric,
         (x->>'post_alcohol_ok')::boolean, (x->>'post_condition_ok')::boolean, coalesce(x->>'post_incident',''), (x->>'post_by')::uuid,
         (x->>'start_at')::timestamptz, (x->>'end_at')::timestamptz, (x->>'break_minutes')::integer,
         (x->>'distance_km')::numeric, (x->>'odo_start')::numeric, (x->>'odo_end')::numeric, coalesce(x->>'memo',''),
         (x->>'created_by')::uuid, (x->>'updated_by')::uuid
    from jsonb_array_elements(coalesce(p_data->'daily_reports','[]')) x
  on conflict (id) do update set
    work_date = excluded.work_date, driver_id = excluded.driver_id, vehicle_id = excluded.vehicle_id,
    pre_at = excluded.pre_at, pre_method = excluded.pre_method, pre_alcohol = excluded.pre_alcohol,
    pre_alcohol_ok = excluded.pre_alcohol_ok, pre_health_ok = excluded.pre_health_ok, pre_inspection_ok = excluded.pre_inspection_ok,
    pre_instruction = excluded.pre_instruction, pre_by = excluded.pre_by,
    post_at = excluded.post_at, post_method = excluded.post_method, post_alcohol = excluded.post_alcohol,
    post_alcohol_ok = excluded.post_alcohol_ok, post_condition_ok = excluded.post_condition_ok, post_incident = excluded.post_incident, post_by = excluded.post_by,
    start_at = excluded.start_at, end_at = excluded.end_at, break_minutes = excluded.break_minutes,
    distance_km = excluded.distance_km, odo_start = excluded.odo_start, odo_end = excluded.odo_end, memo = excluded.memo;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('daily_reports', n);

  -- 日別の稼働（承認済みの合計がトリガーで月次の work_entries.qty になる）
  insert into public.work_day_entries (id, company_id, work_date, driver_id, project_item_id, qty, memo, source, status, reject_reason, submitted_by, approved_by, approved_at)
  select (x->>'id')::uuid, cid, (x->>'work_date')::date, (x->>'driver_id')::uuid, (x->>'project_item_id')::uuid,
         coalesce((x->>'qty')::numeric, 0), coalesce(x->>'memo',''), coalesce((x->>'source')::public.entry_source, 'staff'),
         coalesce((x->>'status')::public.day_entry_status, 'submitted'), coalesce(x->>'reject_reason',''),
         (x->>'submitted_by')::uuid, (x->>'approved_by')::uuid, (x->>'approved_at')::timestamptz
    from jsonb_array_elements(coalesce(p_data->'work_day_entries','[]')) x
  on conflict (id) do update set
    work_date = excluded.work_date, driver_id = excluded.driver_id, project_item_id = excluded.project_item_id,
    qty = excluded.qty, memo = excluded.memo, source = excluded.source, status = excluded.status,
    reject_reason = excluded.reject_reason, submitted_by = excluded.submitted_by, approved_by = excluded.approved_by, approved_at = excluded.approved_at;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('work_day_entries', n);

  insert into public.driver_instructions (id, company_id, driver_id, kind, instructed_on, hours, topics, instructor, memo, created_by)
  select (x->>'id')::uuid, cid, (x->>'driver_id')::uuid, coalesce(x->>'kind','regular'), (x->>'instructed_on')::date,
         coalesce((x->>'hours')::numeric, 0), coalesce(x->>'topics',''), coalesce(x->>'instructor',''), coalesce(x->>'memo',''), (x->>'created_by')::uuid
    from jsonb_array_elements(coalesce(p_data->'driver_instructions','[]')) x
  on conflict (id) do update set
    driver_id = excluded.driver_id, kind = excluded.kind, instructed_on = excluded.instructed_on, hours = excluded.hours,
    topics = excluded.topics, instructor = excluded.instructor, memo = excluded.memo;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('driver_instructions', n);

  insert into public.incidents (id, company_id, driver_id, vehicle_id, occurred_at, kind, place, description, cause, prevention, reported, cost, memo, created_by)
  select (x->>'id')::uuid, cid, (x->>'driver_id')::uuid, (x->>'vehicle_id')::uuid, (x->>'occurred_at')::timestamptz,
         coalesce((x->>'kind')::public.incident_kind, 'near_miss'), coalesce(x->>'place',''), coalesce(x->>'description',''),
         coalesce(x->>'cause',''), coalesce(x->>'prevention',''), coalesce((x->>'reported')::boolean, false),
         coalesce((x->>'cost')::numeric, 0), coalesce(x->>'memo',''), (x->>'created_by')::uuid
    from jsonb_array_elements(coalesce(p_data->'incidents','[]')) x
  on conflict (id) do update set
    driver_id = excluded.driver_id, vehicle_id = excluded.vehicle_id, occurred_at = excluded.occurred_at, kind = excluded.kind,
    place = excluded.place, description = excluded.description, cause = excluded.cause, prevention = excluded.prevention,
    reported = excluded.reported, cost = excluded.cost, memo = excluded.memo;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('incidents', n);

  -- 0013：取り込みの定義・採用・契約
  insert into public.import_profiles (id, company_id, name, client_id, project_id, mapping, driver_match, item_match, header_row, encoding, memo, is_active, last_used_at, created_by)
  select (x->>'id')::uuid, cid, x->>'name', (x->>'client_id')::uuid, (x->>'project_id')::uuid,
         coalesce(x->'mapping', '{}'::jsonb), coalesce(x->'driver_match', '{}'::jsonb), coalesce(x->'item_match', '{}'::jsonb),
         coalesce((x->>'header_row')::integer, 1), coalesce(x->>'encoding','auto'), coalesce(x->>'memo',''),
         coalesce((x->>'is_active')::boolean, true), (x->>'last_used_at')::timestamptz, (x->>'created_by')::uuid
    from jsonb_array_elements(coalesce(p_data->'import_profiles','[]')) x
  on conflict (id) do update set
    name = excluded.name, client_id = excluded.client_id, project_id = excluded.project_id, mapping = excluded.mapping,
    driver_match = excluded.driver_match, item_match = excluded.item_match, header_row = excluded.header_row,
    encoding = excluded.encoding, memo = excluded.memo, is_active = excluded.is_active, last_used_at = excluded.last_used_at;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('import_profiles', n);

  insert into public.applicants (id, company_id, name, kana, phone, email, source, stage, applied_on, interview_on, started_on, driver_id, has_license, has_vehicle, checklist, memo, created_by)
  select (x->>'id')::uuid, cid, x->>'name', coalesce(x->>'kana',''), coalesce(x->>'phone',''), coalesce(x->>'email',''),
         coalesce(x->>'source',''), coalesce((x->>'stage')::public.applicant_stage, 'applied'),
         coalesce((x->>'applied_on')::date, current_date), (x->>'interview_on')::date, (x->>'started_on')::date, (x->>'driver_id')::uuid,
         coalesce((x->>'has_license')::boolean, false), coalesce((x->>'has_vehicle')::boolean, false),
         coalesce(x->'checklist', '{}'::jsonb), coalesce(x->>'memo',''), (x->>'created_by')::uuid
    from jsonb_array_elements(coalesce(p_data->'applicants','[]')) x
  on conflict (id) do update set
    name = excluded.name, kana = excluded.kana, phone = excluded.phone, email = excluded.email, source = excluded.source,
    stage = excluded.stage, applied_on = excluded.applied_on, interview_on = excluded.interview_on, started_on = excluded.started_on,
    driver_id = excluded.driver_id, has_license = excluded.has_license, has_vehicle = excluded.has_vehicle,
    checklist = excluded.checklist, memo = excluded.memo;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('applicants', n);

  insert into public.applicant_events (id, company_id, applicant_id, happened_on, stage, note, created_by)
  select (x->>'id')::uuid, cid, (x->>'applicant_id')::uuid, coalesce((x->>'happened_on')::date, current_date),
         (x->>'stage')::public.applicant_stage, coalesce(x->>'note',''), (x->>'created_by')::uuid
    from jsonb_array_elements(coalesce(p_data->'applicant_events','[]')) x
  on conflict (id) do update set
    applicant_id = excluded.applicant_id, happened_on = excluded.happened_on, stage = excluded.stage, note = excluded.note;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('applicant_events', n);

  insert into public.contracts (id, company_id, driver_id, title, status, start_on, end_on, auto_renew, notice_days, file_path, agreed_at, memo, created_by)
  select (x->>'id')::uuid, cid, (x->>'driver_id')::uuid, coalesce(x->>'title','業務委託契約書'),
         coalesce((x->>'status')::public.contract_status, 'active'), coalesce((x->>'start_on')::date, current_date), (x->>'end_on')::date,
         coalesce((x->>'auto_renew')::boolean, true), coalesce((x->>'notice_days')::integer, 30),
         coalesce(x->>'file_path',''), (x->>'agreed_at')::timestamptz, coalesce(x->>'memo',''), (x->>'created_by')::uuid
    from jsonb_array_elements(coalesce(p_data->'contracts','[]')) x
  on conflict (id) do update set
    driver_id = excluded.driver_id, title = excluded.title, status = excluded.status, start_on = excluded.start_on,
    end_on = excluded.end_on, auto_renew = excluded.auto_renew, notice_days = excluded.notice_days,
    file_path = excluded.file_path, agreed_at = excluded.agreed_at, memo = excluded.memo;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('contracts', n);

  -- 0014：税務の期限・借入と返済予定
  -- 同じ（種類・期日）が別 ID で残っていると一意制約に当たるため、先に消しておく
  delete from public.tax_tasks t
   where t.company_id = cid
     and exists (
       select 1 from jsonb_array_elements(coalesce(p_data->'tax_tasks','[]')) x
        where x->>'kind' = t.kind and (x->>'due_on')::date = t.due_on and (x->>'id')::uuid <> t.id
     );
  insert into public.tax_tasks (id, company_id, kind, title, detail, due_on, status, done_on, amount, memo, is_generated, created_by)
  select (x->>'id')::uuid, cid, x->>'kind', x->>'title', coalesce(x->>'detail',''), (x->>'due_on')::date,
         coalesce((x->>'status')::public.tax_task_status, 'todo'), (x->>'done_on')::date, (x->>'amount')::numeric,
         coalesce(x->>'memo',''), coalesce((x->>'is_generated')::boolean, true), (x->>'created_by')::uuid
    from jsonb_array_elements(coalesce(p_data->'tax_tasks','[]')) x
  on conflict (id) do update set
    kind = excluded.kind, title = excluded.title, detail = excluded.detail, due_on = excluded.due_on,
    status = excluded.status, done_on = excluded.done_on, amount = excluded.amount, memo = excluded.memo,
    is_generated = excluded.is_generated;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('tax_tasks', n);

  insert into public.loans (id, company_id, name, lender, principal, annual_rate, start_on, months, payment_day, monthly_payment, status, memo, created_by)
  select (x->>'id')::uuid, cid, x->>'name', coalesce(x->>'lender',''), coalesce((x->>'principal')::numeric, 0),
         coalesce((x->>'annual_rate')::numeric, 0), coalesce((x->>'start_on')::date, current_date),
         coalesce((x->>'months')::integer, 60), coalesce((x->>'payment_day')::integer, 0),
         coalesce((x->>'monthly_payment')::numeric, 0), coalesce((x->>'status')::public.loan_status, 'active'),
         coalesce(x->>'memo',''), (x->>'created_by')::uuid
    from jsonb_array_elements(coalesce(p_data->'loans','[]')) x
  on conflict (id) do update set
    name = excluded.name, lender = excluded.lender, principal = excluded.principal, annual_rate = excluded.annual_rate,
    start_on = excluded.start_on, months = excluded.months, payment_day = excluded.payment_day,
    monthly_payment = excluded.monthly_payment, status = excluded.status, memo = excluded.memo;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('loans', n);

  insert into public.loan_payments (id, company_id, loan_id, seq, due_on, principal, interest, total, balance, paid_on, memo)
  select (x->>'id')::uuid, cid, (x->>'loan_id')::uuid, coalesce((x->>'seq')::integer, 1), (x->>'due_on')::date,
         coalesce((x->>'principal')::numeric, 0), coalesce((x->>'interest')::numeric, 0), coalesce((x->>'total')::numeric, 0),
         coalesce((x->>'balance')::numeric, 0), (x->>'paid_on')::date, coalesce(x->>'memo','')
    from jsonb_array_elements(coalesce(p_data->'loan_payments','[]')) x
  on conflict (id) do update set
    loan_id = excluded.loan_id, seq = excluded.seq, due_on = excluded.due_on, principal = excluded.principal,
    interest = excluded.interest, total = excluded.total, balance = excluded.balance, paid_on = excluded.paid_on, memo = excluded.memo;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('loan_payments', n);

  -- 0018：元請の支払通知
  insert into public.payment_notices (id, company_id, client_id, month, notice_no, received_on, total_amount, tax_amount, status, memo, created_by)
  select (x->>'id')::uuid, cid, (x->>'client_id')::uuid, (x->>'month')::date, coalesce(x->>'notice_no',''),
         (x->>'received_on')::date, coalesce((x->>'total_amount')::numeric, 0), coalesce((x->>'tax_amount')::numeric, 0),
         coalesce((x->>'status')::public.notice_status, 'received'), coalesce(x->>'memo',''), (x->>'created_by')::uuid
    from jsonb_array_elements(coalesce(p_data->'payment_notices','[]')) x
  on conflict (id) do update set
    client_id = excluded.client_id, month = excluded.month, notice_no = excluded.notice_no, received_on = excluded.received_on,
    total_amount = excluded.total_amount, tax_amount = excluded.tax_amount, status = excluded.status, memo = excluded.memo;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('payment_notices', n);

  insert into public.payment_notice_items (id, company_id, notice_id, project_item_id, raw_name, qty, unit_price, amount, memo, sort_order)
  select (x->>'id')::uuid, cid, (x->>'notice_id')::uuid, (x->>'project_item_id')::uuid, coalesce(x->>'raw_name',''),
         coalesce((x->>'qty')::numeric, 0), coalesce((x->>'unit_price')::numeric, 0), coalesce((x->>'amount')::numeric, 0),
         coalesce(x->>'memo',''), coalesce((x->>'sort_order')::integer, 0)
    from jsonb_array_elements(coalesce(p_data->'payment_notice_items','[]')) x
  on conflict (id) do update set
    notice_id = excluded.notice_id, project_item_id = excluded.project_item_id, raw_name = excluded.raw_name,
    qty = excluded.qty, unit_price = excluded.unit_price, amount = excluded.amount, memo = excluded.memo, sort_order = excluded.sort_order;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('payment_notice_items', n);

  -- 0019：代表（承認・意思決定・会社の基本情報・中期計画）
  insert into public.approvals (id, company_id, kind, title, detail, amount, ref_table, ref_id, href, due_on,
                                status, requested_by, requested_at, decided_by, decided_at, decision_note)
  select (x->>'id')::uuid, cid, coalesce((x->>'kind')::public.approval_kind, 'other'), coalesce(x->>'title','（件名なし）'),
         coalesce(x->>'detail',''), (x->>'amount')::numeric, coalesce(x->>'ref_table',''), coalesce(x->>'ref_id',''),
         coalesce(x->>'href',''), (x->>'due_on')::date,
         coalesce((x->>'status')::public.approval_status, 'pending'), (x->>'requested_by')::uuid,
         coalesce((x->>'requested_at')::timestamptz, now()), (x->>'decided_by')::uuid, (x->>'decided_at')::timestamptz,
         coalesce(x->>'decision_note','')
    from jsonb_array_elements(coalesce(p_data->'approvals','[]')) x
  on conflict (id) do update set
    kind = excluded.kind, title = excluded.title, detail = excluded.detail, amount = excluded.amount,
    ref_table = excluded.ref_table, ref_id = excluded.ref_id, href = excluded.href, due_on = excluded.due_on,
    status = excluded.status, requested_by = excluded.requested_by, requested_at = excluded.requested_at,
    decided_by = excluded.decided_by, decided_at = excluded.decided_at, decision_note = excluded.decision_note;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('approvals', n);

  insert into public.decisions (id, company_id, title, context, options, decision, reason, expected_effect, amount,
                                decided_on, review_on, outcome, outcome_on, status, approval_id, created_by)
  select (x->>'id')::uuid, cid, coalesce(x->>'title','（件名なし）'), coalesce(x->>'context',''),
         coalesce(x->'options','[]'::jsonb), coalesce(x->>'decision',''), coalesce(x->>'reason',''),
         coalesce(x->>'expected_effect',''), (x->>'amount')::numeric,
         coalesce((x->>'decided_on')::date, current_date), (x->>'review_on')::date,
         coalesce(x->>'outcome',''), (x->>'outcome_on')::date,
         coalesce((x->>'status')::public.decision_status, 'open'), (x->>'approval_id')::uuid, (x->>'created_by')::uuid
    from jsonb_array_elements(coalesce(p_data->'decisions','[]')) x
  on conflict (id) do update set
    title = excluded.title, context = excluded.context, options = excluded.options, decision = excluded.decision,
    reason = excluded.reason, expected_effect = excluded.expected_effect, amount = excluded.amount,
    decided_on = excluded.decided_on, review_on = excluded.review_on, outcome = excluded.outcome,
    outcome_on = excluded.outcome_on, status = excluded.status, approval_id = excluded.approval_id;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('decisions', n);

  if p_data ? 'company_profile' and jsonb_typeof(p_data->'company_profile') = 'object' then
    insert into public.company_profile (company_id, corporate_number, established_on, capital, registered_address,
                                        representative_name, business_purpose, transport_office, transport_number,
                                        transport_notified_on, labor_insurance_number, social_insurance_number, memo)
    select cid, coalesce(cp->>'corporate_number',''), (cp->>'established_on')::date, (cp->>'capital')::numeric,
           coalesce(cp->>'registered_address',''), coalesce(cp->>'representative_name',''),
           coalesce(cp->>'business_purpose',''), coalesce(cp->>'transport_office',''),
           coalesce(cp->>'transport_number',''), (cp->>'transport_notified_on')::date,
           coalesce(cp->>'labor_insurance_number',''), coalesce(cp->>'social_insurance_number',''),
           coalesce(cp->>'memo','')
      from (select p_data->'company_profile' as cp) s
    on conflict (company_id) do update set
      corporate_number = excluded.corporate_number, established_on = excluded.established_on, capital = excluded.capital,
      registered_address = excluded.registered_address, representative_name = excluded.representative_name,
      business_purpose = excluded.business_purpose, transport_office = excluded.transport_office,
      transport_number = excluded.transport_number, transport_notified_on = excluded.transport_notified_on,
      labor_insurance_number = excluded.labor_insurance_number, social_insurance_number = excluded.social_insurance_number,
      memo = excluded.memo;
    get diagnostics n = row_count; counts := counts || jsonb_build_object('company_profile', n);
  end if;

  insert into public.officers (id, company_id, name, title, appointed_on, term_end_on, is_active, memo, sort_order)
  select (x->>'id')::uuid, cid, coalesce(x->>'name','（名称なし）'), coalesce(x->>'title','取締役'),
         (x->>'appointed_on')::date, (x->>'term_end_on')::date, coalesce((x->>'is_active')::boolean, true),
         coalesce(x->>'memo',''), coalesce((x->>'sort_order')::integer, 0)
    from jsonb_array_elements(coalesce(p_data->'officers','[]')) x
  on conflict (id) do update set
    name = excluded.name, title = excluded.title, appointed_on = excluded.appointed_on,
    term_end_on = excluded.term_end_on, is_active = excluded.is_active, memo = excluded.memo, sort_order = excluded.sort_order;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('officers', n);

  insert into public.shareholders (id, company_id, name, shares, memo, sort_order)
  select (x->>'id')::uuid, cid, coalesce(x->>'name','（名称なし）'), coalesce((x->>'shares')::numeric, 0),
         coalesce(x->>'memo',''), coalesce((x->>'sort_order')::integer, 0)
    from jsonb_array_elements(coalesce(p_data->'shareholders','[]')) x
  on conflict (id) do update set
    name = excluded.name, shares = excluded.shares, memo = excluded.memo, sort_order = excluded.sort_order;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('shareholders', n);

  insert into public.insurance_policies (id, company_id, kind, insurer, policy_no, starts_on, expires_on, premium, covers, memo, is_active)
  select (x->>'id')::uuid, cid, coalesce(x->>'kind',''), coalesce(x->>'insurer',''), coalesce(x->>'policy_no',''),
         (x->>'starts_on')::date, (x->>'expires_on')::date, coalesce((x->>'premium')::numeric, 0),
         coalesce(x->>'covers',''), coalesce(x->>'memo',''), coalesce((x->>'is_active')::boolean, true)
    from jsonb_array_elements(coalesce(p_data->'insurance_policies','[]')) x
  on conflict (id) do update set
    kind = excluded.kind, insurer = excluded.insurer, policy_no = excluded.policy_no, starts_on = excluded.starts_on,
    expires_on = excluded.expires_on, premium = excluded.premium, covers = excluded.covers,
    memo = excluded.memo, is_active = excluded.is_active;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('insurance_policies', n);

  insert into public.advisors (id, company_id, kind, name, contact, fee, memo, is_active, sort_order)
  select (x->>'id')::uuid, cid, coalesce(x->>'kind','税理士'), coalesce(x->>'name','（名称なし）'),
         coalesce(x->>'contact',''), coalesce((x->>'fee')::numeric, 0), coalesce(x->>'memo',''),
         coalesce((x->>'is_active')::boolean, true), coalesce((x->>'sort_order')::integer, 0)
    from jsonb_array_elements(coalesce(p_data->'advisors','[]')) x
  on conflict (id) do update set
    kind = excluded.kind, name = excluded.name, contact = excluded.contact, fee = excluded.fee,
    memo = excluded.memo, is_active = excluded.is_active, sort_order = excluded.sort_order;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('advisors', n);

  insert into public.guarantees (id, company_id, lender, kind, amount, loan_id, starts_on, ends_on, is_active, memo)
  select (x->>'id')::uuid, cid, coalesce(x->>'lender',''), coalesce(x->>'kind','個人保証'),
         coalesce((x->>'amount')::numeric, 0), (x->>'loan_id')::uuid, (x->>'starts_on')::date, (x->>'ends_on')::date,
         coalesce((x->>'is_active')::boolean, true), coalesce(x->>'memo','')
    from jsonb_array_elements(coalesce(p_data->'guarantees','[]')) x
  on conflict (id) do update set
    lender = excluded.lender, kind = excluded.kind, amount = excluded.amount, loan_id = excluded.loan_id,
    starts_on = excluded.starts_on, ends_on = excluded.ends_on, is_active = excluded.is_active, memo = excluded.memo;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('guarantees', n);

  insert into public.plans (id, company_id, name, from_year, to_year, vision, memo, is_active, created_by)
  select (x->>'id')::uuid, cid, coalesce(x->>'name','（名称なし）'),
         coalesce((x->>'from_year')::integer, extract(year from current_date)::integer),
         coalesce((x->>'to_year')::integer, extract(year from current_date)::integer + 2),
         coalesce(x->>'vision',''), coalesce(x->>'memo',''), coalesce((x->>'is_active')::boolean, true),
         (x->>'created_by')::uuid
    from jsonb_array_elements(coalesce(p_data->'plans','[]')) x
  on conflict (id) do update set
    name = excluded.name, from_year = excluded.from_year, to_year = excluded.to_year, vision = excluded.vision,
    memo = excluded.memo, is_active = excluded.is_active;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('plans', n);

  insert into public.plan_years (id, company_id, plan_id, year, bill_target, profit_target, driver_target, memo)
  select (x->>'id')::uuid, cid, (x->>'plan_id')::uuid, (x->>'year')::integer,
         coalesce((x->>'bill_target')::numeric, 0), coalesce((x->>'profit_target')::numeric, 0),
         coalesce((x->>'driver_target')::integer, 0), coalesce(x->>'memo','')
    from jsonb_array_elements(coalesce(p_data->'plan_years','[]')) x
  on conflict (id) do update set
    plan_id = excluded.plan_id, year = excluded.year, bill_target = excluded.bill_target,
    profit_target = excluded.profit_target, driver_target = excluded.driver_target, memo = excluded.memo;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('plan_years', n);


  -- 0020：ドライバーの振込口座（version 7 の配列。古いバックアップは drivers の列から拾う）
  insert into public.driver_bank_accounts (driver_id, company_id, bank_code, bank_name, branch_code, branch_name,
                                           account_type, account_number, account_holder_kana)
  select (x->>'driver_id')::uuid, cid, coalesce(x->>'bank_code',''), coalesce(x->>'bank_name',''),
         coalesce(x->>'branch_code',''), coalesce(x->>'branch_name',''), (x->>'account_type')::public.bank_account_type,
         coalesce(x->>'account_number',''), coalesce(x->>'account_holder_kana','')
    from jsonb_array_elements(coalesce(p_data->'driver_bank_accounts','[]')) x
  on conflict (driver_id) do update set
    bank_code = excluded.bank_code, bank_name = excluded.bank_name, branch_code = excluded.branch_code,
    branch_name = excluded.branch_name, account_type = excluded.account_type,
    account_number = excluded.account_number, account_holder_kana = excluded.account_holder_kana;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('driver_bank_accounts', n);

  if coalesce(jsonb_array_length(p_data->'driver_bank_accounts'), 0) = 0 then
    insert into public.driver_bank_accounts (driver_id, company_id, bank_code, bank_name, branch_code, branch_name,
                                             account_type, account_number, account_holder_kana)
    select (x->>'id')::uuid, cid, coalesce(x->>'bank_code',''), coalesce(x->>'bank_name',''),
           coalesce(x->>'branch_code',''), coalesce(x->>'branch_name',''), (x->>'account_type')::public.bank_account_type,
           coalesce(x->>'account_number',''), coalesce(x->>'account_holder_kana','')
      from jsonb_array_elements(coalesce(p_data->'drivers','[]')) x
     where coalesce(x->>'account_number','') <> '' or coalesce(x->>'bank_code','') <> ''
    on conflict (driver_id) do nothing;
  end if;

  -- 0020：決裁のルールと委任
  insert into public.approval_rules (id, company_id, kind, label, threshold_amount, is_enabled, due_days, note, sort_order)
  select (x->>'id')::uuid, cid, (x->>'kind')::public.approval_kind, coalesce(x->>'label',''),
         (x->>'threshold_amount')::numeric, coalesce((x->>'is_enabled')::boolean, true),
         coalesce((x->>'due_days')::integer, 3), coalesce(x->>'note',''), coalesce((x->>'sort_order')::integer, 0)
    from jsonb_array_elements(coalesce(p_data->'approval_rules','[]')) x
  on conflict (company_id, kind) do update set
    label = excluded.label, threshold_amount = excluded.threshold_amount, is_enabled = excluded.is_enabled,
    due_days = excluded.due_days, note = excluded.note, sort_order = excluded.sort_order;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('approval_rules', n);

  insert into public.approval_delegations (id, company_id, to_profile_id, from_on, to_on, max_amount, kinds, is_active, memo, created_by)
  select (x->>'id')::uuid, cid, (x->>'to_profile_id')::uuid,
         coalesce((x->>'from_on')::date, current_date), coalesce((x->>'to_on')::date, current_date),
         (x->>'max_amount')::numeric,
         coalesce((select array_agg(v::public.approval_kind) from jsonb_array_elements_text(coalesce(x->'kinds','[]'::jsonb)) v), '{}'),
         coalesce((x->>'is_active')::boolean, true), coalesce(x->>'memo',''), (x->>'created_by')::uuid
    from jsonb_array_elements(coalesce(p_data->'approval_delegations','[]')) x
   where exists (select 1 from public.profiles p where p.id = (x->>'to_profile_id')::uuid and p.company_id = cid)
  on conflict (id) do update set
    to_profile_id = excluded.to_profile_id, from_on = excluded.from_on, to_on = excluded.to_on,
    max_amount = excluded.max_amount, kinds = excluded.kinds, is_active = excluded.is_active, memo = excluded.memo;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('approval_delegations', n);

  -- 0023 配車・シフト
  insert into public.project_demands (id, company_id, project_item_id, weekday, need)
  select (x->>'id')::uuid, cid, (x->>'project_item_id')::uuid, (x->>'weekday')::smallint, coalesce((x->>'need')::integer, 0)
    from jsonb_array_elements(coalesce(p_data->'project_demands','[]')) x
   where exists (select 1 from public.project_items t where t.id = (x->>'project_item_id')::uuid and t.company_id = cid)
  on conflict (project_item_id, weekday) do update set need = excluded.need;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('project_demands', n);

  insert into public.project_demand_days (id, company_id, project_item_id, on_date, need, note)
  select (x->>'id')::uuid, cid, (x->>'project_item_id')::uuid, (x->>'on_date')::date,
         coalesce((x->>'need')::integer, 0), coalesce(x->>'note','')
    from jsonb_array_elements(coalesce(p_data->'project_demand_days','[]')) x
   where exists (select 1 from public.project_items t where t.id = (x->>'project_item_id')::uuid and t.company_id = cid)
  on conflict (project_item_id, on_date) do update set need = excluded.need, note = excluded.note;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('project_demand_days', n);

  insert into public.driver_day_offs (id, company_id, driver_id, on_date, status, reason, decided_by, decided_at, decided_note)
  select (x->>'id')::uuid, cid, (x->>'driver_id')::uuid, (x->>'on_date')::date,
         coalesce((x->>'status')::public.day_off_status, 'requested'), coalesce(x->>'reason',''),
         (x->>'decided_by')::uuid, (x->>'decided_at')::timestamptz, coalesce(x->>'decided_note','')
    from jsonb_array_elements(coalesce(p_data->'driver_day_offs','[]')) x
   where exists (select 1 from public.drivers t where t.id = (x->>'driver_id')::uuid and t.company_id = cid)
  on conflict (driver_id, on_date) do update set
    status = excluded.status, reason = excluded.reason, decided_by = excluded.decided_by,
    decided_at = excluded.decided_at, decided_note = excluded.decided_note;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('driver_day_offs', n);

  insert into public.dispatch_assignments (id, company_id, on_date, driver_id, project_item_id, qty_plan, status, note, confirmed_at, confirmed_by, notified_at)
  select (x->>'id')::uuid, cid, (x->>'on_date')::date, (x->>'driver_id')::uuid, (x->>'project_item_id')::uuid,
         coalesce((x->>'qty_plan')::numeric, 1), coalesce((x->>'status')::public.dispatch_status, 'planned'),
         coalesce(x->>'note',''), (x->>'confirmed_at')::timestamptz, (x->>'confirmed_by')::uuid, (x->>'notified_at')::timestamptz
    from jsonb_array_elements(coalesce(p_data->'dispatch_assignments','[]')) x
   where exists (select 1 from public.drivers t where t.id = (x->>'driver_id')::uuid and t.company_id = cid)
     and exists (select 1 from public.project_items t where t.id = (x->>'project_item_id')::uuid and t.company_id = cid)
  on conflict (company_id, on_date, driver_id, project_item_id) do update set
    qty_plan = excluded.qty_plan, status = excluded.status, note = excluded.note,
    confirmed_at = excluded.confirmed_at, confirmed_by = excluded.confirmed_by, notified_at = excluded.notified_at;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('dispatch_assignments', n);

  insert into public.aptitude_tests (id, company_id, driver_id, kind, taken_on, institution, result, memo, file_path, created_by)
  select (x->>'id')::uuid, cid, (x->>'driver_id')::uuid, coalesce((x->>'kind')::public.aptitude_kind, 'general'), (x->>'taken_on')::date,
         coalesce(x->>'institution',''), coalesce(x->>'result',''), coalesce(x->>'memo',''), coalesce(x->>'file_path',''), (x->>'created_by')::uuid
    from jsonb_array_elements(coalesce(p_data->'aptitude_tests','[]')) x
   where exists (select 1 from public.drivers t where t.id = (x->>'driver_id')::uuid and t.company_id = cid)
  on conflict (driver_id, kind, taken_on) do update set
    institution = excluded.institution, result = excluded.result, memo = excluded.memo, file_path = excluded.file_path;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('aptitude_tests', n);

  perform set_config('app.skip_audit', 'off', true);
  perform set_config('app.bypass_closing', 'off', true);
  perform set_config('app.audit_internal', 'on', true);
  perform public.write_audit(cid, 'import_backup', 'company', cid::text, null, counts);
  perform set_config('app.audit_internal', 'off', true);
  return counts;
end $$;

-- =============================================================================
-- 事務の画面に「支払明細を送った人数」を足す（それ以外は 0026 と同じ）
-- =============================================================================
-- 会社の LINE 連携が有効か（事務員は integrations を読めないため、真偽だけを返す definer）
create or replace function public.company_line_enabled()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select i.is_enabled from public.integrations i
                    where i.company_id = public.current_company_id() and i.kind = 'line'), false);
$$;
comment on function public.company_line_enabled() is '自社の LINE 連携が有効か（中身は返さない）';

create or replace function public.office_desk(p_month date default null, p_today date default null)
returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare
  cid uuid := public.current_company_id();
  today date := coalesce(p_today, (now() at time zone 'Asia/Tokyo')::date);
  this_month date := date_trunc('month', coalesce(p_today, (now() at time zone 'Asia/Tokyo')::date))::date;
  m date;
begin
  if cid is null or not public.is_admin() then
    raise exception '権限がありません' using errcode = 'P0001', hint = 'FORBIDDEN';
  end if;
  m := date_trunc('month', coalesce(
    p_month,
    (select min(l.month) from public.v_month_list l
      where l.company_id = cid and l.status = 'open' and l.month < this_month and coalesce(l.entry_count, 0) > 0),
    this_month
  ))::date;

  return jsonb_build_object(
    'today', today,
    'month', m,

    -- 承認待ちの稼働報告（古い日から。多すぎるときは件数だけ total で返す）
    'pending_entries', (
      select coalesce(jsonb_agg(to_jsonb(x) order by x.work_date, x.driver_sort_order, x.driver_name, x.created_at), '[]'::jsonb)
        from (
          select e.id, e.work_date, e.month, e.driver_id, e.driver_name, e.driver_sort_order,
                 e.project_name, e.item_name, e.unit, e.qty, e.memo, e.source, e.created_at
            from public.v_work_day_entry_list e
           where e.company_id = cid and e.status = 'submitted'
           order by e.work_date, e.driver_sort_order, e.driver_name, e.created_at
           limit 300
        ) x
    ),
    'pending_entries_total', (
      select count(*) from public.work_day_entries where company_id = cid and status = 'submitted'
    ),

    -- 休み希望（決まっていないもの）
    'day_offs', (
      select coalesce(jsonb_agg(to_jsonb(x) order by x.on_date, x.driver_sort_order, x.driver_name), '[]'::jsonb)
        from (
          select o.id, o.on_date, o.reason, o.driver_id, o.driver_name, o.driver_sort_order, o.created_at
            from public.v_day_off_list o
           where o.company_id = cid and o.status = 'requested'
           order by o.on_date
           limit 100
        ) x
    ),

    -- 今日の報告：稼働中のドライバーと、今日の点呼・稼働・配車・休み・催促
    'drivers', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', d.id, 'name', d.name, 'sort_order', d.sort_order,
               'weekly_off', to_jsonb(coalesce(d.weekly_off, '{}'::integer[])),
               'line_linked', coalesce(d.line_user_id, '') <> '',
               'has_login', exists (select 1 from public.profiles p where p.company_id = cid and p.driver_id = d.id and p.is_active)
             ) order by d.sort_order, d.name), '[]'::jsonb)
        from public.drivers d
       where d.company_id = cid and d.is_active
    ),
    'today_reports', (
      select coalesce(jsonb_agg(jsonb_build_object('driver_id', r.driver_id, 'pre_at', r.pre_at, 'post_at', r.post_at)), '[]'::jsonb)
        from public.daily_reports r
       where r.company_id = cid and r.work_date = today
    ),
    'today_entry_drivers', (
      select coalesce(jsonb_agg(distinct w.driver_id), '[]'::jsonb)
        from public.work_day_entries w
       where w.company_id = cid and w.work_date = today
    ),
    'today_dispatch_drivers', (
      select coalesce(jsonb_agg(distinct a.driver_id), '[]'::jsonb)
        from public.dispatch_assignments a
       where a.company_id = cid and a.on_date = today and a.status <> 'cancelled'
    ),
    'today_off_drivers', (
      select coalesce(jsonb_agg(distinct o.driver_id), '[]'::jsonb)
        from public.driver_day_offs o
       where o.company_id = cid and o.on_date = today and o.status = 'approved'
    ),
    'reminders', (
      select coalesce(jsonb_agg(jsonb_build_object('driver_id', r.driver_id, 'sent_at', r.sent_at, 'sent_by_name', r.sent_by_name)), '[]'::jsonb)
        from public.report_reminders r
       where r.company_id = cid and r.work_date = today
    ),

    -- 明日の配車（見通しのビューをそのまま）
    'tomorrow', (
      select to_jsonb(o) from public.v_dispatch_outlook o where o.company_id = cid and o.on_date = today + 1
    ),

    -- 入金待ちの請求書（期日の判定はアプリ）
    'invoices_issued', (
      select coalesce(jsonb_agg(to_jsonb(x) order by x.due_date nulls last, x.client_sort_order), '[]'::jsonb)
        from (
          select i.id, i.client_id, i.client_name, i.client_sort_order, i.month, i.invoice_no, i.due_date, i.total
            from public.v_invoice_list i
           where i.company_id = cid and i.status = 'issued'
        ) x
    ),
    -- 消し込めていない入金（出金は請求書と結びつかないので数えない）
    'bank_unmatched', (
      select count(*) from public.bank_transactions b
       where b.company_id = cid and b.status = 'unmatched' and b.amount > 0
    ),
    -- 重要な「気になること」（未対応。新しい順に 5 件）
    'alerts_high', (
      select coalesce(jsonb_agg(to_jsonb(x) order by x.detected_at desc), '[]'::jsonb)
        from (
          select a.id, a.code, a.title, a.detail, a.href, a.month, a.detected_at
            from public.alerts a
           where a.company_id = cid and a.status = 'open' and a.severity = 'high'
           order by a.detected_at desc
           limit 5
        ) x
    ),
    'alerts_open', (
      select count(*) from public.alerts a where a.company_id = cid and a.status = 'open'
    ),

    -- 締めていない過去の月（データがある月だけ。「先月がまだ」の案内に使う）
    'open_past_months', (
      select coalesce(jsonb_agg(l.month order by l.month), '[]'::jsonb)
        from public.v_month_list l
       where l.company_id = cid and l.status = 'open' and l.month < this_month and coalesce(l.entry_count, 0) > 0
    ),

    -- 0028：締めたあとの手順（支払明細の送付・振込）が残っている直近の月。
    --   手順の既定の月は「締めていない一番古い月」へ進むため、締めた月の残りは今日やることで知らせる。
    --   締めて 45 日を過ぎた月は出さない（以前から使っている会社で古い月を催促し続けないように）
    'after_close', (
      select jsonb_build_object(
               'month', mc.month,
               'closed_at', mc.closed_at,
               'statement_targets', (
                 select count(distinct w.driver_id) from public.work_entries w
                  where w.company_id = cid and w.month = mc.month and w.qty > 0
               ),
               'statement_sent', (
                 select count(*) from public.statement_deliveries sd
                  where sd.company_id = cid and sd.month = mc.month
                    and exists (select 1 from public.work_entries w where w.company_id = cid and w.month = mc.month and w.qty > 0 and w.driver_id = sd.driver_id)
               ),
               'checks', (
                 select coalesce(jsonb_agg(k.key order by k.key), '[]'::jsonb)
                   from public.month_close_checks k
                  where k.company_id = cid and k.month = mc.month
               )
             )
        from public.month_closings mc
       where mc.company_id = cid and mc.status = 'closed' and mc.closed_at >= now() - interval '45 days'
       order by mc.month desc
       limit 1
    ),

    -- 月締めの手順に使う事実（その月）
    'closing', jsonb_build_object(
      'status', coalesce((select l.status::text from public.v_month_list l where l.company_id = cid and l.month = m), 'open'),
      'closed_at', (select l.closed_at from public.v_month_list l where l.company_id = cid and l.month = m),
      'entry_count', (select count(*) from public.work_entries w where w.company_id = cid and w.month = m and w.qty > 0),
      'zero_qty', (select count(*) from public.work_entries w where w.company_id = cid and w.month = m and w.qty = 0),
      'pending', (select count(*) from public.work_day_entries w where w.company_id = cid and w.month = m and w.status = 'submitted'),
      'roll_call_missing', coalesce((select s.roll_call_missing_count from public.v_day_status s where s.company_id = cid and s.month = m), 0),
      'no_report', (select count(*) from public.alerts a where a.company_id = cid and a.month = m and a.status = 'open' and a.code = 'dispatch_no_report'),
      'rate_diffs', (select count(*) from public.rate_diffs(m)),
      'recurring_due', (
        select count(*) from public.recurring_expenses r
         where r.company_id = cid and r.is_active
           and (r.start_month is null or r.start_month <= m)
           and (r.end_month is null or r.end_month >= m)
      ),
      'recurring_unapplied', (
        select count(*) from public.recurring_expenses r
         where r.company_id = cid and r.is_active
           and (r.start_month is null or r.start_month <= m)
           and (r.end_month is null or r.end_month >= m)
           and not exists (select 1 from public.expenses e where e.company_id = cid and e.month = m and e.recurring_id = r.id)
      ),
      'notices', (select count(*) from public.payment_notices n where n.company_id = cid and n.month = m),
      'notice_diffs', (
        select count(*) from public.v_payment_notice_diff d
         where d.company_id = cid and d.month = m and d.diff_status <> 'ok'
      ),
      -- 請求先ごとのその月の売上（案件に取引先が付いているもの）と、取引先が付いていない売上
      'clients', (
        select coalesce(jsonb_agg(jsonb_build_object('client_id', x.client_id, 'client_name', x.client_name, 'bill', x.bill)
                                  order by x.client_name), '[]'::jsonb)
          from (
            select p.client_id, max(c.name) as client_name, sum(e.bill) as bill
              from public.v_work_entry_calc e
              join public.projects p on p.id = e.project_id
              join public.clients c on c.id = p.client_id
             where e.company_id = cid and e.month = m and p.client_id is not null
             group by p.client_id
            having sum(e.bill) > 0
          ) x
      ),
      'unassigned_bill', (
        select coalesce(sum(e.bill), 0)
          from public.v_work_entry_calc e
          join public.projects p on p.id = e.project_id
         where e.company_id = cid and e.month = m and p.client_id is null
      ),
      'invoices', (
        select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'client_id', i.client_id, 'status', i.status, 'total', i.total, 'invoice_no', i.invoice_no)
                                  order by i.client_sort_order), '[]'::jsonb)
          from public.v_invoice_list i
         where i.company_id = cid and i.month = m
      ),
      -- 0028：支払明細の送付（稼働があった人・送った人・LINE が届くのにまだ送っていない人）
      'statement_targets', (
        select count(distinct w.driver_id) from public.work_entries w
         where w.company_id = cid and w.month = m and w.qty > 0
      ),
      'statement_sent', (
        select count(*) from public.statement_deliveries sd
         where sd.company_id = cid and sd.month = m
           and exists (select 1 from public.work_entries w where w.company_id = cid and w.month = m and w.qty > 0 and w.driver_id = sd.driver_id)
      ),
      -- LINE が届くのに、まだ送っていない人（「LINE で送る」を出すかどうか）
      'statement_line_ready', (
        select case when public.company_line_enabled() then count(distinct w.driver_id) else 0 end
          from public.work_entries w
          join public.drivers d on d.id = w.driver_id
         where w.company_id = cid and w.month = m and w.qty > 0 and coalesce(d.line_user_id, '') <> ''
           and not exists (select 1 from public.statement_deliveries sd where sd.company_id = cid and sd.month = m and sd.driver_id = w.driver_id)
      ),
      'checks', (
        select coalesce(jsonb_agg(jsonb_build_object('key', k.key, 'done_at', k.done_at, 'done_by_name', k.done_by_name) order by k.done_at), '[]'::jsonb)
          from public.month_close_checks k
         where k.company_id = cid and k.month = m
      )
    )
  );
end $$;


-- =============================================================================
-- 権限（テーブルと関数を足したので出し直す。0023 で気づいた落とし穴）
-- =============================================================================
grant execute on function public.is_clerk() to authenticated, service_role;
grant execute on function public.is_manager() to authenticated, service_role;
revoke all on function public.company_line_enabled() from public, anon;
grant execute on function public.company_line_enabled() to authenticated, service_role;
grant execute on function public.can_see_management() to authenticated, service_role;
grant execute on function public.is_management_alert(text) to authenticated, service_role;
grant execute on function public.record_statement_deliveries(date, uuid[], text) to authenticated;
grant execute on function public.record_invoice_send(uuid, text, text, text, text, text) to authenticated;
revoke execute on function public.record_statement_deliveries(date, uuid[], text) from anon, public;
revoke execute on function public.record_invoice_send(uuid, text, text, text, text, text) from anon, public;

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;
revoke all on public.integration_secrets from authenticated, anon, public;
grant all on public.integration_secrets to service_role;
