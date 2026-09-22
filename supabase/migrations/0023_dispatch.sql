-- =============================================================================
-- 0023 配車・シフト（これから先の予定）
--   ここまでのアプリは「終わったことの記録と集計」だけで、予定を扱えなかった。
--   明日だれがどの案件に入るかが分からないため、欠員も、明日の売上も、
--   ドライバーへの連絡も、すべてアプリの外（口頭・LINE）で回っていた。
--
--   - project_demands        案件内容 × 曜日の必要人数（毎週のパターン）
--   - project_demand_days    特定の日だけ必要人数を変える（繁忙期・祝日）
--   - driver_day_offs        休み希望（本人が申請 → 管理者が決める）
--   - drivers.weekly_off     定休日（曜日の配列）
--   - dispatch_assignments   日 × ドライバー × 案件内容の割り当て
--
--   **予定と実績は分けたまま**にする。実績は日別の稼働（work_day_entries）が正で、
--   配車から実績を自動で作らない（「予定していたのに報告が無い」を検知できなくなるため）。
-- =============================================================================

-- ---------- 割り当ての状態 ----------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'dispatch_status') then
    create type public.dispatch_status as enum ('planned', 'confirmed', 'cancelled');
  end if;
  if not exists (select 1 from pg_type where typname = 'day_off_status') then
    create type public.day_off_status as enum ('requested', 'approved', 'rejected');
  end if;
end $$;

-- ---------- 定休日（曜日。0 = 日曜） ----------
alter table public.drivers add column if not exists weekly_off integer[] not null default '{}';
comment on column public.drivers.weekly_off is '定休日の曜日（0 = 日曜 … 6 = 土曜）。配車の自動割り当てで避ける';

-- ---------- 必要人数（案件内容 × 曜日） ----------
create table if not exists public.project_demands (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_item_id uuid not null references public.project_items(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  need integer not null default 0 check (need >= 0 and need <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_item_id, weekday)
);
create index if not exists project_demands_company_idx on public.project_demands (company_id, weekday);
comment on table public.project_demands is '案件内容ごとの「毎週この曜日は何人要る」。配車の過不足はこれと割り当ての差';

-- ---------- 特定の日だけ必要人数を変える ----------
create table if not exists public.project_demand_days (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_item_id uuid not null references public.project_items(id) on delete cascade,
  on_date date not null,
  need integer not null default 0 check (need >= 0 and need <= 200),
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_item_id, on_date)
);
create index if not exists project_demand_days_company_idx on public.project_demand_days (company_id, on_date);
comment on table public.project_demand_days is '特定の日だけの必要人数（繁忙期・祝日）。曜日のパターンより優先する';

-- ---------- 休み希望 ----------
create table if not exists public.driver_day_offs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  driver_id uuid not null references public.drivers(id) on delete cascade,
  on_date date not null,
  status public.day_off_status not null default 'requested',
  reason text not null default '',
  decided_by uuid,
  decided_at timestamptz,
  decided_note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (driver_id, on_date)
);
create index if not exists driver_day_offs_company_idx on public.driver_day_offs (company_id, on_date);
comment on table public.driver_day_offs is '休み希望。本人が申請し、管理者が承認する。承認済みの日は配車の自動割り当てで避ける';

-- ---------- 割り当て（配車） ----------
create table if not exists public.dispatch_assignments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  on_date date not null,
  driver_id uuid not null references public.drivers(id) on delete cascade,
  project_item_id uuid not null references public.project_items(id) on delete restrict,
  -- 予定の数量（日給型は 1、個数型は見込みの個数）。実績ではない
  qty_plan numeric(12,2) not null default 1 check (qty_plan >= 0),
  status public.dispatch_status not null default 'planned',
  note text not null default '',
  confirmed_at timestamptz,
  confirmed_by uuid,
  -- ドライバーへ知らせた時刻（同じ内容を二度送らないため）
  notified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, on_date, driver_id, project_item_id)
);
create index if not exists dispatch_assignments_date_idx on public.dispatch_assignments (company_id, on_date);
create index if not exists dispatch_assignments_driver_idx on public.dispatch_assignments (driver_id, on_date);
comment on table public.dispatch_assignments is '日ごとの配車（予定）。実績は work_day_entries で、こちらから自動では作らない';

-- ---------- 会社 ID の自動補完と更新日時 ----------
create or replace function public.t23_fill_company_from_item()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.company_id is null then
    select company_id into new.company_id from public.project_items where id = new.project_item_id;
  end if;
  return new;
end $$;

create or replace function public.t23_fill_company_from_driver()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.company_id is null then
    select company_id into new.company_id from public.drivers where id = new.driver_id;
  end if;
  return new;
end $$;

drop trigger if exists t23_project_demands_company on public.project_demands;
create trigger t23_project_demands_company before insert on public.project_demands
  for each row execute function public.t23_fill_company_from_item();
drop trigger if exists t23_project_demand_days_company on public.project_demand_days;
create trigger t23_project_demand_days_company before insert on public.project_demand_days
  for each row execute function public.t23_fill_company_from_item();
drop trigger if exists t23_driver_day_offs_company on public.driver_day_offs;
create trigger t23_driver_day_offs_company before insert on public.driver_day_offs
  for each row execute function public.t23_fill_company_from_driver();
drop trigger if exists t23_dispatch_company on public.dispatch_assignments;
create trigger t23_dispatch_company before insert on public.dispatch_assignments
  for each row execute function public.t23_fill_company_from_driver();

do $$
declare t text;
begin
  foreach t in array array['project_demands','project_demand_days','driver_day_offs','dispatch_assignments']
  loop
    execute format('drop trigger if exists t23_%I_updated_at on public.%I', t, t);
    execute format('create trigger t23_%I_updated_at before update on public.%I for each row execute function public.set_updated_at()', t, t);
  end loop;
end $$;

-- ドライバーと案件内容が同じ会社のものか（他社の行をつながせない）
create or replace function public.t23_guard_same_company()
returns trigger language plpgsql security definer set search_path = public as $$
declare other uuid;
begin
  select company_id into other from public.drivers where id = new.driver_id;
  if other is null or other <> new.company_id then
    raise exception 'ドライバーが違う会社のものです' using errcode = 'P0001', hint = 'CROSS_COMPANY';
  end if;
  select company_id into other from public.project_items where id = new.project_item_id;
  if other is null or other <> new.company_id then
    raise exception '案件内容が違う会社のものです' using errcode = 'P0001', hint = 'CROSS_COMPANY';
  end if;
  return new;
end $$;

drop trigger if exists t23_dispatch_same_company on public.dispatch_assignments;
create trigger t23_dispatch_same_company before insert or update on public.dispatch_assignments
  for each row execute function public.t23_guard_same_company();

-- =============================================================================
-- RLS
-- =============================================================================
alter table public.project_demands enable row level security;
alter table public.project_demand_days enable row level security;
alter table public.driver_day_offs enable row level security;
alter table public.dispatch_assignments enable row level security;

-- 必要人数：スタッフは見られる、書けるのは admin 以上
do $$
declare t text;
begin
  foreach t in array array['project_demands','project_demand_days']
  loop
    execute format('drop policy if exists %I_select on public.%I', t, t);
    execute format($p$create policy %I_select on public.%I for select to authenticated
      using (company_id = public.current_company_id() and public.is_staff())$p$, t, t);
    execute format('drop policy if exists %I_write on public.%I', t, t);
    execute format($p$create policy %I_write on public.%I for all to authenticated
      using (company_id = public.current_company_id() and public.is_admin())
      with check (company_id = public.current_company_id() and public.is_admin())$p$, t, t);
  end loop;
end $$;

-- 休み希望：スタッフは全員分、ドライバーは自分の分だけ。申請は本人、決めるのは admin
drop policy if exists driver_day_offs_select on public.driver_day_offs;
create policy driver_day_offs_select on public.driver_day_offs for select to authenticated
  using (company_id = public.current_company_id() and (public.is_staff() or driver_id = public.current_driver_id()));
drop policy if exists driver_day_offs_insert on public.driver_day_offs;
create policy driver_day_offs_insert on public.driver_day_offs for insert to authenticated
  with check (
    company_id = public.current_company_id()
    and (public.is_admin() or (driver_id = public.current_driver_id() and status = 'requested'))
  );
drop policy if exists driver_day_offs_update on public.driver_day_offs;
create policy driver_day_offs_update on public.driver_day_offs for update to authenticated
  using (company_id = public.current_company_id() and (public.is_admin() or driver_id = public.current_driver_id()))
  with check (company_id = public.current_company_id() and (public.is_admin() or driver_id = public.current_driver_id()));
drop policy if exists driver_day_offs_delete on public.driver_day_offs;
create policy driver_day_offs_delete on public.driver_day_offs for delete to authenticated
  using (company_id = public.current_company_id() and (public.is_admin() or (driver_id = public.current_driver_id() and status = 'requested')));

-- 配車：スタッフは全員分、ドライバーは自分の分だけ読める。書けるのは admin 以上
drop policy if exists dispatch_assignments_select on public.dispatch_assignments;
create policy dispatch_assignments_select on public.dispatch_assignments for select to authenticated
  using (company_id = public.current_company_id() and (public.is_staff() or driver_id = public.current_driver_id()));
drop policy if exists dispatch_assignments_write on public.dispatch_assignments;
create policy dispatch_assignments_write on public.dispatch_assignments for all to authenticated
  using (company_id = public.current_company_id() and public.is_admin())
  with check (company_id = public.current_company_id() and public.is_admin());

-- =============================================================================
-- ビュー（名前を付けて返す。画面は埋め込みリソースを使わない）
-- =============================================================================
drop view if exists public.v_dispatch_list;
create view public.v_dispatch_list
with (security_invoker = true) as
select
  a.id, a.company_id, a.on_date, a.status, a.qty_plan, a.note, a.notified_at,
  a.driver_id, d.name as driver_name, d.sort_order as driver_sort_order,
  a.project_item_id, p.id as project_id, p.name as project_name, pi.name as item_name, pi.unit,
  pi.bill_rate, pi.pay_rate,
  -- その日にその人の報告（日別の稼働）があるか
  exists (
    select 1 from public.work_day_entries w
     where w.company_id = a.company_id and w.work_date = a.on_date
       and w.driver_id = a.driver_id and w.project_item_id = a.project_item_id
  ) as has_report
from public.dispatch_assignments a
join public.drivers d on d.id = a.driver_id
join public.project_items pi on pi.id = a.project_item_id
join public.projects p on p.id = pi.project_id;

comment on view public.v_dispatch_list is '配車（予定）に名前と報告の有無を付けたもの';

drop view if exists public.v_day_off_list;
create view public.v_day_off_list
with (security_invoker = true) as
select o.id, o.company_id, o.on_date, o.status, o.reason, o.decided_at, o.decided_note,
       o.driver_id, d.name as driver_name, d.sort_order as driver_sort_order, o.created_at
  from public.driver_day_offs o
  join public.drivers d on d.id = o.driver_id;

comment on view public.v_day_off_list is '休み希望にドライバー名を付けたもの';

-- これから 2 週間ぶんの「必要・割り当て・不足・予定の売上」を日ごとに 1 行で返す。
--   ダッシュボードは 1 往復でこのビューだけを読む（配車表の 8 往復を持ち込まない）。
--   必要人数は 特定日の指定 → 曜日のパターン の順（`needFor` と同じ）。
drop view if exists public.v_dispatch_outlook;
create view public.v_dispatch_outlook
with (security_invoker = true) as
with days as (
  select d::date as on_date from generate_series(current_date, current_date + 13, interval '1 day') d
),
needs as (
  select pi.company_id,
         days.on_date,
         pi.id as project_item_id,
         coalesce(dd.need, pd.need, 0) as need
    from days
    cross join public.project_items pi
    left join public.project_demand_days dd
      on dd.project_item_id = pi.id and dd.on_date = days.on_date
    left join public.project_demands pd
      on pd.project_item_id = pi.id and pd.weekday = extract(dow from days.on_date)::smallint
),
asg as (
  select a.company_id, a.on_date, a.project_item_id,
         count(*) as assigned,
         sum(a.qty_plan * pi.bill_rate) as plan_bill,
         sum(a.qty_plan * pi.pay_rate) as plan_pay,
         count(*) filter (where a.status = 'confirmed') as confirmed
    from public.dispatch_assignments a
    join public.project_items pi on pi.id = a.project_item_id
   where a.status <> 'cancelled'
     and a.on_date between current_date and current_date + 13
   group by 1, 2, 3
)
select n.company_id,
       n.on_date,
       sum(n.need)::integer as need,
       sum(coalesce(a.assigned, 0))::integer as assigned,
       sum(coalesce(a.confirmed, 0))::integer as confirmed,
       sum(greatest(n.need - coalesce(a.assigned, 0), 0))::integer as shortage,
       sum(coalesce(a.plan_bill, 0))::numeric(12,2) as plan_bill,
       sum(coalesce(a.plan_pay, 0))::numeric(12,2) as plan_pay,
       (sum(coalesce(a.plan_bill, 0)) - sum(coalesce(a.plan_pay, 0)))::numeric(12,2) as plan_margin
  from needs n
  left join asg a
    on a.company_id = n.company_id and a.on_date = n.on_date and a.project_item_id = n.project_item_id
 group by n.company_id, n.on_date;

comment on view public.v_dispatch_outlook is 'これから 2 週間の配車の見通し（日ごとの必要・割り当て・不足・予定の売上）';

-- =============================================================================
-- RPC
-- =============================================================================

-- 必要人数（曜日）を決める。need = 0 なら行を消す
create or replace function public.set_project_demand(p_project_item_id uuid, p_weekday smallint, p_need integer)
returns void language plpgsql security invoker set search_path = public as $$
declare cid uuid := public.current_company_id();
begin
  if not public.is_admin() then
    raise exception '権限がありません' using errcode = 'P0001', hint = 'FORBIDDEN';
  end if;
  if p_weekday < 0 or p_weekday > 6 then
    raise exception '曜日の指定が正しくありません' using errcode = 'P0001', hint = 'INVALID';
  end if;
  if not exists (select 1 from public.project_items where id = p_project_item_id and company_id = cid) then
    raise exception '案件内容が見つかりません' using errcode = 'P0001', hint = 'NOT_FOUND';
  end if;
  if coalesce(p_need, 0) <= 0 then
    delete from public.project_demands where project_item_id = p_project_item_id and weekday = p_weekday;
    return;
  end if;
  insert into public.project_demands (company_id, project_item_id, weekday, need)
  values (cid, p_project_item_id, p_weekday, p_need)
  on conflict (project_item_id, weekday) do update set need = excluded.need, updated_at = now();
end $$;

-- 特定の日の必要人数。need が null か負なら上書きをやめる（曜日のパターンに戻る）
--   アプリ側の型を素直にするため、「やめる」は -1 でも表せるようにしている
create or replace function public.set_project_demand_day(p_project_item_id uuid, p_on_date date, p_need integer, p_note text default '')
returns void language plpgsql security invoker set search_path = public as $$
declare cid uuid := public.current_company_id();
begin
  if not public.is_admin() then
    raise exception '権限がありません' using errcode = 'P0001', hint = 'FORBIDDEN';
  end if;
  if not exists (select 1 from public.project_items where id = p_project_item_id and company_id = cid) then
    raise exception '案件内容が見つかりません' using errcode = 'P0001', hint = 'NOT_FOUND';
  end if;
  if p_need is null or p_need < 0 then
    delete from public.project_demand_days where project_item_id = p_project_item_id and on_date = p_on_date;
    return;
  end if;
  insert into public.project_demand_days (company_id, project_item_id, on_date, need, note)
  values (cid, p_project_item_id, p_on_date, greatest(p_need, 0), coalesce(p_note, ''))
  on conflict (project_item_id, on_date) do update set need = excluded.need, note = excluded.note, updated_at = now();
end $$;

-- 配車をまとめて置く（[{on_date, driver_id, project_item_id, qty_plan}]）。
-- qty_plan が 0 以下の行は「外す」として扱う。
create or replace function public.set_dispatch_bulk(p_rows jsonb)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  cid uuid := public.current_company_id();
  r jsonb;
  v_date date; v_driver uuid; v_item uuid; v_qty numeric;
  ins integer := 0; upd integer := 0; del integer := 0; n integer;
begin
  if not public.is_admin() then
    raise exception '権限がありません' using errcode = 'P0001', hint = 'FORBIDDEN';
  end if;
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    v_date := (r->>'on_date')::date;
    v_driver := (r->>'driver_id')::uuid;
    v_item := (r->>'project_item_id')::uuid;
    v_qty := coalesce((r->>'qty_plan')::numeric, 1);
    if v_date is null or v_driver is null or v_item is null then
      raise exception '配車の指定が足りません' using errcode = 'P0001', hint = 'INVALID';
    end if;
    if v_qty <= 0 then
      delete from public.dispatch_assignments
       where company_id = cid and on_date = v_date and driver_id = v_driver and project_item_id = v_item;
      get diagnostics n = row_count; del := del + n;
      continue;
    end if;
    -- 追加か更新かは、入れる前に数えておく（あとから created_at で当てない）
    select count(*) into n from public.dispatch_assignments
     where company_id = cid and on_date = v_date and driver_id = v_driver and project_item_id = v_item;
    insert into public.dispatch_assignments as t (company_id, on_date, driver_id, project_item_id, qty_plan)
    values (cid, v_date, v_driver, v_item, v_qty)
    on conflict (company_id, on_date, driver_id, project_item_id) do update
      set qty_plan = excluded.qty_plan,
          -- 内容が変わったら「知らせ直す」ため、通知済みの印を外す
          notified_at = case when t.qty_plan <> excluded.qty_plan then null else t.notified_at end,
          updated_at = now();
    if n > 0 then upd := upd + 1; else ins := ins + 1; end if;
  end loop;
  return jsonb_build_object('inserted', ins, 'updated', upd, 'deleted', del);
end $$;

-- 1 週間ぶんを別の週へ写す（休み希望の承認済みの日は避ける）
create or replace function public.copy_dispatch_week(p_from_start date, p_to_start date)
returns integer language plpgsql security invoker set search_path = public as $$
declare cid uuid := public.current_company_id(); n integer := 0;
begin
  if not public.is_admin() then
    raise exception '権限がありません' using errcode = 'P0001', hint = 'FORBIDDEN';
  end if;
  insert into public.dispatch_assignments (company_id, on_date, driver_id, project_item_id, qty_plan, note)
  select cid, (p_to_start + (a.on_date - p_from_start)), a.driver_id, a.project_item_id, a.qty_plan, a.note
    from public.dispatch_assignments a
    join public.drivers d on d.id = a.driver_id and d.is_active
   where a.company_id = cid
     and a.on_date >= p_from_start and a.on_date < p_from_start + 7
     and a.status <> 'cancelled'
     and not exists (
       select 1 from public.driver_day_offs o
        where o.company_id = cid and o.driver_id = a.driver_id
          and o.on_date = (p_to_start + (a.on_date - p_from_start)) and o.status = 'approved')
  on conflict (company_id, on_date, driver_id, project_item_id) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- 予定を確定する（確定すると「明日の配車」の通知に乗る）
create or replace function public.confirm_dispatch(p_from date, p_to date)
returns integer language plpgsql security invoker set search_path = public as $$
declare cid uuid := public.current_company_id(); n integer := 0;
begin
  if not public.is_admin() then
    raise exception '権限がありません' using errcode = 'P0001', hint = 'FORBIDDEN';
  end if;
  update public.dispatch_assignments
     set status = 'confirmed', confirmed_at = now(), confirmed_by = auth.uid(), updated_at = now()
   where company_id = cid and on_date between p_from and p_to and status = 'planned';
  get diagnostics n = row_count;
  return n;
end $$;

-- 休みを申請する（ドライバー本人。すでにある日は理由だけ差し替える）
create or replace function public.request_day_off(p_on_date date, p_reason text default '')
returns uuid language plpgsql security invoker set search_path = public as $$
declare
  cid uuid := public.current_company_id();
  did uuid := public.current_driver_id();
  new_id uuid;
begin
  if did is null then
    raise exception 'ドライバー本人だけが申請できます' using errcode = 'P0001', hint = 'FORBIDDEN';
  end if;
  if p_on_date < current_date then
    raise exception '過ぎた日は申請できません' using errcode = 'P0001', hint = 'PAST_DATE';
  end if;
  insert into public.driver_day_offs (company_id, driver_id, on_date, reason)
  values (cid, did, p_on_date, coalesce(p_reason, ''))
  on conflict (driver_id, on_date) do update
    set reason = excluded.reason, status = 'requested', decided_by = null, decided_at = null, decided_note = '', updated_at = now()
  returning id into new_id;
  return new_id;
end $$;

-- 休み希望を決める（管理者）
create or replace function public.decide_day_off(p_id uuid, p_approve boolean, p_note text default '')
returns void language plpgsql security invoker set search_path = public as $$
declare cid uuid := public.current_company_id();
begin
  if not public.is_admin() then
    raise exception '権限がありません' using errcode = 'P0001', hint = 'FORBIDDEN';
  end if;
  update public.driver_day_offs
     set status = case when p_approve then 'approved'::public.day_off_status else 'rejected'::public.day_off_status end,
         decided_by = auth.uid(), decided_at = now(), decided_note = coalesce(p_note, ''), updated_at = now()
   where id = p_id and company_id = cid;
  if not found then
    raise exception '休み希望が見つかりません' using errcode = 'P0001', hint = 'NOT_FOUND';
  end if;
end $$;

-- 通知した印を付ける（サービスロール専用。同じ内容を二度送らないため）
create or replace function public.mark_dispatch_notified(p_company_id uuid, p_ids uuid[])
returns integer language plpgsql security definer set search_path = public as $$
declare n integer := 0;
begin
  update public.dispatch_assignments
     set notified_at = now(), updated_at = now()
   where company_id = p_company_id and id = any(p_ids);
  get diagnostics n = row_count;
  return n;
end $$;

-- =============================================================================
-- 権限
--   0020 の末尾で「schema public の全テーブル」へまとめて権限を出しているが、
--   そのあとに作ったテーブル（0022 の push_subscriptions、0023 の 4 つ）には
--   届いていない。security invoker の RPC はログイン中のユーザーの権限で動くため、
--   テーブル権限が無いと RLS の手前で permission denied になる。ここで出し直す。
-- =============================================================================
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;
revoke all on public.integration_secrets from authenticated, anon, public;
grant all on public.integration_secrets to service_role;

grant execute on function public.set_project_demand(uuid, smallint, integer) to authenticated;
grant execute on function public.set_project_demand_day(uuid, date, integer, text) to authenticated;
grant execute on function public.set_dispatch_bulk(jsonb) to authenticated;
grant execute on function public.copy_dispatch_week(date, date) to authenticated;
grant execute on function public.confirm_dispatch(date, date) to authenticated;
grant execute on function public.request_day_off(date, text) to authenticated;
grant execute on function public.decide_day_off(uuid, boolean, text) to authenticated;
revoke execute on function public.mark_dispatch_notified(uuid, uuid[]) from authenticated, anon, public;
grant execute on function public.mark_dispatch_notified(uuid, uuid[]) to service_role;

-- =============================================================================
-- 異常の検知に配車の 3 ルールを足す（27〜29）
--   0020 の detect_anomalies_core をそのまま引き継ぎ、末尾に足している
-- =============================================================================
create or replace function public.detect_anomalies_core(p_company_id uuid, p_month date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  cid uuid := p_company_id;
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
  select count(*) into n from public.rate_diffs_for(cid, p_month);
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
      from public.cash_forecast_for(cid, current_date, (current_date + 30)::date);
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

  -- 17. 30 日以内に来る税務・決算の期限（まだ「済」にしていないもの）
  for r in
    select id, title, due_on, (due_on - current_date) as days_left
      from public.tax_tasks
     where company_id = cid and status = 'todo'
       and due_on between current_date and (current_date + 30)::date
  loop
    fp := public.record_alert(cid, p_month, 'tax_due', 'medium',
      r.title || ' があと ' || r.days_left || ' 日です',
      '期限 ' || to_char(r.due_on, 'YYYY/MM/DD') || '。済んだら「対応済み」にしてください。',
      null, 'tax_tasks', r.id::text, '/finance?tab=tax', 'tax_due:' || r.id);
    fps := fps || fp;
  end loop;

  -- 18. 期限を過ぎた税務・決算の期限
  for r in
    select id, title, due_on
      from public.tax_tasks
     where company_id = cid and status = 'todo' and due_on < current_date
       and due_on >= (current_date - 90)
  loop
    fp := public.record_alert(cid, p_month, 'tax_overdue', 'high',
      r.title || ' の期限を過ぎています',
      '期限 ' || to_char(r.due_on, 'YYYY/MM/DD') || ' を過ぎています。対応が済んでいれば「対応済み」にしてください。',
      null, 'tax_tasks', r.id::text, '/finance?tab=tax', 'tax_overdue:' || r.id);
    fps := fps || fp;
  end loop;

  -- 19. 契約が期限切れ・更新時期
  for r in
    select id, driver_name, title, end_on, days_left, auto_renew, period_status
      from public.v_contract_list
     where company_id = cid and period_status in ('expired', 'renewal')
  loop
    if r.period_status = 'expired' then
      fp := public.record_alert(cid, p_month, 'contract_expired', 'high',
        r.driver_name || ' の' || r.title || 'が期限切れです',
        '契約期間は ' || to_char(r.end_on, 'YYYY/MM/DD') || ' までです。更新した契約書を登録してください。',
        null, 'contracts', r.id::text, '/hr?tab=contracts', 'contract_expired:' || r.id);
    else
      fp := public.record_alert(cid, p_month, 'contract_renewal', 'medium',
        r.driver_name || ' の' || r.title || 'があと ' || r.days_left || ' 日で満了です',
        case when r.auto_renew then '自動更新の契約です。続けるかどうかを確認してください。'
             else '自動更新ではありません。更新するなら新しい契約書が必要です。' end,
        null, 'contracts', r.id::text, '/hr?tab=contracts', 'contract_renewal:' || r.id);
    end if;
    fps := fps || fp;
  end loop;

  -- 20. 口座情報が入っていないドライバー（振込データを作れない。その月に支払があるときだけ）
  for r in
    select s.driver_id, s.driver_name
      from public.v_driver_month_summary s
      left join public.driver_bank_accounts b on b.driver_id = s.driver_id
     where s.company_id = cid and s.month = p_month and s.payout > 0
       and (b.driver_id is null or b.bank_code = '' or b.branch_code = '' or b.account_number = '' or b.account_holder_kana = '')
  loop
    fp := public.record_alert(cid, p_month, 'bank_account_missing', 'low',
      r.driver_name || ' の口座情報が入っていません',
      '振込データ（全銀フォーマット）を作るには、銀行・支店・口座番号・カナ名義が必要です。',
      null, 'drivers', r.driver_id::text, '/settings/drivers/' || r.driver_id,
      'bank_account_missing:' || m || ':' || r.driver_id);
    fps := fps || fp;
  end loop;

  -- 21. 拘束時間が長い日がある（改善基準告示の目安を超えた日）
  select coalesce(sum(over_duty_days + severe_duty_days), 0) into n
    from public.v_driver_month_labor where company_id = cid and month = p_month;
  if coalesce(n, 0) > 0 then
    fp := public.record_alert(cid, p_month, 'duty_long', 'medium', '拘束時間が長い日が ' || n || ' 日あります',
      '開始から終了までが目安（既定 13 時間）を超えた日です。日報の労務タブで確認してください。',
      null, 'daily_reports', '', '/daily?tab=labor' || '&m=' || m, 'duty_long:' || m);
    fps := fps || fp;
  end if;

  -- 22. 休息期間（前日の終了から当日の開始まで）が足りない日がある
  select coalesce(sum(severe_rest_days), 0) into n
    from public.v_driver_month_labor where company_id = cid and month = p_month;
  if coalesce(n, 0) > 0 then
    fp := public.record_alert(cid, p_month, 'rest_short', 'high', '休息期間が足りない日が ' || n || ' 日あります',
      '前の稼働の終了から次の開始までが目安（既定 9 時間）を下回っています。事故につながるため、配車を見直してください。',
      null, 'daily_reports', '', '/daily?tab=labor' || '&m=' || m, 'rest_short:' || m);
    fps := fps || fp;
  end if;

  -- 23. 連続勤務が長いドライバー
  for r in
    select driver_id, driver_name, max_consecutive_days, labor_max_consecutive_days
      from public.v_driver_month_labor
     where company_id = cid and month = p_month and consecutive_over
  loop
    fp := public.record_alert(cid, p_month, 'consecutive_days', 'medium',
      r.driver_name || ' の連続勤務が ' || r.max_consecutive_days || ' 日です',
      '目安の ' || r.labor_max_consecutive_days || ' 日を超えています。休みを入れられないか確認してください。',
      null, 'drivers', r.driver_id::text, '/daily?tab=labor' || '&m=' || m,
      'consecutive_days:' || m || ':' || r.driver_id);
    fps := fps || fp;
  end loop;

  -- 24. 元請の支払通知と自社の売上に差がある
  for r in
    select n2.id, n2.notice_no, n2.client_name, n2.total_diff
      from public.v_payment_notice_list n2
     where n2.company_id = cid and n2.month = p_month and abs(n2.total_diff) >= 1
  loop
    fp := public.record_alert(cid, p_month, 'notice_diff', 'high',
      coalesce(nullif(r.client_name, ''), '取引先') || ' の支払通知と売上に差があります',
      '差額は ' || to_char(r.total_diff, 'FM999,999,999') || ' 円です（プラスは通知のほうが多い）。明細を突き合わせてください。',
      r.total_diff, 'payment_notices', r.id::text, '/invoices/notices/' || r.id,
      'notice_diff:' || r.id);
    fps := fps || fp;
  end loop;

  -- 25. 代表の決裁が止まっている申請
  for r in
    select a.id, a.title, a.waiting_days, a.is_overdue, a.amount
      from public.v_approval_list a
     where a.company_id = cid and a.status = 'pending'
       and (a.is_overdue or a.waiting_days >= 3)
  loop
    fp := public.record_alert(cid, p_month, 'approval_pending',
      case when r.is_overdue then 'high'::public.alert_severity else 'medium'::public.alert_severity end,
      '決裁待ちの申請があります：' || r.title,
      case when r.is_overdue then '期限を過ぎています（申請から ' || r.waiting_days || ' 日）。'
           else '申請から ' || r.waiting_days || ' 日たっています。' end
      || '代表の画面で決裁してください。',
      r.amount, 'approvals', r.id::text, '/executive/approvals/' || r.id, 'approval_pending:' || r.id);
    fps := fps || fp;
  end loop;

  -- 26. 個人情報を含む出力が急に増えた（持ち出しの見張り）
  select count(*) into n from public.export_logs
   where company_id = cid and is_sensitive and at >= now() - interval '1 day';
  if coalesce(n, 0) > 10 then
    fp := public.record_alert(cid, p_month, 'export_burst', 'high',
      '個人情報を含む出力が 24 時間で ' || n || ' 件あります',
      '口座・明細・振込データ・バックアップの持ち出しが普段より多くなっています。代表の「守り」の画面で誰が出したか確認してください。',
      null, 'export_logs', '', '/executive/security', 'export_burst:' || to_char(current_date, 'YYYY-MM-DD'));
    fps := fps || fp;
  end if;

  -- 27. この先 1 週間で人が足りない日がある（配車の欠員）
  select count(*) into n from (
    select g.on_date, g.project_item_id,
           coalesce(dd.need, pd.need, 0) as need,
           (select count(*) from public.dispatch_assignments a
             where a.company_id = cid and a.on_date = g.on_date
               and a.project_item_id = g.project_item_id and a.status <> 'cancelled') as assigned
      from (
        select gs::date as on_date, items.id as project_item_id
          from generate_series(current_date, current_date + 6, interval '1 day') gs
          cross join (
            select pi.id from public.project_items pi
              join public.projects p on p.id = pi.project_id
             where pi.company_id = cid and pi.is_active and p.is_active
          ) items
      ) g
      left join public.project_demand_days dd
        on dd.project_item_id = g.project_item_id and dd.on_date = g.on_date
      left join public.project_demands pd
        on pd.project_item_id = g.project_item_id and pd.weekday = extract(dow from g.on_date)::smallint
  ) x
   where x.need > x.assigned;
  if coalesce(n, 0) > 0 then
    fp := public.record_alert(cid, p_month, 'dispatch_shortage', 'high',
      'この先 1 週間で人が足りない日が ' || n || ' 件あります',
      '必要人数に対して配車が足りていません。配車の画面で埋めるか、必要人数を直してください。',
      null, 'dispatch_assignments', '', '/dispatch', 'dispatch_shortage:' || to_char(current_date, 'IYYY-IW'));
    fps := fps || fp;
  end if;

  -- 28. 配車したのに報告が来ていない（過ぎた 7 日ぶん）
  select count(*) into n
    from public.dispatch_assignments a
   where a.company_id = cid and a.status = 'confirmed'
     and a.on_date between current_date - 7 and current_date - 1
     and not exists (
       select 1 from public.work_day_entries w
        where w.company_id = cid and w.work_date = a.on_date
          and w.driver_id = a.driver_id and w.project_item_id = a.project_item_id);
  if coalesce(n, 0) > 0 then
    fp := public.record_alert(cid, p_month, 'dispatch_no_report', 'medium',
      '配車したのに報告が無い日が ' || n || ' 件あります',
      '予定では入っていたのに、日別の稼働が出ていません。休んだのか、報告を忘れているのか確認してください。',
      null, 'dispatch_assignments', '', '/dispatch', 'dispatch_no_report:' || to_char(current_date, 'YYYY-MM-DD'));
    fps := fps || fp;
  end if;

  -- 29. 休み希望が決まっていない
  select count(*) into n from public.driver_day_offs
   where company_id = cid and status = 'requested' and on_date >= current_date;
  if coalesce(n, 0) > 0 then
    fp := public.record_alert(cid, p_month, 'day_off_pending', 'medium',
      '返事をしていない休み希望が ' || n || ' 件あります',
      '配車を組む前に、休み希望に返事をしてください。',
      null, 'driver_day_offs', '', '/dispatch?tab=offs', 'day_off_pending:' || to_char(current_date, 'YYYY-MM-DD'));
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
-- バックアップを version 8 にする（配車・必要人数・休み希望まで戻せる）
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
    'version', 8,
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
    'dispatch_assignments', (select coalesce(jsonb_agg(to_jsonb(x) order by x.on_date, x.driver_id), '[]'::jsonb) from public.dispatch_assignments x where x.company_id = cid)
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
    or exists (select 1 from jsonb_array_elements(coalesce(p_data->'dispatch_assignments','[]')) x join public.dispatch_assignments t on t.id = (x->>'id')::uuid where t.company_id <> p_company_id);
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

  perform set_config('app.skip_audit', 'off', true);
  perform set_config('app.bypass_closing', 'off', true);
  perform set_config('app.audit_internal', 'on', true);
  perform public.write_audit(cid, 'import_backup', 'company', cid::text, null, counts);
  perform set_config('app.audit_internal', 'off', true);
  return counts;
end $$;

-- =============================================================================
-- データ全削除に配車のテーブルを足す
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
-- 監査と更新日時（配車の変更は誰がやったか残す）
-- =============================================================================
do $$
declare t text;
begin
  foreach t in array array['project_demands','project_demand_days','driver_day_offs','dispatch_assignments']
  loop
    execute format('drop trigger if exists t90_audit on public.%I', t);
    execute format('create trigger t90_audit after insert or update or delete on public.%I for each row execute function public.audit_row_change()', t);
  end loop;
end $$;
