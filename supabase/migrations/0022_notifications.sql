-- =============================================================================
-- 0022 通知（端末へのプッシュ・LINE への転送・通知の設定）
--   これまで「通知」はナビの未読バッジしか無く、端末には何も届かなかった。
--   - push_subscriptions：端末ごとの購読（Web Push）。**自分のものしか見えない**
--   - profiles.notify_*：受け取り方の設定（チャットは 全部／メンションのみ／切）
--   - 送信そのものはアプリ側（lib/push）が行う。DB は宛先と設定を持つだけ
--   バックアップには含めない（端末の資格情報であり、復元しても他の端末では使えない）
-- =============================================================================

-- ---------- 受け取り方（本人が決める。profiles は本人が更新できる） ----------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'notify_chat_mode') then
    create type public.notify_chat_mode as enum ('all', 'mention', 'off');
  end if;
end $$;

alter table public.profiles add column if not exists notify_chat public.notify_chat_mode not null default 'mention';
alter table public.profiles add column if not exists notify_line boolean not null default true;

comment on column public.profiles.notify_chat is
  'チャットの通知：all＝すべての発言、mention＝自分あてだけ（既定）、off＝受け取らない';
comment on column public.profiles.notify_line is
  '自分あての発言を LINE にも送る（LINE 連携済みのときだけ効く）';

-- ---------- 端末ごとの購読（Web Push） ----------
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  -- ブラウザが発行する送信先。端末 × オリジンで一意
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  user_agent text not null default '',
  label text not null default '',
  -- 送信に続けて失敗した回数（404 / 410 はその場で消すので、これは一時的な失敗の数）
  failed_count integer not null default 0,
  last_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (endpoint)
);

create index if not exists push_subscriptions_profile_idx on public.push_subscriptions (company_id, profile_id);

comment on table public.push_subscriptions is
  '端末ごとのプッシュ通知の購読。本人しか読み書きできない。バックアップには含めない';

drop trigger if exists t01_push_subscriptions_updated_at on public.push_subscriptions;
create trigger t01_push_subscriptions_updated_at before update on public.push_subscriptions
  for each row execute function public.set_updated_at();

alter table public.push_subscriptions enable row level security;

-- 自分の購読だけ。管理者にも他人の端末は見せない（送信はサービスロールが行う）
drop policy if exists push_subscriptions_select on public.push_subscriptions;
create policy push_subscriptions_select on public.push_subscriptions for select to authenticated
  using (profile_id = auth.uid());
drop policy if exists push_subscriptions_write on public.push_subscriptions;
create policy push_subscriptions_write on public.push_subscriptions for all to authenticated
  using (profile_id = auth.uid() and company_id = public.current_company_id())
  with check (profile_id = auth.uid() and company_id = public.current_company_id());

-- ---------- 購読の登録・解除 ----------
-- 同じ端末（endpoint）の古い行は消してから入れ直す。
-- 1 台の端末を別の人が使い直したときに、前の人あての通知が届き続けるのを防ぐ。
create or replace function public.save_push_subscription(
  p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default '', p_label text default ''
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  cid uuid := public.current_company_id();
  uid uuid := auth.uid();
  new_id uuid;
begin
  if uid is null or cid is null then
    raise exception 'ログインが必要です' using errcode = 'P0001', hint = 'FORBIDDEN';
  end if;
  if coalesce(btrim(p_endpoint), '') = '' or coalesce(btrim(p_p256dh), '') = '' or coalesce(btrim(p_auth), '') = '' then
    raise exception '購読の情報が足りません' using errcode = 'P0001', hint = 'INVALID';
  end if;

  delete from public.push_subscriptions where endpoint = p_endpoint;
  insert into public.push_subscriptions (company_id, profile_id, endpoint, p256dh, auth, user_agent, label)
  values (cid, uid, p_endpoint, p_p256dh, p_auth, coalesce(p_user_agent, ''), coalesce(p_label, ''))
  returning id into new_id;
  return new_id;
end $$;

comment on function public.save_push_subscription(text, text, text, text, text) is
  'この端末でプッシュ通知を受け取る（同じ端末の古い購読は消してから入れ直す）';

create or replace function public.delete_push_subscription(p_endpoint text)
returns integer language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  n integer := 0;
begin
  if uid is null then
    raise exception 'ログインが必要です' using errcode = 'P0001', hint = 'FORBIDDEN';
  end if;
  delete from public.push_subscriptions where endpoint = p_endpoint and profile_id = uid;
  get diagnostics n = row_count;
  return n;
end $$;

comment on function public.delete_push_subscription(text) is
  'この端末の購読をやめる（自分の購読だけ消せる）';

-- ---------- 自分の通知の設定 ----------
create or replace function public.set_notify_prefs(p_notify_chat text, p_notify_line boolean)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'ログインが必要です' using errcode = 'P0001', hint = 'FORBIDDEN';
  end if;
  if p_notify_chat not in ('all', 'mention', 'off') then
    raise exception 'チャットの通知の指定が正しくありません' using errcode = 'P0001', hint = 'INVALID';
  end if;
  update public.profiles
     set notify_chat = p_notify_chat::public.notify_chat_mode,
         notify_line = coalesce(p_notify_line, true)
   where id = uid;
  return jsonb_build_object('notify_chat', p_notify_chat, 'notify_line', coalesce(p_notify_line, true));
end $$;

comment on function public.set_notify_prefs(text, boolean) is
  '自分の通知の受け取り方を変える（profiles の RLS がそのまま効く）';

-- ---------- 権限 ----------
grant execute on function public.save_push_subscription(text, text, text, text, text) to authenticated;
grant execute on function public.delete_push_subscription(text) to authenticated;
grant execute on function public.set_notify_prefs(text, boolean) to authenticated, service_role;
