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
