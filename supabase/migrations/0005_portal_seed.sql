-- =============================================================================
-- 0005 ドライバーポータル用関数・初期データ投入・招待ユーティリティ
-- =============================================================================

-- ドライバー本人：締め済み月の一覧（会社利益は含めない）
create or replace function public.driver_portal_months()
returns table (month date, payout numeric, pay numeric, royalty numeric, mgmt_fee numeric, adj_pay numeric, closed_at timestamptz)
language sql stable security definer set search_path = public as $$
  select s.month, s.payout, s.pay, s.royalty, s.mgmt_fee, s.adj_pay, mc.closed_at
    from public.v_driver_month_summary s
    join public.month_closings mc on mc.company_id = s.company_id and mc.month = s.month and mc.status = 'closed'
   where s.driver_id = public.current_driver_id()
     and s.company_id = public.current_company_id()
   order by s.month desc;
$$;

-- ドライバー本人：締め済み月の支払明細（会社売上・利益は含めない）
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
    'driver', (select jsonb_build_object('id', d.id, 'name', d.name) from public.drivers d where d.id = did),
    'company', (select jsonb_build_object('name', c.name, 'address', c.address, 'tel', c.tel, 'invoice_reg_no', c.invoice_reg_no,
                  'statement_note', c.statement_note, 'payout_month_offset', c.payout_month_offset, 'payout_day', c.payout_day,
                  'show_royalty', c.driver_portal_show_royalty) from public.companies c where c.id = cid),
    'entries', (select coalesce(jsonb_agg(jsonb_build_object(
                  'id', e.id, 'project_name', e.project_name, 'item_name', e.item_name, 'unit', e.unit,
                  'qty', e.qty, 'pay_rate', e.pay_rate, 'pay', e.pay,
                  'royalty', e.royalty, 'royalty_rate', case when show_royalty then e.royalty_rate else null end, 'memo', e.memo)
                  order by e.created_at), '[]'::jsonb)
                from public.v_work_entry_calc e where e.driver_id = did and e.company_id = cid and e.month = p_month),
    'summary', (select jsonb_build_object('pay', s.pay, 'royalty', s.royalty, 'mgmt_fee', s.mgmt_fee, 'adj_pay', s.adj_pay, 'payout', s.payout,
                  'royalty_visible', show_royalty)
                from public.v_driver_month_summary s where s.driver_id = did and s.company_id = cid and s.month = p_month),
    'adjustments', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'label', a.label, 'amount', a.amount) order by a.sort_order, a.created_at), '[]'::jsonb)
                from public.adjustments a join public.driver_months dm on dm.id = a.driver_month_id
               where dm.driver_id = did and dm.company_id = cid and dm.month = p_month),
    'closed_at', (select mc.closed_at from public.month_closings mc where mc.company_id = cid and mc.month = p_month)
  );
end $$;

-- 初期データ（§8.6）。ドライバーが 1 件も無い会社にのみ投入する
create or replace function public.seed_initial_data(p_with_entries boolean default true)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  cid uuid := public.current_company_id();
  m date := date '2026-09-01';
  d_aiso uuid; d_kane uuid; d_numa uuid; d_imai uuid; d_ishi uuid; d_kuro uuid; d_fuji uuid; d_yosh uuid; d_kawa uuid; d_taka uuid;
  p_misato uuid; p_kawaguchi uuid; p_temu uuid; p_nihonbashi uuid; p_wako uuid; p_soka uuid; p_tatsumi uuid;
  i_misato uuid; i_kawaguchi uuid; i_temu uuid; i_nihonbashi uuid; i_wako_takkyu uuid; i_wako_neko uuid; i_soka uuid; i_tatsumi uuid;
begin
  if not public.is_admin() then
    raise exception '権限がありません' using errcode = 'P0001', hint = 'FORBIDDEN';
  end if;
  if exists (select 1 from public.drivers where company_id = cid) then
    raise exception '既にドライバーが登録されているため初期データは投入できません' using errcode = 'P0001', hint = 'NOT_EMPTY';
  end if;

  insert into public.drivers (company_id, name, kana, royalty_rate, mgmt_fee, sort_order) values
    (cid, '相曽慧', 'あいそ けい', 0.1, 15000, 1) returning id into d_aiso;
  insert into public.drivers (company_id, name, kana, royalty_rate, mgmt_fee, sort_order) values
    (cid, '金島幸太', 'かねしま こうた', 0.1, 0, 2) returning id into d_kane;
  insert into public.drivers (company_id, name, kana, royalty_rate, mgmt_fee, sort_order) values
    (cid, '沼田基', 'ぬまた もとい', 0.1, 15000, 3) returning id into d_numa;
  insert into public.drivers (company_id, name, kana, royalty_rate, mgmt_fee, sort_order) values
    (cid, '今井皇輝', 'いまい こうき', 0.1, 15000, 4) returning id into d_imai;
  insert into public.drivers (company_id, name, kana, royalty_rate, mgmt_fee, sort_order) values
    (cid, '石田泰典', 'いしだ やすのり', 0.125, 15000, 5) returning id into d_ishi;
  insert into public.drivers (company_id, name, kana, royalty_rate, mgmt_fee, sort_order) values
    (cid, '黒岩亜夢莉', 'くろいわ あむり', 0.125, 15000, 6) returning id into d_kuro;
  insert into public.drivers (company_id, name, kana, royalty_rate, mgmt_fee, sort_order) values
    (cid, '藤田裕介', 'ふじた ゆうすけ', 0.1, 0, 7) returning id into d_fuji;
  insert into public.drivers (company_id, name, kana, royalty_rate, mgmt_fee, sort_order) values
    (cid, '吉田雅一', 'よしだ まさかず', 0.1, 15000, 8) returning id into d_yosh;
  insert into public.drivers (company_id, name, kana, royalty_rate, mgmt_fee, memo, sort_order) values
    (cid, '川島幹太', 'かわしま かんた', 0, 0, 'オーナー本人（役員報酬のため支払 0）', 9) returning id into d_kawa;
  insert into public.drivers (company_id, name, kana, royalty_rate, mgmt_fee, sort_order) values
    (cid, '高森豪介', 'たかもり ごうすけ', 0.1, 15000, 10) returning id into d_taka;

  insert into public.projects (company_id, name, sort_order) values (cid, '三郷Amazon', 1) returning id into p_misato;
  insert into public.projects (company_id, name, sort_order) values (cid, '川口領家Amazon', 2) returning id into p_kawaguchi;
  insert into public.projects (company_id, name, sort_order) values (cid, 'Temu', 3) returning id into p_temu;
  insert into public.projects (company_id, name, client_name, sort_order) values (cid, 'にほんばし蔵前郵便局', '株式会社GALLOP9', 4) returning id into p_nihonbashi;
  insert into public.projects (company_id, name, sort_order) values (cid, '和光ヤマト', 5) returning id into p_wako;
  insert into public.projects (company_id, name, sort_order) values (cid, '草加→鎌ヶ谷', 6) returning id into p_soka;
  insert into public.projects (company_id, name, sort_order) values (cid, '辰巳屋興業', 7) returning id into p_tatsumi;

  insert into public.project_items (project_id, name, unit, bill_rate, pay_rate, sort_order) values (p_misato, '標準', 'day', 23025, 21780, 1) returning id into i_misato;
  insert into public.project_items (project_id, name, unit, bill_rate, pay_rate, sort_order) values (p_kawaguchi, '標準', 'day', 21133, 20250, 1) returning id into i_kawaguchi;
  insert into public.project_items (project_id, name, unit, bill_rate, pay_rate, sort_order) values (p_temu, '標準', 'day', 23025, 21960, 1) returning id into i_temu;
  insert into public.project_items (project_id, name, unit, bill_rate, pay_rate, sort_order) values (p_nihonbashi, '標準', 'piece', 180, 162, 1) returning id into i_nihonbashi;
  insert into public.project_items (project_id, name, unit, bill_rate, pay_rate, sort_order) values (p_wako, '宅急便', 'piece', 180, 162, 1) returning id into i_wako_takkyu;
  insert into public.project_items (project_id, name, unit, bill_rate, pay_rate, sort_order) values (p_wako, 'ネコポス', 'piece', 50, 50, 2) returning id into i_wako_neko;
  insert into public.project_items (project_id, name, unit, bill_rate, pay_rate, sort_order) values (p_soka, '標準', 'day', 15000, 15000, 1) returning id into i_soka;
  insert into public.project_items (project_id, name, unit, bill_rate, pay_rate, sort_order) values (p_tatsumi, '標準', 'day', 8500, 0, 1) returning id into i_tatsumi;

  insert into public.driver_pay_overrides (driver_id, project_item_id, pay_rate) values (d_yosh, i_misato, 21960), (d_taka, i_misato, 21960);

  if p_with_entries then
    -- §2.6 の 10 行（相曽慧の管理費は 14,999）
    insert into public.work_entries (company_id, month, driver_id, project_item_id, qty, bill_rate, pay_rate, royalty_rate, rounding_mode) values
      (cid, m, d_aiso, i_misato, 21, 23025, 21780, 0.1, 'none'),
      (cid, m, d_kane, i_nihonbashi, 803, 180, 162, 0.1, 'none'),
      (cid, m, d_numa, i_nihonbashi, 803, 180, 162, 0.1, 'none'),
      (cid, m, d_imai, i_wako_takkyu, 1398, 180, 162, 0.1, 'none'),
      (cid, m, d_imai, i_wako_neko, 749, 50, 50, 0.1, 'none'),
      (cid, m, d_fuji, i_temu, 21, 23025, 21960, 0.1, 'none'),
      (cid, m, d_ishi, i_kawaguchi, 16, 21133, 20250, 0.125, 'none'),
      (cid, m, d_kuro, i_misato, 21, 23025, 21780, 0.125, 'none'),
      (cid, m, d_kawa, i_misato, 8, 23025, 0, 0, 'none'),
      (cid, m, d_kawa, i_tatsumi, 1, 8500, 0, 0, 'none');
    update public.driver_months set mgmt_fee = 14999 where company_id = cid and month = m and driver_id = d_aiso;
  end if;

  return jsonb_build_object('drivers', 10, 'projects', 7, 'project_items', 8, 'entries', case when p_with_entries then 10 else 0 end);
end $$;

-- 招待の作成（owner）。招待トークンを返す
create or replace function public.create_invitation(p_email text, p_role public.user_role, p_driver_id uuid default null, p_display_name text default '')
returns public.invitations language plpgsql security invoker set search_path = public as $$
declare
  cid uuid := public.current_company_id();
  inv public.invitations;
begin
  if not public.is_owner() then
    raise exception 'ユーザー招待はオーナーのみ可能です' using errcode = 'P0001', hint = 'OWNER_ONLY';
  end if;
  -- 同じメールの未受諾招待は取り消す
  update public.invitations set cancelled_at = now()
   where company_id = cid and lower(email) = lower(p_email) and accepted_at is null and cancelled_at is null;
  insert into public.invitations (company_id, email, role, driver_id, display_name, invited_by)
  values (cid, lower(trim(p_email)), p_role, case when p_role = 'driver' then p_driver_id else null end, coalesce(p_display_name, ''), auth.uid())
  returning * into inv;
  return inv;
end $$;
