-- =============================================================================
-- 0029 ユーザーごとの見せる範囲・代表を譲る
--
--   1. ユーザーごとの見せる範囲（profiles.access_overrides）
--      これまで「誰に何を見せるか」はロール（と会社全体の機密の見せ方 confidential_scope）だけで決まっていた。
--      同じ管理者でも「この人には借入を見せたくない」「この事務員には経営の数字も見せたい」に応えられなかったので、
--      人ごとに次の 5 つを「ロールのとおり（キーなし）／見せる（allow）／見せない（deny）」で上書きできるようにする。
--        management   … 経営の数字（ホーム・資金繰り・案件別・ドライバー別の採算・財務・レポート・AI・経営のアラート）
--        loans        … 借入と納税
--        cash         … 現金残高と資金繰り
--        bank_account … ドライバーの振込口座
--        export       … 出力（CSV・Excel・PDF・ZIP のダウンロード）
--      - 判定は今までの関数（can_see_management / can_see_confidential）の中で行うので、RLS はそのまま効く
--      - **代表（owner）とドライバーには効かない**（代表は常にすべて、ドライバーは自分のものだけ）
--      - export は DB では止めない（画面に出せるものを一覧で持ち出すかどうかの話なので、出力の口で止める）。
--        締め時のバックアップ（export_backup）は月締めの一部なので止めない
--      - 変えられるのは代表だけ。自分自身のものは変えられない（protect_profile_columns）
--   2. 代表を譲る（transfer_ownership）
--      相手を代表にし、自分は選んだロールになる。1 回の処理で入れ替えるので、代表が 0 人になる瞬間が無い
--   3. 経営のアラートの見せ方を「事務員か」から「経営の数字を見てよいか」に変える
--      （事務員に経営の数字を見せる設定にしたら、経営のアラートも見えるように）
-- =============================================================================

-- ---------- 1. ユーザーごとの見せる範囲 ----------
create or replace function public.valid_access_overrides(p jsonb)
returns boolean language sql immutable as $$
  select jsonb_typeof(p) = 'object'
     and not exists (
       select 1 from jsonb_each(p) e
        where e.key not in ('management', 'loans', 'cash', 'bank_account', 'export')
           or jsonb_typeof(e.value) <> 'string'
           or (e.value #>> '{}') not in ('allow', 'deny')
     );
$$;

comment on function public.valid_access_overrides(jsonb) is
  'access_overrides の形が正しいか（キーは management / loans / cash / bank_account / export、値は allow / deny）';

alter table public.profiles add column if not exists access_overrides jsonb not null default '{}'::jsonb;
do $$ begin
  alter table public.profiles add constraint profiles_access_overrides_check check (public.valid_access_overrides(access_overrides));
exception when duplicate_object then null; end $$;

comment on column public.profiles.access_overrides is
  'ユーザーごとの見せる範囲の上書き（0029）。{"management":"deny","cash":"allow"} のように、ロールの既定と違うものだけを持つ。代表・ドライバーには効かない';

-- ログイン中のユーザーの上書き（'allow' / 'deny' / null）。代表とドライバーは常に null
create or replace function public.access_override(p_key text)
returns text language sql stable security definer set search_path = public as $$
  select case when p.role in ('admin', 'clerk', 'viewer') then p.access_overrides->>p_key end
    from public.profiles p
   where p.id = auth.uid() and p.is_active
   limit 1;
$$;

comment on function public.access_override(text) is 'ログイン中のユーザーの見せる範囲の上書き（allow / deny / null）。代表・ドライバーは常に null';

-- 経営の数字を見てよいか：代表は常に。スタッフは上書き → ロール（owner・admin・viewer）の順
create or replace function public.can_see_management()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select case
             when p.role = 'owner' then true
             when p.role not in ('admin', 'clerk', 'viewer') then false
             when p.access_overrides->>'management' = 'allow' then true
             when p.access_overrides->>'management' = 'deny' then false
             else p.role in ('admin', 'viewer')
           end
      from public.profiles p
     where p.id = auth.uid() and p.is_active
     limit 1), false);
$$;

comment on function public.can_see_management() is
  '経営の数字を見てよいか。代表は常に true。スタッフは access_overrides.management → ロール（owner・admin・viewer）の順（0029）';

-- 機密（借入・現金・振込口座）を見てよいか：代表は常に。スタッフは上書き → 会社の見せ方の順
create or replace function public.can_see_confidential(p_key text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare scope text; ov text;
begin
  if public.is_owner() then
    return true;
  end if;
  if not public.is_staff() then
    return false;
  end if;
  ov := public.access_override(p_key);
  if ov = 'allow' then
    return true;
  end if;
  if ov = 'deny' then
    return false;
  end if;
  select coalesce(confidential_scope->>p_key, 'admin') into scope
    from public.companies where id = public.current_company_id();
  if scope = 'staff' then
    return true;
  end if;
  if scope = 'clerk' then
    return public.is_admin();
  end if;
  if scope = 'admin' then
    return public.is_manager();
  end if;
  return false;  -- 'owner' は上で返している
end $$;

comment on function public.can_see_confidential(text) is
  '機密（loans / cash / bank_account）を見てよいか。代表は常に true。スタッフは access_overrides → 会社の見せ方（owner / admin / clerk / staff）の順（0029）';

-- 出力してよいか（画面・出力の口の判定と同じ。DB の RLS では使わない）
create or replace function public.can_export()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select case
             when p.role = 'owner' then true
             when p.role in ('admin', 'clerk', 'viewer') then coalesce(p.access_overrides->>'export', '') <> 'deny'
             else false
           end
      from public.profiles p
     where p.id = auth.uid() and p.is_active
     limit 1), false);
$$;

comment on function public.can_export() is 'CSV・Excel・PDF・ZIP を出力してよいか（代表は常に。スタッフは access_overrides.export が deny でなければ）';

-- ---------- 3. 経営のアラート：経営の数字を見てよい人にだけ ----------
drop policy if exists alerts_select on public.alerts;
create policy alerts_select on public.alerts for select to authenticated
  using (company_id = public.current_company_id() and public.is_staff()
         and (public.can_see_management() or not public.is_management_alert(code)));
drop policy if exists alerts_write on public.alerts;
create policy alerts_write on public.alerts for all to authenticated
  using (company_id = public.current_company_id() and public.is_admin()
         and (public.can_see_management() or not public.is_management_alert(code)))
  with check (company_id = public.current_company_id() and public.is_admin()
         and (public.can_see_management() or not public.is_management_alert(code)));

-- ---------- プロフィール保護：見せる範囲も代表だけが変えられる（自分のものは変えられない） ----------
create or replace function public.protect_profile_columns()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- API 経由でないセッション（SQL Editor・psql・サービスロール）は制限しない。JWT のある通常ユーザーのみ保護する
  if coalesce(current_setting('app.bypass_profile_guard', true), 'off') = 'on' or public.is_service_role() or auth.role() is null then
    return new;
  end if;
  if new.id <> old.id then
    raise exception 'ID は変更できません' using errcode = 'P0001';
  end if;
  if (new.role is distinct from old.role) or (new.company_id is distinct from old.company_id)
     or (new.is_active is distinct from old.is_active) or (new.driver_id is distinct from old.driver_id)
     or (new.email is distinct from old.email) or (new.access_overrides is distinct from old.access_overrides) then
    if not public.is_owner() then
      raise exception 'ロール・所属・状態・見せる範囲の変更はオーナーのみ可能です' using errcode = 'P0001', hint = 'OWNER_ONLY';
    end if;
    if old.id = auth.uid() and ((new.role is distinct from old.role) or (new.is_active is distinct from old.is_active)
                                or (new.access_overrides is distinct from old.access_overrides)) then
      raise exception '自分自身のロール・状態・見せる範囲は変更できません' using errcode = 'P0001', hint = 'SELF_CHANGE';
    end if;
  end if;
  return new;
end $$;

-- ---------- 2. 代表を譲る ----------
create or replace function public.transfer_ownership(p_to uuid, p_my_role public.user_role default 'admin')
returns void language plpgsql security definer set search_path = public as $$
declare
  actor public.profiles;
  target public.profiles;
begin
  select * into actor from public.profiles where id = auth.uid() and is_active;
  if actor.id is null or actor.role <> 'owner' then
    raise exception '代表を譲れるのは代表だけです' using errcode = 'P0001', hint = 'OWNER_ONLY';
  end if;
  if p_to is null or p_to = actor.id then
    raise exception '自分には譲れません。譲る相手を選んでください' using errcode = 'P0001', hint = 'INVALID';
  end if;
  if p_my_role is null or p_my_role not in ('admin', 'clerk', 'viewer') then
    raise exception '譲ったあとのあなたのロールは 管理者・事務員・閲覧者 から選んでください' using errcode = 'P0001', hint = 'INVALID';
  end if;
  select * into target from public.profiles where id = p_to and company_id = actor.company_id for update;
  if target.id is null then
    raise exception '譲る相手が見つかりません' using errcode = 'P0001', hint = 'NOT_FOUND';
  end if;
  if not target.is_active then
    raise exception '無効にしている人には譲れません。先に有効に戻してください' using errcode = 'P0001', hint = 'INVALID';
  end if;
  if target.role = 'driver' then
    raise exception 'ドライバーのアカウントには譲れません。スタッフのアカウントを選んでください' using errcode = 'P0001', hint = 'INVALID';
  end if;

  -- 自分のロールを変えるため、この処理の中だけプロフィール保護を外す（変更の記録は監査ログのトリガーが残す）
  perform set_config('app.bypass_profile_guard', 'on', true);
  update public.profiles set role = 'owner', access_overrides = '{}'::jsonb where id = target.id;
  update public.profiles set role = p_my_role, access_overrides = '{}'::jsonb where id = actor.id;
  perform set_config('app.bypass_profile_guard', 'off', true);
end $$;

comment on function public.transfer_ownership(uuid, public.user_role) is
  '代表を譲る（0029）。相手を代表にし、自分は選んだロール（admin / clerk / viewer）になる。見せる範囲の上書きは両方とも外す';

revoke all on function public.transfer_ownership(uuid, public.user_role) from public, anon;
grant execute on function public.transfer_ownership(uuid, public.user_role) to authenticated;
grant execute on function public.valid_access_overrides(jsonb) to authenticated, service_role;
grant execute on function public.access_override(text) to authenticated, service_role;
grant execute on function public.can_see_management() to authenticated, service_role;
grant execute on function public.can_see_confidential(text) to authenticated, service_role;
grant execute on function public.can_export() to authenticated, service_role;
