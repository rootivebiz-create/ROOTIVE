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
