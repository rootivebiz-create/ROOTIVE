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
