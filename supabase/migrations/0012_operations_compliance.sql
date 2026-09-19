-- =============================================================================
-- 0012 運行管理と法令対応（点呼・業務記録・日別の稼働・車両・書類の期限）
--   2025 年 4 月施行の貨物軽自動車運送事業の安全対策に対応する。
--   - daily_reports：業務前点呼・業務後点呼・業務記録（1 日 1 件・ドライバーごと）
--   - work_day_entries：日別の稼働数量。承認すると月次の work_entries.qty に自動で反映
--   - vehicles / documents：車両と、免許証・車検・保険・健康診断などの期限
--   - safety_managers / driver_instructions / incidents：安全管理者・指導監督・事故の記録
-- =============================================================================

-- ---------- 列挙型 ----------
do $$ begin
  create type public.document_kind as enum (
    'license','vehicle_inspection','compulsory_insurance','voluntary_insurance',
    'health_check','safety_training','contract','other');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.roll_call_method as enum ('face','phone','video','app');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.day_entry_status as enum ('submitted','approved','rejected');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.entry_source as enum ('staff','driver','import','line');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.vehicle_ownership as enum ('owned','lease','driver');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.incident_kind as enum ('accident','violation','near_miss');
exception when duplicate_object then null; end $$;

-- =============================================================================
-- 車両
-- =============================================================================
create table if not exists public.vehicles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  plate text not null check (length(plate) between 1 and 40),
  maker text not null default '',
  model text not null default '',
  ownership public.vehicle_ownership not null default 'owned',
  driver_id uuid references public.drivers(id) on delete set null,
  lease_monthly numeric(12,2) not null default 0 check (lease_monthly >= 0),
  odometer numeric(10,1),
  memo text not null default '',
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, plate)
);
create index if not exists vehicles_company_idx on public.vehicles (company_id, sort_order, plate);
comment on table public.vehicles is '車両（黒ナンバー）。ドライバーへの割当と、車検・保険の期限は documents で持つ';

-- =============================================================================
-- 書類と期限（免許証・車検・自賠責・任意保険・健康診断・安全管理者講習 …）
-- =============================================================================
create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  kind public.document_kind not null,
  driver_id uuid references public.drivers(id) on delete cascade,
  vehicle_id uuid references public.vehicles(id) on delete cascade,
  label text not null default '',
  number text not null default '',
  issued_on date,
  expires_on date,
  reminder_days integer not null default 60 check (reminder_days between 0 and 365),
  file_path text not null default '',
  memo text not null default '',
  is_active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (driver_id is not null or vehicle_id is not null)
);
create index if not exists documents_company_idx on public.documents (company_id, expires_on);
create index if not exists documents_driver_idx on public.documents (driver_id);
create index if not exists documents_vehicle_idx on public.documents (vehicle_id);
comment on table public.documents is '期限のある書類。expires_on の reminder_days 日前からアラートに出す';

-- =============================================================================
-- 日報（業務前点呼・業務後点呼・業務記録）
--   国土交通省の点呼記録簿・業務記録に必要な項目を 1 行にまとめる。
--   month は締めガード（guard_month_closed）が使う（work_date から自動）
-- =============================================================================
create table if not exists public.daily_reports (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  work_date date not null,
  -- 締めガード（guard_month_closed）が new.month を見るため、生成列ではなくトリガーで入れる
  month date not null,
  driver_id uuid not null references public.drivers(id) on delete cascade,
  vehicle_id uuid references public.vehicles(id) on delete set null,

  -- 業務前点呼
  pre_at timestamptz,
  pre_method public.roll_call_method,
  pre_alcohol numeric(4,3) check (pre_alcohol is null or (pre_alcohol >= 0 and pre_alcohol <= 9)),
  pre_alcohol_ok boolean,
  pre_health_ok boolean,
  pre_inspection_ok boolean,
  pre_instruction text not null default '',
  pre_by uuid,

  -- 業務後点呼
  post_at timestamptz,
  post_method public.roll_call_method,
  post_alcohol numeric(4,3) check (post_alcohol is null or (post_alcohol >= 0 and post_alcohol <= 9)),
  post_alcohol_ok boolean,
  post_condition_ok boolean,
  post_incident text not null default '',
  post_by uuid,

  -- 業務記録
  start_at timestamptz,
  end_at timestamptz,
  break_minutes integer not null default 0 check (break_minutes between 0 and 1440),
  distance_km numeric(10,1) check (distance_km is null or distance_km >= 0),
  odo_start numeric(10,1),
  odo_end numeric(10,1),
  memo text not null default '',

  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, work_date, driver_id)
);
create index if not exists daily_reports_company_idx on public.daily_reports (company_id, work_date desc);
create index if not exists daily_reports_driver_idx on public.daily_reports (driver_id, work_date desc);
create index if not exists daily_reports_month_idx on public.daily_reports (company_id, month);
comment on table public.daily_reports is '日報（業務前点呼・業務後点呼・業務記録）。1 年間保存する';

-- =============================================================================
-- 日別の稼働数量（承認すると月次の work_entries.qty へ自動反映）
-- =============================================================================
create table if not exists public.work_day_entries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  work_date date not null,
  -- 締めガード（guard_month_closed）が new.month を見るため、生成列ではなくトリガーで入れる
  month date not null,
  driver_id uuid not null references public.drivers(id) on delete cascade,
  project_item_id uuid not null references public.project_items(id) on delete restrict,
  qty numeric(12,2) not null default 0 check (qty >= 0),
  memo text not null default '',
  source public.entry_source not null default 'driver',
  status public.day_entry_status not null default 'submitted',
  reject_reason text not null default '',
  submitted_by uuid,
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, work_date, driver_id, project_item_id)
);
create index if not exists work_day_entries_company_idx on public.work_day_entries (company_id, work_date desc);
create index if not exists work_day_entries_month_idx on public.work_day_entries (company_id, month, status);
create index if not exists work_day_entries_driver_idx on public.work_day_entries (driver_id, work_date desc);
comment on table public.work_day_entries is '日別の稼働数量。status=approved の合計が月次の work_entries.qty になる';

-- 月次の稼働行が日別から作られたかどうか
alter table public.work_entries add column if not exists qty_source text not null default 'manual';
alter table public.work_entries drop constraint if exists work_entries_qty_source_check;
alter table public.work_entries add constraint work_entries_qty_source_check check (qty_source in ('manual','daily'));
comment on column public.work_entries.qty_source is 'manual＝画面で入力、daily＝日別の承認済みから自動集計（画面から数量を直接変えない）';

-- =============================================================================
-- 安全管理者・指導監督・事故
-- =============================================================================
create table if not exists public.safety_managers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null check (length(name) between 1 and 100),
  office text not null default '本店',
  profile_id uuid,
  driver_id uuid references public.drivers(id) on delete set null,
  appointed_on date,
  training_on date,
  training_expires_on date,
  notified_on date,
  memo text not null default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists safety_managers_company_idx on public.safety_managers (company_id, is_active);
comment on table public.safety_managers is '貨物軽自動車安全管理者（営業所ごとに 1 名以上。2025 年 4 月施行）';

create table if not exists public.driver_instructions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  driver_id uuid not null references public.drivers(id) on delete cascade,
  kind text not null default 'regular' check (kind in ('initial','regular','accident','elderly','special')),
  instructed_on date not null,
  hours numeric(5,2) not null default 0 check (hours >= 0),
  topics text not null default '',
  instructor text not null default '',
  memo text not null default '',
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists driver_instructions_company_idx on public.driver_instructions (company_id, instructed_on desc);
create index if not exists driver_instructions_driver_idx on public.driver_instructions (driver_id, instructed_on desc);
comment on table public.driver_instructions is '運転者への指導・監督の記録（初任・定期・事故後など）。3 年間保存する';

create table if not exists public.incidents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  driver_id uuid references public.drivers(id) on delete set null,
  vehicle_id uuid references public.vehicles(id) on delete set null,
  occurred_at timestamptz not null,
  kind public.incident_kind not null default 'accident',
  place text not null default '',
  description text not null default '',
  cause text not null default '',
  prevention text not null default '',
  reported boolean not null default false,
  cost numeric(12,2) not null default 0,
  memo text not null default '',
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists incidents_company_idx on public.incidents (company_id, occurred_at desc);
comment on table public.incidents is '事故・違反・ヒヤリハットの記録と再発防止対策';

-- =============================================================================
-- トリガー
-- =============================================================================
-- 稼動月を work_date から入れる（締めガードより先に動くよう t00 の名前にする）
create or replace function public.t_set_month_from_work_date()
returns trigger language plpgsql as $$
begin
  if new.work_date is null then
    raise exception '日付が必要です' using errcode = 'P0001';
  end if;
  new.month := date_trunc('month', new.work_date)::date;
  return new;
end $$;

-- 子テーブルの company_id を親（ドライバー）から補完し、一致を確認する
-- ドライバーは案件マスタ・車両を直接読めない（RLS）ため、確認だけできるよう security definer にする
create or replace function public.fill_company_id_0012()
returns trigger language plpgsql security definer set search_path = public as $$
declare parent_company uuid; other_company uuid;
begin
  select company_id into parent_company from public.drivers where id = new.driver_id;
  if parent_company is null then
    raise exception 'ドライバーが見つかりません（%）', tg_table_name using errcode = 'foreign_key_violation';
  end if;
  if new.company_id is null then
    new.company_id := parent_company;
  elsif new.company_id <> parent_company then
    raise exception '会社が一致しません（%）', tg_table_name using errcode = 'check_violation';
  end if;

  if tg_table_name = 'work_day_entries' then
    select company_id into other_company from public.project_items where id = new.project_item_id;
    if other_company is null or other_company <> new.company_id then
      raise exception '案件内容の会社が一致しません' using errcode = 'check_violation';
    end if;
  end if;
  -- plpgsql は and の右側も評価するため、列の有無はネストした if で判定する
  if tg_table_name = 'daily_reports' then
    if new.vehicle_id is not null then
      select company_id into other_company from public.vehicles where id = new.vehicle_id;
      if other_company is null or other_company <> new.company_id then
        raise exception '車両の会社が一致しません' using errcode = 'check_violation';
      end if;
    end if;
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['vehicles','documents','daily_reports','work_day_entries','safety_managers','driver_instructions','incidents']
  loop
    execute format('drop trigger if exists t00_set_updated_at on public.%I', t);
    execute format('create trigger t00_set_updated_at before update on public.%I for each row execute function public.set_updated_at()', t);
  end loop;

  foreach t in array array['daily_reports','work_day_entries']
  loop
    execute format('drop trigger if exists t00_set_month on public.%I', t);
    execute format('create trigger t00_set_month before insert or update on public.%I for each row execute function public.t_set_month_from_work_date()', t);
    execute format('drop trigger if exists t01_fill_company_id on public.%I', t);
    execute format('create trigger t01_fill_company_id before insert or update on public.%I for each row execute function public.fill_company_id_0012()', t);
    -- 締め済みの月の記録は変えられない（0002 の guard_month_closed。t05 なので t00/t01 のあとに動く）
    execute format('drop trigger if exists t05_guard_month_closed on public.%I', t);
    execute format('create trigger t05_guard_month_closed before insert or update or delete on public.%I for each row execute function public.guard_month_closed()', t);
  end loop;

  foreach t in array array['vehicles','documents','daily_reports','work_day_entries','safety_managers','driver_instructions','incidents']
  loop
    execute format('drop trigger if exists t90_audit on public.%I', t);
    execute format('create trigger t90_audit after insert or update or delete on public.%I for each row execute function public.audit_row_change()', t);
  end loop;
end $$;

-- ---------- 日別 → 月次の自動集計 ----------
-- 承認済みの日別の合計を、その月の稼働行（work_entries.qty）に反映する。
-- 行が無ければ現在のマスタ（entry_defaults）から作る。日別由来の行は qty_source='daily'。
create or replace function public.sync_work_entry_from_days(p_company_id uuid, p_month date, p_driver_id uuid, p_project_item_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  total numeric := 0;
  n integer := 0;
  ed record;
begin
  select coalesce(sum(qty), 0), count(*) into total, n
    from public.work_day_entries
   where company_id = p_company_id and month = p_month and driver_id = p_driver_id
     and project_item_id = p_project_item_id and status = 'approved';

  if n = 0 then
    -- 承認済みの日別が無くなったら、日別由来の行だけ 0 にする（手入力の行は触らない）
    update public.work_entries
       set qty = 0
     where company_id = p_company_id and month = p_month and driver_id = p_driver_id
       and project_item_id = p_project_item_id and qty_source = 'daily' and qty <> 0;
    return;
  end if;

  update public.work_entries
     set qty = total, qty_source = 'daily'
   where company_id = p_company_id and month = p_month and driver_id = p_driver_id
     and project_item_id = p_project_item_id;
  if found then
    return;
  end if;

  select * into ed from public.entry_defaults(p_driver_id, p_project_item_id);
  if ed is null then
    raise exception '単価が取得できません' using errcode = 'P0001';
  end if;
  insert into public.work_entries (company_id, month, driver_id, project_item_id, qty, bill_rate, pay_rate, royalty_rate, rounding_mode, qty_source)
  values (p_company_id, p_month, p_driver_id, p_project_item_id, total, ed.bill_rate, ed.pay_rate, ed.royalty_rate, ed.rounding_mode, 'daily');
end $$;

create or replace function public.t_work_day_entry_sync()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('INSERT', 'UPDATE') then
    perform public.sync_work_entry_from_days(new.company_id, new.month, new.driver_id, new.project_item_id);
  end if;
  if tg_op = 'DELETE'
     or (tg_op = 'UPDATE' and (old.month, old.driver_id, old.project_item_id) is distinct from (new.month, new.driver_id, new.project_item_id)) then
    perform public.sync_work_entry_from_days(old.company_id, old.month, old.driver_id, old.project_item_id);
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists t50_sync_work_entry on public.work_day_entries;
create trigger t50_sync_work_entry after insert or update or delete on public.work_day_entries
  for each row execute function public.t_work_day_entry_sync();

-- =============================================================================
-- RLS
-- =============================================================================
alter table public.vehicles enable row level security;
drop policy if exists vehicles_select on public.vehicles;
create policy vehicles_select on public.vehicles for select to authenticated
  using (company_id = public.current_company_id() and (public.is_staff() or driver_id = public.current_driver_id()));
drop policy if exists vehicles_write on public.vehicles;
create policy vehicles_write on public.vehicles for all to authenticated
  using (company_id = public.current_company_id() and public.is_admin())
  with check (company_id = public.current_company_id() and public.is_admin());

alter table public.documents enable row level security;
drop policy if exists documents_select on public.documents;
create policy documents_select on public.documents for select to authenticated
  using (company_id = public.current_company_id() and (public.is_staff() or driver_id = public.current_driver_id()));
drop policy if exists documents_write on public.documents;
create policy documents_write on public.documents for all to authenticated
  using (company_id = public.current_company_id() and public.is_admin())
  with check (company_id = public.current_company_id() and public.is_admin());

alter table public.daily_reports enable row level security;
drop policy if exists daily_reports_select on public.daily_reports;
create policy daily_reports_select on public.daily_reports for select to authenticated
  using (company_id = public.current_company_id() and (public.is_staff() or driver_id = public.current_driver_id()));
drop policy if exists daily_reports_insert on public.daily_reports;
create policy daily_reports_insert on public.daily_reports for insert to authenticated
  with check (company_id = public.current_company_id() and (public.is_admin() or driver_id = public.current_driver_id()));
drop policy if exists daily_reports_update on public.daily_reports;
create policy daily_reports_update on public.daily_reports for update to authenticated
  using (company_id = public.current_company_id() and (public.is_admin() or driver_id = public.current_driver_id()))
  with check (company_id = public.current_company_id() and (public.is_admin() or driver_id = public.current_driver_id()));
drop policy if exists daily_reports_delete on public.daily_reports;
create policy daily_reports_delete on public.daily_reports for delete to authenticated
  using (company_id = public.current_company_id() and public.is_admin());

alter table public.work_day_entries enable row level security;
drop policy if exists work_day_entries_select on public.work_day_entries;
create policy work_day_entries_select on public.work_day_entries for select to authenticated
  using (company_id = public.current_company_id() and (public.is_staff() or driver_id = public.current_driver_id()));
-- ドライバー本人は「提出」だけできる（自分で承認はできない）
drop policy if exists work_day_entries_insert on public.work_day_entries;
create policy work_day_entries_insert on public.work_day_entries for insert to authenticated
  with check (
    company_id = public.current_company_id()
    and (public.is_admin() or (driver_id = public.current_driver_id() and status = 'submitted'))
  );
drop policy if exists work_day_entries_update on public.work_day_entries;
create policy work_day_entries_update on public.work_day_entries for update to authenticated
  using (
    company_id = public.current_company_id()
    and (public.is_admin() or (driver_id = public.current_driver_id() and status <> 'approved'))
  )
  with check (
    company_id = public.current_company_id()
    and (public.is_admin() or (driver_id = public.current_driver_id() and status = 'submitted'))
  );
drop policy if exists work_day_entries_delete on public.work_day_entries;
create policy work_day_entries_delete on public.work_day_entries for delete to authenticated
  using (
    company_id = public.current_company_id()
    and (public.is_admin() or (driver_id = public.current_driver_id() and status <> 'approved'))
  );

alter table public.safety_managers enable row level security;
drop policy if exists safety_managers_select on public.safety_managers;
create policy safety_managers_select on public.safety_managers for select to authenticated
  using (company_id = public.current_company_id() and public.is_staff());
drop policy if exists safety_managers_write on public.safety_managers;
create policy safety_managers_write on public.safety_managers for all to authenticated
  using (company_id = public.current_company_id() and public.is_admin())
  with check (company_id = public.current_company_id() and public.is_admin());

alter table public.driver_instructions enable row level security;
drop policy if exists driver_instructions_select on public.driver_instructions;
create policy driver_instructions_select on public.driver_instructions for select to authenticated
  using (company_id = public.current_company_id() and (public.is_staff() or driver_id = public.current_driver_id()));
drop policy if exists driver_instructions_write on public.driver_instructions;
create policy driver_instructions_write on public.driver_instructions for all to authenticated
  using (company_id = public.current_company_id() and public.is_admin())
  with check (company_id = public.current_company_id() and public.is_admin());

alter table public.incidents enable row level security;
drop policy if exists incidents_select on public.incidents;
create policy incidents_select on public.incidents for select to authenticated
  using (company_id = public.current_company_id() and (public.is_staff() or driver_id = public.current_driver_id()));
drop policy if exists incidents_write on public.incidents;
create policy incidents_write on public.incidents for all to authenticated
  using (company_id = public.current_company_id() and public.is_admin())
  with check (company_id = public.current_company_id() and public.is_admin());

-- =============================================================================
-- ビュー
-- =============================================================================
drop view if exists public.v_vehicle_list, public.v_document_list, public.v_daily_report_list,
  public.v_work_day_entry_list, public.v_day_status cascade;

-- 車両 ＋ 割当ドライバー ＋ 次に来る期限
create view public.v_vehicle_list
with (security_invoker = true) as
select
  v.id,
  v.company_id,
  v.plate,
  v.maker,
  v.model,
  v.ownership,
  v.driver_id,
  coalesce(d.name, '') as driver_name,
  v.lease_monthly,
  v.odometer,
  v.memo,
  v.is_active,
  v.sort_order,
  v.created_at,
  x.next_expires_on,
  x.next_kind,
  coalesce(x.expired_count, 0)::integer as expired_count
from public.vehicles v
left join public.drivers d on d.id = v.driver_id
left join lateral (
  select min(doc.expires_on) as next_expires_on,
         (array_agg(doc.kind order by doc.expires_on))[1] as next_kind,
         count(*) filter (where doc.expires_on < current_date) as expired_count
    from public.documents doc
   where doc.vehicle_id = v.id and doc.is_active and doc.expires_on is not null
) x on true;

-- 書類 ＋ 対象の名前 ＋ 残り日数
create view public.v_document_list
with (security_invoker = true) as
select
  doc.id,
  doc.company_id,
  doc.kind,
  doc.driver_id,
  coalesce(d.name, '') as driver_name,
  doc.vehicle_id,
  coalesce(v.plate, '') as vehicle_plate,
  doc.label,
  doc.number,
  doc.issued_on,
  doc.expires_on,
  doc.reminder_days,
  doc.file_path,
  doc.memo,
  doc.is_active,
  doc.created_at,
  case when doc.expires_on is null then null else (doc.expires_on - current_date) end as days_left,
  case
    when doc.expires_on is null then 'none'
    when doc.expires_on < current_date then 'expired'
    when doc.expires_on <= current_date + doc.reminder_days then 'soon'
    else 'valid'
  end as expiry_status
from public.documents doc
left join public.drivers d on d.id = doc.driver_id
left join public.vehicles v on v.id = doc.vehicle_id;

-- 日報 ＋ ドライバー名・車両番号 ＋ その日の稼働合計
create view public.v_daily_report_list
with (security_invoker = true) as
select
  r.id,
  r.company_id,
  r.work_date,
  r.month,
  r.driver_id,
  coalesce(d.name, '') as driver_name,
  r.vehicle_id,
  coalesce(v.plate, '') as vehicle_plate,
  r.pre_at, r.pre_method, r.pre_alcohol, r.pre_alcohol_ok, r.pre_health_ok, r.pre_inspection_ok, r.pre_instruction,
  r.post_at, r.post_method, r.post_alcohol, r.post_alcohol_ok, r.post_condition_ok, r.post_incident,
  r.start_at, r.end_at, r.break_minutes, r.distance_km, r.odo_start, r.odo_end, r.memo,
  (r.pre_at is not null) as pre_done,
  (r.post_at is not null) as post_done,
  (r.pre_at is not null and r.post_at is not null) as roll_call_done,
  coalesce(w.qty_total, 0) as qty_total,
  coalesce(w.entry_count, 0)::integer as entry_count,
  r.created_at,
  r.updated_at
from public.daily_reports r
left join public.drivers d on d.id = r.driver_id
left join public.vehicles v on v.id = r.vehicle_id
left join lateral (
  select sum(e.qty) as qty_total, count(*) as entry_count
    from public.work_day_entries e
   where e.driver_id = r.driver_id and e.work_date = r.work_date and e.status <> 'rejected'
) w on true;

-- 日別の稼働 ＋ ドライバー名・案件名・内容名
create view public.v_work_day_entry_list
with (security_invoker = true) as
select
  e.id,
  e.company_id,
  e.work_date,
  e.month,
  e.driver_id,
  coalesce(d.name, '') as driver_name,
  d.sort_order as driver_sort_order,
  e.project_item_id,
  p.id as project_id,
  coalesce(p.name, '') as project_name,
  coalesce(pi.name, '') as item_name,
  pi.unit,
  e.qty,
  e.memo,
  e.source,
  e.status,
  e.reject_reason,
  e.submitted_by,
  e.approved_by,
  e.approved_at,
  e.created_at,
  e.updated_at
from public.work_day_entries e
left join public.drivers d on d.id = e.driver_id
left join public.project_items pi on pi.id = e.project_item_id
left join public.projects p on p.id = pi.project_id;

-- 会社 × 月：承認待ち・点呼の未実施・稼働日数
create view public.v_day_status
with (security_invoker = true) as
with days as (
  select company_id, month, work_date, driver_id,
         count(*) filter (where status = 'submitted')::integer as pending,
         count(*) filter (where status = 'approved')::integer as approved
    from public.work_day_entries
   group by company_id, month, work_date, driver_id
)
select
  x.company_id,
  x.month,
  sum(x.pending)::integer as pending_count,
  sum(x.approved)::integer as approved_count,
  count(*)::integer as work_day_count,
  count(*) filter (where r.id is null or r.pre_at is null)::integer as roll_call_missing_count
from days x
left join public.daily_reports r
  on r.company_id = x.company_id and r.work_date = x.work_date and r.driver_id = x.driver_id
group by x.company_id, x.month;

-- =============================================================================
-- RPC
-- =============================================================================
-- 日別の稼働をまとめて提出する（ドライバー本人は自分の分だけ。数量 0 は削除）
create or replace function public.submit_day_entries(
  p_work_date date, p_item_ids uuid[], p_qtys numeric[], p_driver_id uuid default null, p_memo text default ''
) returns integer language plpgsql security invoker set search_path = public as $$
declare
  cid uuid := public.current_company_id();
  own uuid := public.current_driver_id();
  did uuid;
  i integer;
  n integer := 0;
  src public.entry_source;
begin
  if cid is null then
    raise exception 'ログインが必要です' using errcode = 'P0001';
  end if;
  if own is not null then
    did := own;            -- ドライバー本人は自分の分だけ（引数は無視する）
    src := 'driver';
  else
    if not public.is_admin() then
      raise exception '権限がありません' using errcode = 'P0001', hint = 'FORBIDDEN';
    end if;
    did := p_driver_id;
    src := 'staff';
    if did is null then
      raise exception 'ドライバーを指定してください' using errcode = 'P0001';
    end if;
  end if;
  if p_item_ids is null or p_qtys is null or array_length(p_item_ids, 1) is distinct from array_length(p_qtys, 1) then
    raise exception '案件内容と数量の数が合いません' using errcode = 'P0001';
  end if;

  -- ドライバー本人は、承認済みの分は直せない（分かりやすい日本語で止める）
  if own is not null and exists (
    select 1 from public.work_day_entries
     where company_id = cid and work_date = p_work_date and driver_id = did
       and project_item_id = any(p_item_ids) and status = 'approved'
  ) then
    raise exception '承認済みの報告は変更できません。担当者に連絡してください。' using errcode = 'P0001', hint = 'ALREADY_APPROVED';
  end if;

  for i in 1 .. coalesce(array_length(p_item_ids, 1), 0) loop
    if coalesce(p_qtys[i], 0) <= 0 then
      delete from public.work_day_entries
       where company_id = cid and work_date = p_work_date and driver_id = did and project_item_id = p_item_ids[i]
         and (public.is_admin() or status <> 'approved');
    else
      insert into public.work_day_entries (company_id, work_date, driver_id, project_item_id, qty, memo, source, status, submitted_by)
      values (cid, p_work_date, did, p_item_ids[i], p_qtys[i], coalesce(p_memo, ''), src, 'submitted', auth.uid())
      on conflict (company_id, work_date, driver_id, project_item_id) do update
        set qty = excluded.qty,
            memo = excluded.memo,
            source = excluded.source,
            status = case when public.is_admin() and public.work_day_entries.status = 'approved'
                          then 'approved'::public.day_entry_status else 'submitted'::public.day_entry_status end,
            reject_reason = '',
            submitted_by = auth.uid(),
            updated_at = now();
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

-- 承認・差戻し（admin 以上）
create or replace function public.approve_day_entries(p_ids uuid[], p_approve boolean default true, p_reason text default '')
returns integer language plpgsql security invoker set search_path = public as $$
declare cid uuid := public.current_company_id(); n integer;
begin
  if not public.is_admin() then
    raise exception '権限がありません' using errcode = 'P0001', hint = 'FORBIDDEN';
  end if;
  update public.work_day_entries
     set status = case when p_approve then 'approved'::public.day_entry_status else 'rejected'::public.day_entry_status end,
         reject_reason = case when p_approve then '' else coalesce(btrim(p_reason), '') end,
         approved_by = auth.uid(),
         approved_at = now(),
         updated_at = now()
   where company_id = cid and id = any(p_ids);
  get diagnostics n = row_count;
  return n;
end $$;

-- その月の承認済みの日別を、月次の稼働行にまとめて反映し直す（admin 以上）
create or replace function public.apply_day_entries(p_month date)
returns integer language plpgsql security invoker set search_path = public as $$
declare cid uuid := public.current_company_id(); r record; n integer := 0;
begin
  if not public.is_admin() then
    raise exception '権限がありません' using errcode = 'P0001', hint = 'FORBIDDEN';
  end if;
  if public.is_month_closed(cid, p_month) then
    raise exception '締め済みの月（%）は変更できません', to_char(p_month, 'YYYY-MM') using errcode = 'P0001', hint = 'MONTH_CLOSED';
  end if;
  for r in
    select distinct driver_id, project_item_id
      from public.work_day_entries
     where company_id = cid and month = p_month and status = 'approved'
  loop
    perform public.sync_work_entry_from_days(cid, p_month, r.driver_id, r.project_item_id);
    n := n + 1;
  end loop;
  return n;
end $$;

-- ドライバーが今日の報告を出すための案件内容の候補
-- ドライバーは案件マスタを直接読めない（締め済み月の自分の稼働に紐づくものだけ）ため
-- security definer にして、会社とドライバー本人であることを関数の中で確認する
create or replace function public.driver_day_items()
returns table (project_item_id uuid, project_name text, item_name text, unit public.item_unit, recent boolean)
language sql stable security definer set search_path = public as $$
  select pi.id, p.name, pi.name, pi.unit,
         exists (
           select 1 from public.work_day_entries e
            where e.driver_id = public.current_driver_id() and e.project_item_id = pi.id
              and e.work_date >= current_date - 60
         ) as recent
    from public.project_items pi
    join public.projects p on p.id = pi.project_id
   where pi.company_id = public.current_company_id() and pi.is_active and p.is_active
     and (public.is_staff() or public.is_driver_user())
   order by 5 desc, p.sort_order, pi.sort_order, p.name, pi.name;
$$;

-- =============================================================================
-- 異常の検知に運行管理のルールを追加する（12〜16 番。0011 の detect_anomalies を置き換える）
-- =============================================================================
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

  -- 12. 期限が切れた書類（免許証・車検・保険・健康診断など）
  for r in
    select id, kind, label, expires_on, driver_name, vehicle_plate
      from public.v_document_list
     where company_id = cid and is_active and expiry_status = 'expired'
  loop
    fp := public.record_alert(cid, p_month, 'document_expired', 'high',
      coalesce(nullif(r.driver_name, ''), nullif(r.vehicle_plate, ''), '') || ' の' || coalesce(nullif(r.label, ''), r.kind::text) || 'が期限切れです',
      '有効期限 ' || to_char(r.expires_on, 'YYYY/MM/DD') || ' を過ぎています。更新して登録し直してください。',
      null, 'documents', r.id::text, '/fleet?tab=documents', 'document_expired:' || r.id);
    fps := fps || fp;
  end loop;

  -- 13. まもなく期限が来る書類
  for r in
    select id, kind, label, expires_on, days_left, driver_name, vehicle_plate
      from public.v_document_list
     where company_id = cid and is_active and expiry_status = 'soon'
  loop
    fp := public.record_alert(cid, p_month, 'document_expiring', 'medium',
      coalesce(nullif(r.driver_name, ''), nullif(r.vehicle_plate, ''), '') || ' の' || coalesce(nullif(r.label, ''), r.kind::text) || 'があと ' || r.days_left || ' 日で期限です',
      '有効期限 ' || to_char(r.expires_on, 'YYYY/MM/DD') || '。早めに更新してください。',
      null, 'documents', r.id::text, '/fleet?tab=documents', 'document_expiring:' || r.id);
    fps := fps || fp;
  end loop;

  -- 14. 稼働した日の点呼が記録されていない
  select coalesce(roll_call_missing_count, 0) into n from public.v_day_status where company_id = cid and month = p_month;
  if coalesce(n, 0) > 0 then
    fp := public.record_alert(cid, p_month, 'roll_call_missing', 'high', '点呼の記録が無い日が ' || n || ' 日あります',
      '稼働した日は業務前・業務後の点呼を記録し、1 年間保存する必要があります。', null, 'daily_reports', '', '/daily' || href_m,
      'roll_call_missing:' || m);
    fps := fps || fp;
  end if;

  -- 15. 貨物軽自動車安全管理者が選任されていない
  if not exists (select 1 from public.safety_managers where company_id = cid and is_active and appointed_on is not null) then
    fp := public.record_alert(cid, p_month, 'safety_manager_missing', 'high', '貨物軽自動車安全管理者が選任されていません',
      '2025 年 4 月施行の制度で、営業所ごとに 1 名以上の選任が必要です（2027 年 3 月末まで猶予）。', null, 'safety_managers', '', '/settings/safety',
      'safety_manager_missing:' || m);
    fps := fps || fp;
  end if;

  -- 16. 承認待ちの日別の稼働が残っている
  select coalesce(pending_count, 0) into n from public.v_day_status where company_id = cid and month = p_month;
  if coalesce(n, 0) > 0 then
    fp := public.record_alert(cid, p_month, 'day_entry_pending', 'medium', '承認待ちの稼働報告が ' || n || ' 件あります',
      'ドライバーからの報告を承認すると、月次の稼働に反映されます。', null, 'work_day_entries', '', '/daily' || href_m,
      'day_entry_pending:' || m);
    fps := fps || fp;
  end if;

  -- 検知しなくなったものは自動で解決済みにする
  update public.alerts
     set status = 'resolved', resolved_at = now(), updated_at = now()
   where company_id = cid and month = p_month and status = 'open' and not (fingerprint = any(fps));
  get diagnostics n = row_count;

  select count(*) into closed_n from public.alerts where company_id = cid and month = p_month and status = 'open';
  return jsonb_build_object('detected', coalesce(array_length(fps, 1), 0), 'open', closed_n, 'auto_resolved', n);
end $$;

-- =============================================================================
-- データ全削除に 0012 のテーブルを追加（reset_company_data を置き換える）
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
-- 権限（0006 と同じ方針を 0012 で追加したテーブル・ビュー・関数にも適用する）
-- =============================================================================
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;
grant execute on all functions in schema public to authenticated, service_role;

-- 機密テーブルはサービスロール専用のまま
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
revoke execute on function public.line_consume_code(text, text, uuid) from authenticated, anon, public;
revoke execute on function public.sync_work_entry_from_days(uuid, date, uuid, uuid) from authenticated, anon, public;

-- =============================================================================
-- 再発したアラートを「未対応」に戻す（record_alert を置き換える）
-- =============================================================================
-- アラートを 1 件記録する（同じ fingerprint があれば内容を更新。再発したら未対応に戻し、対象外は触らない）
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
        -- 一度直ったものが再発したら「未対応」に戻す。「対象外」にしたものは戻さない
        status = case when public.alerts.status = 'ignored' then 'ignored'::public.alert_status else 'open'::public.alert_status end,
        resolved_at = case when public.alerts.status = 'ignored' then public.alerts.resolved_at else null end,
        resolved_by = case when public.alerts.status = 'ignored' then public.alerts.resolved_by else null end,
        detected_at = now(),
        updated_at = now();
  return p_fingerprint;
end $$;
