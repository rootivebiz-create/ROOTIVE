-- =============================================================================
-- 0031 中期計画を期（事業年度）で数える
--
--   0030 で月の切り替えと年次レポートは期（第N期）で見られるようにしたが、中期計画は暦年（1〜12 月）のままだった。
--   計画の「年」（plans.from_year / to_year・plan_years.year）を「期の決算の年」と読み替え、DB 側の 2 か所を期に合わせる。
--   決算月が 12 月の会社は今までと同じ結果になる。列もデータも変えない（区切り方だけを変える）。
--
--   1. fiscal_end_year(month, fiscal_month)：その月が入る期の決算の年（lib/fiscal.ts の periodEndYearOf と同じ式）
--   2. v_plan_year_actual：実績を期ごとに合計する（列は 0019 と同じ並び・同じ型）
--   3. spread_plan_year：期の月（決算月の 11 か月前〜決算月）へ配る。第1期は設立の月から。
--      端数は決算月でまとめる。actual は 12 か月前の同じ月の売上の構成比（前期の実績が無ければ均等）
-- =============================================================================

-- ---------- 1. その月が入る期の決算の年 ----------
create or replace function public.fiscal_end_year(p_month date, p_fiscal_month integer)
returns integer language sql immutable set search_path = public as $$
  select case
    when extract(month from p_month)::integer <= coalesce(p_fiscal_month, 3) then extract(year from p_month)::integer
    else extract(year from p_month)::integer + 1
  end;
$$;

comment on function public.fiscal_end_year(date, integer) is
  'その月が入る期の決算の年（0031）。決算月が 9 なら 2026-09 → 2026、2026-10 → 2027';

-- ---------- 2. 中期計画の年ごとの目標と、その期の実績 ----------
create or replace view public.v_plan_year_actual
with (security_invoker = true) as
with actual as (
  select
    pl.company_id,
    public.fiscal_end_year(pl.month, c.fiscal_month) as year,
    coalesce(sum(pl.bill), 0) as bill_actual,
    coalesce(sum(pl.operating_profit), 0) as profit_actual,
    coalesce(max(pl.active_driver_count), 0)::integer as driver_actual,
    count(*)::integer as month_count
  from public.v_month_pl pl
  join public.companies c on c.id = pl.company_id
  group by pl.company_id, public.fiscal_end_year(pl.month, c.fiscal_month)
)
select
  y.id,
  y.company_id,
  y.plan_id,
  y.year,
  y.bill_target,
  y.profit_target,
  y.driver_target,
  y.memo,
  p.name as plan_name,
  p.is_active as plan_is_active,
  coalesce(a.bill_actual, 0) as bill_actual,
  coalesce(a.profit_actual, 0) as profit_actual,
  coalesce(a.driver_actual, 0) as driver_actual,
  coalesce(a.month_count, 0) as month_count,
  case when y.bill_target <> 0 then round(coalesce(a.bill_actual, 0) / y.bill_target, 6) else null end as bill_achievement,
  case when y.profit_target <> 0 then round(coalesce(a.profit_actual, 0) / y.profit_target, 6) else null end as profit_achievement,
  case when y.bill_target <> 0 then coalesce(a.bill_actual, 0) - y.bill_target else 0 end as bill_diff,
  (coalesce(a.profit_actual, 0) - y.profit_target) as profit_diff,
  case when coalesce(a.bill_actual, 0) <> 0
       then round(coalesce(a.profit_actual, 0) / a.bill_actual, 6) else 0 end as profit_rate
from public.plan_years y
join public.plans p on p.id = y.plan_id
left join actual a on a.company_id = y.company_id and a.year = y.year;

comment on view public.v_plan_year_actual is
  '中期計画の期ごとの目標と実績（0031。year は期の決算の年、実績は v_month_pl をその期の月で合計）';

-- ---------- 3. 中期計画の期 → 月次目標へ配分 ----------
create or replace function public.spread_plan_year(p_plan_id uuid, p_year integer, p_weight text default 'even')
returns integer language plpgsql security invoker set search_path = public as $$
declare
  cid uuid := public.current_company_id();
  y record; fm integer; est date;
  first_m date; last_m date; m date; cnt integer; i integer := 0;
  w numeric; total numeric := 0; cur_bill numeric; cur_profit numeric;
  bill_rest numeric; profit_rest numeric;
begin
  if not public.is_owner() then
    raise exception '権限がありません' using errcode = 'P0001', hint = 'FORBIDDEN';
  end if;
  select * into y from public.plan_years where plan_id = p_plan_id and year = p_year and company_id = cid;
  if y.id is null then
    raise exception '計画の年が見つかりません' using errcode = 'P0001';
  end if;

  -- 期の月：決算月の 11 か月前〜決算月。第1期は設立の月から（12 か月より短いことがある）
  select coalesce(fiscal_month, 3), established_on into fm, est from public.companies where id = cid;
  fm := coalesce(fm, 3);
  last_m := make_date(p_year, fm, 1);
  first_m := (last_m - interval '11 months')::date;
  if est is not null and public.fiscal_end_year(est, fm) = p_year and date_trunc('month', est)::date > first_m then
    first_m := date_trunc('month', est)::date;
  end if;
  cnt := ((extract(year from last_m) - extract(year from first_m)) * 12
          + extract(month from last_m) - extract(month from first_m))::integer + 1;

  -- 実績の月構成比（12 か月前の同じ月の売上）。無ければ均等
  if p_weight = 'actual' then
    select coalesce(sum(bill), 0) into total from public.v_month_pl
     where company_id = cid
       and month between (first_m - interval '12 months')::date and (last_m - interval '12 months')::date;
  end if;

  bill_rest := y.bill_target;
  profit_rest := y.profit_target;
  m := first_m;
  while m <= last_m loop
    i := i + 1;
    if p_weight = 'actual' and total > 0 then
      select coalesce(bill, 0) / total into w from public.v_month_pl
       where company_id = cid and month = (m - interval '12 months')::date;
      w := coalesce(w, 0);
    else
      w := 1.0 / cnt;
    end if;
    if i = cnt then
      cur_bill := bill_rest;       -- 端数は決算月でまとめる
      cur_profit := profit_rest;
    else
      cur_bill := round(y.bill_target * w, 0);
      cur_profit := round(y.profit_target * w, 0);
      bill_rest := bill_rest - cur_bill;
      profit_rest := profit_rest - cur_profit;
    end if;
    -- すでに手で入れてある月は上書きしない
    insert into public.month_targets (company_id, month, bill_target, profit_target, driver_target)
    values (cid, m, cur_bill, cur_profit, y.driver_target)
    on conflict (company_id, month) do update
      set bill_target = case when month_targets.bill_target = 0 then excluded.bill_target else month_targets.bill_target end,
          profit_target = case when month_targets.profit_target = 0 then excluded.profit_target else month_targets.profit_target end,
          driver_target = case when month_targets.driver_target = 0 then excluded.driver_target else month_targets.driver_target end;
    m := (m + interval '1 month')::date;
  end loop;
  return cnt;
end $$;

comment on function public.spread_plan_year(uuid, integer, text) is
  '中期計画の期の目標を、その期の月へ配分する（0031。even＝均等、actual＝前期の同じ月の売上の構成比。第1期は設立の月から。端数は決算月。手入力済みの月は変えない。代表のみ）';
