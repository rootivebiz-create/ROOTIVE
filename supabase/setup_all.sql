-- =============================================================================
-- ROOTIVE 利益管理システム  全マイグレーション結合ファイル（自動生成：npm run build:sql）
-- Supabase の SQL Editor に貼り付けて実行してください（何度実行しても安全です）
-- 生成元: 0001_schema.sql, 0002_auth_rls.sql, 0003_views.sql, 0004_rpc.sql, 0005_portal_seed.sql, 0006_storage_grants.sql, 0007_driver_rates.sql, 0008_tax_assets_payout.sql, 0009_expenses_invoices.sql, 0010_cashflow_project_pl.sql, 0011_ai_chat_integrations.sql
-- =============================================================================


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 0001_schema.sql >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- =============================================================================
-- 0001 スキーマ：拡張・型・テーブル・制約・インデックス・基本トリガー
-- ROOTIVE 利益管理システム
-- =============================================================================

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- ---------- 型 ----------
do $$ begin
  if not exists (select 1 from pg_type where typname = 'rounding_mode') then
    create type public.rounding_mode as enum ('none', 'floor', 'round', 'ceil');
  end if;
  if not exists (select 1 from pg_type where typname = 'user_role') then
    create type public.user_role as enum ('owner', 'admin', 'viewer', 'driver');
  end if;
  if not exists (select 1 from pg_type where typname = 'item_unit') then
    create type public.item_unit as enum ('day', 'piece');
  end if;
  if not exists (select 1 from pg_type where typname = 'month_status') then
    create type public.month_status as enum ('open', 'closed');
  end if;
end $$;

-- ---------- 会社 ----------
create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 100),
  rounding_mode public.rounding_mode not null default 'none',
  default_royalty_rate numeric(6,4) not null default 0.1 check (default_royalty_rate >= 0 and default_royalty_rate <= 1),
  default_mgmt_fee numeric(12,2) not null default 15000 check (default_mgmt_fee >= 0),
  payout_month_offset integer not null default 1 check (payout_month_offset between 0 and 3),
  payout_day integer not null default 0 check (payout_day between 0 and 31),
  statement_note text not null default '',
  invoice_reg_no text not null default '',
  address text not null default '',
  tel text not null default '',
  driver_portal_show_royalty boolean not null default true,
  yayoi_accounts jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- ドライバー ----------
create table if not exists public.drivers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null check (length(name) between 1 and 100),
  kana text not null default '',
  is_active boolean not null default true,
  royalty_rate numeric(6,4) check (royalty_rate is null or (royalty_rate >= 0 and royalty_rate <= 1)),
  mgmt_fee numeric(12,2) not null default 0 check (mgmt_fee >= 0),
  rounding_mode public.rounding_mode, -- null = 会社設定に従う
  phone text not null default '',
  email text not null default '',
  bank_info text not null default '',
  memo text not null default '',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, name)
);
create index if not exists drivers_company_idx on public.drivers (company_id, sort_order, name);

-- ---------- プロフィール（auth.users と 1:1） ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  email text not null,
  display_name text not null default '',
  role public.user_role not null default 'viewer',
  driver_id uuid references public.drivers(id) on delete restrict,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (role <> 'driver' or driver_id is not null)
);
-- ドライバー本人のユーザーが紐づくドライバーは削除不可（停止中にする）
alter table public.profiles drop constraint if exists profiles_driver_id_fkey;
alter table public.profiles add constraint profiles_driver_id_fkey foreign key (driver_id) references public.drivers(id) on delete restrict;
create index if not exists profiles_company_idx on public.profiles (company_id);
create index if not exists profiles_email_idx on public.profiles (lower(email));

-- ---------- 招待 ----------
create table if not exists public.invitations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  email text not null check (position('@' in email) > 1),
  role public.user_role not null default 'viewer',
  driver_id uuid references public.drivers(id) on delete cascade,
  display_name text not null default '',
  token text not null unique default encode(extensions.gen_random_bytes(24), 'hex'),
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,
  cancelled_at timestamptz,
  link_used_at timestamptz, -- 招待リンクでのログインに使用済み（1 回限り）
  invited_by uuid,
  created_at timestamptz not null default now(),
  check (role <> 'driver' or driver_id is not null)
);
alter table public.invitations add column if not exists link_used_at timestamptz;
-- ドライバー削除時は、そのドライバー宛の招待も削除する
alter table public.invitations drop constraint if exists invitations_driver_id_fkey;
alter table public.invitations add constraint invitations_driver_id_fkey foreign key (driver_id) references public.drivers(id) on delete cascade;
create index if not exists invitations_company_idx on public.invitations (company_id, created_at desc);
create index if not exists invitations_email_idx on public.invitations (lower(email));

-- ---------- 案件・内容 ----------
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null check (length(name) between 1 and 100),
  client_name text not null default '',
  is_active boolean not null default true,
  memo text not null default '',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, name)
);
create index if not exists projects_company_idx on public.projects (company_id, sort_order, name);

create table if not exists public.project_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete restrict,
  name text not null default '標準' check (length(name) between 1 and 100),
  unit public.item_unit not null default 'day',
  bill_rate numeric(12,2) not null default 0 check (bill_rate >= 0),
  pay_rate numeric(12,2) not null default 0 check (pay_rate >= 0),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, name)
);
create index if not exists project_items_project_idx on public.project_items (project_id, sort_order);
create index if not exists project_items_company_idx on public.project_items (company_id);

-- ---------- ドライバー個別支払単価 ----------
create table if not exists public.driver_pay_overrides (
  company_id uuid not null references public.companies(id) on delete cascade,
  driver_id uuid not null references public.drivers(id) on delete cascade,
  project_item_id uuid not null references public.project_items(id) on delete cascade,
  pay_rate numeric(12,2) not null check (pay_rate >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (driver_id, project_item_id)
);
create index if not exists driver_pay_overrides_company_idx on public.driver_pay_overrides (company_id);

-- ---------- 固定控除（毎月自動計上） ----------
create table if not exists public.driver_recurring_adjustments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  driver_id uuid not null references public.drivers(id) on delete cascade,
  label text not null check (length(label) between 1 and 100),
  amount numeric(12,2) not null,
  count_as_profit boolean not null default true,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists driver_recurring_adjustments_driver_idx on public.driver_recurring_adjustments (driver_id, sort_order);

-- ---------- 稼働行（入力時点のスナップショットを保持） ----------
create table if not exists public.work_entries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  month date not null check (extract(day from month) = 1),
  driver_id uuid not null references public.drivers(id) on delete restrict,
  project_item_id uuid not null references public.project_items(id) on delete restrict,
  qty numeric(12,2) not null default 0 check (qty >= 0),
  bill_rate numeric(12,2) not null check (bill_rate >= 0),
  pay_rate numeric(12,2) not null check (pay_rate >= 0),
  royalty_rate numeric(6,4) not null check (royalty_rate >= 0 and royalty_rate <= 1),
  rounding_mode public.rounding_mode not null default 'none',
  memo text not null default '',
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists work_entries_company_month_idx on public.work_entries (company_id, month);
create index if not exists work_entries_driver_month_idx on public.work_entries (driver_id, month);
create index if not exists work_entries_item_month_idx on public.work_entries (project_item_id, month);

-- ---------- ドライバー × 月 ----------
create table if not exists public.driver_months (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  month date not null check (extract(day from month) = 1),
  driver_id uuid not null references public.drivers(id) on delete restrict,
  mgmt_fee numeric(12,2) not null default 0 check (mgmt_fee >= 0),
  memo text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, month, driver_id)
);
create index if not exists driver_months_driver_idx on public.driver_months (driver_id, month);

-- ---------- 調整（控除・加算） ----------
create table if not exists public.adjustments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  driver_month_id uuid not null references public.driver_months(id) on delete cascade,
  label text not null check (length(label) between 1 and 100),
  amount numeric(12,2) not null,
  count_as_profit boolean not null default true,
  recurring_id uuid references public.driver_recurring_adjustments(id) on delete set null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists adjustments_driver_month_idx on public.adjustments (driver_month_id, sort_order);
create index if not exists adjustments_company_idx on public.adjustments (company_id);

-- ---------- 月締め ----------
create table if not exists public.month_closings (
  company_id uuid not null references public.companies(id) on delete cascade,
  month date not null check (extract(day from month) = 1),
  status public.month_status not null default 'open',
  closed_at timestamptz,
  closed_by uuid,
  reopened_at timestamptz,
  reopened_by uuid,
  snapshot jsonb,
  backup_path text,
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (company_id, month)
);

-- ---------- 監査ログ ----------
create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  actor_id uuid,
  action text not null,
  table_name text not null,
  record_id text,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_logs_company_created_idx on public.audit_logs (company_id, created_at desc);
create index if not exists audit_logs_company_table_idx on public.audit_logs (company_id, table_name, created_at desc);

-- ---------- AI 月次分析 ----------
create table if not exists public.ai_insights (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  month date not null check (extract(day from month) = 1),
  model text not null default '',
  findings jsonb not null default '[]'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists ai_insights_company_month_idx on public.ai_insights (company_id, month, created_at desc);

-- =============================================================================
-- 基本トリガー：updated_at 自動更新、company_id の自動補完と整合チェック
-- =============================================================================
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['companies','drivers','profiles','projects','project_items','driver_pay_overrides',
    'driver_recurring_adjustments','work_entries','driver_months','adjustments','month_closings']
  loop
    execute format('drop trigger if exists t00_set_updated_at on public.%I', t);
    execute format('create trigger t00_set_updated_at before update on public.%I for each row execute function public.set_updated_at()', t);
  end loop;
end $$;

-- 子テーブルの company_id を親から補完し、親と一致することを確認する
create or replace function public.fill_company_id()
returns trigger language plpgsql as $$
declare
  parent_company uuid;
  other_company uuid;
begin
  if tg_table_name = 'project_items' then
    select company_id into parent_company from public.projects where id = new.project_id;
  elsif tg_table_name in ('driver_pay_overrides', 'driver_recurring_adjustments', 'driver_months', 'work_entries') then
    select company_id into parent_company from public.drivers where id = new.driver_id;
  elsif tg_table_name = 'adjustments' then
    select company_id into parent_company from public.driver_months where id = new.driver_month_id;
  end if;

  if parent_company is null then
    raise exception '親レコードが見つかりません（%）', tg_table_name using errcode = 'foreign_key_violation';
  end if;
  if new.company_id is null then
    new.company_id := parent_company;
  elsif new.company_id <> parent_company then
    raise exception '会社が一致しません（%）', tg_table_name using errcode = 'check_violation';
  end if;

  -- 稼働行・個別単価は案件内容の会社とも一致させる
  if tg_table_name in ('work_entries', 'driver_pay_overrides') then
    select company_id into other_company from public.project_items where id = new.project_item_id;
    if other_company is null or other_company <> new.company_id then
      raise exception '案件内容の会社が一致しません' using errcode = 'check_violation';
    end if;
  end if;
  if tg_table_name = 'adjustments' then
    if new.recurring_id is not null then
      select company_id into other_company from public.driver_recurring_adjustments where id = new.recurring_id;
      if other_company is not null and other_company <> new.company_id then
        raise exception '固定控除の会社が一致しません' using errcode = 'check_violation';
      end if;
    end if;
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['project_items','driver_pay_overrides','driver_recurring_adjustments','work_entries','driver_months','adjustments']
  loop
    execute format('drop trigger if exists t01_fill_company_id on public.%I', t);
    execute format('create trigger t01_fill_company_id before insert or update on public.%I for each row execute function public.fill_company_id()', t);
  end loop;
end $$;

-- profiles.driver_id / invitations.driver_id は同じ会社のドライバーであること
create or replace function public.check_profile_driver_company()
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
drop trigger if exists t02_check_driver_company on public.profiles;
create trigger t02_check_driver_company before insert or update on public.profiles for each row execute function public.check_profile_driver_company();
drop trigger if exists t02_check_driver_company on public.invitations;
create trigger t02_check_driver_company before insert or update on public.invitations for each row execute function public.check_profile_driver_company();

-- 稼働行の作成者・更新者
create or replace function public.set_entry_actor()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, auth.uid());
  end if;
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end $$;
drop trigger if exists t03_set_entry_actor on public.work_entries;
create trigger t03_set_entry_actor before insert or update on public.work_entries for each row execute function public.set_entry_actor();

-- <<<<<<<<<<<<<<<<<<<<<<<<<<<<<< 0001_schema.sql <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<

-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 0002_auth_rls.sql >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- =============================================================================
-- 0002 認証ヘルパー・招待制・プロフィール保護・RLS
-- =============================================================================

-- ---------- ヘルパー関数（security definer：profiles を RLS なしで参照） ----------
create or replace function public.current_company_id()
returns uuid language sql stable security definer set search_path = public as $$
  select company_id from public.profiles where id = auth.uid() and is_active limit 1;
$$;

create or replace function public.current_app_role()
returns public.user_role language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and is_active limit 1;
$$;

create or replace function public.current_driver_id()
returns uuid language sql stable security definer set search_path = public as $$
  select driver_id from public.profiles where id = auth.uid() and is_active and role = 'driver' limit 1;
$$;

create or replace function public.is_service_role()
returns boolean language sql stable as $$
  select coalesce(auth.role() = 'service_role', false);
$$;

create or replace function public.is_owner()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'owner' from public.profiles where id = auth.uid() and is_active limit 1), false);
$$;

-- owner または admin
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role in ('owner','admin') from public.profiles where id = auth.uid() and is_active limit 1), false);
$$;

-- owner / admin / viewer（閲覧可能なスタッフ）
create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role in ('owner','admin','viewer') from public.profiles where id = auth.uid() and is_active limit 1), false);
$$;

create or replace function public.is_driver_user()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'driver' and driver_id is not null from public.profiles where id = auth.uid() and is_active limit 1), false);
$$;

-- 月が締め済みか
create or replace function public.is_month_closed(p_company_id uuid, p_month date)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.month_closings
    where company_id = p_company_id and month = p_month and status = 'closed'
  );
$$;

-- 監査ログ書き込み（トリガー・RPC からのみ使用）
create or replace function public.write_audit(
  p_company_id uuid, p_action text, p_table text, p_record_id text, p_before jsonb, p_after jsonb
) returns void language plpgsql security definer set search_path = public as $$
begin
  -- 内部関数：トリガーと RPC（security definer）からのみ使う。一般ユーザーの直接呼び出しは拒否
  if coalesce(current_setting('app.audit_internal', true), 'off') <> 'on' and auth.role() is not null and not public.is_service_role() then
    raise exception '権限がありません' using errcode = 'P0001', hint = 'FORBIDDEN';
  end if;
  insert into public.audit_logs (company_id, actor_id, action, table_name, record_id, before, after)
  values (p_company_id, auth.uid(), p_action, p_table, p_record_id, p_before, p_after);
end $$;

-- ---------- 招待の適用（新規ユーザー作成トリガー・既存ユーザーへの再招待の両方で使用） ----------
drop function if exists public.apply_invitation(uuid, text);
create or replace function public.apply_invitation(p_user_id uuid, p_email text, p_token text default null)
returns public.profiles language plpgsql security definer set search_path = public as $$
declare
  inv public.invitations%rowtype;
  prof public.profiles;
begin
  -- 内部関数：auth.users のトリガー（JWT なし）またはサービスロールからのみ呼べる。一般ユーザーの RPC 呼び出しは拒否
  if auth.role() is not null and not public.is_service_role() then
    raise exception '権限がありません' using errcode = 'P0001', hint = 'FORBIDDEN';
  end if;
  if p_token is not null then
    -- 招待リンク経由：トークンで特定した招待だけを適用する（メール一致も必須）
    select * into inv from public.invitations
     where token = p_token and lower(email) = lower(p_email)
       and cancelled_at is null and expires_at > now();
  else
    select * into inv from public.invitations
     where lower(email) = lower(p_email)
       and accepted_at is null and cancelled_at is null and expires_at > now()
     order by created_at desc limit 1;
  end if;
  if not found then
    return null;
  end if;

  perform set_config('app.bypass_profile_guard', 'on', true);
  insert into public.profiles (id, company_id, email, display_name, role, driver_id, is_active)
  values (p_user_id, inv.company_id, lower(p_email), coalesce(nullif(inv.display_name, ''), split_part(p_email, '@', 1)), inv.role, inv.driver_id, true)
  on conflict (id) do update
    set company_id = excluded.company_id,
        email = excluded.email,
        role = excluded.role,
        driver_id = excluded.driver_id,
        is_active = true,
        display_name = case when public.profiles.display_name = '' then excluded.display_name else public.profiles.display_name end
  returning * into prof;

  update public.invitations set accepted_at = coalesce(accepted_at, now()) where id = inv.id;
  perform set_config('app.bypass_profile_guard', 'off', true);
  return prof;
end $$;

-- auth.users への INSERT で招待を照合。招待が無ければ登録自体を拒否する
create or replace function public.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare prof public.profiles;
begin
  prof := public.apply_invitation(new.id, new.email);
  if prof.id is null then
    raise exception '招待が必要です（%）', new.email using errcode = 'P0001', hint = 'INVITATION_REQUIRED';
  end if;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_auth_user();

-- ---------- プロフィール保護 ----------
-- role / company_id / is_active / driver_id / email は owner のみ変更可。自分自身のロール変更・無効化は不可
create or replace function public.protect_profile_columns()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- API 経由でないセッション（SQL Editor・psql・サービスロール）は制限しない。JWT のある通常ユーザーのみ保護する
  if coalesce(current_setting('app.bypass_profile_guard', true), 'off') = 'on' or public.is_service_role() or auth.role() is null then
    return new;
  end if;
  if new.id <> old.id then
    raise exception 'ID は変更できません' using errcode = 'P0001';
  end if;
  if (new.role is distinct from old.role) or (new.company_id is distinct from old.company_id)
     or (new.is_active is distinct from old.is_active) or (new.driver_id is distinct from old.driver_id)
     or (new.email is distinct from old.email) then
    if not public.is_owner() then
      raise exception 'ロール・所属・状態の変更はオーナーのみ可能です' using errcode = 'P0001', hint = 'OWNER_ONLY';
    end if;
    if old.id = auth.uid() and ((new.role is distinct from old.role) or (new.is_active is distinct from old.is_active)) then
      raise exception '自分自身のロール変更・無効化はできません' using errcode = 'P0001', hint = 'SELF_CHANGE';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists t10_protect_profile on public.profiles;
create trigger t10_protect_profile before update on public.profiles for each row execute function public.protect_profile_columns();

-- ---------- 月締め保護：closed → open と削除は owner のみ ----------
create or replace function public.protect_month_closings()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.is_service_role() or auth.role() is null then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' then
    if not public.is_owner() then
      raise exception '締め記録の削除はオーナーのみ可能です' using errcode = 'P0001', hint = 'OWNER_ONLY';
    end if;
    return old;
  end if;
  if old.status = 'closed' and new.status = 'open' and not public.is_owner() then
    raise exception '締めの解除はオーナーのみ可能です' using errcode = 'P0001', hint = 'OWNER_ONLY';
  end if;
  return new;
end $$;
drop trigger if exists t10_protect_month_closings on public.month_closings;
create trigger t10_protect_month_closings before update or delete on public.month_closings for each row execute function public.protect_month_closings();

-- ---------- 締め済み月への書き込み拒否 ----------
create or replace function public.guard_month_closed()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  c uuid; m date; c2 uuid; m2 date;
begin
  if coalesce(current_setting('app.bypass_closing', true), 'off') = 'on' then
    return coalesce(new, old);
  end if;
  if tg_table_name = 'adjustments' then
    if tg_op in ('INSERT', 'UPDATE') then
      select company_id, month into c, m from public.driver_months where id = new.driver_month_id;
    end if;
    if tg_op in ('UPDATE', 'DELETE') then
      select company_id, month into c2, m2 from public.driver_months where id = old.driver_month_id;
    end if;
  else
    if tg_op in ('INSERT', 'UPDATE') then
      c := new.company_id; m := new.month;
    end if;
    if tg_op in ('UPDATE', 'DELETE') then
      c2 := old.company_id; m2 := old.month;
    end if;
  end if;
  if m is not null and public.is_month_closed(c, m) then
    raise exception '締め済みの月（%）は変更できません', to_char(m, 'YYYY-MM') using errcode = 'P0001', hint = 'MONTH_CLOSED';
  end if;
  if m2 is not null and (m2 is distinct from m or c2 is distinct from c) and public.is_month_closed(c2, m2) then
    raise exception '締め済みの月（%）は変更できません', to_char(m2, 'YYYY-MM') using errcode = 'P0001', hint = 'MONTH_CLOSED';
  end if;
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['work_entries','driver_months','adjustments']
  loop
    execute format('drop trigger if exists t05_guard_month_closed on public.%I', t);
    execute format('create trigger t05_guard_month_closed before insert or update or delete on public.%I for each row execute function public.guard_month_closed()', t);
  end loop;
end $$;

-- ---------- 稼働行 INSERT 時に driver_months を自動作成し、有効な固定控除を複写 ----------
create or replace function public.ensure_driver_month(p_company_id uuid, p_month date, p_driver_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  dm_id uuid;
  fee numeric(12,2);
begin
  -- 内部関数（トリガーから呼ぶ）。一般ユーザーが直接呼ぶ場合は自社かつ admin 以上に限定
  if auth.role() is not null and not public.is_service_role() then
    if p_company_id is distinct from public.current_company_id() or not public.is_admin() then
      raise exception '権限がありません' using errcode = 'P0001', hint = 'FORBIDDEN';
    end if;
  end if;
  select id into dm_id from public.driver_months where company_id = p_company_id and month = p_month and driver_id = p_driver_id;
  if dm_id is not null then
    return dm_id;
  end if;
  select mgmt_fee into fee from public.drivers where id = p_driver_id;
  insert into public.driver_months (company_id, month, driver_id, mgmt_fee)
  values (p_company_id, p_month, p_driver_id, coalesce(fee, 0))
  returning id into dm_id;
  insert into public.adjustments (company_id, driver_month_id, label, amount, count_as_profit, recurring_id, sort_order)
  select p_company_id, dm_id, r.label, r.amount, r.count_as_profit, r.id, r.sort_order
    from public.driver_recurring_adjustments r
   where r.driver_id = p_driver_id and r.is_active;
  return dm_id;
end $$;

create or replace function public.work_entry_ensure_driver_month()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.ensure_driver_month(new.company_id, new.month, new.driver_id);
  return new;
end $$;
drop trigger if exists t20_ensure_driver_month on public.work_entries;
create trigger t20_ensure_driver_month before insert or update of month, driver_id on public.work_entries
  for each row execute function public.work_entry_ensure_driver_month();

-- ---------- 監査ログ（主要テーブルの INSERT/UPDATE/DELETE。差分の無い UPDATE は除く） ----------
create or replace function public.audit_row_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  b jsonb; a jsonb; rid text; cid uuid;
begin
  if coalesce(current_setting('app.skip_audit', true), 'off') = 'on' then
    return coalesce(new, old);
  end if;
  if tg_op in ('UPDATE', 'DELETE') then b := to_jsonb(old); end if;
  if tg_op in ('INSERT', 'UPDATE') then a := to_jsonb(new); end if;
  -- 秘匿列を除外
  if tg_table_name = 'invitations' then
    b := b - 'token'; a := a - 'token';
  end if;
  if tg_table_name = 'month_closings' then
    b := b - 'snapshot'; a := a - 'snapshot';
  end if;
  if tg_op = 'UPDATE' and (b - 'updated_at') = (a - 'updated_at') then
    return new;
  end if;
  if tg_table_name = 'companies' then
    cid := coalesce((a->>'id')::uuid, (b->>'id')::uuid);
  else
    cid := coalesce((a->>'company_id')::uuid, (b->>'company_id')::uuid);
  end if;
  rid := case tg_table_name
    when 'driver_pay_overrides' then coalesce(a->>'driver_id', b->>'driver_id') || ':' || coalesce(a->>'project_item_id', b->>'project_item_id')
    when 'month_closings' then coalesce(a->>'month', b->>'month')
    else coalesce(a->>'id', b->>'id')
  end;
  perform set_config('app.audit_internal', 'on', true);
  perform public.write_audit(cid, tg_op, tg_table_name, rid, b, a);
  perform set_config('app.audit_internal', 'off', true);
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['companies','profiles','invitations','drivers','projects','project_items','driver_pay_overrides',
    'driver_recurring_adjustments','work_entries','driver_months','adjustments','month_closings']
  loop
    execute format('drop trigger if exists t90_audit on public.%I', t);
    execute format('create trigger t90_audit after insert or update or delete on public.%I for each row execute function public.audit_row_change()', t);
  end loop;
end $$;

-- =============================================================================
-- RLS
-- =============================================================================
alter table public.companies enable row level security;
alter table public.profiles enable row level security;
alter table public.invitations enable row level security;
alter table public.drivers enable row level security;
alter table public.projects enable row level security;
alter table public.project_items enable row level security;
alter table public.driver_pay_overrides enable row level security;
alter table public.driver_recurring_adjustments enable row level security;
alter table public.work_entries enable row level security;
alter table public.driver_months enable row level security;
alter table public.adjustments enable row level security;
alter table public.month_closings enable row level security;
alter table public.audit_logs enable row level security;
alter table public.ai_insights enable row level security;

-- companies
drop policy if exists companies_select on public.companies;
create policy companies_select on public.companies for select to authenticated
  using (id = public.current_company_id());
drop policy if exists companies_update on public.companies;
create policy companies_update on public.companies for update to authenticated
  using (id = public.current_company_id() and public.is_owner())
  with check (id = public.current_company_id() and public.is_owner());

-- profiles
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using ((id = auth.uid() and is_active) or (company_id = public.current_company_id() and public.is_admin()));
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using ((id = auth.uid() and public.current_company_id() is not null) or (company_id = public.current_company_id() and public.is_owner()))
  with check ((id = auth.uid() and public.current_company_id() is not null) or (company_id = public.current_company_id() and public.is_owner()));

-- invitations（owner のみ）
drop policy if exists invitations_all on public.invitations;
create policy invitations_all on public.invitations for all to authenticated
  using (company_id = public.current_company_id() and public.is_owner())
  with check (company_id = public.current_company_id() and public.is_owner());

-- マスタ：閲覧はスタッフ、書き込みは admin+
do $$
declare t text;
begin
  foreach t in array array['drivers','projects','project_items','driver_pay_overrides','driver_recurring_adjustments']
  loop
    execute format('drop policy if exists %I_select on public.%I', t, t);
    execute format('create policy %I_select on public.%I for select to authenticated using (company_id = public.current_company_id() and public.is_staff())', t, t);
    execute format('drop policy if exists %I_write on public.%I', t, t);
    execute format('create policy %I_write on public.%I for all to authenticated using (company_id = public.current_company_id() and public.is_admin()) with check (company_id = public.current_company_id() and public.is_admin())', t, t);
  end loop;
end $$;

-- driver ロール：自分に関係する行のみ
drop policy if exists drivers_select_self on public.drivers;
create policy drivers_select_self on public.drivers for select to authenticated
  using (id = public.current_driver_id());
drop policy if exists project_items_select_driver on public.project_items;
create policy project_items_select_driver on public.project_items for select to authenticated
  using (public.is_driver_user() and exists (
    select 1 from public.work_entries we where we.project_item_id = project_items.id and we.driver_id = public.current_driver_id()
      and public.is_month_closed(we.company_id, we.month)));
drop policy if exists projects_select_driver on public.projects;
create policy projects_select_driver on public.projects for select to authenticated
  using (public.is_driver_user() and exists (
    select 1 from public.project_items pi join public.work_entries we on we.project_item_id = pi.id
     where pi.project_id = projects.id and we.driver_id = public.current_driver_id()
       and public.is_month_closed(we.company_id, we.month)));

-- 稼働・月・調整：閲覧はスタッフ、書き込みは admin+、driver は自分かつ締め済み月のみ SELECT
do $$
declare t text;
begin
  foreach t in array array['work_entries','driver_months']
  loop
    execute format('drop policy if exists %I_select on public.%I', t, t);
    execute format('create policy %I_select on public.%I for select to authenticated using (company_id = public.current_company_id() and public.is_staff())', t, t);
    execute format('drop policy if exists %I_write on public.%I', t, t);
    execute format('create policy %I_write on public.%I for all to authenticated using (company_id = public.current_company_id() and public.is_admin()) with check (company_id = public.current_company_id() and public.is_admin())', t, t);
    execute format('drop policy if exists %I_select_driver on public.%I', t, t);
    execute format('create policy %I_select_driver on public.%I for select to authenticated using (driver_id = public.current_driver_id() and public.is_month_closed(company_id, month))', t, t);
  end loop;
end $$;

drop policy if exists adjustments_select on public.adjustments;
create policy adjustments_select on public.adjustments for select to authenticated
  using (company_id = public.current_company_id() and public.is_staff());
drop policy if exists adjustments_write on public.adjustments;
create policy adjustments_write on public.adjustments for all to authenticated
  using (company_id = public.current_company_id() and public.is_admin())
  with check (company_id = public.current_company_id() and public.is_admin());
drop policy if exists adjustments_select_driver on public.adjustments;
create policy adjustments_select_driver on public.adjustments for select to authenticated
  using (exists (select 1 from public.driver_months dm where dm.id = adjustments.driver_month_id
                  and dm.driver_id = public.current_driver_id() and public.is_month_closed(dm.company_id, dm.month)));

-- month_closings：閲覧は全ロール、insert/update は admin+（closed→open はトリガーで owner に限定）、削除は owner
drop policy if exists month_closings_select on public.month_closings;
create policy month_closings_select on public.month_closings for select to authenticated
  using (company_id = public.current_company_id() and public.is_staff());
drop policy if exists month_closings_insert on public.month_closings;
create policy month_closings_insert on public.month_closings for insert to authenticated
  with check (company_id = public.current_company_id() and public.is_admin());
drop policy if exists month_closings_update on public.month_closings;
create policy month_closings_update on public.month_closings for update to authenticated
  using (company_id = public.current_company_id() and public.is_admin())
  with check (company_id = public.current_company_id() and public.is_admin());
drop policy if exists month_closings_delete on public.month_closings;
create policy month_closings_delete on public.month_closings for delete to authenticated
  using (company_id = public.current_company_id() and public.is_owner());

-- audit_logs：owner/admin のみ SELECT。書き込みはトリガー（security definer）のみ
drop policy if exists audit_logs_select on public.audit_logs;
create policy audit_logs_select on public.audit_logs for select to authenticated
  using (company_id = public.current_company_id() and public.is_admin());

-- ai_insights
drop policy if exists ai_insights_select on public.ai_insights;
create policy ai_insights_select on public.ai_insights for select to authenticated
  using (company_id = public.current_company_id() and public.is_staff());
drop policy if exists ai_insights_write on public.ai_insights;
create policy ai_insights_write on public.ai_insights for all to authenticated
  using (company_id = public.current_company_id() and public.is_admin())
  with check (company_id = public.current_company_id() and public.is_admin());

-- <<<<<<<<<<<<<<<<<<<<<<<<<<<<<< 0002_auth_rls.sql <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<

-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 0003_views.sql >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- =============================================================================
-- 0003 集計ビュー（security_invoker：呼び出し元の RLS が適用される）
-- 計算仕様 §2 を SQL 側でも実装し、画面とテストの両方から使う
-- =============================================================================

-- 既存のビューは作り直す（create or replace は列を減らせないため、あとのマイグレーションで
-- 列が増えたビューに対して 0003 を再適用すると「cannot drop columns from view」になる）。
-- すべてのマイグレーションは毎回順番に再適用されるので、後続ファイルのビューもここで落として作り直す
drop view if exists
  public.v_month_list,
  public.v_month_pl,
  public.v_project_pl,
  public.v_month_summary,
  public.v_driver_month_summary,
  public.v_project_summary,
  public.v_client_month_summary,
  public.v_invoice_list,
  public.v_expense_list,
  public.v_expense_summary,
  public.v_recurring_expense_list,
  public.v_work_entry_calc
cascade;

-- 稼働行 ＋ 計算値 ＋ 名称
create or replace view public.v_work_entry_calc
with (security_invoker = true) as
select
  we.id,
  we.company_id,
  we.month,
  we.driver_id,
  we.project_item_id,
  pi.project_id,
  d.name as driver_name,
  d.sort_order as driver_sort_order,
  d.is_active as driver_is_active,
  p.name as project_name,
  p.client_name,
  pi.name as item_name,
  pi.unit,
  we.qty,
  we.bill_rate,
  we.pay_rate,
  we.royalty_rate,
  we.rounding_mode,
  we.memo,
  we.created_by,
  we.updated_by,
  we.created_at,
  we.updated_at,
  calc.bill,
  calc.pay,
  calc.bill - calc.pay as margin,
  calc.royalty,
  (calc.bill - calc.pay) + calc.royalty as entry_profit
from public.work_entries we
join public.drivers d on d.id = we.driver_id
join public.project_items pi on pi.id = we.project_item_id
join public.projects p on p.id = pi.project_id
cross join lateral (
  select
    (we.bill_rate * we.qty)::numeric as bill,
    (we.pay_rate * we.qty)::numeric as pay,
    case we.rounding_mode
      when 'floor' then floor(we.pay_rate * we.qty * we.royalty_rate)
      when 'ceil' then ceil(we.pay_rate * we.qty * we.royalty_rate)
      when 'round' then round(we.pay_rate * we.qty * we.royalty_rate)
      else (we.pay_rate * we.qty * we.royalty_rate)
    end::numeric as royalty
) calc;

-- ドライバー × 月
create or replace view public.v_driver_month_summary
with (security_invoker = true) as
with base as (
  select company_id, month, driver_id from public.driver_months
  union
  select company_id, month, driver_id from public.work_entries
),
ent as (
  select company_id, month, driver_id,
         count(*)::integer as entry_count,
         count(*) filter (where qty > 0)::integer as active_entry_count,
         coalesce(sum(bill), 0)::numeric as bill,
         coalesce(sum(pay), 0)::numeric as pay,
         coalesce(sum(margin), 0)::numeric as margin,
         coalesce(sum(royalty), 0)::numeric as royalty
    from public.v_work_entry_calc
   group by company_id, month, driver_id
),
adj as (
  select dm.id as driver_month_id,
         count(a.id)::integer as adjustment_count,
         coalesce(sum(a.amount), 0)::numeric as adj_pay,
         coalesce(sum(case when a.count_as_profit then -a.amount else 0 end), 0)::numeric as adj_profit
    from public.driver_months dm
    left join public.adjustments a on a.driver_month_id = dm.id
   group by dm.id
)
select
  b.company_id,
  b.month,
  b.driver_id,
  d.name as driver_name,
  d.sort_order as driver_sort_order,
  d.is_active as driver_is_active,
  d.mgmt_fee as driver_default_mgmt_fee,
  dm.id as driver_month_id,
  dm.memo,
  coalesce(e.entry_count, 0) as entry_count,
  coalesce(e.active_entry_count, 0) as active_entry_count,
  coalesce(e.bill, 0) as bill,
  coalesce(e.pay, 0) as pay,
  coalesce(e.margin, 0) as margin,
  coalesce(e.royalty, 0) as royalty,
  coalesce(dm.mgmt_fee, 0) as mgmt_fee_setting,
  case when coalesce(e.active_entry_count, 0) > 0 then coalesce(dm.mgmt_fee, 0) else 0 end as mgmt_fee,
  coalesce(a.adjustment_count, 0) as adjustment_count,
  coalesce(a.adj_pay, 0) as adj_pay,
  coalesce(a.adj_profit, 0) as adj_profit,
  (coalesce(e.pay, 0) - coalesce(e.royalty, 0)
     - (case when coalesce(e.active_entry_count, 0) > 0 then coalesce(dm.mgmt_fee, 0) else 0 end)
     + coalesce(a.adj_pay, 0)) as payout,
  (coalesce(e.margin, 0) + coalesce(e.royalty, 0)
     + (case when coalesce(e.active_entry_count, 0) > 0 then coalesce(dm.mgmt_fee, 0) else 0 end)
     + coalesce(a.adj_profit, 0)) as driver_profit,
  public.is_month_closed(b.company_id, b.month) as is_closed
from base b
join public.drivers d on d.id = b.driver_id
left join public.driver_months dm on dm.company_id = b.company_id and dm.month = b.month and dm.driver_id = b.driver_id
left join ent e on e.company_id = b.company_id and e.month = b.month and e.driver_id = b.driver_id
left join adj a on a.driver_month_id = dm.id;

-- 会社 × 月（＋締め状態）
create or replace view public.v_month_summary
with (security_invoker = true) as
with months as (
  select company_id, month from public.driver_months
  union
  select company_id, month from public.work_entries
  union
  select company_id, month from public.month_closings
),
agg as (
  select company_id, month,
         count(*)::integer as driver_count,
         count(*) filter (where active_entry_count > 0)::integer as active_driver_count,
         coalesce(sum(entry_count), 0)::integer as entry_count,
         coalesce(sum(bill), 0)::numeric as bill,
         coalesce(sum(pay), 0)::numeric as pay,
         coalesce(sum(margin), 0)::numeric as margin,
         coalesce(sum(royalty), 0)::numeric as royalty,
         coalesce(sum(mgmt_fee), 0)::numeric as mgmt_fee,
         coalesce(sum(adj_pay), 0)::numeric as adj_pay,
         coalesce(sum(adj_profit), 0)::numeric as adj_profit,
         coalesce(sum(payout), 0)::numeric as payout,
         coalesce(sum(driver_profit), 0)::numeric as profit
    from public.v_driver_month_summary
   group by company_id, month
)
select
  m.company_id,
  m.month,
  coalesce(a.driver_count, 0) as driver_count,
  coalesce(a.active_driver_count, 0) as active_driver_count,
  coalesce(a.entry_count, 0) as entry_count,
  coalesce(a.bill, 0) as bill,
  coalesce(a.pay, 0) as pay,
  coalesce(a.margin, 0) as margin,
  coalesce(a.royalty, 0) as royalty,
  coalesce(a.mgmt_fee, 0) as mgmt_fee,
  coalesce(a.adj_pay, 0) as adj_pay,
  coalesce(a.adj_profit, 0) as adj_profit,
  coalesce(a.payout, 0) as payout,
  coalesce(a.profit, 0) as profit,
  case when coalesce(a.bill, 0) <> 0 then round(coalesce(a.profit, 0) / a.bill, 6) else 0 end as profit_rate,
  coalesce(mc.status, 'open'::public.month_status) as status,
  mc.closed_at,
  mc.closed_by,
  mc.reopened_at,
  mc.backup_path,
  mc.note as closing_note
from months m
left join agg a on a.company_id = m.company_id and a.month = m.month
left join public.month_closings mc on mc.company_id = m.company_id and mc.month = m.month;

-- 案件内容 × 月（管理費・調整は含めない）
create or replace view public.v_project_summary
with (security_invoker = true) as
select
  c.company_id,
  c.month,
  c.project_id,
  c.project_item_id,
  c.project_name,
  c.client_name,
  c.item_name,
  c.unit,
  p.sort_order as project_sort_order,
  pi.sort_order as item_sort_order,
  count(*)::integer as entry_count,
  count(distinct c.driver_id)::integer as driver_count,
  coalesce(sum(c.qty), 0)::numeric as qty_total,
  coalesce(sum(c.bill), 0)::numeric as bill,
  coalesce(sum(c.pay), 0)::numeric as pay,
  coalesce(sum(c.margin), 0)::numeric as margin,
  coalesce(sum(c.royalty), 0)::numeric as royalty,
  coalesce(sum(c.entry_profit), 0)::numeric as entry_profit,
  case when coalesce(sum(c.bill), 0) <> 0 then round(sum(c.entry_profit) / sum(c.bill), 6) else 0 end as profit_rate
from public.v_work_entry_calc c
join public.projects p on p.id = c.project_id
join public.project_items pi on pi.id = c.project_item_id
group by c.company_id, c.month, c.project_id, c.project_item_id, c.project_name, c.client_name, c.item_name, c.unit, p.sort_order, pi.sort_order;

-- データがある月の一覧
create or replace view public.v_month_list
with (security_invoker = true) as
select company_id, month, driver_count, entry_count, bill, profit, payout, profit_rate, status, closed_at, backup_path, closing_note
from public.v_month_summary;

-- <<<<<<<<<<<<<<<<<<<<<<<<<<<<<< 0003_views.sql <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<

-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 0004_rpc.sql >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- =============================================================================
-- 0004 RPC：月複製・一括入力・月締め・解除・バックアップ出力/復元・データ全削除
-- =============================================================================

-- マスタからの自動入力（§2.5）
create or replace function public.entry_defaults(p_driver_id uuid, p_project_item_id uuid)
returns table (bill_rate numeric, pay_rate numeric, royalty_rate numeric, rounding_mode public.rounding_mode)
language sql stable security invoker set search_path = public as $$
  select
    pi.bill_rate,
    coalesce(o.pay_rate, pi.pay_rate) as pay_rate,
    coalesce(d.royalty_rate, c.default_royalty_rate) as royalty_rate,
    coalesce(d.rounding_mode, c.rounding_mode) as rounding_mode
  from public.project_items pi
  join public.drivers d on d.id = p_driver_id
  join public.companies c on c.id = d.company_id
  left join public.driver_pay_overrides o on o.driver_id = d.id and o.project_item_id = pi.id
  where pi.id = p_project_item_id;
$$;

-- 前月から複製（数量 0、単価・率・端数処理は現在のマスタから再取得。冪等）
create or replace function public.copy_previous_month(p_month date)
returns integer language plpgsql security invoker set search_path = public as $$
declare
  cid uuid := public.current_company_id();
  from_month date := (p_month - interval '1 month')::date;
  n integer := 0;
begin
  if not public.is_admin() then
    raise exception '権限がありません' using errcode = 'P0001', hint = 'FORBIDDEN';
  end if;
  if extract(day from p_month) <> 1 then
    raise exception '稼動月は月初日で指定してください' using errcode = 'P0001';
  end if;
  if public.is_month_closed(cid, p_month) then
    raise exception '締め済みの月（%）は変更できません', to_char(p_month, 'YYYY-MM') using errcode = 'P0001', hint = 'MONTH_CLOSED';
  end if;
  insert into public.work_entries (company_id, month, driver_id, project_item_id, qty, bill_rate, pay_rate, royalty_rate, rounding_mode, memo)
  select distinct on (we.driver_id, we.project_item_id)
         cid, p_month, we.driver_id, we.project_item_id, 0, ed.bill_rate, ed.pay_rate, ed.royalty_rate, ed.rounding_mode, ''
    from public.work_entries we
    join public.drivers d on d.id = we.driver_id and d.is_active
    join public.project_items pi on pi.id = we.project_item_id and pi.is_active
    join public.projects p on p.id = pi.project_id and p.is_active
    cross join lateral public.entry_defaults(we.driver_id, we.project_item_id) ed
   where we.company_id = cid and we.month = from_month
     and not exists (
       select 1 from public.work_entries x
        where x.company_id = cid and x.month = p_month and x.driver_id = we.driver_id and x.project_item_id = we.project_item_id)
   order by we.driver_id, we.project_item_id, we.created_at;
  get diagnostics n = row_count;
  return n;
end $$;

-- 一括入力：案件内容 1 つに対し複数ドライバーの数量をまとめて保存
-- p_rows: [{"driver_id": "...", "qty": 21}, ...]  数量 0/null は削除、既存行は更新（単価は既存のスナップショットを維持）
create or replace function public.bulk_set_entries(p_month date, p_project_item_id uuid, p_rows jsonb)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  cid uuid := public.current_company_id();
  r jsonb;
  v_driver uuid;
  v_qty numeric;
  existing uuid;
  n integer;
  ins integer := 0; upd integer := 0; del integer := 0;
begin
  if not public.is_admin() then
    raise exception '権限がありません' using errcode = 'P0001', hint = 'FORBIDDEN';
  end if;
  if public.is_month_closed(cid, p_month) then
    raise exception '締め済みの月（%）は変更できません', to_char(p_month, 'YYYY-MM') using errcode = 'P0001', hint = 'MONTH_CLOSED';
  end if;
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    v_driver := (r->>'driver_id')::uuid;
    v_qty := coalesce((r->>'qty')::numeric, 0);
    if v_qty < 0 then
      raise exception '数量は 0 以上で入力してください' using errcode = 'check_violation';
    end if;
    select id into existing from public.work_entries
     where company_id = cid and month = p_month and driver_id = v_driver and project_item_id = p_project_item_id
     order by created_at limit 1;
    if v_qty = 0 then
      if existing is not null then
        delete from public.work_entries where id = existing;
        del := del + 1;
      end if;
    elsif existing is not null then
      update public.work_entries set qty = v_qty where id = existing and qty <> v_qty;
      get diagnostics n = row_count;
      upd := upd + n;
    else
      insert into public.work_entries (company_id, month, driver_id, project_item_id, qty, bill_rate, pay_rate, royalty_rate, rounding_mode)
      select cid, p_month, v_driver, p_project_item_id, v_qty, ed.bill_rate, ed.pay_rate, ed.royalty_rate, ed.rounding_mode
        from public.entry_defaults(v_driver, p_project_item_id) ed;
      ins := ins + 1;
    end if;
  end loop;
  return jsonb_build_object('inserted', ins, 'updated', upd, 'deleted', del);
end $$;

-- 締め時点のスナップショット
create or replace function public.month_snapshot(p_month date)
returns jsonb language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'month', to_char(p_month, 'YYYY-MM'),
    'generated_at', now(),
    'summary', (select to_jsonb(s) from public.v_month_summary s where s.company_id = public.current_company_id() and s.month = p_month),
    'drivers', (select coalesce(jsonb_agg(to_jsonb(d) order by d.driver_sort_order, d.driver_name), '[]'::jsonb)
                  from public.v_driver_month_summary d where d.company_id = public.current_company_id() and d.month = p_month),
    'entries', (select coalesce(jsonb_agg(to_jsonb(e) order by e.driver_sort_order, e.driver_name, e.created_at), '[]'::jsonb)
                  from public.v_work_entry_calc e where e.company_id = public.current_company_id() and e.month = p_month),
    'adjustments', (select coalesce(jsonb_agg(to_jsonb(a) order by a.sort_order, a.created_at), '[]'::jsonb)
                  from public.adjustments a join public.driver_months dm on dm.id = a.driver_month_id
                 where dm.company_id = public.current_company_id() and dm.month = p_month),
    'projects', (select coalesce(jsonb_agg(to_jsonb(p) order by p.project_name, p.item_name), '[]'::jsonb)
                  from public.v_project_summary p where p.company_id = public.current_company_id() and p.month = p_month)
  );
$$;

-- 月締め（admin+）。監査ログ書き込みのため security definer（会社は current_company_id() で限定）
create or replace function public.close_month(p_month date, p_note text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  cid uuid := public.current_company_id();
  snap jsonb;
begin
  if not public.is_admin() then
    raise exception '権限がありません' using errcode = 'P0001', hint = 'FORBIDDEN';
  end if;
  if public.is_month_closed(cid, p_month) then
    raise exception '既に締め済みです（%）', to_char(p_month, 'YYYY-MM') using errcode = 'P0001', hint = 'ALREADY_CLOSED';
  end if;
  snap := public.month_snapshot(p_month);
  insert into public.month_closings (company_id, month, status, closed_at, closed_by, snapshot, note)
  values (cid, p_month, 'closed', now(), auth.uid(), snap, coalesce(p_note, ''))
  on conflict (company_id, month) do update
    set status = 'closed', closed_at = now(), closed_by = auth.uid(), snapshot = excluded.snapshot,
        note = excluded.note, reopened_at = null, reopened_by = null;
  perform set_config('app.audit_internal', 'on', true);
  perform public.write_audit(cid, 'close_month', 'month_closings', to_char(p_month, 'YYYY-MM'), null, jsonb_build_object('note', p_note, 'summary', snap->'summary'));
  perform set_config('app.audit_internal', 'off', true);
  return snap;
end $$;

-- 締め時バックアップの保存先を記録（admin+）
create or replace function public.set_month_backup_path(p_month date, p_path text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception '権限がありません' using errcode = 'P0001', hint = 'FORBIDDEN';
  end if;
  update public.month_closings set backup_path = p_path
   where company_id = public.current_company_id() and month = p_month;
end $$;

-- 締め解除（owner）
create or replace function public.reopen_month(p_month date)
returns void language plpgsql security definer set search_path = public as $$
declare cid uuid := public.current_company_id();
begin
  if not public.is_owner() then
    raise exception '締めの解除はオーナーのみ可能です' using errcode = 'P0001', hint = 'OWNER_ONLY';
  end if;
  if not public.is_month_closed(cid, p_month) then
    raise exception 'この月は締められていません（%）', to_char(p_month, 'YYYY-MM') using errcode = 'P0001';
  end if;
  update public.month_closings set status = 'open', reopened_at = now(), reopened_by = auth.uid()
   where company_id = cid and month = p_month;
  perform set_config('app.audit_internal', 'on', true);
  perform public.write_audit(cid, 'reopen_month', 'month_closings', to_char(p_month, 'YYYY-MM'), null, null);
  perform set_config('app.audit_internal', 'off', true);
end $$;

-- バックアップ JSON（admin+）
create or replace function public.export_backup()
returns jsonb language plpgsql security invoker set search_path = public as $$
declare cid uuid := public.current_company_id();
begin
  if not public.is_admin() then
    raise exception '権限がありません' using errcode = 'P0001', hint = 'FORBIDDEN';
  end if;
  return jsonb_build_object(
    'version', 1,
    'app', 'rootive-profit',
    'exported_at', now(),
    'company', (select to_jsonb(c) from public.companies c where c.id = cid),
    'drivers', (select coalesce(jsonb_agg(to_jsonb(x) order by x.sort_order, x.name), '[]'::jsonb) from public.drivers x where x.company_id = cid),
    'projects', (select coalesce(jsonb_agg(to_jsonb(x) order by x.sort_order, x.name), '[]'::jsonb) from public.projects x where x.company_id = cid),
    'project_items', (select coalesce(jsonb_agg(to_jsonb(x) order by x.project_id, x.sort_order), '[]'::jsonb) from public.project_items x where x.company_id = cid),
    'driver_pay_overrides', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.driver_pay_overrides x where x.company_id = cid),
    'driver_recurring_adjustments', (select coalesce(jsonb_agg(to_jsonb(x) order by x.driver_id, x.sort_order), '[]'::jsonb) from public.driver_recurring_adjustments x where x.company_id = cid),
    'work_entries', (select coalesce(jsonb_agg(to_jsonb(x) order by x.month, x.created_at), '[]'::jsonb) from public.work_entries x where x.company_id = cid),
    'driver_months', (select coalesce(jsonb_agg(to_jsonb(x) order by x.month, x.driver_id), '[]'::jsonb) from public.driver_months x where x.company_id = cid),
    'adjustments', (select coalesce(jsonb_agg(to_jsonb(x) order by x.driver_month_id, x.sort_order), '[]'::jsonb) from public.adjustments x where x.company_id = cid),
    'month_closings', (select coalesce(jsonb_agg((to_jsonb(x) - 'snapshot') order by x.month), '[]'::jsonb) from public.month_closings x where x.company_id = cid)
  );
end $$;

-- 他社の ID と衝突するか（RLS を越えて確認するため security definer）
create or replace function public.import_has_id_conflict(p_company_id uuid, p_data jsonb)
returns boolean language sql stable security definer set search_path = public as $$
  select
       exists (select 1 from jsonb_array_elements(coalesce(p_data->'drivers','[]')) x join public.drivers t on t.id = (x->>'id')::uuid where t.company_id <> p_company_id)
    or exists (select 1 from jsonb_array_elements(coalesce(p_data->'projects','[]')) x join public.projects t on t.id = (x->>'id')::uuid where t.company_id <> p_company_id)
    or exists (select 1 from jsonb_array_elements(coalesce(p_data->'project_items','[]')) x join public.project_items t on t.id = (x->>'id')::uuid where t.company_id <> p_company_id)
    or exists (select 1 from jsonb_array_elements(coalesce(p_data->'driver_recurring_adjustments','[]')) x join public.driver_recurring_adjustments t on t.id = (x->>'id')::uuid where t.company_id <> p_company_id)
    or exists (select 1 from jsonb_array_elements(coalesce(p_data->'work_entries','[]')) x join public.work_entries t on t.id = (x->>'id')::uuid where t.company_id <> p_company_id)
    or exists (select 1 from jsonb_array_elements(coalesce(p_data->'driver_months','[]')) x join public.driver_months t on t.id = (x->>'id')::uuid where t.company_id <> p_company_id)
    or exists (select 1 from jsonb_array_elements(coalesce(p_data->'adjustments','[]')) x join public.adjustments t on t.id = (x->>'id')::uuid where t.company_id <> p_company_id)
    or exists (select 1 from jsonb_array_elements(coalesce(p_data->'driver_pay_overrides','[]')) x join public.driver_pay_overrides t on t.driver_id = (x->>'driver_id')::uuid and t.project_item_id = (x->>'project_item_id')::uuid where t.company_id <> p_company_id);
$$;

-- 復元／取り込み（owner）。ID 一致は上書き、他社の ID と衝突すれば拒否。締めガード・行単位監査は一時的に回避
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
      tax_rounding = coalesce((c->>'tax_rounding')::public.rounding_mode, tax_rounding)
    where id = cid;
  end if;

  insert into public.drivers (id, company_id, name, kana, is_active, royalty_rate, mgmt_fee, rounding_mode, phone, email, bank_info, memo, sort_order,
                              tax_mode, invoice_reg_no, payout_month_offset, payout_day)
  select (x->>'id')::uuid, cid, x->>'name', coalesce(x->>'kana',''), coalesce((x->>'is_active')::boolean, true),
         (x->>'royalty_rate')::numeric, coalesce((x->>'mgmt_fee')::numeric, 0), (x->>'rounding_mode')::public.rounding_mode,
         coalesce(x->>'phone',''), coalesce(x->>'email',''), coalesce(x->>'bank_info',''), coalesce(x->>'memo',''), coalesce((x->>'sort_order')::integer, 0),
         coalesce((x->>'tax_mode')::public.tax_mode, 'taxable'), coalesce(x->>'invoice_reg_no',''), (x->>'payout_month_offset')::integer, (x->>'payout_day')::integer
    from jsonb_array_elements(coalesce(p_data->'drivers','[]')) x
  on conflict (id) do update set
    name = excluded.name, kana = excluded.kana, is_active = excluded.is_active, royalty_rate = excluded.royalty_rate,
    mgmt_fee = excluded.mgmt_fee, rounding_mode = excluded.rounding_mode, phone = excluded.phone, email = excluded.email,
    bank_info = excluded.bank_info, memo = excluded.memo, sort_order = excluded.sort_order,
    tax_mode = excluded.tax_mode, invoice_reg_no = excluded.invoice_reg_no, payout_month_offset = excluded.payout_month_offset, payout_day = excluded.payout_day;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('drivers', n);

  insert into public.projects (id, company_id, name, client_name, is_active, memo, sort_order)
  select (x->>'id')::uuid, cid, x->>'name', coalesce(x->>'client_name',''), coalesce((x->>'is_active')::boolean, true), coalesce(x->>'memo',''), coalesce((x->>'sort_order')::integer, 0)
    from jsonb_array_elements(coalesce(p_data->'projects','[]')) x
  on conflict (id) do update set
    name = excluded.name, client_name = excluded.client_name, is_active = excluded.is_active, memo = excluded.memo, sort_order = excluded.sort_order;
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

  perform set_config('app.skip_audit', 'off', true);
  perform set_config('app.bypass_closing', 'off', true);
  perform set_config('app.audit_internal', 'on', true);
  perform public.write_audit(cid, 'import_backup', 'company', cid::text, null, counts);
  perform set_config('app.audit_internal', 'off', true);
  return counts;
end $$;

-- データ全削除（owner。会社名の入力で確認）。ユーザー・招待・会社設定は残す
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
  delete from public.adjustments where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('adjustments', n);
  delete from public.work_entries where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('work_entries', n);
  delete from public.driver_months where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('driver_months', n);
  delete from public.month_closings where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('month_closings', n);
  delete from public.ai_insights where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('ai_insights', n);
  delete from public.driver_pay_overrides where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('driver_pay_overrides', n);
  delete from public.driver_recurring_adjustments where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('driver_recurring_adjustments', n);
  -- ドライバー本人のユーザーは、対応ドライバーが消えるため「無効な閲覧者」に変更する（再招待で復帰できる）
  perform set_config('app.bypass_profile_guard', 'on', true);
  update public.profiles set role = 'viewer', driver_id = null, is_active = false where company_id = cid and role = 'driver';
  update public.profiles set driver_id = null where company_id = cid and driver_id is not null;
  perform set_config('app.bypass_profile_guard', 'off', true);
  delete from public.invitations where company_id = cid and role = 'driver';
  update public.invitations set driver_id = null where company_id = cid and driver_id is not null;
  delete from public.project_items where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('project_items', n);
  delete from public.projects where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('projects', n);
  delete from public.drivers where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('drivers', n);
  perform set_config('app.skip_audit', 'off', true);
  perform set_config('app.bypass_closing', 'off', true);
  perform set_config('app.audit_internal', 'on', true);
  perform public.write_audit(cid, 'reset_company_data', 'company', cid::text, counts, null);
  perform set_config('app.audit_internal', 'off', true);
  return counts;
end $$;

-- <<<<<<<<<<<<<<<<<<<<<<<<<<<<<< 0004_rpc.sql <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<

-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 0005_portal_seed.sql >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- =============================================================================
-- 0005 ドライバーポータル用関数・初期データ投入・招待ユーティリティ
-- =============================================================================

-- ドライバー本人：月の一覧（締め済み月は金額付き、未締め月は「集計中」として金額なし。会社利益は含めない）
drop function if exists public.driver_portal_months();
create or replace function public.driver_portal_months()
returns table (month date, status public.month_status, payout numeric, pay numeric, royalty numeric, mgmt_fee numeric, adj_pay numeric, closed_at timestamptz)
language sql stable security definer set search_path = public as $$
  select s.month,
         case when mc.status = 'closed' then 'closed'::public.month_status else 'open'::public.month_status end as status,
         case when mc.status = 'closed' then s.payout end as payout,
         case when mc.status = 'closed' then s.pay end as pay,
         case when mc.status = 'closed' then s.royalty end as royalty,
         case when mc.status = 'closed' then s.mgmt_fee end as mgmt_fee,
         case when mc.status = 'closed' then s.adj_pay end as adj_pay,
         case when mc.status = 'closed' then mc.closed_at end as closed_at
    from public.v_driver_month_summary s
    left join public.month_closings mc on mc.company_id = s.company_id and mc.month = s.month
   where s.driver_id = public.current_driver_id()
     and s.company_id = public.current_company_id()
     and (mc.status = 'closed' or s.entry_count > 0)
   order by s.month desc;
$$;

-- ドライバー本人：締め済み月の支払明細（会社売上・利益は含めない）
create or replace function public.driver_portal_statement(p_month date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  did uuid := public.current_driver_id();
  cid uuid := public.current_company_id();
  show_royalty boolean;
begin
  if did is null or cid is null then
    return null;
  end if;
  if not public.is_month_closed(cid, p_month) then
    return jsonb_build_object('month', to_char(p_month, 'YYYY-MM'), 'status', 'open');
  end if;
  select driver_portal_show_royalty into show_royalty from public.companies where id = cid;
  return jsonb_build_object(
    'month', to_char(p_month, 'YYYY-MM'),
    'status', 'closed',
    'driver', (select jsonb_build_object('id', d.id, 'name', d.name) from public.drivers d where d.id = did),
    'company', (select jsonb_build_object('name', c.name, 'address', c.address, 'tel', c.tel, 'invoice_reg_no', c.invoice_reg_no,
                  'statement_note', c.statement_note, 'payout_month_offset', c.payout_month_offset, 'payout_day', c.payout_day,
                  'show_royalty', c.driver_portal_show_royalty) from public.companies c where c.id = cid),
    'entries', (select coalesce(jsonb_agg(jsonb_build_object(
                  'id', e.id, 'project_name', e.project_name, 'item_name', e.item_name, 'unit', e.unit,
                  'qty', e.qty, 'pay_rate', e.pay_rate, 'pay', e.pay,
                  'royalty', e.royalty, 'royalty_rate', case when show_royalty then e.royalty_rate else null end, 'memo', e.memo)
                  order by e.created_at), '[]'::jsonb)
                from public.v_work_entry_calc e where e.driver_id = did and e.company_id = cid and e.month = p_month),
    'summary', (select jsonb_build_object('pay', s.pay, 'royalty', s.royalty, 'mgmt_fee', s.mgmt_fee, 'adj_pay', s.adj_pay, 'payout', s.payout,
                  'royalty_visible', show_royalty)
                from public.v_driver_month_summary s where s.driver_id = did and s.company_id = cid and s.month = p_month),
    'adjustments', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'label', a.label, 'amount', a.amount) order by a.sort_order, a.created_at), '[]'::jsonb)
                from public.adjustments a join public.driver_months dm on dm.id = a.driver_month_id
               where dm.driver_id = did and dm.company_id = cid and dm.month = p_month),
    'closed_at', (select mc.closed_at from public.month_closings mc where mc.company_id = cid and mc.month = p_month)
  );
end $$;

-- 初期データ（§8.6）。ドライバーが 1 件も無い会社にのみ投入する
create or replace function public.seed_initial_data(p_with_entries boolean default true)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  cid uuid := public.current_company_id();
  m date := date '2026-09-01';
  d_aiso uuid; d_kane uuid; d_numa uuid; d_imai uuid; d_ishi uuid; d_kuro uuid; d_fuji uuid; d_yosh uuid; d_kawa uuid; d_taka uuid;
  p_misato uuid; p_kawaguchi uuid; p_temu uuid; p_nihonbashi uuid; p_wako uuid; p_soka uuid; p_tatsumi uuid;
  i_misato uuid; i_kawaguchi uuid; i_temu uuid; i_nihonbashi uuid; i_wako_takkyu uuid; i_wako_neko uuid; i_soka uuid; i_tatsumi uuid;
begin
  if not public.is_admin() then
    raise exception '権限がありません' using errcode = 'P0001', hint = 'FORBIDDEN';
  end if;
  if exists (select 1 from public.drivers where company_id = cid) then
    raise exception '既にドライバーが登録されているため初期データは投入できません' using errcode = 'P0001', hint = 'NOT_EMPTY';
  end if;

  insert into public.drivers (company_id, name, kana, royalty_rate, mgmt_fee, sort_order) values
    (cid, '相曽慧', 'あいそ けい', 0.1, 15000, 1) returning id into d_aiso;
  insert into public.drivers (company_id, name, kana, royalty_rate, mgmt_fee, sort_order) values
    (cid, '金島幸太', 'かねしま こうた', 0.1, 0, 2) returning id into d_kane;
  insert into public.drivers (company_id, name, kana, royalty_rate, mgmt_fee, sort_order) values
    (cid, '沼田基', 'ぬまた もとい', 0.1, 15000, 3) returning id into d_numa;
  insert into public.drivers (company_id, name, kana, royalty_rate, mgmt_fee, sort_order) values
    (cid, '今井皇輝', 'いまい こうき', 0.1, 15000, 4) returning id into d_imai;
  insert into public.drivers (company_id, name, kana, royalty_rate, mgmt_fee, sort_order) values
    (cid, '石田泰典', 'いしだ やすのり', 0.125, 15000, 5) returning id into d_ishi;
  insert into public.drivers (company_id, name, kana, royalty_rate, mgmt_fee, sort_order) values
    (cid, '黒岩亜夢莉', 'くろいわ あむり', 0.125, 15000, 6) returning id into d_kuro;
  insert into public.drivers (company_id, name, kana, royalty_rate, mgmt_fee, sort_order) values
    (cid, '藤田裕介', 'ふじた ゆうすけ', 0.1, 0, 7) returning id into d_fuji;
  insert into public.drivers (company_id, name, kana, royalty_rate, mgmt_fee, sort_order) values
    (cid, '吉田雅一', 'よしだ まさかず', 0.1, 15000, 8) returning id into d_yosh;
  insert into public.drivers (company_id, name, kana, royalty_rate, mgmt_fee, memo, sort_order) values
    (cid, '川島幹太', 'かわしま かんた', 0, 0, 'オーナー本人（役員報酬のため支払 0）', 9) returning id into d_kawa;
  insert into public.drivers (company_id, name, kana, royalty_rate, mgmt_fee, sort_order) values
    (cid, '高森豪介', 'たかもり ごうすけ', 0.1, 15000, 10) returning id into d_taka;

  insert into public.projects (company_id, name, sort_order) values (cid, '三郷Amazon', 1) returning id into p_misato;
  insert into public.projects (company_id, name, sort_order) values (cid, '川口領家Amazon', 2) returning id into p_kawaguchi;
  insert into public.projects (company_id, name, sort_order) values (cid, 'Temu', 3) returning id into p_temu;
  insert into public.projects (company_id, name, client_name, sort_order) values (cid, 'にほんばし蔵前郵便局', '株式会社GALLOP9', 4) returning id into p_nihonbashi;
  insert into public.projects (company_id, name, sort_order) values (cid, '和光ヤマト', 5) returning id into p_wako;
  insert into public.projects (company_id, name, sort_order) values (cid, '草加→鎌ヶ谷', 6) returning id into p_soka;
  insert into public.projects (company_id, name, sort_order) values (cid, '辰巳屋興業', 7) returning id into p_tatsumi;

  insert into public.project_items (project_id, name, unit, bill_rate, pay_rate, sort_order) values (p_misato, '標準', 'day', 23025, 21780, 1) returning id into i_misato;
  insert into public.project_items (project_id, name, unit, bill_rate, pay_rate, sort_order) values (p_kawaguchi, '標準', 'day', 21133, 20250, 1) returning id into i_kawaguchi;
  insert into public.project_items (project_id, name, unit, bill_rate, pay_rate, sort_order) values (p_temu, '標準', 'day', 23025, 21960, 1) returning id into i_temu;
  insert into public.project_items (project_id, name, unit, bill_rate, pay_rate, sort_order) values (p_nihonbashi, '標準', 'piece', 180, 162, 1) returning id into i_nihonbashi;
  insert into public.project_items (project_id, name, unit, bill_rate, pay_rate, sort_order) values (p_wako, '宅急便', 'piece', 180, 162, 1) returning id into i_wako_takkyu;
  insert into public.project_items (project_id, name, unit, bill_rate, pay_rate, sort_order) values (p_wako, 'ネコポス', 'piece', 50, 50, 2) returning id into i_wako_neko;
  insert into public.project_items (project_id, name, unit, bill_rate, pay_rate, sort_order) values (p_soka, '標準', 'day', 15000, 15000, 1) returning id into i_soka;
  insert into public.project_items (project_id, name, unit, bill_rate, pay_rate, sort_order) values (p_tatsumi, '標準', 'day', 8500, 0, 1) returning id into i_tatsumi;

  -- 個別単価：吉田・高森は三郷Amazon 21,960。川島幹太（オーナー本人）は支払 0 をマスタにも持たせる（稼働行のスナップショットと一致させる）
  insert into public.driver_pay_overrides (driver_id, project_item_id, pay_rate) values (d_yosh, i_misato, 21960), (d_taka, i_misato, 21960), (d_kawa, i_misato, 0), (d_kawa, i_tatsumi, 0);

  if p_with_entries then
    -- §2.6 の 10 行（相曽慧の管理費は 14,999）
    insert into public.work_entries (company_id, month, driver_id, project_item_id, qty, bill_rate, pay_rate, royalty_rate, rounding_mode) values
      (cid, m, d_aiso, i_misato, 21, 23025, 21780, 0.1, 'none'),
      (cid, m, d_kane, i_nihonbashi, 803, 180, 162, 0.1, 'none'),
      (cid, m, d_numa, i_nihonbashi, 803, 180, 162, 0.1, 'none'),
      (cid, m, d_imai, i_wako_takkyu, 1398, 180, 162, 0.1, 'none'),
      (cid, m, d_imai, i_wako_neko, 749, 50, 50, 0.1, 'none'),
      (cid, m, d_fuji, i_temu, 21, 23025, 21960, 0.1, 'none'),
      (cid, m, d_ishi, i_kawaguchi, 16, 21133, 20250, 0.125, 'none'),
      (cid, m, d_kuro, i_misato, 21, 23025, 21780, 0.125, 'none'),
      (cid, m, d_kawa, i_misato, 8, 23025, 0, 0, 'none'),
      (cid, m, d_kawa, i_tatsumi, 1, 8500, 0, 0, 'none');
    update public.driver_months set mgmt_fee = 14999 where company_id = cid and month = m and driver_id = d_aiso;
  end if;

  return jsonb_build_object('drivers', 10, 'projects', 7, 'project_items', 8, 'entries', case when p_with_entries then 10 else 0 end);
end $$;

-- 招待の作成（owner）。招待トークンを返す
create or replace function public.create_invitation(p_email text, p_role public.user_role, p_driver_id uuid default null, p_display_name text default '')
returns public.invitations language plpgsql security invoker set search_path = public as $$
declare
  cid uuid := public.current_company_id();
  inv public.invitations;
begin
  if not public.is_owner() then
    raise exception 'ユーザー招待はオーナーのみ可能です' using errcode = 'P0001', hint = 'OWNER_ONLY';
  end if;
  -- 同じメールの、まだ招待リンクで使われていない招待はすべて取り消す（再招待で常に最新の 1 件だけが有効）
  update public.invitations set cancelled_at = now()
   where company_id = cid and lower(email) = lower(trim(p_email)) and cancelled_at is null and link_used_at is null;
  insert into public.invitations (company_id, email, role, driver_id, display_name, invited_by)
  values (cid, lower(trim(p_email)), p_role, case when p_role = 'driver' then p_driver_id else null end, coalesce(p_display_name, ''), auth.uid())
  returning * into inv;
  return inv;
end $$;

-- <<<<<<<<<<<<<<<<<<<<<<<<<<<<<< 0005_portal_seed.sql <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<

-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 0006_storage_grants.sql >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- =============================================================================
-- 0006 Storage（backups バケット）と権限の最終調整
-- =============================================================================

-- backups バケット（非公開）
insert into storage.buckets (id, name, public)
values ('backups', 'backups', false)
on conflict (id) do nothing;

-- 会社フォルダ配下のみ、owner/admin が閲覧・作成できる（実際の保存はサーバーのサービスロールで行う）
drop policy if exists backups_select on storage.objects;
create policy backups_select on storage.objects for select to authenticated
  using (bucket_id = 'backups' and public.is_admin() and (storage.foldername(name))[1] = public.current_company_id()::text);
drop policy if exists backups_insert on storage.objects;
create policy backups_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'backups' and public.is_admin() and (storage.foldername(name))[1] = public.current_company_id()::text);

-- anon には一切の権限を与えない
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;
revoke usage on schema public from anon;

-- authenticated / service_role
grant usage on schema public to authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;
grant execute on all functions in schema public to authenticated, service_role;

-- 今後作成されるオブジェクトにも anon 権限を付けない
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on functions from anon;
alter default privileges in schema public revoke all on sequences from anon;

-- 内部関数（トリガー・サーバー専用）は一般ユーザーから RPC で呼べないようにする
revoke execute on function public.apply_invitation(uuid, text, text) from authenticated, anon, public;
revoke execute on function public.write_audit(uuid, text, text, text, jsonb, jsonb) from authenticated, anon, public;
revoke execute on function public.ensure_driver_month(uuid, date, uuid) from authenticated, anon, public;
revoke execute on function public.import_has_id_conflict(uuid, jsonb) from authenticated, anon, public;
revoke execute on function public.handle_new_auth_user() from authenticated, anon, public;

-- 招待トリガー用：auth 管理ロールが関数を実行できること（security definer なのでテーブル権限は不要）
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    grant usage on schema public to supabase_auth_admin;
    grant execute on function public.handle_new_auth_user() to supabase_auth_admin;
    grant execute on function public.apply_invitation(uuid, text, text) to supabase_auth_admin;
  end if;
end $$;

-- <<<<<<<<<<<<<<<<<<<<<<<<<<<<<< 0006_storage_grants.sql <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<

-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 0007_driver_rates.sql >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- =============================================================================
-- 0007 ドライバー別単価：受注単価も個別に設定できるようにし、単価変更を未締め月の稼働へ反映する RPC を追加
-- =============================================================================

-- ---------- driver_pay_overrides：bill_rate を追加（どちらか一方だけの上書きも可） ----------
alter table public.driver_pay_overrides add column if not exists bill_rate numeric(12,2);
alter table public.driver_pay_overrides alter column pay_rate drop not null;
alter table public.driver_pay_overrides drop constraint if exists driver_pay_overrides_bill_rate_check;
alter table public.driver_pay_overrides add constraint driver_pay_overrides_bill_rate_check check (bill_rate is null or bill_rate >= 0);
alter table public.driver_pay_overrides drop constraint if exists driver_pay_overrides_rate_present;
alter table public.driver_pay_overrides add constraint driver_pay_overrides_rate_present check (bill_rate is not null or pay_rate is not null);

comment on table public.driver_pay_overrides is 'ドライバー別単価（案件内容ごとの受注単価・支払単価の上書き。null は案件内容の標準を使う）';

-- ---------- マスタからの自動入力（§2.5）：受注単価もドライバー別単価を優先 ----------
create or replace function public.entry_defaults(p_driver_id uuid, p_project_item_id uuid)
returns table (bill_rate numeric, pay_rate numeric, royalty_rate numeric, rounding_mode public.rounding_mode)
language sql stable security invoker set search_path = public as $$
  select
    coalesce(o.bill_rate, pi.bill_rate) as bill_rate,
    coalesce(o.pay_rate, pi.pay_rate) as pay_rate,
    coalesce(d.royalty_rate, c.default_royalty_rate) as royalty_rate,
    coalesce(d.rounding_mode, c.rounding_mode) as rounding_mode
  from public.project_items pi
  join public.drivers d on d.id = p_driver_id
  join public.companies c on c.id = d.company_id
  left join public.driver_pay_overrides o on o.driver_id = d.id and o.project_item_id = pi.id
  where pi.id = p_project_item_id;
$$;

-- ---------- 稼働行のスナップショットと現在のマスタ（§2.5）の差分 ----------
-- 単価・率・端数処理のいずれかが現在のマスタと異なる稼働行（自社・指定月）。RLS が適用される（security invoker）
create or replace function public.rate_diffs(p_month date)
returns table (
  entry_id uuid, driver_id uuid, driver_name text, project_id uuid, project_item_id uuid, project_name text, item_name text, qty numeric,
  bill_rate numeric, pay_rate numeric, royalty_rate numeric, rounding_mode public.rounding_mode,
  master_bill_rate numeric, master_pay_rate numeric, master_royalty_rate numeric, master_rounding_mode public.rounding_mode
)
language sql stable security invoker set search_path = public as $$
  select we.id, we.driver_id, d.name, p.id, pi.id, p.name, pi.name, we.qty,
         we.bill_rate, we.pay_rate, we.royalty_rate, we.rounding_mode,
         ed.bill_rate, ed.pay_rate, ed.royalty_rate, ed.rounding_mode
    from public.work_entries we
    join public.drivers d on d.id = we.driver_id
    join public.project_items pi on pi.id = we.project_item_id
    join public.projects p on p.id = pi.project_id
    cross join lateral public.entry_defaults(we.driver_id, we.project_item_id) ed
   where we.company_id = public.current_company_id()
     and we.month = p_month
     and (we.bill_rate <> ed.bill_rate or we.pay_rate <> ed.pay_rate or we.royalty_rate <> ed.royalty_rate or we.rounding_mode <> ed.rounding_mode)
   order by d.sort_order, d.name, p.sort_order, pi.sort_order, we.created_at;
$$;

-- ---------- 単価変更を未締め月の稼働へ反映（admin+） ----------
-- 指定月の稼働行のうちマスタと異なる行の 単価・率・端数処理 を現在のマスタの値に更新する。
-- p_driver_id / p_project_item_id / p_entry_ids で対象を絞れる（null はすべて）。更新した行数を返す
create or replace function public.apply_master_rates(p_month date, p_driver_id uuid default null, p_project_item_id uuid default null, p_entry_ids uuid[] default null)
returns integer language plpgsql security invoker set search_path = public as $$
declare
  cid uuid := public.current_company_id();
  n integer := 0;
begin
  if not public.is_admin() then
    raise exception '権限がありません' using errcode = 'P0001', hint = 'FORBIDDEN';
  end if;
  if extract(day from p_month) <> 1 then
    raise exception '稼動月は月初日で指定してください' using errcode = 'P0001';
  end if;
  if public.is_month_closed(cid, p_month) then
    raise exception '締め済みの月（%）は変更できません', to_char(p_month, 'YYYY-MM') using errcode = 'P0001', hint = 'MONTH_CLOSED';
  end if;
  update public.work_entries we
     set bill_rate = rd.master_bill_rate,
         pay_rate = rd.master_pay_rate,
         royalty_rate = rd.master_royalty_rate,
         rounding_mode = rd.master_rounding_mode,
         updated_by = auth.uid()
    from public.rate_diffs(p_month) rd
   where we.id = rd.entry_id
     and we.company_id = cid
     and (p_driver_id is null or rd.driver_id = p_driver_id)
     and (p_project_item_id is null or rd.project_item_id = p_project_item_id)
     and (p_entry_ids is null or we.id = any(p_entry_ids));
  get diagnostics n = row_count;
  return n;
end $$;

-- バックアップの復元（import_backup）は 0004 側で bill_rate を取り込むよう更新済み

-- ---------- 権限 ----------
revoke execute on function public.rate_diffs(date) from anon, public;
revoke execute on function public.apply_master_rates(date, uuid, uuid, uuid[]) from anon, public;
grant execute on function public.rate_diffs(date) to authenticated, service_role;
grant execute on function public.apply_master_rates(date, uuid, uuid, uuid[]) to authenticated, service_role;

-- <<<<<<<<<<<<<<<<<<<<<<<<<<<<<< 0007_driver_rates.sql <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<

-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 0008_tax_assets_payout.sql >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- =============================================================================
-- 0008 消費税（税込の支払明細）・会社のロゴと認印・ドライバーごとの支払日
--   - 単価・管理費・ロイヤリティはすべて税抜で入力し、支払明細の段階で消費税を計算する（調整は税込のまま）
--   - 税率・端数処理は会社設定、課税／非課税はドライバーごと。締めた月は driver_months に固定（スナップショット）
-- =============================================================================

-- ---------- 型 ----------
do $$ begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace where n.nspname = 'public' and t.typname = 'tax_mode') then
    create type public.tax_mode as enum ('taxable', 'exempt');
  end if;
end $$;

-- ---------- 会社設定：消費税・ロゴ・認印 ----------
alter table public.companies
  add column if not exists tax_rate numeric(6,4) not null default 0.10,
  add column if not exists tax_rounding public.rounding_mode not null default 'floor',
  add column if not exists logo_path text,
  add column if not exists seal_path text;
alter table public.companies drop constraint if exists companies_tax_rate_check;
alter table public.companies add constraint companies_tax_rate_check check (tax_rate >= 0 and tax_rate <= 1);
comment on column public.companies.tax_rate is '消費税率（0.10 = 10%）。単価は税抜で入力し、明細で消費税を計算する';
comment on column public.companies.tax_rounding is '消費税額の端数処理（既定 切り捨て）';
comment on column public.companies.logo_path is 'Storage company-assets 内のロゴ画像のパス（null = 無し）';
comment on column public.companies.seal_path is 'Storage company-assets 内の認印画像のパス（null = 無し）';

-- ---------- ドライバー：課税区分・登録番号・支払日の個別設定 ----------
alter table public.drivers
  add column if not exists tax_mode public.tax_mode not null default 'taxable',
  add column if not exists invoice_reg_no text not null default '',
  add column if not exists payout_month_offset integer,
  add column if not exists payout_day integer;
alter table public.drivers drop constraint if exists drivers_payout_month_offset_check;
alter table public.drivers add constraint drivers_payout_month_offset_check check (payout_month_offset is null or payout_month_offset between 0 and 3);
alter table public.drivers drop constraint if exists drivers_payout_day_check;
alter table public.drivers add constraint drivers_payout_day_check check (payout_day is null or payout_day between 0 and 31);
comment on column public.drivers.tax_mode is 'taxable = 消費税を上乗せして支払う／exempt = 上乗せしない（非課税・免税）';
comment on column public.drivers.payout_month_offset is '振込予定日の月（null = 会社設定に従う）';
comment on column public.drivers.payout_day is '振込予定日の日（0 = 末日、null = 会社設定に従う）';

-- ---------- ドライバー × 月：締め時に固定する消費税の設定（未締めの間は null ＝ 現在の設定に従う） ----------
alter table public.driver_months
  add column if not exists tax_rate numeric(6,4),
  add column if not exists tax_rounding public.rounding_mode,
  add column if not exists tax_mode public.tax_mode;
alter table public.driver_months drop constraint if exists driver_months_tax_rate_check;
alter table public.driver_months add constraint driver_months_tax_rate_check check (tax_rate is null or (tax_rate >= 0 and tax_rate <= 1));

-- ---------- 端数処理（SQL 側。lib/calc の applyRounding と同じ規則） ----------
create or replace function public.round_by_mode(p_value numeric, p_mode public.rounding_mode)
returns numeric language sql immutable as $$
  select case p_mode
    when 'floor' then floor(p_value)
    when 'ceil' then ceil(p_value)
    when 'round' then round(p_value)
    else p_value
  end;
$$;

-- ---------- ドライバー × 月 の集計に消費税を追加 ----------
-- 税抜の小計 tax_base = pay − royalty − mgmt_fee、消費税 tax = 端数処理(tax_base × 税率)、税込支払額 payout_incl = payout + tax
-- （調整 adj_pay は税込の金額として扱い、消費税を計算しない）
create or replace view public.v_driver_month_summary
with (security_invoker = true) as
with base as (
  select company_id, month, driver_id from public.driver_months
  union
  select company_id, month, driver_id from public.work_entries
),
ent as (
  select company_id, month, driver_id,
         count(*)::integer as entry_count,
         count(*) filter (where qty > 0)::integer as active_entry_count,
         coalesce(sum(bill), 0)::numeric as bill,
         coalesce(sum(pay), 0)::numeric as pay,
         coalesce(sum(margin), 0)::numeric as margin,
         coalesce(sum(royalty), 0)::numeric as royalty
    from public.v_work_entry_calc
   group by company_id, month, driver_id
),
adj as (
  select dm.id as driver_month_id,
         count(a.id)::integer as adjustment_count,
         coalesce(sum(a.amount), 0)::numeric as adj_pay,
         coalesce(sum(case when a.count_as_profit then -a.amount else 0 end), 0)::numeric as adj_profit
    from public.driver_months dm
    left join public.adjustments a on a.driver_month_id = dm.id
   group by dm.id
),
calc as (
  select
    b.company_id, b.month, b.driver_id,
    coalesce(e.entry_count, 0) as entry_count,
    coalesce(e.active_entry_count, 0) as active_entry_count,
    coalesce(e.bill, 0) as bill,
    coalesce(e.pay, 0) as pay,
    coalesce(e.margin, 0) as margin,
    coalesce(e.royalty, 0) as royalty,
    coalesce(dm.mgmt_fee, 0) as mgmt_fee_setting,
    case when coalesce(e.active_entry_count, 0) > 0 then coalesce(dm.mgmt_fee, 0) else 0 end as mgmt_fee,
    coalesce(a.adjustment_count, 0) as adjustment_count,
    coalesce(a.adj_pay, 0) as adj_pay,
    coalesce(a.adj_profit, 0) as adj_profit,
    dm.id as driver_month_id,
    dm.memo,
    coalesce(dm.tax_mode, d.tax_mode) as tax_mode,
    coalesce(dm.tax_rate, c.tax_rate) as tax_rate,
    coalesce(dm.tax_rounding, c.tax_rounding) as tax_rounding,
    d.name as driver_name,
    d.sort_order as driver_sort_order,
    d.is_active as driver_is_active,
    d.mgmt_fee as driver_default_mgmt_fee
  from base b
  join public.drivers d on d.id = b.driver_id
  join public.companies c on c.id = b.company_id
  left join public.driver_months dm on dm.company_id = b.company_id and dm.month = b.month and dm.driver_id = b.driver_id
  left join ent e on e.company_id = b.company_id and e.month = b.month and e.driver_id = b.driver_id
  left join adj a on a.driver_month_id = dm.id
),
calc2 as (
  select *,
    (pay - royalty - mgmt_fee + adj_pay) as payout,
    (margin + royalty + mgmt_fee + adj_profit) as driver_profit,
    (pay - royalty - mgmt_fee) as tax_base
  from calc
),
calc3 as (
  select *,
    case when tax_mode = 'taxable' then public.round_by_mode(tax_base * tax_rate, tax_rounding) else 0 end as tax
  from calc2
)
select
  company_id,
  month,
  driver_id,
  driver_name,
  driver_sort_order,
  driver_is_active,
  driver_default_mgmt_fee,
  driver_month_id,
  memo,
  entry_count,
  active_entry_count,
  bill,
  pay,
  margin,
  royalty,
  mgmt_fee_setting,
  mgmt_fee,
  adjustment_count,
  adj_pay,
  adj_profit,
  payout,
  driver_profit,
  public.is_month_closed(company_id, month) as is_closed,
  tax_mode,
  tax_rate,
  tax_rounding,
  tax_base,
  tax,
  (payout + tax) as payout_incl
from calc3;

-- ---------- 会社 × 月 に消費税・税込支払額の合計を追加 ----------
create or replace view public.v_month_summary
with (security_invoker = true) as
with months as (
  select company_id, month from public.driver_months
  union
  select company_id, month from public.work_entries
  union
  select company_id, month from public.month_closings
),
agg as (
  select company_id, month,
         count(*)::integer as driver_count,
         count(*) filter (where active_entry_count > 0)::integer as active_driver_count,
         coalesce(sum(entry_count), 0)::integer as entry_count,
         coalesce(sum(bill), 0)::numeric as bill,
         coalesce(sum(pay), 0)::numeric as pay,
         coalesce(sum(margin), 0)::numeric as margin,
         coalesce(sum(royalty), 0)::numeric as royalty,
         coalesce(sum(mgmt_fee), 0)::numeric as mgmt_fee,
         coalesce(sum(adj_pay), 0)::numeric as adj_pay,
         coalesce(sum(adj_profit), 0)::numeric as adj_profit,
         coalesce(sum(payout), 0)::numeric as payout,
         coalesce(sum(driver_profit), 0)::numeric as profit,
         coalesce(sum(tax), 0)::numeric as tax,
         coalesce(sum(payout_incl), 0)::numeric as payout_incl
    from public.v_driver_month_summary
   group by company_id, month
)
select
  m.company_id,
  m.month,
  coalesce(a.driver_count, 0) as driver_count,
  coalesce(a.active_driver_count, 0) as active_driver_count,
  coalesce(a.entry_count, 0) as entry_count,
  coalesce(a.bill, 0) as bill,
  coalesce(a.pay, 0) as pay,
  coalesce(a.margin, 0) as margin,
  coalesce(a.royalty, 0) as royalty,
  coalesce(a.mgmt_fee, 0) as mgmt_fee,
  coalesce(a.adj_pay, 0) as adj_pay,
  coalesce(a.adj_profit, 0) as adj_profit,
  coalesce(a.payout, 0) as payout,
  coalesce(a.profit, 0) as profit,
  case when coalesce(a.bill, 0) <> 0 then round(coalesce(a.profit, 0) / a.bill, 6) else 0 end as profit_rate,
  coalesce(mc.status, 'open'::public.month_status) as status,
  mc.closed_at,
  mc.closed_by,
  mc.reopened_at,
  mc.backup_path,
  mc.note as closing_note,
  coalesce(a.tax, 0) as tax,
  coalesce(a.payout_incl, 0) as payout_incl
from months m
left join agg a on a.company_id = m.company_id and a.month = m.month
left join public.month_closings mc on mc.company_id = m.company_id and mc.month = m.month;

-- ---------- 月締め：消費税の設定をその月の driver_months に固定してから締める ----------
create or replace function public.close_month(p_month date, p_note text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  cid uuid := public.current_company_id();
  snap jsonb;
begin
  if not public.is_admin() then
    raise exception '権限がありません' using errcode = 'P0001', hint = 'FORBIDDEN';
  end if;
  if public.is_month_closed(cid, p_month) then
    raise exception '既に締め済みです（%）', to_char(p_month, 'YYYY-MM') using errcode = 'P0001', hint = 'ALREADY_CLOSED';
  end if;
  -- 消費税の設定（会社の税率・端数処理、ドライバーの課税区分）を固定する
  perform set_config('app.skip_audit', 'on', true);
  update public.driver_months dm
     set tax_rate = c.tax_rate, tax_rounding = c.tax_rounding, tax_mode = d.tax_mode
    from public.companies c, public.drivers d
   where dm.company_id = cid and dm.month = p_month and c.id = cid and d.id = dm.driver_id;
  perform set_config('app.skip_audit', 'off', true);

  snap := public.month_snapshot(p_month);
  insert into public.month_closings (company_id, month, status, closed_at, closed_by, snapshot, note)
  values (cid, p_month, 'closed', now(), auth.uid(), snap, coalesce(p_note, ''))
  on conflict (company_id, month) do update
    set status = 'closed', closed_at = now(), closed_by = auth.uid(), snapshot = excluded.snapshot,
        note = excluded.note, reopened_at = null, reopened_by = null;
  perform set_config('app.audit_internal', 'on', true);
  perform public.write_audit(cid, 'close_month', 'month_closings', to_char(p_month, 'YYYY-MM'), null, jsonb_build_object('note', p_note, 'summary', snap->'summary'));
  perform set_config('app.audit_internal', 'off', true);
  return snap;
end $$;

-- ---------- 締め解除：固定した消費税の設定を外し、現在の設定に従わせる ----------
create or replace function public.reopen_month(p_month date)
returns void language plpgsql security definer set search_path = public as $$
declare cid uuid := public.current_company_id();
begin
  if not public.is_owner() then
    raise exception '締めの解除はオーナーのみ可能です' using errcode = 'P0001', hint = 'OWNER_ONLY';
  end if;
  if not public.is_month_closed(cid, p_month) then
    raise exception 'この月は締められていません（%）', to_char(p_month, 'YYYY-MM') using errcode = 'P0001';
  end if;
  update public.month_closings set status = 'open', reopened_at = now(), reopened_by = auth.uid()
   where company_id = cid and month = p_month;
  perform set_config('app.skip_audit', 'on', true);
  update public.driver_months set tax_rate = null, tax_rounding = null, tax_mode = null
   where company_id = cid and month = p_month;
  perform set_config('app.skip_audit', 'off', true);
  perform set_config('app.audit_internal', 'on', true);
  perform public.write_audit(cid, 'reopen_month', 'month_closings', to_char(p_month, 'YYYY-MM'), null, null);
  perform set_config('app.audit_internal', 'off', true);
end $$;

-- ---------- ドライバーポータル：税込のお支払額 ----------
drop function if exists public.driver_portal_months();
create or replace function public.driver_portal_months()
returns table (month date, status public.month_status, payout numeric, pay numeric, royalty numeric, mgmt_fee numeric, adj_pay numeric, closed_at timestamptz, tax numeric, payout_incl numeric)
language sql stable security definer set search_path = public as $$
  select s.month,
         case when mc.status = 'closed' then 'closed'::public.month_status else 'open'::public.month_status end as status,
         case when mc.status = 'closed' then s.payout end as payout,
         case when mc.status = 'closed' then s.pay end as pay,
         case when mc.status = 'closed' then s.royalty end as royalty,
         case when mc.status = 'closed' then s.mgmt_fee end as mgmt_fee,
         case when mc.status = 'closed' then s.adj_pay end as adj_pay,
         case when mc.status = 'closed' then mc.closed_at end as closed_at,
         case when mc.status = 'closed' then s.tax end as tax,
         case when mc.status = 'closed' then s.payout_incl end as payout_incl
    from public.v_driver_month_summary s
    left join public.month_closings mc on mc.company_id = s.company_id and mc.month = s.month
   where s.driver_id = public.current_driver_id()
     and s.company_id = public.current_company_id()
     and (mc.status = 'closed' or s.entry_count > 0)
   order by s.month desc;
$$;
revoke execute on function public.driver_portal_months() from anon, public;
grant execute on function public.driver_portal_months() to authenticated, service_role;

create or replace function public.driver_portal_statement(p_month date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  did uuid := public.current_driver_id();
  cid uuid := public.current_company_id();
  show_royalty boolean;
begin
  if did is null or cid is null then
    return null;
  end if;
  if not public.is_month_closed(cid, p_month) then
    return jsonb_build_object('month', to_char(p_month, 'YYYY-MM'), 'status', 'open');
  end if;
  select driver_portal_show_royalty into show_royalty from public.companies where id = cid;
  return jsonb_build_object(
    'month', to_char(p_month, 'YYYY-MM'),
    'status', 'closed',
    'driver', (select jsonb_build_object('id', d.id, 'name', d.name, 'invoice_reg_no', d.invoice_reg_no, 'tax_mode', d.tax_mode,
                  'payout_month_offset', d.payout_month_offset, 'payout_day', d.payout_day) from public.drivers d where d.id = did),
    'company', (select jsonb_build_object('name', c.name, 'address', c.address, 'tel', c.tel, 'invoice_reg_no', c.invoice_reg_no,
                  'statement_note', c.statement_note, 'payout_month_offset', c.payout_month_offset, 'payout_day', c.payout_day,
                  'show_royalty', c.driver_portal_show_royalty, 'has_logo', c.logo_path is not null, 'has_seal', c.seal_path is not null)
                from public.companies c where c.id = cid),
    'entries', (select coalesce(jsonb_agg(jsonb_build_object(
                  'id', e.id, 'project_name', e.project_name, 'item_name', e.item_name, 'unit', e.unit,
                  'qty', e.qty, 'pay_rate', e.pay_rate, 'pay', e.pay,
                  'royalty', e.royalty, 'royalty_rate', case when show_royalty then e.royalty_rate else null end, 'memo', e.memo)
                  order by e.created_at), '[]'::jsonb)
                from public.v_work_entry_calc e where e.driver_id = did and e.company_id = cid and e.month = p_month),
    'summary', (select jsonb_build_object('pay', s.pay, 'royalty', s.royalty, 'mgmt_fee', s.mgmt_fee, 'adj_pay', s.adj_pay, 'payout', s.payout,
                  'royalty_visible', show_royalty,
                  'tax_mode', s.tax_mode, 'tax_rate', s.tax_rate, 'tax_rounding', s.tax_rounding, 'tax_base', s.tax_base, 'tax', s.tax, 'payout_incl', s.payout_incl)
                from public.v_driver_month_summary s where s.driver_id = did and s.company_id = cid and s.month = p_month),
    'adjustments', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'label', a.label, 'amount', a.amount) order by a.sort_order, a.created_at), '[]'::jsonb)
                from public.adjustments a join public.driver_months dm on dm.id = a.driver_month_id
               where dm.driver_id = did and dm.company_id = cid and dm.month = p_month),
    'closed_at', (select mc.closed_at from public.month_closings mc where mc.company_id = cid and mc.month = p_month)
  );
end $$;

-- ---------- Storage：会社のロゴ・認印（非公開バケット。書き込みはサーバーのサービスロールのみ） ----------
insert into storage.buckets (id, name, public)
values ('company-assets', 'company-assets', false)
on conflict (id) do nothing;

drop policy if exists company_assets_select on storage.objects;
create policy company_assets_select on storage.objects for select to authenticated
  using (bucket_id = 'company-assets' and (storage.foldername(name))[1] = public.current_company_id()::text);

-- ---------- 権限 ----------
revoke execute on function public.round_by_mode(numeric, public.rounding_mode) from anon;
grant execute on function public.round_by_mode(numeric, public.rounding_mode) to authenticated, service_role;

-- <<<<<<<<<<<<<<<<<<<<<<<<<<<<<< 0008_tax_assets_payout.sql <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<

-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 0009_expenses_invoices.sql >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- =============================================================================
-- 0009 経費（会社の固定費・変動費）／取引先と請求書／月次目標
--   - 経費を登録して「会社利益 − 経費 ＝ 営業利益」を出す（v_month_pl）
--   - 取引先マスタと月次請求書（インボイス対応。ロゴ・認印つき PDF）と入金管理
--   - 月次目標（売上・営業利益）とダッシュボードの進捗
--   - ドライバーポータルの当月速報（未締め月の暫定額）
-- =============================================================================

-- ---------- 型 ----------
do $$ begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace where n.nspname = 'public' and t.typname = 'expense_kind') then
    create type public.expense_kind as enum ('fixed', 'variable');
  end if;
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace where n.nspname = 'public' and t.typname = 'invoice_status') then
    create type public.invoice_status as enum ('draft', 'issued', 'paid');
  end if;
end $$;

-- ---------- 会社設定：ポータルの当月速報 ----------
alter table public.companies
  add column if not exists driver_portal_show_open_month boolean not null default true;
comment on column public.companies.driver_portal_show_open_month is 'ドライバーポータルに未締め月の暫定額（速報）を表示する';

-- ---------- 取引先 ----------
create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null check (length(name) between 1 and 100),
  honorific text not null default '御中' check (length(honorific) <= 10),
  address text not null default '',
  tel text not null default '',
  invoice_reg_no text not null default '',
  payment_month_offset integer not null default 1 check (payment_month_offset between 0 and 3),
  payment_day integer not null default 0 check (payment_day between 0 and 31),
  memo text not null default '',
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, name)
);
create index if not exists clients_company_idx on public.clients (company_id, sort_order, name);
comment on column public.clients.payment_month_offset is '入金予定日の月（0=当月、1=翌月…）';
comment on column public.clients.payment_day is '入金予定日の日（0 = 末日）';

-- 案件に取引先を紐づける（client_name は表示用に同期する）
alter table public.projects add column if not exists client_id uuid references public.clients(id) on delete set null;
create index if not exists projects_client_idx on public.projects (client_id);

-- ---------- 経費カテゴリ ----------
create table if not exists public.expense_categories (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null check (length(name) between 1 and 50),
  kind public.expense_kind not null default 'variable',
  memo text not null default '',
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, name)
);
create index if not exists expense_categories_company_idx on public.expense_categories (company_id, sort_order, name);

-- ---------- 毎月かかる経費（固定費テンプレ） ----------
create table if not exists public.recurring_expenses (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  category_id uuid not null references public.expense_categories(id) on delete restrict,
  label text not null check (length(label) between 1 and 100),
  amount numeric(12,2) not null,
  tax_mode public.tax_mode not null default 'taxable',
  driver_id uuid references public.drivers(id) on delete set null,
  project_id uuid references public.projects(id) on delete set null,
  vendor text not null default '',
  start_month date check (start_month is null or extract(day from start_month) = 1),
  end_month date check (end_month is null or extract(day from end_month) = 1),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists recurring_expenses_company_idx on public.recurring_expenses (company_id, sort_order);

-- ---------- 経費（金額はすべて税抜） ----------
create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  month date not null check (extract(day from month) = 1),
  category_id uuid not null references public.expense_categories(id) on delete restrict,
  label text not null check (length(label) between 1 and 100),
  amount numeric(12,2) not null,
  tax_mode public.tax_mode not null default 'taxable',
  incurred_on date,
  driver_id uuid references public.drivers(id) on delete set null,
  project_id uuid references public.projects(id) on delete set null,
  vendor text not null default '',
  memo text not null default '',
  recurring_id uuid references public.recurring_expenses(id) on delete set null,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists expenses_company_month_idx on public.expenses (company_id, month);
create index if not exists expenses_category_idx on public.expenses (category_id, month);
create index if not exists expenses_recurring_idx on public.expenses (recurring_id, month);
comment on column public.expenses.amount is '税抜の金額（マイナスも可）。消費税は集計では扱わない';

-- ---------- 請求書 ----------
create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete restrict,
  month date not null check (extract(day from month) = 1),
  invoice_no text not null check (length(invoice_no) between 1 and 50),
  status public.invoice_status not null default 'draft',
  issue_date date not null default current_date,
  due_date date,
  subtotal numeric(12,2) not null default 0,
  tax_rate numeric(6,4) not null default 0.10 check (tax_rate >= 0 and tax_rate <= 1),
  tax_rounding public.rounding_mode not null default 'floor',
  tax numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  paid_on date,
  note text not null default '',
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, invoice_no),
  unique (company_id, client_id, month)
);
create index if not exists invoices_company_month_idx on public.invoices (company_id, month desc);
create index if not exists invoices_client_idx on public.invoices (client_id, month desc);

create table if not exists public.invoice_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  project_item_id uuid references public.project_items(id) on delete set null,
  name text not null check (length(name) between 1 and 200),
  unit public.item_unit,
  qty numeric(12,2) not null default 0,
  unit_price numeric(12,2) not null default 0,
  amount numeric(12,2) not null default 0,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists invoice_items_invoice_idx on public.invoice_items (invoice_id, sort_order);
create index if not exists invoice_items_company_idx on public.invoice_items (company_id);

-- ---------- 月次目標 ----------
create table if not exists public.month_targets (
  company_id uuid not null references public.companies(id) on delete cascade,
  month date not null check (extract(day from month) = 1),
  bill_target numeric(12,2) not null default 0 check (bill_target >= 0),
  profit_target numeric(12,2) not null default 0 check (profit_target >= 0),
  memo text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (company_id, month)
);

-- =============================================================================
-- トリガー
-- =============================================================================

-- updated_at
do $$
declare t text;
begin
  foreach t in array array['clients','expense_categories','recurring_expenses','expenses','invoices','invoice_items','month_targets']
  loop
    execute format('drop trigger if exists t00_set_updated_at on public.%I', t);
    execute format('create trigger t00_set_updated_at before update on public.%I for each row execute function public.set_updated_at()', t);
  end loop;
end $$;

-- 子テーブルの company_id の補完・検証（0001 の fill_company_id に 0009 のテーブルを追加）
create or replace function public.fill_company_id()
returns trigger language plpgsql as $$
declare
  parent_company uuid;
  other_company uuid;
begin
  if tg_table_name = 'project_items' then
    select company_id into parent_company from public.projects where id = new.project_id;
  elsif tg_table_name in ('driver_pay_overrides', 'driver_recurring_adjustments', 'driver_months', 'work_entries') then
    select company_id into parent_company from public.drivers where id = new.driver_id;
  elsif tg_table_name = 'adjustments' then
    select company_id into parent_company from public.driver_months where id = new.driver_month_id;
  elsif tg_table_name in ('expenses', 'recurring_expenses') then
    select company_id into parent_company from public.expense_categories where id = new.category_id;
  elsif tg_table_name = 'invoices' then
    select company_id into parent_company from public.clients where id = new.client_id;
  elsif tg_table_name = 'invoice_items' then
    select company_id into parent_company from public.invoices where id = new.invoice_id;
  end if;

  if parent_company is null then
    raise exception '親レコードが見つかりません（%）', tg_table_name using errcode = 'foreign_key_violation';
  end if;
  if new.company_id is null then
    new.company_id := parent_company;
  elsif new.company_id <> parent_company then
    raise exception '会社が一致しません（%）', tg_table_name using errcode = 'check_violation';
  end if;

  -- 稼働行・個別単価は案件内容の会社とも一致させる
  if tg_table_name in ('work_entries', 'driver_pay_overrides') then
    select company_id into other_company from public.project_items where id = new.project_item_id;
    if other_company is null or other_company <> new.company_id then
      raise exception '案件内容の会社が一致しません' using errcode = 'check_violation';
    end if;
  end if;
  if tg_table_name = 'adjustments' then
    if new.recurring_id is not null then
      select company_id into other_company from public.driver_recurring_adjustments where id = new.recurring_id;
      if other_company is not null and other_company <> new.company_id then
        raise exception '固定控除の会社が一致しません' using errcode = 'check_violation';
      end if;
    end if;
  end if;
  -- 経費・請求書の任意の関連（ドライバー・案件）も同じ会社であること
  if tg_table_name in ('expenses', 'recurring_expenses', 'invoice_items') then
    if new.project_id is not null then
      select company_id into other_company from public.projects where id = new.project_id;
      if other_company is null or other_company <> new.company_id then
        raise exception '案件の会社が一致しません' using errcode = 'check_violation';
      end if;
    end if;
  end if;
  if tg_table_name in ('expenses', 'recurring_expenses') then
    if new.driver_id is not null then
      select company_id into other_company from public.drivers where id = new.driver_id;
      if other_company is null or other_company <> new.company_id then
        raise exception 'ドライバーの会社が一致しません' using errcode = 'check_violation';
      end if;
    end if;
  end if;
  if tg_table_name = 'invoice_items' then
    if new.project_item_id is not null then
      select company_id into other_company from public.project_items where id = new.project_item_id;
      if other_company is null or other_company <> new.company_id then
        raise exception '案件内容の会社が一致しません' using errcode = 'check_violation';
      end if;
    end if;
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['expenses','recurring_expenses','invoices','invoice_items']
  loop
    execute format('drop trigger if exists t01_fill_company_id on public.%I', t);
    execute format('create trigger t01_fill_company_id before insert or update on public.%I for each row execute function public.fill_company_id()', t);
  end loop;
end $$;

-- 締め済み月の経費は変更できない（0002 の guard_month_closed を経費にも付ける）
drop trigger if exists t05_guard_month_closed on public.expenses;
create trigger t05_guard_month_closed before insert or update or delete on public.expenses
  for each row execute function public.guard_month_closed();

-- 経費の作成者・更新者
drop trigger if exists t03_set_entry_actor on public.expenses;
create trigger t03_set_entry_actor before insert or update on public.expenses
  for each row execute function public.set_entry_actor();

-- 案件と取引先の同期：client_id があれば client_name を合わせ、client_name だけなら取引先を作る
create or replace function public.sync_project_client()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  cname text;
  cid uuid;
begin
  if new.client_id is not null then
    select name into cname from public.clients where id = new.client_id and company_id = new.company_id;
    if cname is null then
      raise exception '取引先が見つかりません' using errcode = 'check_violation';
    end if;
    new.client_name := cname;
  elsif coalesce(new.client_name, '') <> '' then
    select id into cid from public.clients where company_id = new.company_id and name = new.client_name;
    if cid is null then
      insert into public.clients (company_id, name, sort_order)
      values (new.company_id, new.client_name, coalesce((select max(sort_order) + 1 from public.clients where company_id = new.company_id), 1))
      returning id into cid;
    end if;
    new.client_id := cid;
  end if;
  return new;
end $$;
drop trigger if exists t04_sync_project_client on public.projects;
create trigger t04_sync_project_client before insert or update on public.projects
  for each row execute function public.sync_project_client();

-- 取引先の名称変更を案件の表示名に反映
create or replace function public.sync_client_name_to_projects()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.name is distinct from old.name then
    update public.projects set client_name = new.name where client_id = new.id;
  end if;
  return new;
end $$;
drop trigger if exists t04_sync_client_name on public.clients;
create trigger t04_sync_client_name after update on public.clients
  for each row execute function public.sync_client_name_to_projects();

-- 請求明細の金額（数量 × 単価）と請求書の合計・消費税
create or replace function public.set_invoice_item_amount()
returns trigger language plpgsql as $$
begin
  new.amount := (new.qty * new.unit_price)::numeric(12,2);
  return new;
end $$;
drop trigger if exists t06_invoice_item_amount on public.invoice_items;
create trigger t06_invoice_item_amount before insert or update on public.invoice_items
  for each row execute function public.set_invoice_item_amount();

create or replace function public.recalc_invoice_totals()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  inv_id uuid;
  s numeric;
  rt numeric;
  md public.rounding_mode;
  tx numeric;
begin
  if coalesce(current_setting('app.invoice_recalc', true), 'off') = 'on' then
    return coalesce(new, old);
  end if;
  if tg_table_name = 'invoice_items' then
    inv_id := coalesce(new.invoice_id, old.invoice_id);
  else
    inv_id := coalesce(new.id, old.id);
  end if;
  select tax_rate, tax_rounding into rt, md from public.invoices where id = inv_id;
  if rt is null then
    return coalesce(new, old);
  end if;
  select coalesce(sum(amount), 0) into s from public.invoice_items where invoice_id = inv_id;
  tx := public.round_by_mode(s * rt, md);
  perform set_config('app.invoice_recalc', 'on', true);
  update public.invoices set subtotal = s, tax = tx, total = s + tx where id = inv_id;
  perform set_config('app.invoice_recalc', 'off', true);
  return coalesce(new, old);
end $$;
drop trigger if exists t07_recalc_invoice on public.invoice_items;
create trigger t07_recalc_invoice after insert or update or delete on public.invoice_items
  for each row execute function public.recalc_invoice_totals();
drop trigger if exists t07_recalc_invoice on public.invoices;
create trigger t07_recalc_invoice after update of tax_rate, tax_rounding on public.invoices
  for each row execute function public.recalc_invoice_totals();

-- 監査ログ
do $$
declare t text;
begin
  foreach t in array array['clients','expense_categories','recurring_expenses','expenses','invoices','invoice_items','month_targets']
  loop
    execute format('drop trigger if exists t90_audit on public.%I', t);
    execute format('create trigger t90_audit after insert or update or delete on public.%I for each row execute function public.audit_row_change()', t);
  end loop;
end $$;

-- 監査ログの record_id（month_targets は主キーが (company_id, month)）
create or replace function public.audit_row_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  b jsonb; a jsonb; rid text; cid uuid;
begin
  if coalesce(current_setting('app.skip_audit', true), 'off') = 'on' then
    return coalesce(new, old);
  end if;
  if tg_op in ('UPDATE', 'DELETE') then b := to_jsonb(old); end if;
  if tg_op in ('INSERT', 'UPDATE') then a := to_jsonb(new); end if;
  -- 秘匿列を除外
  if tg_table_name = 'invitations' then
    b := b - 'token'; a := a - 'token';
  end if;
  if tg_table_name = 'month_closings' then
    b := b - 'snapshot'; a := a - 'snapshot';
  end if;
  if tg_op = 'UPDATE' and (b - 'updated_at') = (a - 'updated_at') then
    return new;
  end if;
  if tg_table_name = 'companies' then
    cid := coalesce((a->>'id')::uuid, (b->>'id')::uuid);
  else
    cid := coalesce((a->>'company_id')::uuid, (b->>'company_id')::uuid);
  end if;
  rid := case tg_table_name
    when 'driver_pay_overrides' then coalesce(a->>'driver_id', b->>'driver_id') || ':' || coalesce(a->>'project_item_id', b->>'project_item_id')
    when 'month_closings' then coalesce(a->>'month', b->>'month')
    when 'month_targets' then coalesce(a->>'month', b->>'month')
    else coalesce(a->>'id', b->>'id')
  end;
  perform set_config('app.audit_internal', 'on', true);
  perform public.write_audit(cid, tg_op, tg_table_name, rid, b, a);
  perform set_config('app.audit_internal', 'off', true);
  return coalesce(new, old);
end $$;

-- =============================================================================
-- RLS：閲覧はスタッフ、書き込みは admin 以上（ドライバーロールからは見えない）
-- =============================================================================
alter table public.clients enable row level security;
alter table public.expense_categories enable row level security;
alter table public.recurring_expenses enable row level security;
alter table public.expenses enable row level security;
alter table public.invoices enable row level security;
alter table public.invoice_items enable row level security;
alter table public.month_targets enable row level security;

do $$
declare t text;
begin
  foreach t in array array['clients','expense_categories','recurring_expenses','expenses','invoices','invoice_items','month_targets']
  loop
    execute format('drop policy if exists %I_select on public.%I', t, t);
    execute format('create policy %I_select on public.%I for select to authenticated using (company_id = public.current_company_id() and public.is_staff())', t, t);
    execute format('drop policy if exists %I_write on public.%I', t, t);
    execute format('create policy %I_write on public.%I for all to authenticated using (company_id = public.current_company_id() and public.is_admin()) with check (company_id = public.current_company_id() and public.is_admin())', t, t);
  end loop;
end $$;

-- =============================================================================
-- ビュー（security_invoker：呼び出し元の RLS が適用される）
-- =============================================================================

-- 経費の一覧（カテゴリ・ドライバー・案件の名称つき）
create or replace view public.v_expense_list
with (security_invoker = true) as
select
  e.id,
  e.company_id,
  e.month,
  e.category_id,
  c.name as category_name,
  c.kind,
  c.sort_order as category_sort_order,
  e.label,
  e.amount,
  e.tax_mode,
  e.incurred_on,
  e.driver_id,
  d.name as driver_name,
  e.project_id,
  p.name as project_name,
  e.vendor,
  e.memo,
  e.recurring_id,
  e.created_at,
  e.updated_at,
  public.is_month_closed(e.company_id, e.month) as is_closed
from public.expenses e
join public.expense_categories c on c.id = e.category_id
left join public.drivers d on d.id = e.driver_id
left join public.projects p on p.id = e.project_id;

-- 経費 × 月 × カテゴリ
create or replace view public.v_expense_summary
with (security_invoker = true) as
select
  e.company_id,
  e.month,
  e.category_id,
  c.name as category_name,
  c.kind,
  c.sort_order as category_sort_order,
  count(*)::integer as expense_count,
  coalesce(sum(e.amount), 0)::numeric as amount,
  coalesce(sum(case when e.tax_mode = 'taxable' then e.amount else 0 end), 0)::numeric as taxable_amount
from public.expenses e
join public.expense_categories c on c.id = e.category_id
group by e.company_id, e.month, e.category_id, c.name, c.kind, c.sort_order;

-- 毎月かかる経費（カテゴリ名つき）
create or replace view public.v_recurring_expense_list
with (security_invoker = true) as
select
  r.id,
  r.company_id,
  r.category_id,
  c.name as category_name,
  c.kind,
  r.label,
  r.amount,
  r.tax_mode,
  r.driver_id,
  d.name as driver_name,
  r.project_id,
  p.name as project_name,
  r.vendor,
  r.start_month,
  r.end_month,
  r.is_active,
  r.sort_order,
  r.created_at,
  r.updated_at
from public.recurring_expenses r
join public.expense_categories c on c.id = r.category_id
left join public.drivers d on d.id = r.driver_id
left join public.projects p on p.id = r.project_id;

-- 会社 × 月 の損益（会社利益 − 経費 ＝ 営業利益）と目標
create or replace view public.v_month_pl
with (security_invoker = true) as
with months as (
  select company_id, month from public.v_month_summary
  union
  select company_id, month from public.expenses
  union
  select company_id, month from public.month_targets
),
exp as (
  select company_id, month,
         coalesce(sum(amount), 0)::numeric as expense_total,
         coalesce(sum(amount) filter (where kind = 'fixed'), 0)::numeric as expense_fixed,
         coalesce(sum(amount) filter (where kind = 'variable'), 0)::numeric as expense_variable,
         coalesce(sum(expense_count), 0)::integer as expense_count
    from public.v_expense_summary
   group by company_id, month
)
select
  m.company_id,
  m.month,
  coalesce(s.driver_count, 0) as driver_count,
  coalesce(s.active_driver_count, 0) as active_driver_count,
  coalesce(s.entry_count, 0) as entry_count,
  coalesce(s.bill, 0) as bill,
  coalesce(s.pay, 0) as pay,
  coalesce(s.margin, 0) as margin,
  coalesce(s.royalty, 0) as royalty,
  coalesce(s.mgmt_fee, 0) as mgmt_fee,
  coalesce(s.adj_pay, 0) as adj_pay,
  coalesce(s.adj_profit, 0) as adj_profit,
  coalesce(s.payout, 0) as payout,
  coalesce(s.tax, 0) as tax,
  coalesce(s.payout_incl, 0) as payout_incl,
  coalesce(s.profit, 0) as profit,
  coalesce(e.expense_total, 0) as expense_total,
  coalesce(e.expense_fixed, 0) as expense_fixed,
  coalesce(e.expense_variable, 0) as expense_variable,
  coalesce(e.expense_count, 0) as expense_count,
  (coalesce(s.profit, 0) - coalesce(e.expense_total, 0)) as operating_profit,
  case when coalesce(s.bill, 0) <> 0
       then round((coalesce(s.profit, 0) - coalesce(e.expense_total, 0)) / s.bill, 6)
       else 0 end as operating_margin,
  coalesce(t.bill_target, 0) as bill_target,
  coalesce(t.profit_target, 0) as profit_target,
  coalesce(t.memo, '') as target_memo,
  coalesce(s.status, 'open'::public.month_status) as status
from months m
left join public.v_month_summary s on s.company_id = m.company_id and s.month = m.month
left join exp e on e.company_id = m.company_id and e.month = m.month
left join public.month_targets t on t.company_id = m.company_id and t.month = m.month;

-- 取引先 × 月（請求のもとになる売上。取引先を設定した案件のみ）
create or replace view public.v_client_month_summary
with (security_invoker = true) as
select
  w.company_id,
  w.month,
  p.client_id,
  cl.name as client_name,
  cl.sort_order as client_sort_order,
  count(distinct w.project_id)::integer as project_count,
  count(*)::integer as entry_count,
  coalesce(sum(w.qty), 0)::numeric as qty_total,
  coalesce(sum(w.bill), 0)::numeric as bill
from public.v_work_entry_calc w
join public.projects p on p.id = w.project_id
join public.clients cl on cl.id = p.client_id
group by w.company_id, w.month, p.client_id, cl.name, cl.sort_order;

-- 請求書の一覧（取引先名・明細数つき）
create or replace view public.v_invoice_list
with (security_invoker = true) as
select
  i.id,
  i.company_id,
  i.client_id,
  cl.name as client_name,
  cl.sort_order as client_sort_order,
  i.month,
  i.invoice_no,
  i.status,
  i.issue_date,
  i.due_date,
  i.subtotal,
  i.tax_rate,
  i.tax_rounding,
  i.tax,
  i.total,
  i.paid_on,
  i.note,
  i.created_at,
  i.updated_at,
  (select count(*) from public.invoice_items it where it.invoice_id = i.id)::integer as item_count
from public.invoices i
join public.clients cl on cl.id = i.client_id;

-- =============================================================================
-- 関数・RPC
-- =============================================================================

-- 稼動月からの支払日・入金日（0 = 末日。月末を超える日は月末に丸める）
create or replace function public.month_day_date(p_month date, p_offset integer, p_day integer)
returns date language sql immutable as $$
  select case
    when coalesce(p_day, 0) = 0 then (date_trunc('month', p_month + make_interval(months => coalesce(p_offset, 0))) + interval '1 month - 1 day')::date
    else least(
      (date_trunc('month', p_month + make_interval(months => coalesce(p_offset, 0))) + make_interval(days => p_day - 1))::date,
      (date_trunc('month', p_month + make_interval(months => coalesce(p_offset, 0))) + interval '1 month - 1 day')::date
    )
  end;
$$;

-- 毎月かかる経費をその月に計上（admin+。未締め月のみ。同じテンプレの二重計上はしない）
create or replace function public.apply_recurring_expenses(p_month date)
returns integer language plpgsql security definer set search_path = public as $$
declare
  cid uuid := public.current_company_id();
  n integer;
begin
  if not public.is_admin() then
    raise exception '権限がありません' using errcode = 'P0001', hint = 'FORBIDDEN';
  end if;
  if public.is_month_closed(cid, p_month) then
    raise exception '締め済みの月（%）は変更できません', to_char(p_month, 'YYYY-MM') using errcode = 'P0001', hint = 'MONTH_CLOSED';
  end if;
  insert into public.expenses (company_id, month, category_id, label, amount, tax_mode, driver_id, project_id, vendor, memo, recurring_id)
  select cid, p_month, r.category_id, r.label, r.amount, r.tax_mode, r.driver_id, r.project_id, r.vendor, '', r.id
    from public.recurring_expenses r
   where r.company_id = cid
     and r.is_active
     and (r.start_month is null or r.start_month <= p_month)
     and (r.end_month is null or r.end_month >= p_month)
     and not exists (
       select 1 from public.expenses e
        where e.company_id = cid and e.month = p_month and e.recurring_id = r.id
     );
  get diagnostics n = row_count;
  return n;
end $$;

-- 請求書の作成・作り直し（admin+）。その月・その取引先の稼働から明細を作る
create or replace function public.build_invoice(p_client_id uuid, p_month date)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  cid uuid := public.current_company_id();
  inv_id uuid;
  inv_status public.invoice_status;
  v_no text;
  seq integer := 1;
  cl public.clients;
  co public.companies;
begin
  if not public.is_admin() then
    raise exception '権限がありません' using errcode = 'P0001', hint = 'FORBIDDEN';
  end if;
  select * into cl from public.clients where id = p_client_id and company_id = cid;
  if cl.id is null then
    raise exception '取引先が見つかりません' using errcode = 'P0001';
  end if;
  select * into co from public.companies where id = cid;

  select id, status into inv_id, inv_status from public.invoices where company_id = cid and client_id = p_client_id and month = p_month;
  if inv_id is not null and inv_status <> 'draft' then
    raise exception '発行済みの請求書は作り直せません（%）', to_char(p_month, 'YYYY-MM') using errcode = 'P0001', hint = 'INVOICE_ISSUED';
  end if;

  if inv_id is null then
    loop
      v_no := to_char(p_month, 'YYYYMM') || '-' || lpad(seq::text, 2, '0');
      exit when not exists (select 1 from public.invoices where company_id = cid and invoice_no = v_no);
      seq := seq + 1;
    end loop;
    insert into public.invoices (company_id, client_id, month, invoice_no, status, issue_date, due_date, tax_rate, tax_rounding, created_by)
    values (cid, p_client_id, p_month, v_no, 'draft',
            public.month_day_date(p_month, 0, 0),
            public.month_day_date(p_month, cl.payment_month_offset, cl.payment_day),
            co.tax_rate, co.tax_rounding, auth.uid())
    returning id into inv_id;
  else
    update public.invoices
       set tax_rate = co.tax_rate,
           tax_rounding = co.tax_rounding,
           due_date = public.month_day_date(p_month, cl.payment_month_offset, cl.payment_day)
     where id = inv_id;
  end if;

  delete from public.invoice_items where invoice_id = inv_id;

  insert into public.invoice_items (company_id, invoice_id, project_id, project_item_id, name, unit, qty, unit_price, sort_order)
  select cid, inv_id, g.project_id, g.project_item_id,
         g.project_name || case when g.item_name = '標準' then '' else '（' || g.item_name || '）' end,
         g.unit, g.qty, g.bill_rate,
         (row_number() over (order by g.project_sort_order, g.item_sort_order, g.bill_rate))::integer
    from (
      select w.project_id, w.project_item_id, w.project_name, w.item_name, w.unit, w.bill_rate,
             sum(w.qty) as qty, p.sort_order as project_sort_order, pi.sort_order as item_sort_order
        from public.v_work_entry_calc w
        join public.projects p on p.id = w.project_id
        join public.project_items pi on pi.id = w.project_item_id
       where w.company_id = cid and w.month = p_month and p.client_id = p_client_id and w.qty > 0
       group by w.project_id, w.project_item_id, w.project_name, w.item_name, w.unit, w.bill_rate, p.sort_order, pi.sort_order
    ) g;

  -- 明細が 1 件も無い場合も合計を 0 に更新する
  perform public.recalc_invoice(inv_id);
  return inv_id;
end $$;

-- 請求書の合計を計算し直す（トリガーと同じ計算）
create or replace function public.recalc_invoice(p_invoice_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare s numeric; rt numeric; md public.rounding_mode; tx numeric;
begin
  select tax_rate, tax_rounding into rt, md from public.invoices where id = p_invoice_id;
  if rt is null then return; end if;
  select coalesce(sum(amount), 0) into s from public.invoice_items where invoice_id = p_invoice_id;
  tx := public.round_by_mode(s * rt, md);
  perform set_config('app.invoice_recalc', 'on', true);
  update public.invoices set subtotal = s, tax = tx, total = s + tx where id = p_invoice_id;
  perform set_config('app.invoice_recalc', 'off', true);
end $$;

-- 請求書の状態変更（admin+）
create or replace function public.set_invoice_status(p_invoice_id uuid, p_status public.invoice_status, p_paid_on date default null)
returns void language plpgsql security definer set search_path = public as $$
declare cid uuid := public.current_company_id();
begin
  if not public.is_admin() then
    raise exception '権限がありません' using errcode = 'P0001', hint = 'FORBIDDEN';
  end if;
  if not exists (select 1 from public.invoices where id = p_invoice_id and company_id = cid) then
    raise exception '請求書が見つかりません' using errcode = 'P0001';
  end if;
  update public.invoices
     set status = p_status,
         paid_on = case when p_status = 'paid' then coalesce(p_paid_on, current_date) else null end,
         issue_date = case when p_status = 'draft' then issue_date else coalesce(issue_date, current_date) end
   where id = p_invoice_id and company_id = cid;
end $$;

-- ドライバーポータル：未締め月の暫定額（速報）。会社設定が off なら null
create or replace function public.driver_portal_current()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  did uuid := public.current_driver_id();
  cid uuid := public.current_company_id();
  show_open boolean;
  s record;
  d record;
  co record;
begin
  if did is null or cid is null then
    return null;
  end if;
  select driver_portal_show_open_month into show_open from public.companies where id = cid;
  if not coalesce(show_open, false) then
    return null;
  end if;
  select * into s
    from public.v_driver_month_summary v
   where v.driver_id = did and v.company_id = cid and not v.is_closed and v.entry_count > 0
   order by v.month desc
   limit 1;
  if s.month is null then
    return null;
  end if;
  select * into d from public.drivers where id = did;
  select * into co from public.companies where id = cid;
  return jsonb_build_object(
    'month', to_char(s.month, 'YYYY-MM'),
    'status', 'open',
    'entry_count', s.entry_count,
    'pay', s.pay,
    'royalty', s.royalty,
    'mgmt_fee', s.mgmt_fee,
    'adj_pay', s.adj_pay,
    'payout', s.payout,
    'tax', s.tax,
    'payout_incl', s.payout_incl,
    'payout_date', to_char(public.month_day_date(s.month,
        coalesce(d.payout_month_offset, co.payout_month_offset), coalesce(d.payout_day, co.payout_day)), 'YYYY-MM-DD'),
    'updated_at', (select max(w.updated_at) from public.work_entries w where w.driver_id = did and w.company_id = cid and w.month = s.month)
  );
end $$;

-- ---------- 権限 ----------
revoke execute on function public.month_day_date(date, integer, integer) from anon;
grant execute on function public.month_day_date(date, integer, integer) to authenticated, service_role;
revoke execute on function public.apply_recurring_expenses(date) from anon, public;
grant execute on function public.apply_recurring_expenses(date) to authenticated, service_role;
revoke execute on function public.build_invoice(uuid, date) from anon, public;
grant execute on function public.build_invoice(uuid, date) to authenticated, service_role;
revoke execute on function public.recalc_invoice(uuid) from anon, public;
grant execute on function public.recalc_invoice(uuid) to authenticated, service_role;
revoke execute on function public.set_invoice_status(uuid, public.invoice_status, date) from anon, public;
grant execute on function public.set_invoice_status(uuid, public.invoice_status, date) to authenticated, service_role;
revoke execute on function public.driver_portal_current() from anon, public;
grant execute on function public.driver_portal_current() to authenticated, service_role;

-- ---------- 締め時スナップショットに経費と損益を追加 ----------
create or replace function public.month_snapshot(p_month date)
returns jsonb language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'month', to_char(p_month, 'YYYY-MM'),
    'generated_at', now(),
    'summary', (select to_jsonb(s) from public.v_month_summary s where s.company_id = public.current_company_id() and s.month = p_month),
    'drivers', (select coalesce(jsonb_agg(to_jsonb(d) order by d.driver_sort_order, d.driver_name), '[]'::jsonb)
                  from public.v_driver_month_summary d where d.company_id = public.current_company_id() and d.month = p_month),
    'entries', (select coalesce(jsonb_agg(to_jsonb(e) order by e.driver_sort_order, e.driver_name, e.created_at), '[]'::jsonb)
                  from public.v_work_entry_calc e where e.company_id = public.current_company_id() and e.month = p_month),
    'adjustments', (select coalesce(jsonb_agg(to_jsonb(a) order by a.sort_order, a.created_at), '[]'::jsonb)
                  from public.adjustments a join public.driver_months dm on dm.id = a.driver_month_id
                 where dm.company_id = public.current_company_id() and dm.month = p_month),
    'projects', (select coalesce(jsonb_agg(to_jsonb(p) order by p.project_name, p.item_name), '[]'::jsonb)
                  from public.v_project_summary p where p.company_id = public.current_company_id() and p.month = p_month),
    'expenses', (select coalesce(jsonb_agg(to_jsonb(x) order by x.category_sort_order, x.created_at), '[]'::jsonb)
                  from public.v_expense_list x where x.company_id = public.current_company_id() and x.month = p_month),
    'pl', (select to_jsonb(pl) from public.v_month_pl pl where pl.company_id = public.current_company_id() and pl.month = p_month)
  );
$$;

-- ---------- バックアップ JSON に 0009 のテーブルを追加 ----------
create or replace function public.export_backup()
returns jsonb language plpgsql security invoker set search_path = public as $$
declare cid uuid := public.current_company_id();
begin
  if not public.is_admin() then
    raise exception '権限がありません' using errcode = 'P0001', hint = 'FORBIDDEN';
  end if;
  return jsonb_build_object(
    'version', 2,
    'app', 'rootive-profit',
    'exported_at', now(),
    'company', (select to_jsonb(c) from public.companies c where c.id = cid),
    'clients', (select coalesce(jsonb_agg(to_jsonb(x) order by x.sort_order, x.name), '[]'::jsonb) from public.clients x where x.company_id = cid),
    'drivers', (select coalesce(jsonb_agg(to_jsonb(x) order by x.sort_order, x.name), '[]'::jsonb) from public.drivers x where x.company_id = cid),
    'projects', (select coalesce(jsonb_agg(to_jsonb(x) order by x.sort_order, x.name), '[]'::jsonb) from public.projects x where x.company_id = cid),
    'project_items', (select coalesce(jsonb_agg(to_jsonb(x) order by x.project_id, x.sort_order), '[]'::jsonb) from public.project_items x where x.company_id = cid),
    'driver_pay_overrides', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.driver_pay_overrides x where x.company_id = cid),
    'driver_recurring_adjustments', (select coalesce(jsonb_agg(to_jsonb(x) order by x.driver_id, x.sort_order), '[]'::jsonb) from public.driver_recurring_adjustments x where x.company_id = cid),
    'work_entries', (select coalesce(jsonb_agg(to_jsonb(x) order by x.month, x.created_at), '[]'::jsonb) from public.work_entries x where x.company_id = cid),
    'driver_months', (select coalesce(jsonb_agg(to_jsonb(x) order by x.month, x.driver_id), '[]'::jsonb) from public.driver_months x where x.company_id = cid),
    'adjustments', (select coalesce(jsonb_agg(to_jsonb(x) order by x.driver_month_id, x.sort_order), '[]'::jsonb) from public.adjustments x where x.company_id = cid),
    'month_closings', (select coalesce(jsonb_agg((to_jsonb(x) - 'snapshot') order by x.month), '[]'::jsonb) from public.month_closings x where x.company_id = cid),
    'expense_categories', (select coalesce(jsonb_agg(to_jsonb(x) order by x.sort_order, x.name), '[]'::jsonb) from public.expense_categories x where x.company_id = cid),
    'recurring_expenses', (select coalesce(jsonb_agg(to_jsonb(x) order by x.sort_order), '[]'::jsonb) from public.recurring_expenses x where x.company_id = cid),
    'expenses', (select coalesce(jsonb_agg(to_jsonb(x) order by x.month, x.created_at), '[]'::jsonb) from public.expenses x where x.company_id = cid),
    'invoices', (select coalesce(jsonb_agg(to_jsonb(x) order by x.month, x.invoice_no), '[]'::jsonb) from public.invoices x where x.company_id = cid),
    'invoice_items', (select coalesce(jsonb_agg(to_jsonb(x) order by x.invoice_id, x.sort_order), '[]'::jsonb) from public.invoice_items x where x.company_id = cid),
    'month_targets', (select coalesce(jsonb_agg(to_jsonb(x) order by x.month), '[]'::jsonb) from public.month_targets x where x.company_id = cid)
  );
end $$;

-- ---------- ID 衝突チェックに 0009 のテーブルを追加 ----------
create or replace function public.import_has_id_conflict(p_company_id uuid, p_data jsonb)
returns boolean language sql stable security definer set search_path = public as $$
  select
       exists (select 1 from jsonb_array_elements(coalesce(p_data->'drivers','[]')) x join public.drivers t on t.id = (x->>'id')::uuid where t.company_id <> p_company_id)
    or exists (select 1 from jsonb_array_elements(coalesce(p_data->'projects','[]')) x join public.projects t on t.id = (x->>'id')::uuid where t.company_id <> p_company_id)
    or exists (select 1 from jsonb_array_elements(coalesce(p_data->'project_items','[]')) x join public.project_items t on t.id = (x->>'id')::uuid where t.company_id <> p_company_id)
    or exists (select 1 from jsonb_array_elements(coalesce(p_data->'driver_recurring_adjustments','[]')) x join public.driver_recurring_adjustments t on t.id = (x->>'id')::uuid where t.company_id <> p_company_id)
    or exists (select 1 from jsonb_array_elements(coalesce(p_data->'work_entries','[]')) x join public.work_entries t on t.id = (x->>'id')::uuid where t.company_id <> p_company_id)
    or exists (select 1 from jsonb_array_elements(coalesce(p_data->'driver_months','[]')) x join public.driver_months t on t.id = (x->>'id')::uuid where t.company_id <> p_company_id)
    or exists (select 1 from jsonb_array_elements(coalesce(p_data->'adjustments','[]')) x join public.adjustments t on t.id = (x->>'id')::uuid where t.company_id <> p_company_id)
    or exists (select 1 from jsonb_array_elements(coalesce(p_data->'driver_pay_overrides','[]')) x join public.driver_pay_overrides t on t.driver_id = (x->>'driver_id')::uuid and t.project_item_id = (x->>'project_item_id')::uuid where t.company_id <> p_company_id)
    or exists (select 1 from jsonb_array_elements(coalesce(p_data->'clients','[]')) x join public.clients t on t.id = (x->>'id')::uuid where t.company_id <> p_company_id)
    or exists (select 1 from jsonb_array_elements(coalesce(p_data->'expense_categories','[]')) x join public.expense_categories t on t.id = (x->>'id')::uuid where t.company_id <> p_company_id)
    or exists (select 1 from jsonb_array_elements(coalesce(p_data->'recurring_expenses','[]')) x join public.recurring_expenses t on t.id = (x->>'id')::uuid where t.company_id <> p_company_id)
    or exists (select 1 from jsonb_array_elements(coalesce(p_data->'expenses','[]')) x join public.expenses t on t.id = (x->>'id')::uuid where t.company_id <> p_company_id)
    or exists (select 1 from jsonb_array_elements(coalesce(p_data->'invoices','[]')) x join public.invoices t on t.id = (x->>'id')::uuid where t.company_id <> p_company_id)
    or exists (select 1 from jsonb_array_elements(coalesce(p_data->'invoice_items','[]')) x join public.invoice_items t on t.id = (x->>'id')::uuid where t.company_id <> p_company_id);
$$;

-- ---------- 復元／取り込みに 0009 のテーブルを追加（0004 の import_backup を置き換え） ----------
-- 復元／取り込み（owner）。ID 一致は上書き、他社の ID と衝突すれば拒否。締めガード・行単位監査は一時的に回避
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
      tax_rounding = coalesce((c->>'tax_rounding')::public.rounding_mode, tax_rounding)
    where id = cid;
  end if;

  insert into public.clients (id, company_id, name, honorific, address, tel, invoice_reg_no, payment_month_offset, payment_day, memo, is_active, sort_order)
  select (x->>'id')::uuid, cid, x->>'name', coalesce(x->>'honorific','御中'), coalesce(x->>'address',''), coalesce(x->>'tel',''),
         coalesce(x->>'invoice_reg_no',''), coalesce((x->>'payment_month_offset')::integer, 1), coalesce((x->>'payment_day')::integer, 0),
         coalesce(x->>'memo',''), coalesce((x->>'is_active')::boolean, true), coalesce((x->>'sort_order')::integer, 0)
    from jsonb_array_elements(coalesce(p_data->'clients','[]')) x
  on conflict (id) do update set
    name = excluded.name, honorific = excluded.honorific, address = excluded.address, tel = excluded.tel,
    invoice_reg_no = excluded.invoice_reg_no, payment_month_offset = excluded.payment_month_offset, payment_day = excluded.payment_day,
    memo = excluded.memo, is_active = excluded.is_active, sort_order = excluded.sort_order;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('clients', n);

  insert into public.drivers (id, company_id, name, kana, is_active, royalty_rate, mgmt_fee, rounding_mode, phone, email, bank_info, memo, sort_order,
                              tax_mode, invoice_reg_no, payout_month_offset, payout_day)
  select (x->>'id')::uuid, cid, x->>'name', coalesce(x->>'kana',''), coalesce((x->>'is_active')::boolean, true),
         (x->>'royalty_rate')::numeric, coalesce((x->>'mgmt_fee')::numeric, 0), (x->>'rounding_mode')::public.rounding_mode,
         coalesce(x->>'phone',''), coalesce(x->>'email',''), coalesce(x->>'bank_info',''), coalesce(x->>'memo',''), coalesce((x->>'sort_order')::integer, 0),
         coalesce((x->>'tax_mode')::public.tax_mode, 'taxable'), coalesce(x->>'invoice_reg_no',''), (x->>'payout_month_offset')::integer, (x->>'payout_day')::integer
    from jsonb_array_elements(coalesce(p_data->'drivers','[]')) x
  on conflict (id) do update set
    name = excluded.name, kana = excluded.kana, is_active = excluded.is_active, royalty_rate = excluded.royalty_rate,
    mgmt_fee = excluded.mgmt_fee, rounding_mode = excluded.rounding_mode, phone = excluded.phone, email = excluded.email,
    bank_info = excluded.bank_info, memo = excluded.memo, sort_order = excluded.sort_order,
    tax_mode = excluded.tax_mode, invoice_reg_no = excluded.invoice_reg_no, payout_month_offset = excluded.payout_month_offset, payout_day = excluded.payout_day;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('drivers', n);

  insert into public.projects (id, company_id, name, client_name, client_id, is_active, memo, sort_order)
  select (x->>'id')::uuid, cid, x->>'name', coalesce(x->>'client_name',''), (x->>'client_id')::uuid, coalesce((x->>'is_active')::boolean, true), coalesce(x->>'memo',''), coalesce((x->>'sort_order')::integer, 0)
    from jsonb_array_elements(coalesce(p_data->'projects','[]')) x
  on conflict (id) do update set
    name = excluded.name, client_name = excluded.client_name, client_id = excluded.client_id, is_active = excluded.is_active, memo = excluded.memo, sort_order = excluded.sort_order;
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

  insert into public.recurring_expenses (id, company_id, category_id, label, amount, tax_mode, driver_id, project_id, vendor, start_month, end_month, is_active, sort_order)
  select (x->>'id')::uuid, cid, (x->>'category_id')::uuid, x->>'label', coalesce((x->>'amount')::numeric, 0),
         coalesce((x->>'tax_mode')::public.tax_mode, 'taxable'), (x->>'driver_id')::uuid, (x->>'project_id')::uuid, coalesce(x->>'vendor',''),
         (x->>'start_month')::date, (x->>'end_month')::date, coalesce((x->>'is_active')::boolean, true), coalesce((x->>'sort_order')::integer, 0)
    from jsonb_array_elements(coalesce(p_data->'recurring_expenses','[]')) x
  on conflict (id) do update set
    category_id = excluded.category_id, label = excluded.label, amount = excluded.amount, tax_mode = excluded.tax_mode,
    driver_id = excluded.driver_id, project_id = excluded.project_id, vendor = excluded.vendor,
    start_month = excluded.start_month, end_month = excluded.end_month, is_active = excluded.is_active, sort_order = excluded.sort_order;
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

  insert into public.month_targets (company_id, month, bill_target, profit_target, memo)
  select cid, (x->>'month')::date, coalesce((x->>'bill_target')::numeric, 0), coalesce((x->>'profit_target')::numeric, 0), coalesce(x->>'memo','')
    from jsonb_array_elements(coalesce(p_data->'month_targets','[]')) x
  on conflict (company_id, month) do update set
    bill_target = excluded.bill_target, profit_target = excluded.profit_target, memo = excluded.memo;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('month_targets', n);

  perform set_config('app.skip_audit', 'off', true);
  perform set_config('app.bypass_closing', 'off', true);
  perform set_config('app.audit_internal', 'on', true);
  perform public.write_audit(cid, 'import_backup', 'company', cid::text, null, counts);
  perform set_config('app.audit_internal', 'off', true);
  return counts;
end $$;

-- ---------- データ全削除に 0009 のテーブルを追加（0004 の reset_company_data を置き換え） ----------
-- データ全削除（owner。会社名の入力で確認）。ユーザー・招待・会社設定は残す
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
  delete from public.invoice_items where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('invoice_items', n);
  delete from public.invoices where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('invoices', n);
  delete from public.expenses where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('expenses', n);
  delete from public.recurring_expenses where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('recurring_expenses', n);
  delete from public.month_targets where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('month_targets', n);
  delete from public.adjustments where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('adjustments', n);
  delete from public.work_entries where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('work_entries', n);
  delete from public.driver_months where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('driver_months', n);
  delete from public.month_closings where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('month_closings', n);
  delete from public.ai_insights where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('ai_insights', n);
  delete from public.driver_pay_overrides where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('driver_pay_overrides', n);
  delete from public.driver_recurring_adjustments where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('driver_recurring_adjustments', n);
  -- ドライバー本人のユーザーは、対応ドライバーが消えるため「無効な閲覧者」に変更する（再招待で復帰できる）
  perform set_config('app.bypass_profile_guard', 'on', true);
  update public.profiles set role = 'viewer', driver_id = null, is_active = false where company_id = cid and role = 'driver';
  update public.profiles set driver_id = null where company_id = cid and driver_id is not null;
  perform set_config('app.bypass_profile_guard', 'off', true);
  delete from public.invitations where company_id = cid and role = 'driver';
  update public.invitations set driver_id = null where company_id = cid and driver_id is not null;
  delete from public.project_items where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('project_items', n);
  delete from public.projects where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('projects', n);
  delete from public.drivers where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('drivers', n);
  delete from public.clients where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('clients', n);
  -- 経費カテゴリは残す（既定のカテゴリを使い続けられるようにするため）
  perform set_config('app.skip_audit', 'off', true);
  perform set_config('app.bypass_closing', 'off', true);
  perform set_config('app.audit_internal', 'on', true);
  perform public.write_audit(cid, 'reset_company_data', 'company', cid::text, counts, null);
  perform set_config('app.audit_internal', 'off', true);
  return counts;
end $$;

-- =============================================================================
-- 既定の経費カテゴリ（会社を作ったときに自動で用意する）
-- =============================================================================
create or replace function public.default_expense_categories(p_company_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  insert into public.expense_categories (company_id, name, kind, sort_order)
  select p_company_id, v.name, v.kind::public.expense_kind, v.sort
    from (values
      ('車両リース・レンタル', 'fixed', 1),
      ('保険料', 'fixed', 2),
      ('駐車場・車庫', 'fixed', 3),
      ('通信費', 'fixed', 4),
      ('事務所・家賃', 'fixed', 5),
      ('燃料費', 'variable', 6),
      ('高速・有料道路', 'variable', 7),
      ('車両整備・修理', 'variable', 8),
      ('消耗品・備品', 'variable', 9),
      ('外注費', 'variable', 10),
      ('広告・採用', 'variable', 11),
      ('その他', 'variable', 12)
    ) as v(name, kind, sort)
  on conflict (company_id, name) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.default_expense_categories(uuid) from anon, public;
grant execute on function public.default_expense_categories(uuid) to authenticated, service_role;

create or replace function public.company_seed_defaults()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.default_expense_categories(new.id);
  return new;
end $$;
drop trigger if exists t20_company_seed_defaults on public.companies;
create trigger t20_company_seed_defaults after insert on public.companies
  for each row execute function public.company_seed_defaults();

-- =============================================================================
-- 既存データの移行
-- =============================================================================
do $$
declare c record;
begin
  -- 既存の会社に既定の経費カテゴリを用意する
  for c in select id from public.companies loop
    perform public.default_expense_categories(c.id);
  end loop;
end $$;

-- 案件の取引先名（client_name）から取引先マスタを作り、案件に紐づける
insert into public.clients (company_id, name, sort_order)
select p.company_id, p.client_name, row_number() over (partition by p.company_id order by min(p.sort_order), p.client_name)
  from public.projects p
 where coalesce(p.client_name, '') <> ''
   and not exists (select 1 from public.clients c where c.company_id = p.company_id and c.name = p.client_name)
 group by p.company_id, p.client_name
on conflict (company_id, name) do nothing;

update public.projects p
   set client_id = c.id
  from public.clients c
 where p.client_id is null and coalesce(p.client_name, '') <> '' and c.company_id = p.company_id and c.name = p.client_name;

-- =============================================================================
-- 権限（0006 と同じ方針を 0009 で追加したテーブル・ビュー・関数にも適用する）
-- =============================================================================
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;
grant execute on all functions in schema public to authenticated, service_role;

-- 内部関数（トリガー・サーバー専用）は RPC から呼べないようにする
revoke execute on function public.apply_invitation(uuid, text, text) from authenticated, anon, public;
revoke execute on function public.write_audit(uuid, text, text, text, jsonb, jsonb) from authenticated, anon, public;
revoke execute on function public.ensure_driver_month(uuid, date, uuid) from authenticated, anon, public;
revoke execute on function public.import_has_id_conflict(uuid, jsonb) from authenticated, anon, public;
revoke execute on function public.handle_new_auth_user() from authenticated, anon, public;
revoke execute on function public.default_expense_categories(uuid) from authenticated, anon, public;
revoke execute on function public.recalc_invoice(uuid) from anon, public;

-- <<<<<<<<<<<<<<<<<<<<<<<<<<<<<< 0009_expenses_invoices.sql <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<

-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 0010_cashflow_project_pl.sql >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- =============================================================================
-- 0010 資金繰り・案件別採算
--   - 現金残高のスナップショット（資金繰りの起点）
--   - 案件ごとの目標利益率と、直課経費を含む案件 × 月の損益（v_project_pl）
--   - 毎月かかる経費の支払日（資金繰りに載せるため）
--   - 入金予定・支払予定・経費を時系列に並べる RPC（cash_forecast）
-- =============================================================================

-- ---------- 現金残高のスナップショット ----------
create table if not exists public.cash_snapshots (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  as_of date not null,
  balance numeric(14,2) not null,
  memo text not null default '',
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, as_of)
);
create index if not exists cash_snapshots_company_idx on public.cash_snapshots (company_id, as_of desc);
comment on table public.cash_snapshots is '資金繰りの起点になる現金残高（手入力。銀行 CSV 取り込みでも更新できるようにする）';

-- ---------- 案件の目標利益率 ----------
alter table public.projects add column if not exists target_margin numeric(6,4);
alter table public.projects drop constraint if exists projects_target_margin_check;
alter table public.projects add constraint projects_target_margin_check check (target_margin is null or (target_margin >= 0 and target_margin <= 1));
comment on column public.projects.target_margin is '案件の目標利益率（0.2 = 20%）。下回るとレポートで警告する。null = 判定しない';

-- ---------- 毎月かかる経費の支払日 ----------
alter table public.recurring_expenses add column if not exists payment_day integer;
alter table public.recurring_expenses drop constraint if exists recurring_expenses_payment_day_check;
alter table public.recurring_expenses add constraint recurring_expenses_payment_day_check check (payment_day is null or payment_day between 0 and 31);
comment on column public.recurring_expenses.payment_day is '支払日（0 = 末日、null = 末日扱い）。資金繰りの予定に使う';

-- ---------- トリガー ----------
drop trigger if exists t00_set_updated_at on public.cash_snapshots;
create trigger t00_set_updated_at before update on public.cash_snapshots for each row execute function public.set_updated_at();
drop trigger if exists t90_audit on public.cash_snapshots;
create trigger t90_audit after insert or update or delete on public.cash_snapshots for each row execute function public.audit_row_change();

-- ---------- RLS ----------
alter table public.cash_snapshots enable row level security;
drop policy if exists cash_snapshots_select on public.cash_snapshots;
create policy cash_snapshots_select on public.cash_snapshots for select to authenticated
  using (company_id = public.current_company_id() and public.is_staff());
drop policy if exists cash_snapshots_write on public.cash_snapshots;
create policy cash_snapshots_write on public.cash_snapshots for all to authenticated
  using (company_id = public.current_company_id() and public.is_admin())
  with check (company_id = public.current_company_id() and public.is_admin());

-- =============================================================================
-- 案件 × 月の損益（直課した経費を含む）
--   案件利益 = 稼働の利益（単価差額 ＋ ロイヤリティ）− その案件に紐づけた経費
--   管理費・調整はドライバー単位のため案件には配賦しない
-- =============================================================================
create or replace view public.v_project_pl
with (security_invoker = true) as
with ent as (
  select company_id, month, project_id,
         count(*)::integer as entry_count,
         count(distinct driver_id)::integer as driver_count,
         coalesce(sum(qty), 0)::numeric as qty_total,
         coalesce(sum(bill), 0)::numeric as bill,
         coalesce(sum(pay), 0)::numeric as pay,
         coalesce(sum(margin), 0)::numeric as margin,
         coalesce(sum(royalty), 0)::numeric as royalty,
         coalesce(sum(entry_profit), 0)::numeric as entry_profit
    from public.v_work_entry_calc
   group by company_id, month, project_id
),
exp as (
  select company_id, month, project_id,
         coalesce(sum(amount), 0)::numeric as expense_direct,
         count(*)::integer as expense_count
    from public.expenses
   where project_id is not null
   group by company_id, month, project_id
),
base as (
  select company_id, month, project_id from ent
  union
  select company_id, month, project_id from exp
),
calc as (
  select
    b.company_id,
    b.month,
    b.project_id,
    p.name as project_name,
    p.client_id,
    p.client_name,
    p.is_active as project_is_active,
    p.sort_order as project_sort_order,
    p.target_margin,
    coalesce(e.entry_count, 0) as entry_count,
    coalesce(e.driver_count, 0) as driver_count,
    coalesce(e.qty_total, 0) as qty_total,
    coalesce(e.bill, 0) as bill,
    coalesce(e.pay, 0) as pay,
    coalesce(e.margin, 0) as margin,
    coalesce(e.royalty, 0) as royalty,
    coalesce(e.entry_profit, 0) as entry_profit,
    coalesce(x.expense_direct, 0) as expense_direct,
    coalesce(x.expense_count, 0) as expense_count
  from base b
  join public.projects p on p.id = b.project_id
  left join ent e on e.company_id = b.company_id and e.month = b.month and e.project_id = b.project_id
  left join exp x on x.company_id = b.company_id and x.month = b.month and x.project_id = b.project_id
),
calc2 as (
  select *, (entry_profit - expense_direct) as project_profit from calc
)
select
  company_id,
  month,
  project_id,
  project_name,
  client_id,
  client_name,
  project_is_active,
  project_sort_order,
  target_margin,
  entry_count,
  driver_count,
  qty_total,
  bill,
  pay,
  margin,
  royalty,
  entry_profit,
  expense_direct,
  expense_count,
  project_profit,
  case when bill <> 0 then round(project_profit / bill, 6) else 0 end as project_margin,
  case
    when target_margin is null or bill = 0 then false
    else round(project_profit / bill, 6) < target_margin
  end as below_target,
  public.is_month_closed(company_id, month) as is_closed
from calc2;

-- =============================================================================
-- 資金繰り：入金予定・ドライバーへの支払予定・経費を日付順に並べる
--   amount は入金が +、支払が −。status は planned（予定）／confirmed（締め済み）／done（実績）
-- =============================================================================
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
language sql stable security invoker set search_path = public as $$
  -- 入金予定（未入金の請求書）
  select coalesce(i.due_date, public.month_day_date(i.month, cl.payment_month_offset, cl.payment_day)) as event_date,
         'invoice'::text as kind,
         cl.name as label,
         i.invoice_no as detail,
         i.total as amount,
         i.id as ref_id,
         case when i.status = 'issued' then 'confirmed' else 'planned' end as status,
         i.month
    from public.invoices i
    join public.clients cl on cl.id = i.client_id
   where i.status <> 'paid'
     and coalesce(i.due_date, public.month_day_date(i.month, cl.payment_month_offset, cl.payment_day)) between p_from and p_to
  union all
  -- 入金の実績
  select i.paid_on, 'invoice', cl.name, i.invoice_no || '（入金済み）', i.total, i.id, 'done', i.month
    from public.invoices i
    join public.clients cl on cl.id = i.client_id
   where i.status = 'paid' and i.paid_on is not null and i.paid_on between p_from and p_to
  union all
  -- ドライバーへの支払予定（税込）
  select public.month_day_date(s.month, coalesce(d.payout_month_offset, c.payout_month_offset), coalesce(d.payout_day, c.payout_day)),
         'payout',
         s.driver_name,
         to_char(s.month, 'YYYY年MM月') || 'の支払',
         -s.payout_incl,
         s.driver_id,
         case when s.is_closed then 'confirmed' else 'planned' end,
         s.month
    from public.v_driver_month_summary s
    join public.drivers d on d.id = s.driver_id
    join public.companies c on c.id = s.company_id
   where s.payout_incl <> 0
     and public.month_day_date(s.month, coalesce(d.payout_month_offset, c.payout_month_offset), coalesce(d.payout_day, c.payout_day)) between p_from and p_to
  union all
  -- 登録済みの経費（発生日が無ければ月末）
  select coalesce(e.incurred_on, public.month_day_date(e.month, 0, 0)), 'expense', ec.name, e.label, -e.amount, e.id, 'done', e.month
    from public.expenses e
    join public.expense_categories ec on ec.id = e.category_id
   where coalesce(e.incurred_on, public.month_day_date(e.month, 0, 0)) between p_from and p_to
  union all
  -- これから計上される固定費（まだその月に計上されていないもの）
  select public.month_day_date(m.month, 0, coalesce(r.payment_day, 0)), 'expense', ec.name, r.label || '（予定）', -r.amount, r.id, 'planned', m.month
    from public.recurring_expenses r
    join public.expense_categories ec on ec.id = r.category_id
    cross join lateral (
      select generate_series(date_trunc('month', p_from), date_trunc('month', p_to), interval '1 month')::date as month
    ) m
   where r.is_active
     and (r.start_month is null or r.start_month <= m.month)
     and (r.end_month is null or r.end_month >= m.month)
     and not exists (
       select 1 from public.expenses e
        where e.company_id = r.company_id and e.month = m.month and e.recurring_id = r.id
     )
     and public.month_day_date(m.month, 0, coalesce(r.payment_day, 0)) between p_from and p_to
  order by 1, 2, 3;
$$;

-- ---------- 権限 ----------
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;
grant execute on all functions in schema public to authenticated, service_role;

revoke execute on function public.apply_invitation(uuid, text, text) from authenticated, anon, public;
revoke execute on function public.write_audit(uuid, text, text, text, jsonb, jsonb) from authenticated, anon, public;
revoke execute on function public.ensure_driver_month(uuid, date, uuid) from authenticated, anon, public;
revoke execute on function public.import_has_id_conflict(uuid, jsonb) from authenticated, anon, public;
revoke execute on function public.handle_new_auth_user() from authenticated, anon, public;
revoke execute on function public.default_expense_categories(uuid) from authenticated, anon, public;
revoke execute on function public.recalc_invoice(uuid) from anon, public;

-- ---------- バックアップ JSON に 0010 のテーブルを追加 ----------
create or replace function public.export_backup()
returns jsonb language plpgsql security invoker set search_path = public as $$
declare cid uuid := public.current_company_id();
begin
  if not public.is_admin() then
    raise exception '権限がありません' using errcode = 'P0001', hint = 'FORBIDDEN';
  end if;
  return jsonb_build_object(
    'version', 3,
    'app', 'rootive-profit',
    'exported_at', now(),
    'company', (select to_jsonb(c) from public.companies c where c.id = cid),
    'clients', (select coalesce(jsonb_agg(to_jsonb(x) order by x.sort_order, x.name), '[]'::jsonb) from public.clients x where x.company_id = cid),
    'drivers', (select coalesce(jsonb_agg(to_jsonb(x) order by x.sort_order, x.name), '[]'::jsonb) from public.drivers x where x.company_id = cid),
    'projects', (select coalesce(jsonb_agg(to_jsonb(x) order by x.sort_order, x.name), '[]'::jsonb) from public.projects x where x.company_id = cid),
    'project_items', (select coalesce(jsonb_agg(to_jsonb(x) order by x.project_id, x.sort_order), '[]'::jsonb) from public.project_items x where x.company_id = cid),
    'driver_pay_overrides', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.driver_pay_overrides x where x.company_id = cid),
    'driver_recurring_adjustments', (select coalesce(jsonb_agg(to_jsonb(x) order by x.driver_id, x.sort_order), '[]'::jsonb) from public.driver_recurring_adjustments x where x.company_id = cid),
    'work_entries', (select coalesce(jsonb_agg(to_jsonb(x) order by x.month, x.created_at), '[]'::jsonb) from public.work_entries x where x.company_id = cid),
    'driver_months', (select coalesce(jsonb_agg(to_jsonb(x) order by x.month, x.driver_id), '[]'::jsonb) from public.driver_months x where x.company_id = cid),
    'adjustments', (select coalesce(jsonb_agg(to_jsonb(x) order by x.driver_month_id, x.sort_order), '[]'::jsonb) from public.adjustments x where x.company_id = cid),
    'month_closings', (select coalesce(jsonb_agg((to_jsonb(x) - 'snapshot') order by x.month), '[]'::jsonb) from public.month_closings x where x.company_id = cid),
    'expense_categories', (select coalesce(jsonb_agg(to_jsonb(x) order by x.sort_order, x.name), '[]'::jsonb) from public.expense_categories x where x.company_id = cid),
    'recurring_expenses', (select coalesce(jsonb_agg(to_jsonb(x) order by x.sort_order), '[]'::jsonb) from public.recurring_expenses x where x.company_id = cid),
    'expenses', (select coalesce(jsonb_agg(to_jsonb(x) order by x.month, x.created_at), '[]'::jsonb) from public.expenses x where x.company_id = cid),
    'invoices', (select coalesce(jsonb_agg(to_jsonb(x) order by x.month, x.invoice_no), '[]'::jsonb) from public.invoices x where x.company_id = cid),
    'invoice_items', (select coalesce(jsonb_agg(to_jsonb(x) order by x.invoice_id, x.sort_order), '[]'::jsonb) from public.invoice_items x where x.company_id = cid),
    'month_targets', (select coalesce(jsonb_agg(to_jsonb(x) order by x.month), '[]'::jsonb) from public.month_targets x where x.company_id = cid),
    'cash_snapshots', (select coalesce(jsonb_agg(to_jsonb(x) order by x.as_of), '[]'::jsonb) from public.cash_snapshots x where x.company_id = cid)
  );
end $$;

-- ---------- ID 衝突チェックに 0010 のテーブルを追加 ----------
create or replace function public.import_has_id_conflict(p_company_id uuid, p_data jsonb)
returns boolean language sql stable security definer set search_path = public as $$
  select
       exists (select 1 from jsonb_array_elements(coalesce(p_data->'drivers','[]')) x join public.drivers t on t.id = (x->>'id')::uuid where t.company_id <> p_company_id)
    or exists (select 1 from jsonb_array_elements(coalesce(p_data->'projects','[]')) x join public.projects t on t.id = (x->>'id')::uuid where t.company_id <> p_company_id)
    or exists (select 1 from jsonb_array_elements(coalesce(p_data->'project_items','[]')) x join public.project_items t on t.id = (x->>'id')::uuid where t.company_id <> p_company_id)
    or exists (select 1 from jsonb_array_elements(coalesce(p_data->'driver_recurring_adjustments','[]')) x join public.driver_recurring_adjustments t on t.id = (x->>'id')::uuid where t.company_id <> p_company_id)
    or exists (select 1 from jsonb_array_elements(coalesce(p_data->'work_entries','[]')) x join public.work_entries t on t.id = (x->>'id')::uuid where t.company_id <> p_company_id)
    or exists (select 1 from jsonb_array_elements(coalesce(p_data->'driver_months','[]')) x join public.driver_months t on t.id = (x->>'id')::uuid where t.company_id <> p_company_id)
    or exists (select 1 from jsonb_array_elements(coalesce(p_data->'adjustments','[]')) x join public.adjustments t on t.id = (x->>'id')::uuid where t.company_id <> p_company_id)
    or exists (select 1 from jsonb_array_elements(coalesce(p_data->'driver_pay_overrides','[]')) x join public.driver_pay_overrides t on t.driver_id = (x->>'driver_id')::uuid and t.project_item_id = (x->>'project_item_id')::uuid where t.company_id <> p_company_id)
    or exists (select 1 from jsonb_array_elements(coalesce(p_data->'clients','[]')) x join public.clients t on t.id = (x->>'id')::uuid where t.company_id <> p_company_id)
    or exists (select 1 from jsonb_array_elements(coalesce(p_data->'expense_categories','[]')) x join public.expense_categories t on t.id = (x->>'id')::uuid where t.company_id <> p_company_id)
    or exists (select 1 from jsonb_array_elements(coalesce(p_data->'recurring_expenses','[]')) x join public.recurring_expenses t on t.id = (x->>'id')::uuid where t.company_id <> p_company_id)
    or exists (select 1 from jsonb_array_elements(coalesce(p_data->'expenses','[]')) x join public.expenses t on t.id = (x->>'id')::uuid where t.company_id <> p_company_id)
    or exists (select 1 from jsonb_array_elements(coalesce(p_data->'invoices','[]')) x join public.invoices t on t.id = (x->>'id')::uuid where t.company_id <> p_company_id)
    or exists (select 1 from jsonb_array_elements(coalesce(p_data->'invoice_items','[]')) x join public.invoice_items t on t.id = (x->>'id')::uuid where t.company_id <> p_company_id)
    or exists (select 1 from jsonb_array_elements(coalesce(p_data->'cash_snapshots','[]')) x join public.cash_snapshots t on t.id = (x->>'id')::uuid where t.company_id <> p_company_id);
$$;

-- ---------- 復元／取り込みに 0010 のテーブルを追加（import_backup を置き換え） ----------
-- 復元／取り込み（owner）。ID 一致は上書き、他社の ID と衝突すれば拒否。締めガード・行単位監査は一時的に回避
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
      tax_rounding = coalesce((c->>'tax_rounding')::public.rounding_mode, tax_rounding)
    where id = cid;
  end if;

  insert into public.clients (id, company_id, name, honorific, address, tel, invoice_reg_no, payment_month_offset, payment_day, memo, is_active, sort_order)
  select (x->>'id')::uuid, cid, x->>'name', coalesce(x->>'honorific','御中'), coalesce(x->>'address',''), coalesce(x->>'tel',''),
         coalesce(x->>'invoice_reg_no',''), coalesce((x->>'payment_month_offset')::integer, 1), coalesce((x->>'payment_day')::integer, 0),
         coalesce(x->>'memo',''), coalesce((x->>'is_active')::boolean, true), coalesce((x->>'sort_order')::integer, 0)
    from jsonb_array_elements(coalesce(p_data->'clients','[]')) x
  on conflict (id) do update set
    name = excluded.name, honorific = excluded.honorific, address = excluded.address, tel = excluded.tel,
    invoice_reg_no = excluded.invoice_reg_no, payment_month_offset = excluded.payment_month_offset, payment_day = excluded.payment_day,
    memo = excluded.memo, is_active = excluded.is_active, sort_order = excluded.sort_order;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('clients', n);

  insert into public.drivers (id, company_id, name, kana, is_active, royalty_rate, mgmt_fee, rounding_mode, phone, email, bank_info, memo, sort_order,
                              tax_mode, invoice_reg_no, payout_month_offset, payout_day)
  select (x->>'id')::uuid, cid, x->>'name', coalesce(x->>'kana',''), coalesce((x->>'is_active')::boolean, true),
         (x->>'royalty_rate')::numeric, coalesce((x->>'mgmt_fee')::numeric, 0), (x->>'rounding_mode')::public.rounding_mode,
         coalesce(x->>'phone',''), coalesce(x->>'email',''), coalesce(x->>'bank_info',''), coalesce(x->>'memo',''), coalesce((x->>'sort_order')::integer, 0),
         coalesce((x->>'tax_mode')::public.tax_mode, 'taxable'), coalesce(x->>'invoice_reg_no',''), (x->>'payout_month_offset')::integer, (x->>'payout_day')::integer
    from jsonb_array_elements(coalesce(p_data->'drivers','[]')) x
  on conflict (id) do update set
    name = excluded.name, kana = excluded.kana, is_active = excluded.is_active, royalty_rate = excluded.royalty_rate,
    mgmt_fee = excluded.mgmt_fee, rounding_mode = excluded.rounding_mode, phone = excluded.phone, email = excluded.email,
    bank_info = excluded.bank_info, memo = excluded.memo, sort_order = excluded.sort_order,
    tax_mode = excluded.tax_mode, invoice_reg_no = excluded.invoice_reg_no, payout_month_offset = excluded.payout_month_offset, payout_day = excluded.payout_day;
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

  insert into public.month_targets (company_id, month, bill_target, profit_target, memo)
  select cid, (x->>'month')::date, coalesce((x->>'bill_target')::numeric, 0), coalesce((x->>'profit_target')::numeric, 0), coalesce(x->>'memo','')
    from jsonb_array_elements(coalesce(p_data->'month_targets','[]')) x
  on conflict (company_id, month) do update set
    bill_target = excluded.bill_target, profit_target = excluded.profit_target, memo = excluded.memo;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('month_targets', n);

  -- 0010：現金残高のスナップショット
  insert into public.cash_snapshots (id, company_id, as_of, balance, memo, created_by)
  select (x->>'id')::uuid, cid, (x->>'as_of')::date, coalesce((x->>'balance')::numeric, 0), coalesce(x->>'memo',''), (x->>'created_by')::uuid
    from jsonb_array_elements(coalesce(p_data->'cash_snapshots','[]')) x
  on conflict (id) do update set
    as_of = excluded.as_of, balance = excluded.balance, memo = excluded.memo;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('cash_snapshots', n);

  perform set_config('app.skip_audit', 'off', true);
  perform set_config('app.bypass_closing', 'off', true);
  perform set_config('app.audit_internal', 'on', true);
  perform public.write_audit(cid, 'import_backup', 'company', cid::text, null, counts);
  perform set_config('app.audit_internal', 'off', true);
  return counts;
end $$;

-- ---------- データ全削除に 0010 のテーブルを追加（reset_company_data を置き換え） ----------
-- データ全削除（owner。会社名の入力で確認）。ユーザー・招待・会社設定は残す
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
  delete from public.invoice_items where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('invoice_items', n);
  delete from public.invoices where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('invoices', n);
  delete from public.expenses where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('expenses', n);
  delete from public.recurring_expenses where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('recurring_expenses', n);
  delete from public.month_targets where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('month_targets', n);
  delete from public.cash_snapshots where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('cash_snapshots', n);
  delete from public.adjustments where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('adjustments', n);
  delete from public.work_entries where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('work_entries', n);
  delete from public.driver_months where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('driver_months', n);
  delete from public.month_closings where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('month_closings', n);
  delete from public.ai_insights where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('ai_insights', n);
  delete from public.driver_pay_overrides where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('driver_pay_overrides', n);
  delete from public.driver_recurring_adjustments where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('driver_recurring_adjustments', n);
  -- ドライバー本人のユーザーは、対応ドライバーが消えるため「無効な閲覧者」に変更する（再招待で復帰できる）
  perform set_config('app.bypass_profile_guard', 'on', true);
  update public.profiles set role = 'viewer', driver_id = null, is_active = false where company_id = cid and role = 'driver';
  update public.profiles set driver_id = null where company_id = cid and driver_id is not null;
  perform set_config('app.bypass_profile_guard', 'off', true);
  delete from public.invitations where company_id = cid and role = 'driver';
  update public.invitations set driver_id = null where company_id = cid and driver_id is not null;
  delete from public.project_items where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('project_items', n);
  delete from public.projects where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('projects', n);
  delete from public.drivers where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('drivers', n);
  delete from public.clients where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('clients', n);
  -- 経費カテゴリは残す（既定のカテゴリを使い続けられるようにするため）
  perform set_config('app.skip_audit', 'off', true);
  perform set_config('app.bypass_closing', 'off', true);
  perform set_config('app.audit_internal', 'on', true);
  perform public.write_audit(cid, 'reset_company_data', 'company', cid::text, counts, null);
  perform set_config('app.audit_internal', 'off', true);
  return counts;
end $$;

-- <<<<<<<<<<<<<<<<<<<<<<<<<<<<<< 0010_cashflow_project_pl.sql <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<

-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 0011_ai_chat_integrations.sql >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- =============================================================================
-- 0011 AI・社内チャット・異常検知・外部連携
--   - AI チャット（ai_conversations / ai_messages）と AI 月次分析の保存形式の拡張
--   - 社内チャット（chat_channels / chat_messages / chat_reads。閲覧者を含むスタッフ全員）
--   - 異常の検知とアラート（alerts ＋ RPC detect_anomalies）
--   - 外部連携（integrations / integration_secrets / integration_logs）
--       LINE 公式アカウント：drivers.line_user_id・profiles.line_user_id・line_link_codes
--       銀行 CSV 取り込み：bank_imports / bank_transactions ＋ 自動消込
-- =============================================================================

-- ---------- 列挙型 ----------
do $$ begin
  create type public.alert_status as enum ('open','resolved','ignored');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.alert_severity as enum ('high','medium','low');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.integration_kind as enum ('line','google_drive','bank');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.bank_txn_status as enum ('unmatched','matched','ignored');
exception when duplicate_object then null; end $$;

-- =============================================================================
-- AI チャット
-- =============================================================================
create table if not exists public.ai_conversations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  title text not null default '新しい相談' check (length(title) <= 200),
  month date check (month is null or extract(day from month) = 1),
  message_count integer not null default 0,
  last_message_at timestamptz not null default now(),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ai_conversations_company_idx on public.ai_conversations (company_id, last_message_at desc);
comment on table public.ai_conversations is 'AI チャットの会話（スタッフ全員が閲覧できる。会社の数字に関する相談）';

create table if not exists public.ai_messages (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  conversation_id uuid not null references public.ai_conversations(id) on delete cascade,
  role text not null check (role in ('user','assistant')),
  content text not null default '',
  model text not null default '',
  data_months integer not null default 0,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists ai_messages_conversation_idx on public.ai_messages (conversation_id, created_at);
create index if not exists ai_messages_company_idx on public.ai_messages (company_id, created_at desc);
comment on table public.ai_messages is 'AI チャットの発言。role=user は質問、role=assistant は Claude の回答';

-- AI 月次分析：所見に加えて要約・改善策を持てるようにする（findings は jsonb なので形は自由）
alter table public.ai_insights add column if not exists kind text not null default 'monthly';
alter table public.ai_insights add column if not exists summary text not null default '';
alter table public.ai_insights add column if not exists actions jsonb not null default '[]'::jsonb;
comment on column public.ai_insights.kind is '分析の種類（monthly＝月次の分析と改善策）';
comment on column public.ai_insights.summary is 'ひとことの総括';
comment on column public.ai_insights.actions is '改善策の配列 [{title, detail, effect}]';

-- =============================================================================
-- 社内チャット（閲覧者を含むスタッフ全員）
-- =============================================================================
create table if not exists public.chat_channels (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null check (length(name) between 1 and 60),
  description text not null default '',
  is_default boolean not null default false,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, name)
);
create index if not exists chat_channels_company_idx on public.chat_channels (company_id, sort_order, name);
comment on table public.chat_channels is '社内チャットのルーム。会社を作ると「全体」「経営」が入る';

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  channel_id uuid not null references public.chat_channels(id) on delete cascade,
  author_id uuid not null,
  body text not null check (length(body) between 1 and 4000),
  mentions jsonb not null default '[]'::jsonb,
  edited_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists chat_messages_channel_idx on public.chat_messages (channel_id, created_at desc);
create index if not exists chat_messages_company_idx on public.chat_messages (company_id, created_at desc);
comment on table public.chat_messages is '社内チャットの発言。mentions は宛先のユーザー ID（profiles.id）の配列';

create table if not exists public.chat_reads (
  company_id uuid not null references public.companies(id) on delete cascade,
  channel_id uuid not null references public.chat_channels(id) on delete cascade,
  profile_id uuid not null,
  last_read_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (channel_id, profile_id)
);
create index if not exists chat_reads_profile_idx on public.chat_reads (profile_id);
comment on table public.chat_reads is 'どこまで読んだか（未読件数の計算に使う）';

-- =============================================================================
-- 異常の検知とアラート
-- =============================================================================
create table if not exists public.alerts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  month date check (month is null or extract(day from month) = 1),
  code text not null check (length(code) between 1 and 50),
  severity public.alert_severity not null default 'medium',
  title text not null check (length(title) between 1 and 200),
  detail text not null default '',
  amount numeric(14,2),
  ref_table text not null default '',
  ref_id text not null default '',
  href text not null default '',
  status public.alert_status not null default 'open',
  fingerprint text not null,
  detected_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid,
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, fingerprint)
);
create index if not exists alerts_company_status_idx on public.alerts (company_id, status, severity, detected_at desc);
create index if not exists alerts_company_month_idx on public.alerts (company_id, month, status);
comment on table public.alerts is '異常の検知（RPC detect_anomalies が作る）。fingerprint で同じ異常を二重に作らない';

-- =============================================================================
-- 外部連携
-- =============================================================================
create table if not exists public.integrations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  kind public.integration_kind not null,
  is_enabled boolean not null default false,
  config jsonb not null default '{}'::jsonb,
  status text not null default '',
  last_ok_at timestamptz,
  last_error text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, kind)
);
comment on table public.integrations is '外部連携の設定（機密でないもの）。トークンなどは integration_secrets に入れる';

-- 機密（アクセストークン等）。RLS を有効にしてポリシーを作らない＝サービスロールだけが読み書きできる
create table if not exists public.integration_secrets (
  company_id uuid not null references public.companies(id) on delete cascade,
  kind public.integration_kind not null,
  secrets jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (company_id, kind)
);
comment on table public.integration_secrets is 'アクセストークンなどの機密。サービスロール（サーバー）だけが読み書きできる';

create table if not exists public.integration_logs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  kind public.integration_kind not null,
  action text not null default '',
  status text not null default 'ok' check (status in ('ok','error')),
  message text not null default '',
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists integration_logs_company_idx on public.integration_logs (company_id, created_at desc);
comment on table public.integration_logs is '外部連携の実行記録（送信・保存・取り込みの結果）';

-- LINE のユーザー ID（ドライバー・スタッフ）
alter table public.drivers add column if not exists line_user_id text not null default '';
alter table public.drivers add column if not exists line_linked_at timestamptz;
comment on column public.drivers.line_user_id is 'LINE 公式アカウントで連携したユーザー ID（空 = 未連携）';
alter table public.profiles add column if not exists line_user_id text not null default '';
alter table public.profiles add column if not exists line_linked_at timestamptz;
comment on column public.profiles.line_user_id is 'LINE 公式アカウントで連携したユーザー ID（空 = 未連携）';

create table if not exists public.line_link_codes (
  code text primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  driver_id uuid references public.drivers(id) on delete cascade,
  profile_id uuid,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  check (driver_id is not null or profile_id is not null)
);
create index if not exists line_link_codes_company_idx on public.line_link_codes (company_id, expires_at desc);
comment on table public.line_link_codes is 'LINE 連携用の合言葉（6 桁）。LINE で送ってもらうと本人と結びつく';

-- 銀行 CSV の取り込み
create table if not exists public.bank_imports (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  file_name text not null default '',
  format text not null default '',
  row_count integer not null default 0,
  inserted_count integer not null default 0,
  skipped_count integer not null default 0,
  matched_count integer not null default 0,
  period_from date,
  period_to date,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists bank_imports_company_idx on public.bank_imports (company_id, created_at desc);
comment on table public.bank_imports is '銀行 CSV の取り込み 1 回分';

create table if not exists public.bank_transactions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  import_id uuid references public.bank_imports(id) on delete set null,
  txn_date date not null,
  description text not null default '',
  amount numeric(14,2) not null,
  balance numeric(14,2),
  status public.bank_txn_status not null default 'unmatched',
  invoice_id uuid references public.invoices(id) on delete set null,
  expense_id uuid references public.expenses(id) on delete set null,
  matched_at timestamptz,
  matched_by uuid,
  auto_matched boolean not null default false,
  memo text not null default '',
  fingerprint text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, fingerprint)
);
create index if not exists bank_transactions_company_idx on public.bank_transactions (company_id, txn_date desc);
create index if not exists bank_transactions_status_idx on public.bank_transactions (company_id, status, txn_date desc);
comment on table public.bank_transactions is '銀行明細の 1 行（amount は入金 ＋／出金 −）。fingerprint で二重取り込みを防ぐ';

-- =============================================================================
-- トリガー
-- =============================================================================
do $$
declare t text;
begin
  foreach t in array array['ai_conversations','chat_channels','chat_messages','chat_reads','alerts','integrations','bank_transactions']
  loop
    execute format('drop trigger if exists t00_set_updated_at on public.%I', t);
    execute format('create trigger t00_set_updated_at before update on public.%I for each row execute function public.set_updated_at()', t);
  end loop;
end $$;

-- 子テーブルの company_id を親から補完し、親と一致することを確認する（0011 のテーブル）
create or replace function public.fill_company_id_0011()
returns trigger language plpgsql as $$
declare parent_company uuid;
begin
  if tg_table_name = 'ai_messages' then
    select company_id into parent_company from public.ai_conversations where id = new.conversation_id;
  elsif tg_table_name in ('chat_messages', 'chat_reads') then
    select company_id into parent_company from public.chat_channels where id = new.channel_id;
  elsif tg_table_name = 'bank_transactions' then
    if new.import_id is null then
      return new;
    end if;
    select company_id into parent_company from public.bank_imports where id = new.import_id;
  end if;

  if parent_company is null then
    raise exception '親レコードが見つかりません（%）', tg_table_name using errcode = 'foreign_key_violation';
  end if;
  if new.company_id is null then
    new.company_id := parent_company;
  elsif new.company_id <> parent_company then
    raise exception '会社が一致しません（%）', tg_table_name using errcode = 'check_violation';
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['ai_messages','chat_messages','chat_reads','bank_transactions']
  loop
    execute format('drop trigger if exists t01_fill_company_id on public.%I', t);
    execute format('create trigger t01_fill_company_id before insert or update on public.%I for each row execute function public.fill_company_id_0011()', t);
  end loop;
end $$;

-- 監査（チャット・AI の発言は量が多いので対象外。設定と連携の変更だけ残す）
do $$
declare t text;
begin
  foreach t in array array['chat_channels','integrations','bank_imports']
  loop
    execute format('drop trigger if exists t90_audit on public.%I', t);
    execute format('create trigger t90_audit after insert or update or delete on public.%I for each row execute function public.audit_row_change()', t);
  end loop;
end $$;

-- 会話の発言数・最終発言時刻を保つ
create or replace function public.t_ai_message_touch()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.ai_conversations
     set message_count = (select count(*) from public.ai_messages where conversation_id = new.conversation_id),
         last_message_at = greatest(last_message_at, new.created_at),
         updated_at = now()
   where id = new.conversation_id;
  return new;
end $$;
drop trigger if exists t10_touch_conversation on public.ai_messages;
create trigger t10_touch_conversation after insert on public.ai_messages for each row execute function public.t_ai_message_touch();

-- =============================================================================
-- RLS
-- =============================================================================
alter table public.ai_conversations enable row level security;
drop policy if exists ai_conversations_select on public.ai_conversations;
create policy ai_conversations_select on public.ai_conversations for select to authenticated
  using (company_id = public.current_company_id() and public.is_staff());
drop policy if exists ai_conversations_write on public.ai_conversations;
create policy ai_conversations_write on public.ai_conversations for all to authenticated
  using (company_id = public.current_company_id() and public.is_staff())
  with check (company_id = public.current_company_id() and public.is_staff());

alter table public.ai_messages enable row level security;
drop policy if exists ai_messages_select on public.ai_messages;
create policy ai_messages_select on public.ai_messages for select to authenticated
  using (company_id = public.current_company_id() and public.is_staff());
drop policy if exists ai_messages_write on public.ai_messages;
create policy ai_messages_write on public.ai_messages for all to authenticated
  using (company_id = public.current_company_id() and public.is_staff())
  with check (company_id = public.current_company_id() and public.is_staff());

alter table public.chat_channels enable row level security;
drop policy if exists chat_channels_select on public.chat_channels;
create policy chat_channels_select on public.chat_channels for select to authenticated
  using (company_id = public.current_company_id() and public.is_staff());
drop policy if exists chat_channels_write on public.chat_channels;
create policy chat_channels_write on public.chat_channels for all to authenticated
  using (company_id = public.current_company_id() and public.is_admin())
  with check (company_id = public.current_company_id() and public.is_admin());

alter table public.chat_messages enable row level security;
drop policy if exists chat_messages_select on public.chat_messages;
create policy chat_messages_select on public.chat_messages for select to authenticated
  using (company_id = public.current_company_id() and public.is_staff());
-- 発言は本人のものだけ作れる・直せる・消せる（閲覧者も発言できる）
drop policy if exists chat_messages_insert on public.chat_messages;
create policy chat_messages_insert on public.chat_messages for insert to authenticated
  with check (company_id = public.current_company_id() and public.is_staff() and author_id = auth.uid());
drop policy if exists chat_messages_update on public.chat_messages;
create policy chat_messages_update on public.chat_messages for update to authenticated
  using (company_id = public.current_company_id() and public.is_staff() and author_id = auth.uid())
  with check (company_id = public.current_company_id() and author_id = auth.uid());
drop policy if exists chat_messages_delete on public.chat_messages;
create policy chat_messages_delete on public.chat_messages for delete to authenticated
  using (company_id = public.current_company_id() and (author_id = auth.uid() or public.is_owner()));

alter table public.chat_reads enable row level security;
drop policy if exists chat_reads_self on public.chat_reads;
create policy chat_reads_self on public.chat_reads for all to authenticated
  using (company_id = public.current_company_id() and profile_id = auth.uid())
  with check (company_id = public.current_company_id() and profile_id = auth.uid());

alter table public.alerts enable row level security;
drop policy if exists alerts_select on public.alerts;
create policy alerts_select on public.alerts for select to authenticated
  using (company_id = public.current_company_id() and public.is_staff());
drop policy if exists alerts_write on public.alerts;
create policy alerts_write on public.alerts for all to authenticated
  using (company_id = public.current_company_id() and public.is_admin())
  with check (company_id = public.current_company_id() and public.is_admin());

alter table public.integrations enable row level security;
drop policy if exists integrations_select on public.integrations;
create policy integrations_select on public.integrations for select to authenticated
  using (company_id = public.current_company_id() and public.is_admin());
drop policy if exists integrations_write on public.integrations;
create policy integrations_write on public.integrations for all to authenticated
  using (company_id = public.current_company_id() and public.is_owner())
  with check (company_id = public.current_company_id() and public.is_owner());

-- 機密はポリシーを作らない＝サービスロールのみ
alter table public.integration_secrets enable row level security;

alter table public.integration_logs enable row level security;
drop policy if exists integration_logs_select on public.integration_logs;
create policy integration_logs_select on public.integration_logs for select to authenticated
  using (company_id = public.current_company_id() and public.is_admin());

-- 連携コードはサービスロールと本人（ドライバー・スタッフ）が作れる
alter table public.line_link_codes enable row level security;
drop policy if exists line_link_codes_self on public.line_link_codes;
create policy line_link_codes_self on public.line_link_codes for all to authenticated
  using (
    company_id = public.current_company_id()
    and (profile_id = auth.uid() or (driver_id is not null and driver_id = public.current_driver_id()) or public.is_admin())
  )
  with check (
    company_id = public.current_company_id()
    and (profile_id = auth.uid() or (driver_id is not null and driver_id = public.current_driver_id()) or public.is_admin())
  );

alter table public.bank_imports enable row level security;
drop policy if exists bank_imports_select on public.bank_imports;
create policy bank_imports_select on public.bank_imports for select to authenticated
  using (company_id = public.current_company_id() and public.is_staff());
drop policy if exists bank_imports_write on public.bank_imports;
create policy bank_imports_write on public.bank_imports for all to authenticated
  using (company_id = public.current_company_id() and public.is_admin())
  with check (company_id = public.current_company_id() and public.is_admin());

alter table public.bank_transactions enable row level security;
drop policy if exists bank_transactions_select on public.bank_transactions;
create policy bank_transactions_select on public.bank_transactions for select to authenticated
  using (company_id = public.current_company_id() and public.is_staff());
drop policy if exists bank_transactions_write on public.bank_transactions;
create policy bank_transactions_write on public.bank_transactions for all to authenticated
  using (company_id = public.current_company_id() and public.is_admin())
  with check (company_id = public.current_company_id() and public.is_admin());

-- 発言者の名前・ロールを発言に写し取る（閲覧者は他人の profiles を読めないため）
alter table public.chat_messages add column if not exists author_name text not null default '';
alter table public.chat_messages add column if not exists author_role public.user_role;

create or replace function public.t_chat_message_author()
returns trigger language plpgsql security definer set search_path = public as $$
declare p record;
begin
  select display_name, email, role into p from public.profiles where id = new.author_id;
  if p is null then
    raise exception '発言者が見つかりません' using errcode = 'foreign_key_violation';
  end if;
  new.author_name := coalesce(nullif(p.display_name, ''), p.email, '');
  new.author_role := p.role;
  return new;
end $$;
drop trigger if exists t02_chat_author on public.chat_messages;
create trigger t02_chat_author before insert or update of author_id on public.chat_messages
  for each row execute function public.t_chat_message_author();

-- =============================================================================
-- ビュー
-- =============================================================================
drop view if exists public.v_staff, public.v_chat_channel_list, public.v_chat_message_list,
  public.v_ai_conversation_list, public.v_alert_summary, public.v_bank_transaction_list cascade;

-- 社内のスタッフ一覧（チャットの宛先に使う）。閲覧者は profiles を読めないため security_invoker にせず、
-- ビューの中で会社とロールを必ず絞り込む
create view public.v_staff as
select
  p.id,
  p.company_id,
  coalesce(nullif(p.display_name, ''), p.email) as display_name,
  p.email,
  p.role,
  p.is_active,
  (coalesce(p.line_user_id, '') <> '') as line_linked,
  p.created_at
from public.profiles p
where p.company_id = public.current_company_id()
  and public.is_staff()
  and p.role <> 'driver';
comment on view public.v_staff is 'スタッフ一覧（チャットの宛先・管理画面用）。会社と権限はビューの中で絞り込む';

-- 社内チャットのルーム一覧（発言数・最終発言・未読件数）
create view public.v_chat_channel_list
with (security_invoker = true) as
select
  c.id,
  c.company_id,
  c.name,
  c.description,
  c.is_default,
  c.is_active,
  c.sort_order,
  c.created_at,
  coalesce(m.message_count, 0)::integer as message_count,
  m.last_message_at,
  coalesce(m.last_author_name, '') as last_author_name,
  coalesce(m.last_body, '') as last_body,
  coalesce(u.unread_count, 0)::integer as unread_count,
  coalesce(u.mention_count, 0)::integer as mention_count,
  r.last_read_at
from public.chat_channels c
left join lateral (
  select count(*)::integer as message_count,
         max(x.created_at) as last_message_at,
         (array_agg(x.author_name order by x.created_at desc))[1] as last_author_name,
         (array_agg(x.body order by x.created_at desc))[1] as last_body
    from public.chat_messages x
   where x.channel_id = c.id
) m on true
left join public.chat_reads r on r.channel_id = c.id and r.profile_id = auth.uid()
left join lateral (
  select count(*)::integer as unread_count,
         count(*) filter (where x.mentions ? auth.uid()::text)::integer as mention_count
    from public.chat_messages x
   where x.channel_id = c.id
     and x.author_id <> auth.uid()
     and x.created_at > coalesce(r.last_read_at, timestamptz '1970-01-01')
) u on true;

-- 社内チャットの発言一覧（発言者名つき）
create view public.v_chat_message_list
with (security_invoker = true) as
select
  m.id,
  m.company_id,
  m.channel_id,
  m.author_id,
  m.author_name,
  m.author_role,
  m.body,
  m.mentions,
  (m.author_id = auth.uid()) as is_mine,
  (m.mentions ? auth.uid()::text) as is_mentioned,
  m.edited_at,
  m.created_at
from public.chat_messages m;

-- AI チャットの会話一覧
create view public.v_ai_conversation_list
with (security_invoker = true) as
select
  c.id,
  c.company_id,
  c.title,
  c.month,
  c.message_count,
  c.last_message_at,
  c.created_by,
  c.created_at,
  coalesce(l.last_role, '') as last_role,
  coalesce(l.last_content, '') as last_content
from public.ai_conversations c
left join lateral (
  select x.role as last_role, x.content as last_content
    from public.ai_messages x
   where x.conversation_id = c.id
   -- 同じ時刻に入っていても、AI の回答（assistant）を最後の発言とみなす
   order by x.created_at desc, (x.role = 'assistant') desc
   limit 1
) l on true;

-- アラートの件数（会社 × 月）
create view public.v_alert_summary
with (security_invoker = true) as
select
  company_id,
  month,
  count(*) filter (where status = 'open')::integer as open_count,
  count(*) filter (where status = 'open' and severity = 'high')::integer as high_count,
  count(*) filter (where status = 'open' and severity = 'medium')::integer as medium_count,
  count(*) filter (where status = 'open' and severity = 'low')::integer as low_count,
  count(*)::integer as total_count,
  max(detected_at) as last_detected_at
from public.alerts
group by company_id, month;

-- 銀行明細の一覧（消込先の請求書・取引先つき）
create view public.v_bank_transaction_list
with (security_invoker = true) as
select
  t.id,
  t.company_id,
  t.import_id,
  t.txn_date,
  t.description,
  t.amount,
  t.balance,
  t.status,
  t.invoice_id,
  t.expense_id,
  t.auto_matched,
  t.memo,
  t.created_at,
  coalesce(i.invoice_no, '') as invoice_no,
  coalesce(i.total, 0) as invoice_total,
  coalesce(cl.name, '') as client_name,
  coalesce(e.label, '') as expense_label,
  coalesce(b.file_name, '') as import_file_name
from public.bank_transactions t
left join public.invoices i on i.id = t.invoice_id
left join public.clients cl on cl.id = i.client_id
left join public.expenses e on e.id = t.expense_id
left join public.bank_imports b on b.id = t.import_id;

-- =============================================================================
-- RPC：社内チャット
-- =============================================================================
-- 既定のルーム（会社を作ったとき・既存の会社に一度だけ）
create or replace function public.default_chat_channels(p_company_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  insert into public.chat_channels (company_id, name, description, is_default, sort_order)
  select p_company_id, v.name, v.descr, v.is_default, v.sort
    from (values
      ('全体', 'みんなへの連絡はここへ', true, 1),
      ('経営', '数字・方針の相談', false, 2)
    ) as v(name, descr, is_default, sort)
  on conflict (company_id, name) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- 発言する（閲覧者も発言できる）。宛先は profiles.id の配列
create or replace function public.chat_post(p_channel_id uuid, p_body text, p_mentions jsonb default '[]'::jsonb)
returns uuid language plpgsql security invoker set search_path = public as $$
declare
  cid uuid := public.current_company_id();
  mid uuid;
  body text := btrim(coalesce(p_body, ''));
begin
  if not public.is_staff() then
    raise exception 'チャットを使えるのはスタッフだけです' using errcode = 'P0001', hint = 'FORBIDDEN';
  end if;
  if body = '' then
    raise exception 'メッセージを入力してください' using errcode = 'P0001', hint = 'EMPTY_BODY';
  end if;
  if not exists (select 1 from public.chat_channels where id = p_channel_id and company_id = cid and is_active) then
    raise exception 'ルームが見つかりません' using errcode = 'P0001', hint = 'NOT_FOUND';
  end if;

  insert into public.chat_messages (company_id, channel_id, author_id, body, mentions)
  values (cid, p_channel_id, auth.uid(), body, coalesce(p_mentions, '[]'::jsonb))
  returning id into mid;

  insert into public.chat_reads (company_id, channel_id, profile_id, last_read_at)
  values (cid, p_channel_id, auth.uid(), now())
  on conflict (channel_id, profile_id) do update set last_read_at = now(), updated_at = now();

  return mid;
end $$;

-- ここまで読んだ
create or replace function public.chat_mark_read(p_channel_id uuid)
returns void language plpgsql security invoker set search_path = public as $$
declare cid uuid := public.current_company_id();
begin
  if not public.is_staff() then
    raise exception 'チャットを使えるのはスタッフだけです' using errcode = 'P0001', hint = 'FORBIDDEN';
  end if;
  insert into public.chat_reads (company_id, channel_id, profile_id, last_read_at)
  values (cid, p_channel_id, auth.uid(), now())
  on conflict (channel_id, profile_id) do update set last_read_at = now(), updated_at = now();
end $$;

-- 未読の合計（ナビのバッジ用）
create or replace function public.chat_unread_total()
returns integer language sql stable security invoker set search_path = public as $$
  select coalesce(sum(unread_count), 0)::integer from public.v_chat_channel_list where is_active;
$$;

-- =============================================================================
-- RPC：異常の検知
-- =============================================================================
-- アラートを 1 件記録する（同じ fingerprint があれば内容だけ更新し、解決済みは触らない）
create or replace function public.record_alert(
  p_company_id uuid, p_month date, p_code text, p_severity public.alert_severity,
  p_title text, p_detail text, p_amount numeric, p_ref_table text, p_ref_id text, p_href text, p_fingerprint text
-- security invoker：呼び出した人の RLS（admin・自社のみ）がそのまま効く
) returns text language plpgsql security invoker set search_path = public as $$
begin
  insert into public.alerts (company_id, month, code, severity, title, detail, amount, ref_table, ref_id, href, fingerprint)
  values (p_company_id, p_month, p_code, p_severity, p_title, coalesce(p_detail, ''), p_amount,
          coalesce(p_ref_table, ''), coalesce(p_ref_id, ''), coalesce(p_href, ''), p_fingerprint)
  on conflict (company_id, fingerprint) do update
    set severity = excluded.severity,
        title = excluded.title,
        detail = excluded.detail,
        amount = excluded.amount,
        href = excluded.href,
        detected_at = now(),
        updated_at = now();
  return p_fingerprint;
end $$;

-- その月の異常を洗い出す（admin 以上）。検知しなくなった未対応のアラートは自動で解決済みにする
create or replace function public.detect_anomalies(p_month date)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  cid uuid := public.current_company_id();
  fps text[] := array[]::text[];
  fp text;
  r record;
  pl record;
  prev record;
  m text := to_char(p_month, 'YYYY-MM');
  href_m text := '?m=' || to_char(p_month, 'YYYY-MM');
  n integer;
  total numeric;
  bal numeric;
  closed_n integer;
begin
  if not public.is_admin() then
    raise exception '権限がありません' using errcode = 'P0001', hint = 'FORBIDDEN';
  end if;
  if cid is null then
    raise exception '会社が特定できません' using errcode = 'P0001';
  end if;

  select * into pl from public.v_month_pl where company_id = cid and month = p_month;
  select * into prev from public.v_month_pl where company_id = cid and month = (p_month - interval '1 month')::date;

  -- 1. 数量 0 の稼働行（入力漏れの可能性）
  select count(*) into n from public.work_entries where company_id = cid and month = p_month and qty = 0;
  if n > 0 then
    fp := public.record_alert(cid, p_month, 'qty_zero', 'medium', '数量が 0 の稼働が ' || n || ' 件あります',
      '数量を入れ忘れている可能性があります。稼働の画面で確認してください。', null, 'work_entries', '', '/entries' || href_m,
      'qty_zero:' || m);
    fps := fps || fp;
  end if;

  -- 2. マスタと違う単価の稼働行
  select count(*) into n from public.rate_diffs(p_month);
  if n > 0 then
    fp := public.record_alert(cid, p_month, 'rate_diff', 'medium', 'マスタと違う単価の稼働が ' || n || ' 件あります',
      '単価表を変えたあとに反映していないか、個別に変えた行があります。', null, 'work_entries', '', '/entries' || href_m,
      'rate_diff:' || m);
    fps := fps || fp;
  end if;

  -- 3. 管理費の設定がドライバーの既定と違う
  for r in
    select driver_id, driver_name, mgmt_fee_setting, driver_default_mgmt_fee
      from public.v_driver_month_summary
     where company_id = cid and month = p_month and mgmt_fee_setting <> driver_default_mgmt_fee
  loop
    fp := public.record_alert(cid, p_month, 'mgmt_fee_mismatch', 'low',
      r.driver_name || ' の管理費が既定と違います',
      'この月は ' || to_char(r.mgmt_fee_setting, 'FM999,999,999') || ' 円、ドライバー設定は ' || to_char(r.driver_default_mgmt_fee, 'FM999,999,999') || ' 円です。',
      r.mgmt_fee_setting, 'driver_months', r.driver_id::text, '/payouts/' || r.driver_id || '/statement' || href_m,
      'mgmt_fee_mismatch:' || m || ':' || r.driver_id);
    fps := fps || fp;
  end loop;

  -- 4. 稼働中なのにその月の稼働が無いドライバー（その月に稼働が 1 件でもあるときだけ）
  if coalesce(pl.entry_count, 0) > 0 then
    for r in
      select d.id, d.name
        from public.drivers d
       where d.company_id = cid and d.is_active
         and not exists (
           select 1 from public.work_entries w
            where w.company_id = cid and w.month = p_month and w.driver_id = d.id and w.qty > 0
         )
    loop
      fp := public.record_alert(cid, p_month, 'no_entry', 'medium', r.name || ' の稼働がありません',
        '稼働中のドライバーですが、この月の稼働が 1 件も入っていません。', null, 'drivers', r.id::text, '/entries' || href_m,
        'no_entry:' || m || ':' || r.id);
      fps := fps || fp;
    end loop;
  end if;

  -- 5. 会社の営業利益率が前月より 5 ポイント以上下がった
  if prev is not null and coalesce(pl.bill, 0) > 0 and coalesce(prev.bill, 0) > 0
     and (coalesce(prev.operating_margin, 0) - coalesce(pl.operating_margin, 0)) >= 0.05 then
    fp := public.record_alert(cid, p_month, 'margin_drop', 'high', '営業利益率が前月より下がっています',
      '前月 ' || to_char(prev.operating_margin * 100, 'FM999.0') || '% → 当月 ' || to_char(pl.operating_margin * 100, 'FM999.0') || '% です。',
      pl.operating_profit, 'v_month_pl', '', '/dashboard' || href_m, 'margin_drop:' || m);
    fps := fps || fp;
  end if;

  -- 6. 会社利益がマイナスのドライバー（オーナー本人のような支払 0・率 0・管理費 0 は除く）
  for r in
    select driver_id, driver_name, driver_profit
      from public.v_driver_month_summary
     where company_id = cid and month = p_month and driver_profit < 0
       and not (coalesce(pay, 0) = 0 and coalesce(royalty, 0) = 0 and coalesce(mgmt_fee, 0) = 0)
  loop
    fp := public.record_alert(cid, p_month, 'driver_loss', 'high', r.driver_name || 'の利益がマイナスです',
      '会社利益が ' || to_char(r.driver_profit, 'FM999,999,999') || ' 円です。単価と調整を確認してください。',
      r.driver_profit, 'drivers', r.driver_id::text, '/drivers-pl' || href_m,
      'driver_loss:' || m || ':' || r.driver_id);
    fps := fps || fp;
  end loop;

  -- 7. 目標に対して売上が 8 割に届かなかった（過ぎた月だけ）
  if p_month < date_trunc('month', current_date)::date and coalesce(pl.bill_target, 0) > 0
     and coalesce(pl.bill, 0) < pl.bill_target * 0.8 then
    fp := public.record_alert(cid, p_month, 'target_miss', 'medium', '売上が目標を大きく下回りました',
      '目標 ' || to_char(pl.bill_target, 'FM999,999,999') || ' 円に対して ' || to_char(pl.bill, 'FM999,999,999') || ' 円でした。',
      pl.bill, 'month_targets', '', '/dashboard' || href_m, 'target_miss:' || m);
    fps := fps || fp;
  end if;

  -- 8. 支払期日を過ぎた未入金の請求書（月は問わず洗い出す）
  for r in
    select i.id, i.invoice_no, i.total, i.due_date, cl.name as client_name
      from public.invoices i
      join public.clients cl on cl.id = i.client_id
     where i.company_id = cid and i.status <> 'paid' and i.due_date is not null and i.due_date < current_date
  loop
    fp := public.record_alert(cid, p_month, 'invoice_overdue', 'high',
      r.client_name || ' の入金が確認できていません',
      '請求書 ' || r.invoice_no || '（' || to_char(r.total, 'FM999,999,999') || ' 円）の期日 ' || to_char(r.due_date, 'YYYY/MM/DD') || ' を過ぎています。',
      r.total, 'invoices', r.id::text, '/invoices/' || r.id, 'invoice_overdue:' || r.id);
    fps := fps || fp;
  end loop;

  -- 9. 売上があるのに請求書を作っていない取引先
  for r in
    select s.client_id, s.client_name, s.bill
      from public.v_client_month_summary s
     where s.company_id = cid and s.month = p_month and s.bill > 0
       and not exists (select 1 from public.invoices i where i.company_id = cid and i.client_id = s.client_id and i.month = p_month)
  loop
    fp := public.record_alert(cid, p_month, 'invoice_missing', 'medium', r.client_name || ' の請求書がまだです',
      'この月の売上 ' || to_char(r.bill, 'FM999,999,999') || ' 円に対して請求書を作っていません。',
      r.bill, 'clients', r.client_id::text, '/invoices' || href_m,
      'invoice_missing:' || m || ':' || r.client_id);
    fps := fps || fp;
  end loop;

  -- 10. 稼働はあるのに経費が 1 件も入っていない
  if coalesce(pl.entry_count, 0) > 0 and coalesce(pl.expense_count, 0) = 0 then
    fp := public.record_alert(cid, p_month, 'expense_missing', 'low', 'この月の経費が入っていません',
      '経費を入れると営業利益が正しく出ます。毎月かかる経費はまとめて計上できます。', null, 'expenses', '', '/expenses' || href_m,
      'expense_missing:' || m);
    fps := fps || fp;
  end if;

  -- 11. 30 日以内の資金がショートする見込み
  select balance into bal from public.cash_snapshots where company_id = cid order by as_of desc limit 1;
  if bal is not null then
    select coalesce(sum(amount), 0) into total
      from public.cash_forecast(current_date, (current_date + 30)::date);
    if bal + total < 0 then
      fp := public.record_alert(cid, p_month, 'cash_short', 'high', '30 日以内に残高が不足する見込みです',
        '現在の残高 ' || to_char(bal, 'FM999,999,999') || ' 円に対して、30 日間の収支は ' || to_char(total, 'FM999,999,999') || ' 円の見込みです。',
        bal + total, 'cash_snapshots', '', '/cashflow', 'cash_short:' || m);
      fps := fps || fp;
    end if;
  end if;

  -- 検知しなくなったものは自動で解決済みにする
  update public.alerts
     set status = 'resolved', resolved_at = now(), updated_at = now()
   where company_id = cid and month = p_month and status = 'open' and not (fingerprint = any(fps));
  get diagnostics n = row_count;

  select count(*) into closed_n from public.alerts where company_id = cid and month = p_month and status = 'open';
  return jsonb_build_object('detected', coalesce(array_length(fps, 1), 0), 'open', closed_n, 'auto_resolved', n);
end $$;

-- アラートの状態を変える（admin 以上）
create or replace function public.set_alert_status(p_alert_id uuid, p_status public.alert_status, p_note text default '')
returns void language plpgsql security invoker set search_path = public as $$
declare cid uuid := public.current_company_id();
begin
  if not public.is_admin() then
    raise exception '権限がありません' using errcode = 'P0001', hint = 'FORBIDDEN';
  end if;
  update public.alerts
     set status = p_status,
         note = coalesce(nullif(btrim(p_note), ''), note),
         resolved_at = case when p_status = 'open' then null else now() end,
         resolved_by = case when p_status = 'open' then null else auth.uid() end,
         updated_at = now()
   where id = p_alert_id and company_id = cid;
  if not found then
    raise exception 'アラートが見つかりません' using errcode = 'P0001';
  end if;
end $$;

-- =============================================================================
-- RPC：銀行 CSV の消込
-- =============================================================================
-- 入金明細と未入金の請求書を金額で突き合わせる（金額が一致し、候補が 1 件だけのものを消し込む）
create or replace function public.bank_auto_match(p_import_id uuid default null)
returns integer language plpgsql security invoker set search_path = public as $$
declare
  cid uuid := public.current_company_id();
  t record;
  inv_id uuid;
  cnt integer;
  matched integer := 0;
begin
  if not public.is_admin() then
    raise exception '権限がありません' using errcode = 'P0001', hint = 'FORBIDDEN';
  end if;
  for t in
    select * from public.bank_transactions
     where company_id = cid and status = 'unmatched' and amount > 0
       and (p_import_id is null or import_id = p_import_id)
     order by txn_date
  loop
    select count(*), (array_agg(i.id order by i.issue_date, i.invoice_no))[1] into cnt, inv_id
      from public.invoices i
     where i.company_id = cid and i.status <> 'paid' and i.total = t.amount
       and t.txn_date >= i.issue_date - 7 and t.txn_date <= i.issue_date + 180;
    if cnt = 1 then
      update public.bank_transactions
         set status = 'matched', invoice_id = inv_id, matched_at = now(), matched_by = auth.uid(), auto_matched = true, updated_at = now()
       where id = t.id;
      perform public.set_invoice_status(inv_id, 'paid', t.txn_date);
      matched := matched + 1;
    end if;
  end loop;
  if p_import_id is not null then
    update public.bank_imports set matched_count = matched where id = p_import_id and company_id = cid;
  end if;
  return matched;
end $$;

-- 手で消し込む（請求書に紐づけて入金済みにする）
create or replace function public.bank_match_invoice(p_txn_id uuid, p_invoice_id uuid)
returns void language plpgsql security invoker set search_path = public as $$
declare
  cid uuid := public.current_company_id();
  d date;
begin
  if not public.is_admin() then
    raise exception '権限がありません' using errcode = 'P0001', hint = 'FORBIDDEN';
  end if;
  select txn_date into d from public.bank_transactions where id = p_txn_id and company_id = cid;
  if d is null then
    raise exception '明細が見つかりません' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.invoices where id = p_invoice_id and company_id = cid) then
    raise exception '請求書が見つかりません' using errcode = 'P0001';
  end if;
  update public.bank_transactions
     set status = 'matched', invoice_id = p_invoice_id, expense_id = null,
         matched_at = now(), matched_by = auth.uid(), auto_matched = false, updated_at = now()
   where id = p_txn_id and company_id = cid;
  perform public.set_invoice_status(p_invoice_id, 'paid', d);
end $$;

-- 消込を外す／対象外にする
create or replace function public.bank_set_status(p_txn_id uuid, p_status public.bank_txn_status)
returns void language plpgsql security invoker set search_path = public as $$
declare
  cid uuid := public.current_company_id();
  old_invoice uuid;
begin
  if not public.is_admin() then
    raise exception '権限がありません' using errcode = 'P0001', hint = 'FORBIDDEN';
  end if;
  select invoice_id into old_invoice from public.bank_transactions where id = p_txn_id and company_id = cid;
  if not found then
    raise exception '明細が見つかりません' using errcode = 'P0001';
  end if;
  if p_status = 'matched' then
    raise exception '消込は bank_match_invoice を使ってください' using errcode = 'P0001';
  end if;
  update public.bank_transactions
     set status = p_status, invoice_id = null, expense_id = null,
         matched_at = null, matched_by = null, auto_matched = false, updated_at = now()
   where id = p_txn_id and company_id = cid;
  -- 消込を外したら請求書は「発行済み」に戻す
  if old_invoice is not null then
    perform public.set_invoice_status(old_invoice, 'issued', null);
  end if;
end $$;

-- =============================================================================
-- RPC：LINE 連携の合言葉
-- =============================================================================
-- 合言葉（6 桁）を発行する。ドライバーは自分の分、スタッフは自分の分
create or replace function public.line_issue_code()
returns text language plpgsql security invoker set search_path = public as $$
declare
  cid uuid := public.current_company_id();
  did uuid := public.current_driver_id();
  code text;
begin
  if cid is null then
    raise exception 'ログインが必要です' using errcode = 'P0001';
  end if;
  code := lpad((floor(random() * 1000000))::integer::text, 6, '0');
  if did is not null then
    delete from public.line_link_codes where company_id = cid and driver_id = did and used_at is null;
    insert into public.line_link_codes (code, company_id, driver_id, expires_at)
    values (code, cid, did, now() + interval '30 minutes');
  else
    if not public.is_staff() then
      raise exception '権限がありません' using errcode = 'P0001', hint = 'FORBIDDEN';
    end if;
    delete from public.line_link_codes where company_id = cid and profile_id = auth.uid() and used_at is null;
    insert into public.line_link_codes (code, company_id, profile_id, expires_at)
    values (code, cid, auth.uid(), now() + interval '30 minutes');
  end if;
  return code;
end $$;

-- 合言葉を使って LINE のユーザー ID を結びつける（Webhook から。サービスロール専用）
create or replace function public.line_consume_code(p_code text, p_line_user_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r record;
begin
  select * into r from public.line_link_codes
   where code = btrim(p_code) and used_at is null and expires_at > now()
   limit 1;
  if r is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  update public.line_link_codes set used_at = now() where code = r.code;
  if r.driver_id is not null then
    update public.drivers set line_user_id = p_line_user_id, line_linked_at = now() where id = r.driver_id;
    return jsonb_build_object('ok', true, 'kind', 'driver', 'company_id', r.company_id,
      'name', (select name from public.drivers where id = r.driver_id));
  end if;
  perform set_config('app.bypass_profile_guard', 'on', true);
  update public.profiles set line_user_id = p_line_user_id, line_linked_at = now() where id = r.profile_id;
  perform set_config('app.bypass_profile_guard', 'off', true);
  return jsonb_build_object('ok', true, 'kind', 'staff', 'company_id', r.company_id,
    'name', (select coalesce(nullif(display_name, ''), email) from public.profiles where id = r.profile_id));
end $$;

-- LINE の連携を外す（ドライバー本人は自分の分だけ。admin は会社のドライバーの分も外せる）
create or replace function public.line_unlink(p_driver_id uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  cid uuid := public.current_company_id();
  own uuid := public.current_driver_id();
  did uuid;
begin
  if cid is null then
    raise exception 'ログインが必要です' using errcode = 'P0001';
  end if;
  if own is not null then
    did := own; -- ドライバー本人は自分の分だけ（引数は無視する）
  elsif p_driver_id is not null then
    if not public.is_admin() then
      raise exception '権限がありません' using errcode = 'P0001', hint = 'FORBIDDEN';
    end if;
    did := p_driver_id;
  end if;

  if did is not null then
    update public.drivers set line_user_id = '', line_linked_at = null where id = did and company_id = cid;
  else
    perform set_config('app.bypass_profile_guard', 'on', true);
    update public.profiles set line_user_id = '', line_linked_at = null where id = auth.uid() and company_id = cid;
    perform set_config('app.bypass_profile_guard', 'off', true);
  end if;
end $$;

-- =============================================================================
-- 会社を作ったときの既定データ（経費カテゴリ ＋ チャットのルーム）
-- =============================================================================
create or replace function public.company_seed_defaults()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.default_expense_categories(new.id);
  perform public.default_chat_channels(new.id);
  return new;
end $$;
drop trigger if exists t20_company_seed_defaults on public.companies;
create trigger t20_company_seed_defaults after insert on public.companies
  for each row execute function public.company_seed_defaults();

-- 既存の会社にもルームを用意する
do $$
declare c record;
begin
  for c in select id from public.companies loop
    perform public.default_chat_channels(c.id);
  end loop;
end $$;

-- =============================================================================
-- データ全削除に 0011 のテーブルを追加（reset_company_data を置き換え）
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
-- 権限（0006 と同じ方針を 0011 で追加したテーブル・ビュー・関数にも適用する）
-- =============================================================================
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;
grant execute on all functions in schema public to authenticated, service_role;

-- 機密テーブルはサービスロール専用（authenticated から権限そのものを外す）
revoke all on public.integration_secrets from authenticated, anon, public;
grant all on public.integration_secrets to service_role;

-- 内部用の関数は直接呼べないようにする
revoke execute on function public.apply_invitation(uuid, text, text) from authenticated, anon, public;
revoke execute on function public.write_audit(uuid, text, text, text, jsonb, jsonb) from authenticated, anon, public;
revoke execute on function public.ensure_driver_month(uuid, date, uuid) from authenticated, anon, public;
revoke execute on function public.import_has_id_conflict(uuid, jsonb) from authenticated, anon, public;
revoke execute on function public.handle_new_auth_user() from authenticated, anon, public;
revoke execute on function public.default_expense_categories(uuid) from authenticated, anon, public;
revoke execute on function public.default_chat_channels(uuid) from authenticated, anon, public;
revoke execute on function public.recalc_invoice(uuid) from anon, public;
revoke execute on function public.line_consume_code(text, text) from authenticated, anon, public;

-- <<<<<<<<<<<<<<<<<<<<<<<<<<<<<< 0011_ai_chat_integrations.sql <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<

-- =============================================================================
-- 次のステップ：supabase/seed/bootstrap_owner.sql を実行して会社とオーナー招待を作成してください
-- =============================================================================
