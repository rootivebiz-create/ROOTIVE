-- =============================================================================
-- ROOTIVE 利益管理システム  全マイグレーション結合ファイル（自動生成：npm run build:sql）
-- Supabase の SQL Editor に貼り付けて実行してください（何度実行しても安全です）
-- 生成元: 0001_schema.sql, 0002_auth_rls.sql, 0003_views.sql, 0004_rpc.sql, 0005_portal_seed.sql, 0006_storage_grants.sql
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
      yayoi_accounts = coalesce(c->'yayoi_accounts', yayoi_accounts)
    where id = cid;
  end if;

  insert into public.drivers (id, company_id, name, kana, is_active, royalty_rate, mgmt_fee, rounding_mode, phone, email, bank_info, memo, sort_order)
  select (x->>'id')::uuid, cid, x->>'name', coalesce(x->>'kana',''), coalesce((x->>'is_active')::boolean, true),
         (x->>'royalty_rate')::numeric, coalesce((x->>'mgmt_fee')::numeric, 0), (x->>'rounding_mode')::public.rounding_mode,
         coalesce(x->>'phone',''), coalesce(x->>'email',''), coalesce(x->>'bank_info',''), coalesce(x->>'memo',''), coalesce((x->>'sort_order')::integer, 0)
    from jsonb_array_elements(coalesce(p_data->'drivers','[]')) x
  on conflict (id) do update set
    name = excluded.name, kana = excluded.kana, is_active = excluded.is_active, royalty_rate = excluded.royalty_rate,
    mgmt_fee = excluded.mgmt_fee, rounding_mode = excluded.rounding_mode, phone = excluded.phone, email = excluded.email,
    bank_info = excluded.bank_info, memo = excluded.memo, sort_order = excluded.sort_order;
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

  insert into public.driver_pay_overrides (company_id, driver_id, project_item_id, pay_rate)
  select cid, (x->>'driver_id')::uuid, (x->>'project_item_id')::uuid, (x->>'pay_rate')::numeric
    from jsonb_array_elements(coalesce(p_data->'driver_pay_overrides','[]')) x
  on conflict (driver_id, project_item_id) do update set pay_rate = excluded.pay_rate;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('driver_pay_overrides', n);

  insert into public.driver_recurring_adjustments (id, company_id, driver_id, label, amount, count_as_profit, is_active, sort_order)
  select (x->>'id')::uuid, cid, (x->>'driver_id')::uuid, x->>'label', (x->>'amount')::numeric, coalesce((x->>'count_as_profit')::boolean, true),
         coalesce((x->>'is_active')::boolean, true), coalesce((x->>'sort_order')::integer, 0)
    from jsonb_array_elements(coalesce(p_data->'driver_recurring_adjustments','[]')) x
  on conflict (id) do update set
    driver_id = excluded.driver_id, label = excluded.label, amount = excluded.amount, count_as_profit = excluded.count_as_profit,
    is_active = excluded.is_active, sort_order = excluded.sort_order;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('driver_recurring_adjustments', n);

  insert into public.driver_months (id, company_id, month, driver_id, mgmt_fee, memo)
  select (x->>'id')::uuid, cid, (x->>'month')::date, (x->>'driver_id')::uuid, coalesce((x->>'mgmt_fee')::numeric, 0), coalesce(x->>'memo','')
    from jsonb_array_elements(coalesce(p_data->'driver_months','[]')) x
  on conflict (id) do update set
    month = excluded.month, driver_id = excluded.driver_id, mgmt_fee = excluded.mgmt_fee, memo = excluded.memo;
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

-- ドライバー本人：締め済み月の一覧（会社利益は含めない）
create or replace function public.driver_portal_months()
returns table (month date, payout numeric, pay numeric, royalty numeric, mgmt_fee numeric, adj_pay numeric, closed_at timestamptz)
language sql stable security definer set search_path = public as $$
  select s.month, s.payout, s.pay, s.royalty, s.mgmt_fee, s.adj_pay, mc.closed_at
    from public.v_driver_month_summary s
    join public.month_closings mc on mc.company_id = s.company_id and mc.month = s.month and mc.status = 'closed'
   where s.driver_id = public.current_driver_id()
     and s.company_id = public.current_company_id()
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

  insert into public.driver_pay_overrides (driver_id, project_item_id, pay_rate) values (d_yosh, i_misato, 21960), (d_taka, i_misato, 21960);

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

-- =============================================================================
-- 次のステップ：supabase/seed/bootstrap_owner.sql を実行して会社とオーナー招待を作成してください
-- =============================================================================
