-- =============================================================================
-- 0024 法定帳票と監査対応
--   0012 で点呼・業務記録・車両・書類までは取れるようになったが、
--   「監査で出してください」と言われる帳票がそろっていなかった。
--
--   - drivers に運転者台帳の項目（生年月日・住所・雇入れ・選任・退職・免許の種類）
--   - aptitude_tests   適性診断（初任・適齢・特定・一般）の受診記録
--   - companies に保存期間と診断の間隔（会社ごとに変えられる）
--   - v_driver_roster       運転者台帳（1 人 1 行。免許は documents から引く）
--   - v_record_retention    何をいつまで保存するか・いま何件持っているか
--   - v_compliance_gaps     監査で足りないもの（台帳の記入漏れ・指導・診断・健康診断）
--
--   **記録は消さない**。保存期間は「いつまで保存する必要があるか」を示すだけで、
--   期限が過ぎた記録を自動で消すことはしない（消してよいかは会社が決める）。
-- =============================================================================

-- ---------- 運転者台帳の項目 ----------
alter table public.drivers add column if not exists roster_no text not null default '';
alter table public.drivers add column if not exists birth_date date;
alter table public.drivers add column if not exists address text not null default '';
alter table public.drivers add column if not exists hired_on date;        -- 雇入れ（業務委託の開始）
alter table public.drivers add column if not exists appointed_on date;    -- 運転者に選任した日
alter table public.drivers add column if not exists retired_on date;      -- 退職・契約終了（保存期間の起点）
alter table public.drivers add column if not exists license_kinds text not null default '';
alter table public.drivers add column if not exists license_conditions text not null default '';

comment on column public.drivers.roster_no is '運転者台帳の作成番号（会社が決める。空でもよい）';
comment on column public.drivers.appointed_on is '運転者に選任した日。初任の指導・初任診断の起点';
comment on column public.drivers.retired_on is '退職・契約終了日。台帳の保存期間（既定 3 年）の起点';

-- ---------- 適性診断 ----------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'aptitude_kind') then
    create type public.aptitude_kind as enum ('initial', 'age', 'specific', 'general');
  end if;
end $$;

create table if not exists public.aptitude_tests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  driver_id uuid not null references public.drivers(id) on delete cascade,
  kind public.aptitude_kind not null default 'general',
  taken_on date not null,
  institution text not null default '',
  result text not null default '',
  memo text not null default '',
  file_path text not null default '',
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (driver_id, kind, taken_on)
);
create index if not exists aptitude_tests_company_idx on public.aptitude_tests (company_id, taken_on);
comment on table public.aptitude_tests is '適性診断の受診記録（初任・適齢・特定・一般）。運転者台帳に載せる';

-- ---------- 保存期間と診断の間隔（会社ごと） ----------
alter table public.companies add column if not exists retention_daily_years integer not null default 1;        -- 運転日報・点呼記録
alter table public.companies add column if not exists retention_instruction_years integer not null default 3;  -- 指導・監督の記録
alter table public.companies add column if not exists retention_incident_years integer not null default 3;     -- 事故の記録
alter table public.companies add column if not exists retention_roster_years integer not null default 3;       -- 運転者台帳（退職後）
alter table public.companies add column if not exists aptitude_age_from integer not null default 65;           -- 適齢診断の対象年齢
alter table public.companies add column if not exists aptitude_age_years integer not null default 3;           -- 適齢診断の間隔
alter table public.companies add column if not exists health_check_months integer not null default 12;         -- 健康診断の間隔

alter table public.companies drop constraint if exists companies_retention_check;
alter table public.companies add constraint companies_retention_check check (
  retention_daily_years between 1 and 20
  and retention_instruction_years between 1 and 20
  and retention_incident_years between 1 and 20
  and retention_roster_years between 1 and 20
  and aptitude_age_from between 40 and 100
  and aptitude_age_years between 1 and 10
  and health_check_months between 1 and 60
);

comment on column public.companies.retention_daily_years is '運転日報・点呼記録の保存年数（既定 1 年）。法令の目安で、会社ごとに延ばせる';
comment on column public.companies.aptitude_age_from is '適齢診断の対象になる年齢（既定 65 歳）';

-- ---------- 会社 ID の自動補完・更新日時 ----------
create or replace function public.t24_fill_company_from_driver()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.company_id is null then
    select company_id into new.company_id from public.drivers where id = new.driver_id;
  end if;
  return new;
end $$;

drop trigger if exists t24_aptitude_tests_company on public.aptitude_tests;
create trigger t24_aptitude_tests_company before insert on public.aptitude_tests
  for each row execute function public.t24_fill_company_from_driver();

drop trigger if exists t24_aptitude_tests_updated_at on public.aptitude_tests;
create trigger t24_aptitude_tests_updated_at before update on public.aptitude_tests
  for each row execute function public.set_updated_at();

-- 他社のドライバーにつなげない
create or replace function public.t24_guard_same_company()
returns trigger language plpgsql security definer set search_path = public as $$
declare other uuid;
begin
  select company_id into other from public.drivers where id = new.driver_id;
  if other is null or other <> new.company_id then
    raise exception 'ドライバーが違う会社のものです' using errcode = 'P0001', hint = 'CROSS_COMPANY';
  end if;
  return new;
end $$;

drop trigger if exists t24_aptitude_tests_same_company on public.aptitude_tests;
create trigger t24_aptitude_tests_same_company before insert or update on public.aptitude_tests
  for each row execute function public.t24_guard_same_company();

-- =============================================================================
-- RLS：スタッフは見られる、書けるのは admin 以上。ドライバーは自分の分だけ読める
-- =============================================================================
alter table public.aptitude_tests enable row level security;

drop policy if exists aptitude_tests_select on public.aptitude_tests;
create policy aptitude_tests_select on public.aptitude_tests for select to authenticated
  using (company_id = public.current_company_id() and (public.is_staff() or driver_id = public.current_driver_id()));
drop policy if exists aptitude_tests_write on public.aptitude_tests;
create policy aptitude_tests_write on public.aptitude_tests for all to authenticated
  using (company_id = public.current_company_id() and public.is_admin())
  with check (company_id = public.current_company_id() and public.is_admin());

-- 監査ログ
drop trigger if exists t90_audit on public.aptitude_tests;
create trigger t90_audit after insert or update or delete on public.aptitude_tests
  for each row execute function public.audit_row_change();

-- =============================================================================
-- ビュー
-- =============================================================================

-- ---------- 運転者台帳（1 人 1 行） ----------
-- 免許証の番号・有効期限は documents（kind='license'）から引く（二重に持たない）。
-- 指導・診断・事故は件数と最終日だけを出し、明細は各テーブルから引く。
-- v_compliance_gaps が v_driver_roster を使うので、作り直すときは先に落とす（再適用で落ちないように）
drop view if exists public.v_compliance_gaps;
drop view if exists public.v_driver_roster;
create view public.v_driver_roster
with (security_invoker = true) as
select
  d.id as driver_id,
  d.company_id,
  d.roster_no,
  d.name,
  d.kana,
  d.birth_date,
  -- 年齢（適齢診断の判定に使う）
  case when d.birth_date is null then null
       else extract(year from age(current_date, d.birth_date))::integer end as age,
  d.address,
  d.phone,
  d.hired_on,
  d.appointed_on,
  d.retired_on,
  d.is_active,
  d.sort_order,
  d.license_kinds,
  d.license_conditions,
  lic.number as license_no,
  lic.issued_on as license_issued_on,
  lic.expires_on as license_expires_on,
  hc.issued_on as health_check_on,
  ins.last_on as instruction_last_on,
  ins.cnt as instruction_count,
  apt.last_on as aptitude_last_on,
  apt.initial_on as aptitude_initial_on,
  apt.age_on as aptitude_age_on,
  inc.accident_count,
  inc.violation_count,
  -- いつまで保存する必要があるか（退職していなければ null ＝ 保存し続ける）
  case when d.retired_on is null then null
       else (d.retired_on + make_interval(years => c.retention_roster_years))::date end as keep_until
from public.drivers d
join public.companies c on c.id = d.company_id
left join lateral (
  select doc.number, doc.issued_on, doc.expires_on
    from public.documents doc
   where doc.driver_id = d.id and doc.kind = 'license' and doc.is_active
   order by doc.expires_on desc nulls last
   limit 1
) lic on true
left join lateral (
  select doc.issued_on
    from public.documents doc
   where doc.driver_id = d.id and doc.kind = 'health_check' and doc.is_active
   order by doc.issued_on desc nulls last
   limit 1
) hc on true
left join lateral (
  select max(i.instructed_on) as last_on, count(*)::integer as cnt
    from public.driver_instructions i where i.driver_id = d.id
) ins on true
left join lateral (
  select max(a.taken_on) as last_on,
         max(a.taken_on) filter (where a.kind = 'initial') as initial_on,
         max(a.taken_on) filter (where a.kind = 'age') as age_on
    from public.aptitude_tests a where a.driver_id = d.id
) apt on true
left join lateral (
  select count(*) filter (where x.kind = 'accident')::integer as accident_count,
         count(*) filter (where x.kind = 'violation')::integer as violation_count
    from public.incidents x where x.driver_id = d.id
) inc on true;

comment on view public.v_driver_roster is '運転者台帳。免許と健康診断は documents から、指導・診断・事故は件数と最終日を付ける';

-- ---------- 保存期間（何をいつまで持つか・いま何件あるか） ----------
drop view if exists public.v_record_retention;
create view public.v_record_retention
with (security_invoker = true) as
select c.id as company_id, k.kind, k.label, k.years, k.basis,
       coalesce(a.cnt, 0) as record_count,
       a.oldest_on,
       coalesce(a.expired_count, 0) as expired_count
  from public.companies c
  cross join lateral (
    values
      ('daily_report', '運転日報・点呼記録', c.retention_daily_years, '記録の日から'),
      ('instruction', '指導・監督の記録', c.retention_instruction_years, '実施の日から'),
      ('incident', '事故・違反の記録', c.retention_incident_years, '発生の日から'),
      ('aptitude', '適性診断の記録', c.retention_instruction_years, '受診の日から'),
      ('driver_roster', '運転者台帳', c.retention_roster_years, '退職・契約終了の日から')
  ) as k(kind, label, years, basis)
  left join lateral (
    select
      case k.kind
        when 'daily_report' then (select count(*)::integer from public.daily_reports x where x.company_id = c.id)
        when 'instruction' then (select count(*)::integer from public.driver_instructions x where x.company_id = c.id)
        when 'incident' then (select count(*)::integer from public.incidents x where x.company_id = c.id)
        when 'aptitude' then (select count(*)::integer from public.aptitude_tests x where x.company_id = c.id)
        else (select count(*)::integer from public.drivers x where x.company_id = c.id)
      end as cnt,
      case k.kind
        when 'daily_report' then (select min(x.work_date) from public.daily_reports x where x.company_id = c.id)
        when 'instruction' then (select min(x.instructed_on) from public.driver_instructions x where x.company_id = c.id)
        when 'incident' then (select min(x.occurred_at)::date from public.incidents x where x.company_id = c.id)
        when 'aptitude' then (select min(x.taken_on) from public.aptitude_tests x where x.company_id = c.id)
        else (select min(x.retired_on) from public.drivers x where x.company_id = c.id)
      end as oldest_on,
      case k.kind
        when 'daily_report' then (select count(*)::integer from public.daily_reports x
                                   where x.company_id = c.id and x.work_date < current_date - make_interval(years => k.years))
        when 'instruction' then (select count(*)::integer from public.driver_instructions x
                                   where x.company_id = c.id and x.instructed_on < current_date - make_interval(years => k.years))
        when 'incident' then (select count(*)::integer from public.incidents x
                                   where x.company_id = c.id and x.occurred_at < current_date - make_interval(years => k.years))
        when 'aptitude' then (select count(*)::integer from public.aptitude_tests x
                                   where x.company_id = c.id and x.taken_on < current_date - make_interval(years => k.years))
        else (select count(*)::integer from public.drivers x
                                   where x.company_id = c.id and x.retired_on is not null
                                     and x.retired_on < current_date - make_interval(years => k.years))
      end as expired_count
  ) a on true;

comment on view public.v_record_retention is '記録の保存期間。expired_count は「保存期間を過ぎた件数」で、消すかどうかは会社が決める（自動では消さない）';

-- ---------- 帳票にドライバー名を付ける（埋め込みリソースを使わないため） ----------
drop view if exists public.v_driver_instruction_list;
create view public.v_driver_instruction_list
with (security_invoker = true) as
select i.id, i.company_id, i.driver_id, d.name as driver_name, d.sort_order as driver_sort_order,
       i.kind, i.instructed_on, i.hours, i.topics, i.instructor, i.memo, i.created_at
  from public.driver_instructions i
  join public.drivers d on d.id = i.driver_id;
comment on view public.v_driver_instruction_list is '指導・監督の記録にドライバー名を付けたもの';

drop view if exists public.v_incident_list;
create view public.v_incident_list
with (security_invoker = true) as
select x.id, x.company_id, x.driver_id, d.name as driver_name,
       x.vehicle_id, v.plate as vehicle_plate,
       x.occurred_at, x.kind, x.place, x.description, x.cause, x.prevention,
       x.reported, x.cost, x.memo, x.created_at
  from public.incidents x
  left join public.drivers d on d.id = x.driver_id
  left join public.vehicles v on v.id = x.vehicle_id;
comment on view public.v_incident_list is '事故・違反の記録にドライバー名と車両番号を付けたもの';

drop view if exists public.v_aptitude_list;
create view public.v_aptitude_list
with (security_invoker = true) as
select a.id, a.company_id, a.driver_id, d.name as driver_name, d.sort_order as driver_sort_order,
       a.kind, a.taken_on, a.institution, a.result, a.memo, a.file_path, a.created_at
  from public.aptitude_tests a
  join public.drivers d on d.id = a.driver_id;
comment on view public.v_aptitude_list is '適性診断の記録にドライバー名を付けたもの';

-- ---------- 監査で足りないもの ----------
-- 在籍しているドライバー（is_active かつ退職日なし）だけを見る。
-- 車検・保険・免許の期限切れと点呼の記録漏れは 0012 の異常検知（alerts）が拾うので、
-- ここでは台帳の記入漏れ・指導・適性診断・健康診断の間隔だけを出す（二重に出さない）。
drop view if exists public.v_compliance_gaps;
create view public.v_compliance_gaps
with (security_invoker = true) as
with r as (
  select v.*, c.aptitude_age_from, c.aptitude_age_years, c.health_check_months
    from public.v_driver_roster v
    join public.companies c on c.id = v.company_id
   where v.is_active and v.retired_on is null
)
select company_id, driver_id, driver_name, kind, severity, title, detail, on_date
from (
  -- 台帳の記入漏れ
  select r.company_id, r.driver_id, r.name as driver_name, 'roster_incomplete' as kind, 'medium' as severity,
         '運転者台帳の記入漏れ' as title,
         concat_ws('・',
           case when r.birth_date is null then '生年月日' end,
           case when r.address = '' then '住所' end,
           case when r.hired_on is null then '雇入れ年月日' end,
           case when r.appointed_on is null then '選任年月日' end) as detail,
         null::date as on_date
    from r
   where r.birth_date is null or r.address = '' or r.hired_on is null or r.appointed_on is null

  union all
  -- 有効な免許証の記録が無い
  select r.company_id, r.driver_id, r.name, 'license_missing', 'high',
         '運転免許証の記録がありません', '車両と書類から免許証を登録してください', null::date
    from r where r.license_no = '' or r.license_no is null or r.license_expires_on is null

  union all
  -- 初任の指導（選任から 1 か月を過ぎても記録が無い）
  select r.company_id, r.driver_id, r.name, 'initial_instruction_missing', 'high',
         '初任運転者への指導の記録がありません',
         concat('選任 ', to_char(r.appointed_on, 'YYYY-MM-DD'), ' から 1 か月を過ぎています'), r.appointed_on
    from r
   where r.appointed_on is not null
     and r.appointed_on < current_date - interval '1 month'
     and not exists (select 1 from public.driver_instructions i
                      where i.driver_id = r.driver_id and i.kind = 'initial')

  union all
  -- 初任診断（選任から 1 年を過ぎても記録が無い）
  select r.company_id, r.driver_id, r.name, 'initial_aptitude_missing', 'high',
         '初任診断の記録がありません',
         concat('選任 ', to_char(r.appointed_on, 'YYYY-MM-DD'), ' から 1 年を過ぎています'), r.appointed_on
    from r
   where r.appointed_on is not null
     and r.appointed_on < current_date - interval '1 year'
     and r.aptitude_initial_on is null

  union all
  -- 定期の指導（直近 1 年に記録が無い）
  select r.company_id, r.driver_id, r.name, 'instruction_overdue', 'medium',
         'この 1 年の指導の記録がありません',
         case when r.instruction_last_on is null then 'まだ 1 件もありません'
              else concat('最後の指導は ', to_char(r.instruction_last_on, 'YYYY-MM-DD')) end,
         r.instruction_last_on
    from r
   where r.instruction_last_on is null or r.instruction_last_on < current_date - interval '1 year'

  union all
  -- 健康診断の間隔
  select r.company_id, r.driver_id, r.name, 'health_check_overdue', 'medium',
         '健康診断の記録が古いか、ありません',
         case when r.health_check_on is null then 'まだ 1 件もありません'
              else concat('最後の受診は ', to_char(r.health_check_on, 'YYYY-MM-DD')) end,
         r.health_check_on
    from r
   where r.health_check_on is null
      or r.health_check_on < current_date - make_interval(months => r.health_check_months)

  union all
  -- 適齢診断（対象の年齢で、間隔を過ぎている）
  select r.company_id, r.driver_id, r.name, 'age_aptitude_missing', 'medium',
         '適齢診断の記録が古いか、ありません',
         concat(r.age, ' 歳（', r.aptitude_age_from, ' 歳以上は ', r.aptitude_age_years, ' 年ごと）'),
         r.aptitude_age_on
    from r
   where r.age is not null and r.age >= r.aptitude_age_from
     and (r.aptitude_age_on is null
          or r.aptitude_age_on < current_date - make_interval(years => r.aptitude_age_years))
) g;

comment on view public.v_compliance_gaps is '監査で足りないもの（台帳の記入漏れ・指導・適性診断・健康診断）。期限切れの書類と点呼の漏れは alerts が拾う';

-- =============================================================================
-- バックアップと復元（version 9）・データ全削除
--   0023 の定休日（weekly_off）が復元されていなかったので、ここで一緒に戻すようにする
-- =============================================================================
create or replace function public.export_backup()
returns jsonb language plpgsql security invoker set search_path = public as $$
declare cid uuid := public.current_company_id();
begin
  if not public.is_admin() then
    raise exception '権限がありません' using errcode = 'P0001', hint = 'FORBIDDEN';
  end if;
  -- PostgreSQL の関数は引数が 100 個までなので、jsonb_build_object を 2 つに分けてつなぐ
  return jsonb_build_object(
    'version', 9,
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
    'cash_snapshots', (select coalesce(jsonb_agg(to_jsonb(x) order by x.as_of), '[]'::jsonb) from public.cash_snapshots x where x.company_id = cid),
    -- 0012 運行管理と法令対応
    'vehicles', (select coalesce(jsonb_agg(to_jsonb(x) order by x.sort_order, x.plate), '[]'::jsonb) from public.vehicles x where x.company_id = cid),
    'safety_managers', (select coalesce(jsonb_agg(to_jsonb(x) order by x.name), '[]'::jsonb) from public.safety_managers x where x.company_id = cid),
    'documents', (select coalesce(jsonb_agg(to_jsonb(x) order by x.expires_on), '[]'::jsonb) from public.documents x where x.company_id = cid),
    'daily_reports', (select coalesce(jsonb_agg(to_jsonb(x) order by x.work_date, x.driver_id), '[]'::jsonb) from public.daily_reports x where x.company_id = cid),
    'work_day_entries', (select coalesce(jsonb_agg(to_jsonb(x) order by x.work_date, x.driver_id), '[]'::jsonb) from public.work_day_entries x where x.company_id = cid),
    'driver_instructions', (select coalesce(jsonb_agg(to_jsonb(x) order by x.instructed_on), '[]'::jsonb) from public.driver_instructions x where x.company_id = cid)
  ) || jsonb_build_object(
    'incidents', (select coalesce(jsonb_agg(to_jsonb(x) order by x.occurred_at), '[]'::jsonb) from public.incidents x where x.company_id = cid),
    -- 0013 取り込みと採用・契約
    'import_profiles', (select coalesce(jsonb_agg(to_jsonb(x) order by x.name), '[]'::jsonb) from public.import_profiles x where x.company_id = cid),
    'applicants', (select coalesce(jsonb_agg(to_jsonb(x) order by x.applied_on), '[]'::jsonb) from public.applicants x where x.company_id = cid),
    'applicant_events', (select coalesce(jsonb_agg(to_jsonb(x) order by x.applicant_id, x.happened_on), '[]'::jsonb) from public.applicant_events x where x.company_id = cid),
    'contracts', (select coalesce(jsonb_agg(to_jsonb(x) order by x.start_on), '[]'::jsonb) from public.contracts x where x.company_id = cid),
    -- 0014 法人の経営管理
    'tax_tasks', (select coalesce(jsonb_agg(to_jsonb(x) order by x.due_on), '[]'::jsonb) from public.tax_tasks x where x.company_id = cid),
    'loans', (select coalesce(jsonb_agg(to_jsonb(x) order by x.start_on), '[]'::jsonb) from public.loans x where x.company_id = cid),
    'loan_payments', (select coalesce(jsonb_agg(to_jsonb(x) order by x.loan_id, x.seq), '[]'::jsonb) from public.loan_payments x where x.company_id = cid),
    -- 0018 支払通知
    'payment_notices', (select coalesce(jsonb_agg(to_jsonb(x) order by x.month, x.notice_no), '[]'::jsonb) from public.payment_notices x where x.company_id = cid),
    'payment_notice_items', (select coalesce(jsonb_agg(to_jsonb(x) order by x.notice_id, x.sort_order), '[]'::jsonb) from public.payment_notice_items x where x.company_id = cid),
    -- 0019 代表（代表専用のテーブルは RLS により、代表以外が書き出すと空になる）
    'approvals', (select coalesce(jsonb_agg(to_jsonb(x) order by x.requested_at), '[]'::jsonb) from public.approvals x where x.company_id = cid),
    'decisions', (select coalesce(jsonb_agg(to_jsonb(x) order by x.decided_on), '[]'::jsonb) from public.decisions x where x.company_id = cid),
    'company_profile', (select to_jsonb(x) from public.company_profile x where x.company_id = cid),
    'officers', (select coalesce(jsonb_agg(to_jsonb(x) order by x.sort_order, x.name), '[]'::jsonb) from public.officers x where x.company_id = cid),
    'shareholders', (select coalesce(jsonb_agg(to_jsonb(x) order by x.sort_order, x.name), '[]'::jsonb) from public.shareholders x where x.company_id = cid),
    'insurance_policies', (select coalesce(jsonb_agg(to_jsonb(x) order by x.expires_on), '[]'::jsonb) from public.insurance_policies x where x.company_id = cid),
    'advisors', (select coalesce(jsonb_agg(to_jsonb(x) order by x.sort_order, x.name), '[]'::jsonb) from public.advisors x where x.company_id = cid),
    'guarantees', (select coalesce(jsonb_agg(to_jsonb(x) order by x.starts_on), '[]'::jsonb) from public.guarantees x where x.company_id = cid),
    'plans', (select coalesce(jsonb_agg(to_jsonb(x) order by x.from_year), '[]'::jsonb) from public.plans x where x.company_id = cid),
    'plan_years', (select coalesce(jsonb_agg(to_jsonb(x) order by x.plan_id, x.year), '[]'::jsonb) from public.plan_years x where x.company_id = cid),
    -- 0020 決裁のルールと委任・ドライバーの振込口座（口座は drivers から分かれた）
    'approval_rules', (select coalesce(jsonb_agg(to_jsonb(x) order by x.sort_order), '[]'::jsonb) from public.approval_rules x where x.company_id = cid),
    'approval_delegations', (select coalesce(jsonb_agg(to_jsonb(x) order by x.from_on), '[]'::jsonb) from public.approval_delegations x where x.company_id = cid),
    'driver_bank_accounts', (select coalesce(jsonb_agg(to_jsonb(x) order by x.driver_id), '[]'::jsonb) from public.driver_bank_accounts x where x.company_id = cid),
    -- 0023 配車・シフト（必要人数・休み希望・割り当て）
    'project_demands', (select coalesce(jsonb_agg(to_jsonb(x) order by x.project_item_id, x.weekday), '[]'::jsonb) from public.project_demands x where x.company_id = cid),
    'project_demand_days', (select coalesce(jsonb_agg(to_jsonb(x) order by x.on_date, x.project_item_id), '[]'::jsonb) from public.project_demand_days x where x.company_id = cid),
    'driver_day_offs', (select coalesce(jsonb_agg(to_jsonb(x) order by x.on_date, x.driver_id), '[]'::jsonb) from public.driver_day_offs x where x.company_id = cid),
    'dispatch_assignments', (select coalesce(jsonb_agg(to_jsonb(x) order by x.on_date, x.driver_id), '[]'::jsonb) from public.dispatch_assignments x where x.company_id = cid),
    -- 0024 法定帳票（適性診断。運転者台帳の項目は drivers の行にそのまま入る）
    'aptitude_tests', (select coalesce(jsonb_agg(to_jsonb(x) order by x.taken_on, x.driver_id), '[]'::jsonb) from public.aptitude_tests x where x.company_id = cid)
  );
end $$;

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
    or exists (select 1 from jsonb_array_elements(coalesce(p_data->'cash_snapshots','[]')) x join public.cash_snapshots t on t.id = (x->>'id')::uuid where t.company_id <> p_company_id)
    or exists (select 1 from jsonb_array_elements(coalesce(p_data->'vehicles','[]')) x join public.vehicles t on t.id = (x->>'id')::uuid where t.company_id <> p_company_id)
    or exists (select 1 from jsonb_array_elements(coalesce(p_data->'safety_managers','[]')) x join public.safety_managers t on t.id = (x->>'id')::uuid where t.company_id <> p_company_id)
    or exists (select 1 from jsonb_array_elements(coalesce(p_data->'documents','[]')) x join public.documents t on t.id = (x->>'id')::uuid where t.company_id <> p_company_id)
    or exists (select 1 from jsonb_array_elements(coalesce(p_data->'daily_reports','[]')) x join public.daily_reports t on t.id = (x->>'id')::uuid where t.company_id <> p_company_id)
    or exists (select 1 from jsonb_array_elements(coalesce(p_data->'work_day_entries','[]')) x join public.work_day_entries t on t.id = (x->>'id')::uuid where t.company_id <> p_company_id)
    or exists (select 1 from jsonb_array_elements(coalesce(p_data->'driver_instructions','[]')) x join public.driver_instructions t on t.id = (x->>'id')::uuid where t.company_id <> p_company_id)
    or exists (select 1 from jsonb_array_elements(coalesce(p_data->'incidents','[]')) x join public.incidents t on t.id = (x->>'id')::uuid where t.company_id <> p_company_id)
    or exists (select 1 from jsonb_array_elements(coalesce(p_data->'import_profiles','[]')) x join public.import_profiles t on t.id = (x->>'id')::uuid where t.company_id <> p_company_id)
    or exists (select 1 from jsonb_array_elements(coalesce(p_data->'applicants','[]')) x join public.applicants t on t.id = (x->>'id')::uuid where t.company_id <> p_company_id)
    or exists (select 1 from jsonb_array_elements(coalesce(p_data->'applicant_events','[]')) x join public.applicant_events t on t.id = (x->>'id')::uuid where t.company_id <> p_company_id)
    or exists (select 1 from jsonb_array_elements(coalesce(p_data->'contracts','[]')) x join public.contracts t on t.id = (x->>'id')::uuid where t.company_id <> p_company_id)
    or exists (select 1 from jsonb_array_elements(coalesce(p_data->'tax_tasks','[]')) x join public.tax_tasks t on t.id = (x->>'id')::uuid where t.company_id <> p_company_id)
    or exists (select 1 from jsonb_array_elements(coalesce(p_data->'loans','[]')) x join public.loans t on t.id = (x->>'id')::uuid where t.company_id <> p_company_id)
    or exists (select 1 from jsonb_array_elements(coalesce(p_data->'loan_payments','[]')) x join public.loan_payments t on t.id = (x->>'id')::uuid where t.company_id <> p_company_id)
    or exists (select 1 from jsonb_array_elements(coalesce(p_data->'payment_notices','[]')) x join public.payment_notices t on t.id = (x->>'id')::uuid where t.company_id <> p_company_id)
    or exists (select 1 from jsonb_array_elements(coalesce(p_data->'payment_notice_items','[]')) x join public.payment_notice_items t on t.id = (x->>'id')::uuid where t.company_id <> p_company_id)
    or exists (select 1 from jsonb_array_elements(coalesce(p_data->'approvals','[]')) x join public.approvals t on t.id = (x->>'id')::uuid where t.company_id <> p_company_id)
    or exists (select 1 from jsonb_array_elements(coalesce(p_data->'decisions','[]')) x join public.decisions t on t.id = (x->>'id')::uuid where t.company_id <> p_company_id)
    or exists (select 1 from jsonb_array_elements(coalesce(p_data->'officers','[]')) x join public.officers t on t.id = (x->>'id')::uuid where t.company_id <> p_company_id)
    or exists (select 1 from jsonb_array_elements(coalesce(p_data->'shareholders','[]')) x join public.shareholders t on t.id = (x->>'id')::uuid where t.company_id <> p_company_id)
    or exists (select 1 from jsonb_array_elements(coalesce(p_data->'insurance_policies','[]')) x join public.insurance_policies t on t.id = (x->>'id')::uuid where t.company_id <> p_company_id)
    or exists (select 1 from jsonb_array_elements(coalesce(p_data->'advisors','[]')) x join public.advisors t on t.id = (x->>'id')::uuid where t.company_id <> p_company_id)
    or exists (select 1 from jsonb_array_elements(coalesce(p_data->'guarantees','[]')) x join public.guarantees t on t.id = (x->>'id')::uuid where t.company_id <> p_company_id)
    or exists (select 1 from jsonb_array_elements(coalesce(p_data->'plans','[]')) x join public.plans t on t.id = (x->>'id')::uuid where t.company_id <> p_company_id)
    or exists (select 1 from jsonb_array_elements(coalesce(p_data->'plan_years','[]')) x join public.plan_years t on t.id = (x->>'id')::uuid where t.company_id <> p_company_id)
    or exists (select 1 from jsonb_array_elements(coalesce(p_data->'approval_rules','[]')) x join public.approval_rules t on t.id = (x->>'id')::uuid where t.company_id <> p_company_id)
    or exists (select 1 from jsonb_array_elements(coalesce(p_data->'approval_delegations','[]')) x join public.approval_delegations t on t.id = (x->>'id')::uuid where t.company_id <> p_company_id)
    or exists (select 1 from jsonb_array_elements(coalesce(p_data->'driver_bank_accounts','[]')) x join public.driver_bank_accounts t on t.driver_id = (x->>'driver_id')::uuid where t.company_id <> p_company_id)
    or exists (select 1 from jsonb_array_elements(coalesce(p_data->'project_demands','[]')) x join public.project_demands t on t.id = (x->>'id')::uuid where t.company_id <> p_company_id)
    or exists (select 1 from jsonb_array_elements(coalesce(p_data->'project_demand_days','[]')) x join public.project_demand_days t on t.id = (x->>'id')::uuid where t.company_id <> p_company_id)
    or exists (select 1 from jsonb_array_elements(coalesce(p_data->'driver_day_offs','[]')) x join public.driver_day_offs t on t.id = (x->>'id')::uuid where t.company_id <> p_company_id)
    or exists (select 1 from jsonb_array_elements(coalesce(p_data->'dispatch_assignments','[]')) x join public.dispatch_assignments t on t.id = (x->>'id')::uuid where t.company_id <> p_company_id)
    or exists (select 1 from jsonb_array_elements(coalesce(p_data->'aptitude_tests','[]')) x join public.aptitude_tests t on t.id = (x->>'id')::uuid where t.company_id <> p_company_id);
$$;

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

  -- 0023 の定休日（weekly_off）と 0024 の運転者台帳の項目まで戻す
  insert into public.drivers (id, company_id, name, kana, is_active, royalty_rate, mgmt_fee, rounding_mode, phone, email, bank_info, memo, sort_order,
                              tax_mode, invoice_reg_no, payout_month_offset, payout_day, weekly_off,
                              roster_no, birth_date, address, hired_on, appointed_on, retired_on, license_kinds, license_conditions)
  select (x->>'id')::uuid, cid, x->>'name', coalesce(x->>'kana',''), coalesce((x->>'is_active')::boolean, true),
         (x->>'royalty_rate')::numeric, coalesce((x->>'mgmt_fee')::numeric, 0), (x->>'rounding_mode')::public.rounding_mode,
         coalesce(x->>'phone',''), coalesce(x->>'email',''), coalesce(x->>'bank_info',''), coalesce(x->>'memo',''), coalesce((x->>'sort_order')::integer, 0),
         coalesce((x->>'tax_mode')::public.tax_mode, 'taxable'), coalesce(x->>'invoice_reg_no',''), (x->>'payout_month_offset')::integer, (x->>'payout_day')::integer,
         coalesce((select array_agg((w)::integer) from jsonb_array_elements_text(coalesce(x->'weekly_off','[]'::jsonb)) w), '{}'),
         coalesce(x->>'roster_no',''), (x->>'birth_date')::date, coalesce(x->>'address',''),
         (x->>'hired_on')::date, (x->>'appointed_on')::date, (x->>'retired_on')::date,
         coalesce(x->>'license_kinds',''), coalesce(x->>'license_conditions','')
    from jsonb_array_elements(coalesce(p_data->'drivers','[]')) x
  on conflict (id) do update set
    name = excluded.name, kana = excluded.kana, is_active = excluded.is_active, royalty_rate = excluded.royalty_rate,
    mgmt_fee = excluded.mgmt_fee, rounding_mode = excluded.rounding_mode, phone = excluded.phone, email = excluded.email,
    bank_info = excluded.bank_info, memo = excluded.memo, sort_order = excluded.sort_order,
    tax_mode = excluded.tax_mode, invoice_reg_no = excluded.invoice_reg_no, payout_month_offset = excluded.payout_month_offset, payout_day = excluded.payout_day,
    weekly_off = excluded.weekly_off,
    roster_no = excluded.roster_no, birth_date = excluded.birth_date, address = excluded.address,
    hired_on = excluded.hired_on, appointed_on = excluded.appointed_on, retired_on = excluded.retired_on,
    license_kinds = excluded.license_kinds, license_conditions = excluded.license_conditions;
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
  -- 0020：決裁のルールと委任・持ち出しの記録・ドライバーの振込口座
  delete from public.approval_delegations where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('approval_delegations', n);
  delete from public.export_logs where company_id = cid;
  delete from public.driver_bank_accounts where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('driver_bank_accounts', n);
  -- 0019：代表（中期計画 → 計画の年 の逆順で消す）
  delete from public.plan_years where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('plan_years', n);
  delete from public.plans where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('plans', n);
  delete from public.guarantees where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('guarantees', n);
  delete from public.advisors where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('advisors', n);
  delete from public.insurance_policies where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('insurance_policies', n);
  delete from public.shareholders where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('shareholders', n);
  delete from public.officers where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('officers', n);
  delete from public.company_profile where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('company_profile', n);
  delete from public.decisions where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('decisions', n);
  delete from public.approvals where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('approvals', n);
  delete from public.login_events where company_id = cid;
  delete from public.bank_transactions where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('bank_transactions', n);
  delete from public.bank_imports where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('bank_imports', n);
  delete from public.alerts where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('alerts', n);
  delete from public.invoice_items where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('invoice_items', n);
  delete from public.invoices where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('invoices', n);
  delete from public.expenses where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('expenses', n);
  delete from public.recurring_expenses where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('recurring_expenses', n);
  delete from public.month_targets where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('month_targets', n);
  delete from public.cash_snapshots where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('cash_snapshots', n);
  delete from public.payment_notice_items where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('payment_notice_items', n);
  delete from public.payment_notices where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('payment_notices', n);
  delete from public.loan_payments where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('loan_payments', n);
  delete from public.loans where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('loans', n);
  delete from public.tax_tasks where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('tax_tasks', n);
  delete from public.import_runs where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('import_runs', n);
  delete from public.import_profiles where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('import_profiles', n);
  delete from public.applicant_events where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('applicant_events', n);
  delete from public.applicants where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('applicants', n);
  delete from public.contracts where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('contracts', n);
  delete from public.aptitude_tests where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('aptitude_tests', n);
  delete from public.dispatch_assignments where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('dispatch_assignments', n);
  delete from public.driver_day_offs where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('driver_day_offs', n);
  delete from public.project_demand_days where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('project_demand_days', n);
  delete from public.project_demands where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('project_demands', n);
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
-- 権限
--   0020 の「schema public の全テーブルへまとめて grant」は、そのあとの番号で作った
--   テーブルには届かない（0023 で気づいた）。新しいテーブルを足したら必ずここで出し直す。
-- =============================================================================
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;
revoke all on public.integration_secrets from authenticated, anon, public;
grant all on public.integration_secrets to service_role;
