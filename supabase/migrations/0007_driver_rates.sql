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
