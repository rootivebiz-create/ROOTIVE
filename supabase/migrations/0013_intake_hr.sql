-- =============================================================================
-- 0013 取り込みと採用・契約
--   - 元請の実績ファイルの取り込み定義（列の対応・名前の対応を覚える）
--   - レシートの画像と AI が読み取った内容（経費に添付）
--   - 採用のパイプライン（応募 → 面談 → 書類 → 契約 → 稼働開始）
--   - 業務委託契約の期間・更新・書類
-- =============================================================================

-- ---------- 列挙型 ----------
do $$ begin
  create type public.applicant_stage as enum ('applied','contacted','interview','docs','contract','started','declined','rejected');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.contract_status as enum ('draft','active','ended');
exception when duplicate_object then null; end $$;

-- =============================================================================
-- 元請の実績ファイルの取り込み定義
--   一度マッピングを決めたら次回から同じ形で取り込める
-- =============================================================================
create table if not exists public.import_profiles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null check (length(name) between 1 and 80),
  client_id uuid references public.clients(id) on delete set null,
  project_id uuid references public.projects(id) on delete set null,
  -- 列の対応（例 {"date":"配送日","driver":"ドライバー名","item":"区分","qty":"個数"}）
  mapping jsonb not null default '{}'::jsonb,
  -- 元請側の名前 → ドライバー／案件内容の対応（例 {"アイソ ケイ":"<driver uuid>"}）
  driver_match jsonb not null default '{}'::jsonb,
  item_match jsonb not null default '{}'::jsonb,
  header_row integer not null default 1 check (header_row between 0 and 50),
  encoding text not null default 'auto',
  memo text not null default '',
  is_active boolean not null default true,
  last_used_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, name)
);
create index if not exists import_profiles_company_idx on public.import_profiles (company_id, is_active, name);
comment on table public.import_profiles is '元請の実績ファイルの取り込み定義。列の対応と名前の対応を覚えて次回から自動で当てる';

create table if not exists public.import_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  profile_id uuid references public.import_profiles(id) on delete set null,
  file_name text not null default '',
  month date,
  row_count integer not null default 0,
  applied_count integer not null default 0,
  skipped_count integer not null default 0,
  unmatched jsonb not null default '[]'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists import_runs_company_idx on public.import_runs (company_id, created_at desc);
comment on table public.import_runs is '元請ファイルの取り込み 1 回分の記録';

-- ---------- レシート（経費への添付と AI の読み取り結果） ----------
alter table public.expenses add column if not exists receipt_path text not null default '';
alter table public.expenses add column if not exists ocr jsonb not null default '{}'::jsonb;
comment on column public.expenses.receipt_path is 'Storage（receipts バケット）のパス。<company_id>/… に置く';
comment on column public.expenses.ocr is 'レシートから AI が読み取った内容（金額・日付・支払先・信頼度）';

-- =============================================================================
-- 採用
-- =============================================================================
create table if not exists public.applicants (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null check (length(name) between 1 and 100),
  kana text not null default '',
  phone text not null default '',
  email text not null default '',
  source text not null default '',
  stage public.applicant_stage not null default 'applied',
  applied_on date not null default current_date,
  interview_on date,
  started_on date,
  driver_id uuid references public.drivers(id) on delete set null,
  has_license boolean,
  has_vehicle boolean,
  checklist jsonb not null default '{}'::jsonb,
  memo text not null default '',
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists applicants_company_idx on public.applicants (company_id, stage, applied_on desc);
comment on table public.applicants is '採用のパイプライン（応募 → 連絡 → 面談 → 書類 → 契約 → 稼働開始）';

create table if not exists public.applicant_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  applicant_id uuid not null references public.applicants(id) on delete cascade,
  happened_on date not null default current_date,
  stage public.applicant_stage,
  note text not null default '',
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists applicant_events_idx on public.applicant_events (applicant_id, happened_on desc);
comment on table public.applicant_events is '応募者ごとのやりとりの記録';

-- =============================================================================
-- 業務委託契約
-- =============================================================================
create table if not exists public.contracts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  driver_id uuid not null references public.drivers(id) on delete cascade,
  title text not null default '業務委託契約書',
  status public.contract_status not null default 'active',
  start_on date not null,
  end_on date,
  auto_renew boolean not null default true,
  notice_days integer not null default 30 check (notice_days between 0 and 365),
  file_path text not null default '',
  agreed_at timestamptz,
  memo text not null default '',
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists contracts_company_idx on public.contracts (company_id, status, end_on);
create index if not exists contracts_driver_idx on public.contracts (driver_id, start_on desc);
comment on table public.contracts is '業務委託契約。end_on が近づくとアラートに出す（auto_renew なら自動更新の確認）';

-- =============================================================================
-- トリガー
-- =============================================================================
do $$
declare t text;
begin
  foreach t in array array['import_profiles','applicants','contracts']
  loop
    execute format('drop trigger if exists t00_set_updated_at on public.%I', t);
    execute format('create trigger t00_set_updated_at before update on public.%I for each row execute function public.set_updated_at()', t);
  end loop;
  foreach t in array array['import_profiles','import_runs','applicants','contracts']
  loop
    execute format('drop trigger if exists t90_audit on public.%I', t);
    execute format('create trigger t90_audit after insert or update or delete on public.%I for each row execute function public.audit_row_change()', t);
  end loop;
end $$;

-- 応募者の会社と、紐づけたドライバーの会社を一致させる
create or replace function public.t_check_applicant_driver()
returns trigger language plpgsql as $$
declare c uuid;
begin
  if new.driver_id is not null then
    select company_id into c from public.drivers where id = new.driver_id;
    if c is null or c <> new.company_id then
      raise exception 'ドライバーの会社が一致しません' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists t02_check_driver on public.applicants;
create trigger t02_check_driver before insert or update on public.applicants
  for each row execute function public.t_check_applicant_driver();

-- 応募者の段階が変わったら履歴を残す
create or replace function public.t_applicant_stage_log()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.stage is distinct from old.stage then
    insert into public.applicant_events (company_id, applicant_id, happened_on, stage, note, created_by)
    values (new.company_id, new.id, current_date, new.stage, '', auth.uid());
  end if;
  return new;
end $$;
drop trigger if exists t50_stage_log on public.applicants;
create trigger t50_stage_log after update on public.applicants
  for each row execute function public.t_applicant_stage_log();

-- =============================================================================
-- ビュー
-- =============================================================================
drop view if exists public.v_applicant_list, public.v_contract_list, public.v_import_profile_list cascade;

create view public.v_applicant_list
with (security_invoker = true) as
select
  a.*,
  coalesce(d.name, '') as driver_name,
  (select count(*) from public.applicant_events e where e.applicant_id = a.id)::integer as event_count,
  (select max(e.happened_on) from public.applicant_events e where e.applicant_id = a.id) as last_event_on,
  (current_date - a.applied_on) as days_since_applied
from public.applicants a
left join public.drivers d on d.id = a.driver_id;

create view public.v_contract_list
with (security_invoker = true) as
select
  c.*,
  coalesce(d.name, '') as driver_name,
  d.is_active as driver_is_active,
  case when c.end_on is null then null else (c.end_on - current_date) end as days_left,
  case
    when c.status = 'ended' then 'ended'
    when c.end_on is null then 'open'
    when c.end_on < current_date then 'expired'
    when c.end_on <= current_date + c.notice_days then 'renewal'
    else 'active'
  end as period_status
from public.contracts c
join public.drivers d on d.id = c.driver_id;

create view public.v_import_profile_list
with (security_invoker = true) as
select
  p.*,
  coalesce(cl.name, '') as client_name,
  coalesce(pj.name, '') as project_name,
  (select count(*) from public.import_runs r where r.profile_id = p.id)::integer as run_count
from public.import_profiles p
left join public.clients cl on cl.id = p.client_id
left join public.projects pj on pj.id = p.project_id;

-- =============================================================================
-- RLS
-- =============================================================================
do $$
declare t text;
begin
  foreach t in array array['import_profiles','import_runs','applicants','applicant_events','contracts']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I_select on public.%I', t, t);
    execute format($p$create policy %I_select on public.%I for select to authenticated
      using (company_id = public.current_company_id() and public.is_staff())$p$, t, t);
    execute format('drop policy if exists %I_write on public.%I', t, t);
    execute format($p$create policy %I_write on public.%I for all to authenticated
      using (company_id = public.current_company_id() and public.is_admin())
      with check (company_id = public.current_company_id() and public.is_admin())$p$, t, t);
  end loop;
end $$;

-- ドライバー本人は自分の契約を読める
drop policy if exists contracts_driver_select on public.contracts;
create policy contracts_driver_select on public.contracts for select to authenticated
  using (company_id = public.current_company_id() and driver_id = public.current_driver_id());

-- =============================================================================
-- Storage：レシート（非公開。会社ごとのフォルダ）
-- =============================================================================
insert into storage.buckets (id, name, public)
values ('receipts', 'receipts', false)
on conflict (id) do nothing;

drop policy if exists receipts_select on storage.objects;
create policy receipts_select on storage.objects for select to authenticated
  using (bucket_id = 'receipts' and (storage.foldername(name))[1] = public.current_company_id()::text and public.is_staff());
drop policy if exists receipts_insert on storage.objects;
create policy receipts_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'receipts' and (storage.foldername(name))[1] = public.current_company_id()::text and public.is_admin());
drop policy if exists receipts_delete on storage.objects;
create policy receipts_delete on storage.objects for delete to authenticated
  using (bucket_id = 'receipts' and (storage.foldername(name))[1] = public.current_company_id()::text and public.is_admin());

-- =============================================================================
-- データ全削除に 0013 のテーブルを追加（reset_company_data を置き換える）
-- =============================================================================
create or replace function public.reset_company_data(p_company_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  cid uuid := public.current_company_id();
  actual text;
  counts jsonb := '{}'::jsonb;
  n integer;
begin
  if not public.is_owner() then
    raise exception 'データ全削除はオーナーのみ可能です' using errcode = 'P0001', hint = 'OWNER_ONLY';
  end if;
  select name into actual from public.companies where id = cid;
  if actual is null or actual <> p_company_name then
    raise exception '会社名が一致しません' using errcode = 'P0001', hint = 'NAME_MISMATCH';
  end if;
  perform set_config('app.bypass_closing', 'on', true);
  perform set_config('app.skip_audit', 'on', true);
  delete from public.bank_transactions where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('bank_transactions', n);
  delete from public.bank_imports where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('bank_imports', n);
  delete from public.alerts where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('alerts', n);
  delete from public.invoice_items where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('invoice_items', n);
  delete from public.invoices where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('invoices', n);
  delete from public.expenses where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('expenses', n);
  delete from public.recurring_expenses where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('recurring_expenses', n);
  delete from public.month_targets where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('month_targets', n);
  delete from public.cash_snapshots where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('cash_snapshots', n);
  delete from public.import_runs where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('import_runs', n);
  delete from public.import_profiles where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('import_profiles', n);
  delete from public.applicant_events where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('applicant_events', n);
  delete from public.applicants where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('applicants', n);
  delete from public.contracts where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('contracts', n);
  delete from public.work_day_entries where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('work_day_entries', n);
  delete from public.daily_reports where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('daily_reports', n);
  delete from public.incidents where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('incidents', n);
  delete from public.driver_instructions where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('driver_instructions', n);
  delete from public.documents where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('documents', n);
  delete from public.safety_managers where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('safety_managers', n);
  delete from public.adjustments where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('adjustments', n);
  delete from public.work_entries where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('work_entries', n);
  delete from public.driver_months where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('driver_months', n);
  delete from public.month_closings where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('month_closings', n);
  delete from public.ai_messages where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('ai_messages', n);
  delete from public.ai_conversations where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('ai_conversations', n);
  delete from public.ai_insights where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('ai_insights', n);
  delete from public.driver_pay_overrides where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('driver_pay_overrides', n);
  delete from public.driver_recurring_adjustments where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('driver_recurring_adjustments', n);
  delete from public.line_link_codes where company_id = cid;
  -- ドライバー本人のユーザーは、対応ドライバーが消えるため「無効な閲覧者」に変更する（再招待で復帰できる）
  perform set_config('app.bypass_profile_guard', 'on', true);
  update public.profiles set role = 'viewer', driver_id = null, is_active = false where company_id = cid and role = 'driver';
  update public.profiles set driver_id = null where company_id = cid and driver_id is not null;
  perform set_config('app.bypass_profile_guard', 'off', true);
  delete from public.invitations where company_id = cid and role = 'driver';
  update public.invitations set driver_id = null where company_id = cid and driver_id is not null;
  delete from public.project_items where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('project_items', n);
  delete from public.projects where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('projects', n);
  delete from public.vehicles where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('vehicles', n);
  delete from public.drivers where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('drivers', n);
  delete from public.clients where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('clients', n);
  -- 経費カテゴリ・チャットのルーム・外部連携の設定は残す
  perform set_config('app.skip_audit', 'off', true);
  perform set_config('app.bypass_closing', 'off', true);
  perform set_config('app.audit_internal', 'on', true);
  perform public.write_audit(cid, 'reset_company_data', 'company', cid::text, counts, null);
  perform set_config('app.audit_internal', 'off', true);
  return counts;
end $$;

-- =============================================================================
-- 権限（0006 と同じ方針を 0013 で追加したテーブル・ビューにも適用する）
-- =============================================================================
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;
grant execute on all functions in schema public to authenticated, service_role;

revoke all on public.integration_secrets from authenticated, anon, public;
grant all on public.integration_secrets to service_role;

revoke execute on function public.apply_invitation(uuid, text, text) from authenticated, anon, public;
revoke execute on function public.write_audit(uuid, text, text, text, jsonb, jsonb) from authenticated, anon, public;
revoke execute on function public.ensure_driver_month(uuid, date, uuid) from authenticated, anon, public;
revoke execute on function public.import_has_id_conflict(uuid, jsonb) from authenticated, anon, public;
revoke execute on function public.handle_new_auth_user() from authenticated, anon, public;
revoke execute on function public.default_expense_categories(uuid) from authenticated, anon, public;
revoke execute on function public.default_chat_channels(uuid) from authenticated, anon, public;
revoke execute on function public.recalc_invoice(uuid) from anon, public;
revoke execute on function public.line_consume_code(text, text, uuid) from authenticated, anon, public;
revoke execute on function public.sync_work_entry_from_days(uuid, date, uuid, uuid) from authenticated, anon, public;
