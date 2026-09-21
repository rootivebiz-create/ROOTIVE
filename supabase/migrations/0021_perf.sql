-- =============================================================================
-- 0021 表示を速くする（タップしてからの待ち時間を減らす）
--   画面を 1 つ開くたびに Supabase へ 5 回も「直列で」問い合わせていた。
--     auth.getUser() → profiles → companies → （やっと並列のクエリ）
--   往復 1 回ごとに待つため、電波の状況によっては 1 秒以上かかっていた。
--
--   ここでは「ログイン中の自分のプロフィールと会社」を 1 回で返す RPC を用意する。
--   security invoker なので RLS はそのまま効き、
--   PostgREST が JWT を検証したうえで auth.uid() が入るため、
--   行が返ること自体が「正しいセッションである」ことの証明になる。
-- =============================================================================
create or replace function public.me()
returns jsonb language sql stable security invoker set search_path = public as $$
  select jsonb_build_object('profile', to_jsonb(p), 'company', to_jsonb(c))
    from public.profiles p
    join public.companies c on c.id = p.company_id
   where p.id = auth.uid() and p.is_active;
$$;

comment on function public.me() is
  'ログイン中のプロフィールと会社を 1 往復で返す（security invoker。RLS がそのまま効く）';

-- =============================================================================
-- ナビのバッジ（気になること・未読のチャット・決裁待ち）も 1 回にまとめる
-- =============================================================================
create or replace function public.nav_badges()
returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare
  cid uuid := public.current_company_id();
  alerts_n integer := 0;
  chat_n integer := 0;
  approvals_n integer := 0;
begin
  if cid is null then
    return jsonb_build_object('alerts', 0, 'chat', 0, 'approvals', 0);
  end if;
  select count(*) into alerts_n from public.alerts where company_id = cid and status = 'open';
  chat_n := coalesce(public.chat_unread_total(), 0);  -- 0011 の RPC をそのまま使う
  if public.is_owner() then
    select count(*) into approvals_n from public.approvals where company_id = cid and status = 'pending';
  end if;
  return jsonb_build_object('alerts', alerts_n, 'chat', chat_n, 'approvals', approvals_n);
end $$;

comment on function public.nav_badges() is
  'ナビのバッジ（未対応のアラート・未読のチャット・決裁待ち）を 1 往復で返す';

-- =============================================================================
-- 権限
-- =============================================================================
grant execute on function public.me() to authenticated, service_role;
grant execute on function public.nav_badges() to authenticated, service_role;
