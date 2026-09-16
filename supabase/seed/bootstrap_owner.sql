-- =============================================================================
-- 最初の会社とオーナー招待を作成する（setup_all.sql の実行後に 1 回だけ実行）
-- 実行後に表示される招待リンク（/invite/<token>）をブラウザで開くだけでログインできます
-- =============================================================================
-- ▼ 必要に応じて DO ブロック内の 3 つの値（メール・会社名・本番 URL）を書き換えてください
--    Supabase の SQL Editor にこのファイル全体を貼り付けて Run できます（psql でも実行可）
do $$
declare
  v_owner_email text := 'rootive.biz@gmail.com';
  v_company_name text := '株式会社ROOTIVE';
  v_app_url text := 'https://rootive.vercel.app';
  v_company_id uuid;
  v_token text;
begin
  select id into v_company_id from public.companies where name = v_company_name limit 1;
  if v_company_id is null then
    insert into public.companies (name, rounding_mode, default_royalty_rate, default_mgmt_fee, payout_month_offset, payout_day)
    values (v_company_name, 'none', 0.1, 15000, 1, 0)
    returning id into v_company_id;
    raise notice '会社を作成しました: % (%)', v_company_name, v_company_id;
  else
    raise notice '会社は既に存在します: % (%)', v_company_name, v_company_id;
  end if;

  -- 既存の未受諾招待は取り消して新しい招待を発行
  update public.invitations set cancelled_at = now()
   where company_id = v_company_id and lower(email) = lower(v_owner_email) and accepted_at is null and cancelled_at is null;

  insert into public.invitations (company_id, email, role, display_name, expires_at)
  values (v_company_id, lower(v_owner_email), 'owner', 'オーナー', now() + interval '30 days')
  returning token into v_token;

  raise notice '==============================================================';
  raise notice 'オーナー招待を作成しました: %', v_owner_email;
  raise notice '招待リンク（ブラウザで開くだけでログインできます）:';
  raise notice '%/invite/%', v_app_url, v_token;
  raise notice '有効期限: 30 日';
  raise notice '==============================================================';
end $$;

-- 招待リンクを確認したい場合（SQL Editor の結果に表示されます。URL 部分は本番 URL に読み替えてください）
select '/invite/' || token as invite_path, email, role, expires_at
  from public.invitations
 where accepted_at is null and cancelled_at is null
 order by created_at desc
 limit 1;
