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
) returns void language sql security definer set search_path = public as $$
  insert into public.audit_logs (company_id, actor_id, action, table_name, record_id, before, after)
  values (p_company_id, auth.uid(), p_action, p_table, p_record_id, p_before, p_after);
$$;

-- ---------- 招待の適用（新規ユーザー作成トリガー・既存ユーザーへの再招待の両方で使用） ----------
create or replace function public.apply_invitation(p_user_id uuid, p_email text)
returns public.profiles language plpgsql security definer set search_path = public as $$
declare
  inv public.invitations%rowtype;
  prof public.profiles;
begin
  select * into inv from public.invitations
   where lower(email) = lower(p_email)
     and accepted_at is null and cancelled_at is null and expires_at > now()
   order by created_at desc limit 1;
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

  update public.invitations set accepted_at = now() where id = inv.id;
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
  if coalesce(current_setting('app.bypass_profile_guard', true), 'off') = 'on' or public.is_service_role() then
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
  if public.is_service_role() then
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
  perform public.write_audit(cid, tg_op, tg_table_name, rid, b, a);
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
  using (id = auth.uid() or (company_id = public.current_company_id() and public.is_admin()));
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
  using (company_id = public.current_company_id());
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
