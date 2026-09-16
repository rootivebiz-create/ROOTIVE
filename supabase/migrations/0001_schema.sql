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
  driver_id uuid references public.drivers(id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (role <> 'driver' or driver_id is not null)
);
create index if not exists profiles_company_idx on public.profiles (company_id);
create index if not exists profiles_email_idx on public.profiles (lower(email));

-- ---------- 招待 ----------
create table if not exists public.invitations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  email text not null check (position('@' in email) > 1),
  role public.user_role not null default 'viewer',
  driver_id uuid references public.drivers(id) on delete set null,
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
