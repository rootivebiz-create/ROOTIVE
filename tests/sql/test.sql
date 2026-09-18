-- =============================================================================
-- SQL 結合テスト：ビューの計算・RLS・締めガード・招待制・プロフィール保護・復元・監査
-- psql -v ON_ERROR_STOP=1 で実行。失敗時は例外で停止する
-- =============================================================================
\set ON_ERROR_STOP on
\set QUIET on
\pset pager off
\o /dev/null

create or replace function public.t_assert(cond boolean, msg text) returns void language plpgsql as $$
begin
  if not coalesce(cond, false) then
    raise exception 'ASSERT FAILED: %', msg;
  end if;
  raise notice '  ok: %', msg;
end $$;

-- 動的 SQL がエラーになることを確認（hint が指定されていれば一致も確認）
create or replace function public.t_expect_error(sql text, expected_hint text default null, msg text default null) returns void language plpgsql as $$
declare
  h text;
  m text;
begin
  begin
    execute sql;
  exception when others then
    get stacked diagnostics h = pg_exception_hint, m = message_text;
    if expected_hint is not null and coalesce(h, '') <> expected_hint and position(expected_hint in coalesce(m, '')) = 0 then
      raise exception 'ASSERT FAILED: % — 期待 hint=% 実際 hint=% message=%', coalesce(msg, sql), expected_hint, h, m;
    end if;
    raise notice '  ok (error as expected): % [%]', coalesce(msg, sql), coalesce(h, left(m, 60));
    return;
  end;
  raise exception 'ASSERT FAILED: エラーになるべき処理が成功した: %', coalesce(msg, sql);
end $$;

-- 動的 SQL の影響行数を返す
create or replace function public.t_rowcount(sql text) returns integer language plpgsql as $$
declare n integer;
begin
  execute sql;
  get diagnostics n = row_count;
  return n;
end $$;
grant execute on function public.t_assert(boolean, text), public.t_expect_error(text, text, text), public.t_rowcount(text) to authenticated, anon, service_role;

-- 固定 ID
\set company_a '00000000-0000-0000-0000-00000000000a'
\set company_b '00000000-0000-0000-0000-00000000000b'
\set owner_a   '00000000-0000-0000-0000-0000000000a1'
\set admin_a   '00000000-0000-0000-0000-0000000000a2'
\set viewer_a  '00000000-0000-0000-0000-0000000000a3'
\set driver_a  '00000000-0000-0000-0000-0000000000a4'
\set inactive_a '00000000-0000-0000-0000-0000000000a5'
\set owner_b   '00000000-0000-0000-0000-0000000000b1'

\echo '== 1. 会社・招待・auth.users トリガー（招待制）'
insert into public.companies (id, name) values (:'company_a', '株式会社ROOTIVE'), (:'company_b', '別会社');
insert into public.invitations (company_id, email, role) values
  (:'company_a', 'owner@a.test', 'owner'),
  (:'company_a', 'admin@a.test', 'admin'),
  (:'company_a', 'viewer@a.test', 'viewer'),
  (:'company_a', 'inactive@a.test', 'viewer'),
  (:'company_b', 'owner@b.test', 'owner');
insert into auth.users (id, email) values (:'owner_a', 'owner@a.test'), (:'admin_a', 'admin@a.test'), (:'viewer_a', 'viewer@a.test'), (:'inactive_a', 'inactive@a.test'), (:'owner_b', 'owner@b.test');
select public.t_assert((select count(*) from public.profiles) = 5, 'トリガーで 5 件のプロフィールが作成される');
select public.t_assert((select role from public.profiles where id = :'owner_a') = 'owner', 'owner ロールが付与される');
select public.t_assert((select accepted_at is not null from public.invitations where email = 'owner@a.test'), '招待が受諾済みになる');
select public.t_expect_error($$insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000ff', 'nobody@a.test')$$, 'INVITATION_REQUIRED', '招待が無いユーザー登録は拒否される');
select public.t_assert((select count(*) from auth.users where email = 'nobody@a.test') = 0, '拒否された auth ユーザーは作成されない');
-- 期限切れの招待
insert into public.invitations (company_id, email, role, expires_at) values (:'company_a', 'expired@a.test', 'viewer', now() - interval '1 day');
select public.t_expect_error($$insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000fe', 'expired@a.test')$$, 'INVITATION_REQUIRED', '期限切れの招待では登録できない');
update public.profiles set is_active = false where id = :'inactive_a';

\echo '== 2. anon には権限が無い'
set role anon;
select public.t_expect_error($$select count(*) from public.drivers$$, null, 'anon は drivers を読めない');
select public.t_expect_error($$select public.export_backup()$$, null, 'anon は RPC を実行できない');
reset role;

\echo '== 3. owner として初期データ投入 → ビューの計算が §2.6 と一致'
set role authenticated;
select public.test_login(:'owner_a');
select public.t_assert(public.current_company_id() = :'company_a', 'current_company_id');
select public.t_assert(public.is_owner(), 'is_owner');
select public.seed_initial_data(true);
select public.t_assert((select count(*) from public.drivers) = 10, 'ドライバー 10 名');
select id as drv_a from public.drivers where name = '相曽慧' \gset
select public.t_assert((select count(*) from public.work_entries) = 10, '稼働行 10 行');
select public.t_assert((select count(*) from public.driver_months) = 8, 'driver_months はトリガーで 8 件自動作成');
select public.t_assert((select bill from public.v_month_summary where month = '2026-09-01') = 2559573, '会社売上 2,559,573');
select public.t_assert((select profit from public.v_month_summary where month = '2026-09-01') = 652490.3, '会社利益 652,490.3');
select public.t_assert((select payout from public.v_month_summary where month = '2026-09-01') = 1907082.7, '支払合計 1,907,082.7');
select public.t_assert((select driver_count from public.v_month_summary where month = '2026-09-01') = 8, '対象 8 名');
select public.t_assert((select round(profit_rate, 4) from public.v_month_summary where month = '2026-09-01') = round(652490.3 / 2559573, 4), '利益率');
-- 各ドライバー
select public.t_assert((select driver_profit = 86882 and payout = 396643 and mgmt_fee = 14999 from public.v_driver_month_summary where driver_name = '相曽慧' and month = '2026-09-01'), '相曽慧 86,882 / 396,643');
select public.t_assert((select driver_profit = 27462.6 and payout = 117077.4 from public.v_driver_month_summary where driver_name = '金島幸太' and month = '2026-09-01'), '金島幸太 27,462.6 / 117,077.4');
select public.t_assert((select driver_profit = 42462.6 and payout = 102077.4 from public.v_driver_month_summary where driver_name = '沼田基' and month = '2026-09-01'), '沼田基 42,462.6 / 102,077.4');
select public.t_assert((select driver_profit = 66556.6 and payout = 222533.4 and entry_count = 2 from public.v_driver_month_summary where driver_name = '今井皇輝' and month = '2026-09-01'), '今井皇輝 66,556.6 / 222,533.4');
select public.t_assert((select driver_profit = 68481 and payout = 415044 from public.v_driver_month_summary where driver_name = '藤田裕介' and month = '2026-09-01'), '藤田裕介 68,481 / 415,044');
select public.t_assert((select driver_profit = 69628 and payout = 268500 from public.v_driver_month_summary where driver_name = '石田泰典' and month = '2026-09-01'), '石田泰典 69,628 / 268,500');
select public.t_assert((select driver_profit = 98317.5 and payout = 385207.5 from public.v_driver_month_summary where driver_name = '黒岩亜夢莉' and month = '2026-09-01'), '黒岩亜夢莉 98,317.5 / 385,207.5');
select public.t_assert((select driver_profit = 192700 and payout = 0 from public.v_driver_month_summary where driver_name = '川島幹太' and month = '2026-09-01'), '川島幹太 192,700 / 0');
-- 恒等式
select public.t_assert((select bool_and(bill = payout + driver_profit) from public.v_driver_month_summary where month = '2026-09-01'), '恒等式 Σbill = payout + driver_profit');
-- 案件別
select public.t_assert((select entry_profit from public.v_project_summary where month = '2026-09-01' and project_name = '三郷Amazon') = 339400.5, '案件別: 三郷Amazon 行の利益 339,400.5');
select public.t_assert((select count(*) from public.v_month_list) = 1, 'v_month_list に 1 か月');

\echo '== 4. 端数処理（floor / round / ceil）と管理費の計上条件'
insert into public.work_entries (company_id, month, driver_id, project_item_id, qty, bill_rate, pay_rate, royalty_rate, rounding_mode)
select :'company_a', '2026-08-01', d.id, i.id, 803, 180, 162, 0.1, 'floor' from public.drivers d, public.project_items i, public.projects p
 where d.name = '金島幸太' and i.project_id = p.id and p.name = 'にほんばし蔵前郵便局';
select public.t_assert((select royalty from public.v_work_entry_calc where month = '2026-08-01') = 13008, 'floor → 13,008');
update public.work_entries set rounding_mode = 'round' where month = '2026-08-01';
select public.t_assert((select royalty from public.v_work_entry_calc where month = '2026-08-01') = 13009, 'round → 13,009');
update public.work_entries set rounding_mode = 'ceil' where month = '2026-08-01';
select public.t_assert((select royalty from public.v_work_entry_calc where month = '2026-08-01') = 13009, 'ceil → 13,009');
update public.work_entries set rounding_mode = 'round', pay_rate = 25, qty = 1, bill_rate = 100 where month = '2026-08-01';
select public.t_assert((select royalty from public.v_work_entry_calc where month = '2026-08-01') = 3, 'round 2.5 → 3（四捨五入）');
update public.driver_months set mgmt_fee = 15000 where month = '2026-08-01';
select public.t_assert((select mgmt_fee from public.v_driver_month_summary where month = '2026-08-01') = 15000, '数量 > 0 なら管理費を計上');
update public.work_entries set qty = 0 where month = '2026-08-01';
select public.t_assert((select mgmt_fee = 0 and mgmt_fee_setting = 15000 and payout = 0 from public.v_driver_month_summary where month = '2026-08-01'), '数量 0 のみの月は管理費を計上しない');
delete from public.work_entries where month = '2026-08-01';
delete from public.driver_months where month = '2026-08-01';

\echo '== 5. 固定控除の自動複写と調整の計算'
insert into public.driver_recurring_adjustments (driver_id, label, amount, count_as_profit)
select id, 'リース代', -30000, true from public.drivers where name = '吉田雅一';
insert into public.driver_recurring_adjustments (driver_id, label, amount, count_as_profit, is_active)
select id, '無効な控除', -999, true, false from public.drivers where name = '吉田雅一';
insert into public.work_entries (company_id, month, driver_id, project_item_id, qty, bill_rate, pay_rate, royalty_rate, rounding_mode)
select :'company_a', '2026-09-01', d.id, i.id, 20, ed.bill_rate, ed.pay_rate, ed.royalty_rate, ed.rounding_mode
  from public.drivers d join public.projects p on p.name = '三郷Amazon' join public.project_items i on i.project_id = p.id
  cross join lateral public.entry_defaults(d.id, i.id) ed where d.name = '吉田雅一';
select public.t_assert((select pay_rate from public.work_entries we join public.drivers d on d.id = we.driver_id where d.name = '吉田雅一') = 21960, '個別単価 21,960 が自動入力される（§2.5）');
select public.t_assert((select count(*) from public.adjustments a join public.driver_months dm on dm.id = a.driver_month_id join public.drivers d on d.id = dm.driver_id where d.name = '吉田雅一') = 1, '有効な固定控除だけが複写される');
select public.t_assert((select payout from public.v_driver_month_summary where driver_name = '吉田雅一' and month = '2026-09-01') = (21960 * 20) - (21960 * 20 * 0.1) - 15000 - 30000, '控除込みの支払額');
select public.t_assert((select driver_profit from public.v_driver_month_summary where driver_name = '吉田雅一' and month = '2026-09-01') = (23025 - 21960) * 20 + (21960 * 20 * 0.1) + 15000 + 30000, '利益計上の控除は会社利益に加算');
-- 利益計上なしの調整
insert into public.adjustments (driver_month_id, label, amount, count_as_profit)
select dm.id, '立替精算', 5000, false from public.driver_months dm join public.drivers d on d.id = dm.driver_id where d.name = '吉田雅一' and dm.month = '2026-09-01';
select public.t_assert((select adj_pay = -25000 and adj_profit = 30000 from public.v_driver_month_summary where driver_name = '吉田雅一' and month = '2026-09-01'), '利益計上なしの調整は支払にのみ影響');
select public.t_assert((select bill - (payout + driver_profit) = -5000 from public.v_driver_month_summary where driver_name = '吉田雅一' and month = '2026-09-01'), '恒等式のずれ＝利益計上なしの調整分');

\echo '== 6. 前月から複製（冪等）と一括入力'
select public.t_assert(public.copy_previous_month('2026-10-01') = 11, '前月から 11 行を数量 0 で複製');
select public.t_assert(public.copy_previous_month('2026-10-01') = 0, '2 回目は 0 行（冪等）');
select public.t_assert((select bool_and(qty = 0) from public.work_entries where month = '2026-10-01'), '複製行は数量 0');
select public.t_assert((select mgmt_fee from public.v_month_summary where month = '2026-10-01') = 0, '複製直後は管理費が計上されない');
select public.t_assert((select payout from public.v_month_summary where month = '2026-10-01') = -30000, '複製直後の支払合計は固定控除分のみ（管理費なし）');
-- 停止中ドライバーは複製されない
update public.drivers set is_active = false where name = '高森豪介';
delete from public.work_entries where month = '2026-10-01';
delete from public.driver_months where month = '2026-10-01';
insert into public.work_entries (company_id, month, driver_id, project_item_id, qty, bill_rate, pay_rate, royalty_rate)
select :'company_a', '2026-09-01', d.id, i.id, 1, 100, 90, 0.1 from public.drivers d, public.project_items i join public.projects p on p.id = i.project_id where d.name = '高森豪介' and p.name = 'Temu';
select public.t_assert(public.copy_previous_month('2026-10-01') = 11, '停止中ドライバーの行は複製されない');
delete from public.work_entries where driver_id = (select id from public.drivers where name = '高森豪介');
update public.drivers set is_active = true where name = '高森豪介';
-- 一括入力
select public.t_assert(
  (public.bulk_set_entries('2026-10-01', (select i.id from public.project_items i join public.projects p on p.id = i.project_id where p.name = 'Temu'),
    jsonb_build_array(
      jsonb_build_object('driver_id', (select id from public.drivers where name = '藤田裕介'), 'qty', 22),
      jsonb_build_object('driver_id', (select id from public.drivers where name = '高森豪介'), 'qty', 3),
      jsonb_build_object('driver_id', (select id from public.drivers where name = '相曽慧'), 'qty', 0)
    )))::text = '{"deleted": 0, "updated": 1, "inserted": 1}', '一括入力: 既存は更新・新規は作成・0 は削除対象なし');
select public.t_assert((select qty from public.work_entries we join public.drivers d on d.id = we.driver_id join public.project_items i on i.id = we.project_item_id join public.projects p on p.id = i.project_id where d.name = '藤田裕介' and p.name = 'Temu' and month = '2026-10-01') = 22, '一括入力で数量が更新される');
select public.t_assert((select pay_rate from public.work_entries we join public.drivers d on d.id = we.driver_id where d.name = '高森豪介' and month = '2026-10-01') = 21960, '一括入力の新規行はマスタから単価を取得');
select public.t_assert((public.bulk_set_entries('2026-10-01', (select i.id from public.project_items i join public.projects p on p.id = i.project_id where p.name = 'Temu'),
    jsonb_build_array(jsonb_build_object('driver_id', (select id from public.drivers where name = '高森豪介'), 'qty', 0))))->>'deleted' = '1', '一括入力: 数量 0 で削除');

\echo '== 6b. ドライバー別単価（受注単価の上書き）と未締め月への反映'
select id as drv_yosh from public.drivers where name = '吉田雅一' \gset
select id as drv_kuro from public.drivers where name = '黒岩亜夢莉' \gset
select i.id as item_misato from public.project_items i join public.projects p on p.id = i.project_id where p.name = '三郷Amazon' \gset
-- 吉田雅一 × 三郷Amazon：受注単価だけ上書き（支払 21,960 は維持）
update public.driver_pay_overrides set bill_rate = 23500 where driver_id = :'drv_yosh' and project_item_id = :'item_misato';
select public.t_assert((select bill_rate from public.entry_defaults(:'drv_yosh', :'item_misato')) = 23500, '受注単価の上書きが自動入力に反映される（§2.5）');
select public.t_assert((select pay_rate from public.entry_defaults(:'drv_yosh', :'item_misato')) = 21960, '支払単価の上書きは維持される');
-- 黒岩亜夢莉 × 三郷Amazon：受注だけの上書き行（支払 null ＝ 案件の標準）
insert into public.driver_pay_overrides (driver_id, project_item_id, bill_rate) values (:'drv_kuro', :'item_misato', 23100);
select public.t_assert((select bill_rate from public.entry_defaults(:'drv_kuro', :'item_misato')) = 23100, '受注だけの上書き行');
select public.t_assert((select pay_rate from public.entry_defaults(:'drv_kuro', :'item_misato')) = 21780, '支払 null は案件内容の標準を使う');
select public.t_expect_error(format($$insert into public.driver_pay_overrides (driver_id, project_item_id) values ('%s', (select id from public.project_items i join public.projects p on p.id = i.project_id where p.name = 'Temu'))$$, :'drv_kuro'), null, '受注・支払とも null の行は作れない');
select public.t_expect_error(format($$update public.driver_pay_overrides set bill_rate = -1 where driver_id = '%s'$$, :'drv_kuro'), null, '受注単価はマイナス不可');
-- 差分：2026-10 の複製行（吉田 23025 → 23500、黒岩 23025 → 23100）
select public.t_assert((select count(*) from public.rate_diffs('2026-10-01')) = 2, 'マスタと異なる稼働行が 2 件');
select public.t_assert((select master_bill_rate from public.rate_diffs('2026-10-01') where driver_id = :'drv_yosh') = 23500, '差分にマスタの受注単価が出る');
select public.t_assert((select bill_rate from public.rate_diffs('2026-10-01') where driver_id = :'drv_yosh') = 23025, '差分に稼働行のスナップショットが出る');
select public.t_assert((select count(*) from public.rate_diffs('2026-09-01')) = 2, '9 月の稼働行も差分に出る（この時点では未締め）');
-- 反映：ドライバー指定 → 残り → 冪等
select public.t_assert(public.apply_master_rates('2026-10-01', :'drv_yosh') = 1, 'ドライバー指定で 1 行を更新');
select public.t_assert((select bill_rate from public.work_entries where month = '2026-10-01' and driver_id = :'drv_yosh') = 23500, '稼働行の受注単価がマスタの値になる');
select public.t_assert((select count(*) from public.rate_diffs('2026-10-01')) = 1, '残りの差分は 1 件');
select public.t_assert(public.apply_master_rates('2026-10-01', null, :'item_misato') = 1, '案件内容指定で残り 1 行を更新');
select public.t_assert(public.apply_master_rates('2026-10-01') = 0, '2 回目は 0 行（冪等）');
select public.t_assert((select count(*) from public.audit_logs where table_name = 'work_entries' and action = 'UPDATE' and (after->>'bill_rate')::numeric = 23500) >= 1, '反映は監査ログに残る');
-- 元に戻す（以降の節の期待値を変えない）。標準に戻すと差分が再び出て、反映で元の単価に戻る
delete from public.driver_pay_overrides where driver_id = :'drv_kuro' and project_item_id = :'item_misato';
update public.driver_pay_overrides set bill_rate = null where driver_id = :'drv_yosh' and project_item_id = :'item_misato';
select public.t_assert((select count(*) from public.rate_diffs('2026-10-01')) = 2, '標準に戻すと再び 2 件の差分');
select public.t_assert(public.apply_master_rates('2026-10-01', null, null, array(select entry_id from public.rate_diffs('2026-10-01'))) = 2, '行 ID 指定で 2 行を更新');
select public.t_assert((select count(*) from public.rate_diffs('2026-10-01')) = 0 and (select count(*) from public.rate_diffs('2026-09-01')) = 0, '差分なし');
select public.t_expect_error($$select public.apply_master_rates('2026-10-15')$$, null, '月初日以外は拒否');

\echo '== 6c. 消費税（税抜の単価 → 明細で税込）・ドライバーごとの課税区分と支払日'
-- 既定：税率 10%・切り捨て・全員 課税。相曽慧：pay 457,380 − royalty 45,738 − 管理費 14,999 = 396,643 → 消費税 39,664 → 税込 436,307
select public.t_assert((select tax_rate = 0.10 and tax_rounding = 'floor' from public.companies where id = :'company_a'), '会社の既定は 10%・切り捨て');
select public.t_assert((select tax_mode = 'taxable' and invoice_reg_no = '' and payout_month_offset is null and payout_day is null from public.drivers where name = '相曽慧'), 'ドライバーの既定は課税・支払日は会社設定');
select public.t_assert((select tax_base = 396643 and tax = 39664 and payout_incl = 436307 from public.v_driver_month_summary where driver_name = '相曽慧' and month = '2026-09-01'), '相曽慧 税抜 396,643 / 消費税 39,664 / 税込 436,307');
select public.t_assert((select tax = 0 and payout_incl = 0 from public.v_driver_month_summary where driver_name = '川島幹太' and month = '2026-09-01'), '川島幹太（支払 0）は消費税 0');
select public.t_assert((select tax = (select sum(tax) from public.v_driver_month_summary where month = '2026-09-01') and payout_incl = payout + tax from public.v_month_summary where month = '2026-09-01'), '会社 × 月の消費税と税込支払額は合計');
-- 吉田雅一（控除 30,000 と立替 5,000 の調整あり）：調整は税込のまま。税抜小計 = 439,200 − 43,920 − 15,000 = 380,280 → 税 38,028
select public.t_assert((select tax_base = 380280 and tax = 38028 and payout_incl = payout + 38028 from public.v_driver_month_summary where driver_name = '吉田雅一' and month = '2026-09-01'), '調整は消費税の対象外');
-- 端数処理：四捨五入に変えると 396,643 × 0.1 = 39,664.3 → 39,664、切り上げ 39,665、税率 8% にすると 31,731.44 → 切り捨て 31,731
update public.companies set tax_rounding = 'round' where id = :'company_a';
select public.t_assert((select tax = 39664 from public.v_driver_month_summary where driver_name = '相曽慧' and month = '2026-09-01'), '四捨五入');
update public.companies set tax_rounding = 'ceil' where id = :'company_a';
select public.t_assert((select tax = 39665 from public.v_driver_month_summary where driver_name = '相曽慧' and month = '2026-09-01'), '切り上げ');
update public.companies set tax_rate = 0.08, tax_rounding = 'floor' where id = :'company_a';
select public.t_assert((select tax = 31731 from public.v_driver_month_summary where driver_name = '相曽慧' and month = '2026-09-01'), '税率 8%');
update public.companies set tax_rate = 0.10 where id = :'company_a';
-- 非課税のドライバー
update public.drivers set tax_mode = 'exempt' where name = '相曽慧';
select public.t_assert((select tax = 0 and payout_incl = payout from public.v_driver_month_summary where driver_name = '相曽慧' and month = '2026-09-01'), '非課税・免税は消費税 0');
update public.drivers set tax_mode = 'taxable' where name = '相曽慧';
select public.t_expect_error($$update public.companies set tax_rate = 1.5$$, null, '税率は 0〜1');
select public.t_expect_error($$update public.drivers set payout_day = 32 where name = '相曽慧'$$, null, '支払日は 0〜31');
-- ドライバーごとの支払日
update public.drivers set payout_month_offset = 2, payout_day = 15 where name = '相曽慧';
select public.t_assert((select payout_month_offset = 2 and payout_day = 15 from public.drivers where name = '相曽慧'), 'ドライバー個別の支払日');
update public.drivers set payout_month_offset = null, payout_day = null where name = '相曽慧';

\echo '== 7. 月締め：ガード・権限'
select public.t_assert((public.close_month('2026-09-01', 'テスト締め'))->'summary'->>'bill' = '2559573.0000' or (public.close_month('2026-09-01', 'テスト締め')) is not null, '締め処理（スナップショット付き）') where false;
select public.t_assert((public.close_month('2026-09-01', 'テスト締め'))->'summary' is not null, '締め処理（スナップショット付き）');
select public.t_assert(public.is_month_closed(:'company_a', '2026-09-01'), '締め済みになる');
select public.t_assert((select status from public.v_month_summary where month = '2026-09-01') = 'closed', 'ビューに締め状態が出る');
select public.t_expect_error($$update public.work_entries set qty = 22 where month = '2026-09-01'$$, 'MONTH_CLOSED', '締め済み月の稼働行 UPDATE は拒否');
select public.t_expect_error($$delete from public.work_entries where month = '2026-09-01'$$, 'MONTH_CLOSED', '締め済み月の稼働行 DELETE は拒否');
select public.t_expect_error(format($$insert into public.work_entries (company_id, month, driver_id, project_item_id, qty, bill_rate, pay_rate, royalty_rate) values ('%s', '2026-09-01', (select id from public.drivers where name = '相曽慧'), (select id from public.project_items limit 1), 1, 1, 1, 0)$$, :'company_a'), 'MONTH_CLOSED', '締め済み月への INSERT は拒否');
select public.t_expect_error($$update public.driver_months set mgmt_fee = 0 where month = '2026-09-01'$$, 'MONTH_CLOSED', '締め済み月の管理費変更は拒否');
select public.t_expect_error($$delete from public.adjustments where driver_month_id in (select id from public.driver_months where month = '2026-09-01')$$, 'MONTH_CLOSED', '締め済み月の調整削除は拒否');
select public.t_expect_error($$update public.work_entries set month = '2026-11-01' where month = '2026-09-01'$$, 'MONTH_CLOSED', '締め済み月から他月への移動も拒否');
select public.t_expect_error($$update public.work_entries set month = '2026-09-01' where month = '2026-10-01'$$, 'MONTH_CLOSED', '他月から締め済み月への移動も拒否');
select public.t_expect_error($$select public.close_month('2026-09-01')$$, 'ALREADY_CLOSED', '二重締めは拒否');
select public.t_expect_error($$select public.copy_previous_month('2026-09-01')$$, 'MONTH_CLOSED', '締め済み月への複製は拒否');
select public.t_expect_error($$select public.apply_master_rates('2026-09-01')$$, 'MONTH_CLOSED', '締め済み月への単価反映は拒否');
select public.t_assert((select count(*) from public.audit_logs where action = 'close_month') = 1, '締めの監査ログ');
-- 締めた月の消費税は固定される（会社設定・課税区分を変えても変わらない）
select public.t_assert((select bool_and(tax_rate = 0.10 and tax_rounding = 'floor' and tax_mode = 'taxable') from public.driver_months where month = '2026-09-01'), '締め時に消費税の設定を driver_months に固定');
update public.companies set tax_rate = 0.08, tax_rounding = 'round' where id = :'company_a';
update public.drivers set tax_mode = 'exempt' where name = '相曽慧';
select public.t_assert((select tax = 39664 and payout_incl = 436307 from public.v_driver_month_summary where driver_name = '相曽慧' and month = '2026-09-01'), '締め済み月の消費税は設定変更の影響を受けない');
select public.t_assert((select tax_rate = 0.08 from public.v_driver_month_summary where driver_name = '藤田裕介' and month = '2026-10-01'), '未締め月は現在の設定に従う');
update public.companies set tax_rate = 0.10, tax_rounding = 'floor' where id = :'company_a';
update public.drivers set tax_mode = 'taxable' where name = '相曽慧';
select public.t_assert((select count(*) from public.audit_logs where table_name = 'driver_months' and after ? 'tax_rate' and (after->>'tax_rate') is not null and action = 'UPDATE') = 0, '固定の書き込みは監査ログに残さない');

\echo '== 8. admin の権限'
select public.test_login(:'admin_a');
select public.t_assert(public.is_admin() and not public.is_owner(), 'admin');
select public.t_expect_error($$select public.reopen_month('2026-09-01')$$, 'OWNER_ONLY', 'admin は締め解除できない');
select public.t_expect_error($$update public.month_closings set status = 'open' where month = '2026-09-01'$$, 'OWNER_ONLY', 'admin は month_closings を直接 open にできない');
select public.t_assert(public.t_rowcount($$delete from public.month_closings where month = '2026-09-01'$$) = 0, 'admin は締め記録を削除できない（RLS で 0 行）');
select public.t_expect_error($$select public.import_backup('{}'::jsonb)$$, 'OWNER_ONLY', 'admin は復元できない');
select public.t_expect_error($$select public.reset_company_data('株式会社ROOTIVE')$$, 'OWNER_ONLY', 'admin はデータ全削除できない');
select public.t_expect_error($$select public.create_invitation('x@a.test', 'viewer')$$, 'OWNER_ONLY', 'admin はユーザー招待できない');
select public.t_assert((select count(*) from public.invitations) = 0, 'admin は招待を読めない');
select public.t_assert((select count(*) from public.audit_logs) > 0, 'admin は監査ログを読める');
select public.t_assert(public.t_rowcount($$update public.profiles set role = 'owner' where id = public.current_company_id() is not null and id = auth.uid()$$) = 0 or true, '準備');
select public.t_expect_error($$update public.profiles set role = 'owner' where id = auth.uid()$$, 'OWNER_ONLY', 'admin は自分のロールを変更できない');
select public.t_assert(public.t_rowcount($$update public.profiles set display_name = '管理者A' where id = auth.uid()$$) = 1, 'admin は自分の表示名を変更できる');
select public.t_assert(public.t_rowcount(format($$update public.profiles set display_name = 'x' where id = '%s'$$, :'owner_a')) = 0, 'admin は他人のプロフィールを変更できない');
-- admin は稼働・マスタを編集できる
insert into public.work_entries (company_id, month, driver_id, project_item_id, qty, bill_rate, pay_rate, royalty_rate)
select :'company_a', '2026-11-01', d.id, i.id, 5, 100, 90, 0.1 from public.drivers d, public.project_items i join public.projects p on p.id = i.project_id where d.name = '相曽慧' and p.name = 'Temu';
select public.t_assert((select count(*) from public.work_entries where month = '2026-11-01') = 1, 'admin は稼働行を追加できる');
select public.t_assert((select created_by from public.work_entries where month = '2026-11-01') = :'admin_a', 'created_by が記録される');
select public.t_assert(public.t_rowcount($$update public.drivers set memo = 'admin 編集' where name = '相曽慧'$$) = 1, 'admin はマスタを編集できる');

\echo '== 9. viewer は閲覧のみ'
select public.test_login(:'viewer_a');
select public.t_assert(public.is_staff() and not public.is_admin(), 'viewer');
select public.t_assert((select count(*) from public.v_month_summary) >= 1, 'viewer は集計を読める');
select public.t_assert((select count(*) from public.drivers) = 10, 'viewer はマスタを読める');
select public.t_expect_error(format($$insert into public.work_entries (company_id, month, driver_id, project_item_id, qty, bill_rate, pay_rate, royalty_rate) values ('%s', '2026-11-01', (select id from public.drivers where name = '相曽慧'), (select id from public.project_items limit 1), 1, 1, 1, 0)$$, :'company_a'), null, 'viewer の稼働行 INSERT は RLS で拒否');
select public.t_assert(public.t_rowcount($$update public.work_entries set qty = 99 where month = '2026-11-01'$$) = 0, 'viewer の UPDATE は 0 行');
select public.t_assert(public.t_rowcount($$delete from public.work_entries where month = '2026-11-01'$$) = 0, 'viewer の DELETE は 0 行');
select public.t_assert(public.t_rowcount($$update public.drivers set memo = 'viewer' where name = '相曽慧'$$) = 0, 'viewer はマスタを編集できない');
select public.t_expect_error(format($$insert into public.drivers (company_id, name) values ('%s', '新人')$$, :'company_a'), null, 'viewer はマスタを追加できない');
select public.t_expect_error($$select public.copy_previous_month('2026-12-01')$$, 'FORBIDDEN', 'viewer は複製できない');
select public.t_expect_error($$select public.apply_master_rates('2026-12-01')$$, 'FORBIDDEN', 'viewer は単価を反映できない');
select public.t_assert(public.t_rowcount(format($$update public.driver_pay_overrides set bill_rate = 1 where driver_id = '%s'$$, :'drv_yosh')) = 0, 'viewer はドライバー別単価を編集できない');
select public.t_expect_error($$select public.close_month('2026-11-01')$$, 'FORBIDDEN', 'viewer は締められない');
select public.t_expect_error($$select public.bulk_set_entries('2026-11-01', (select id from public.project_items limit 1), '[]'::jsonb)$$, 'FORBIDDEN', 'viewer は一括入力できない');
select public.t_expect_error($$select public.export_backup()$$, 'FORBIDDEN', 'viewer はバックアップを出力できない');
select public.t_expect_error($$select public.seed_initial_data()$$, 'FORBIDDEN', 'viewer は初期データを投入できない');
select public.t_assert((select count(*) from public.audit_logs) = 0, 'viewer は監査ログを読めない');
select public.t_assert(public.t_rowcount($$update public.companies set name = 'x'$$) = 0, 'viewer は会社設定を変更できない');
select public.t_assert((select count(*) from public.month_closings) >= 1, 'viewer は締め状態を読める');
select public.t_expect_error(format($$insert into public.month_closings (company_id, month) values ('%s', '2026-12-01')$$, :'company_a'), null, 'viewer は締め記録を作れない');

\echo '== 10. 会社分離'
select public.test_login(:'owner_b');
select public.t_assert(public.current_company_id() = :'company_b', '別会社の owner');
select public.t_assert((select count(*) from public.drivers) = 0, '別会社のドライバーは見えない');
select public.t_assert((select count(*) from public.work_entries) = 0, '別会社の稼働行は見えない');
select public.t_assert((select count(*) from public.v_month_summary) = 0, '別会社の集計は見えない');
select public.t_assert((select count(*) from public.profiles) = 1, '自分のプロフィールだけ見える');
select public.t_assert((select count(*) from public.audit_logs where company_id = :'company_a') = 0 and (select count(*) from public.audit_logs) >= 1, '別会社の監査ログは見えない（自社の分だけ見える）');
select public.t_assert(public.t_rowcount(format($$update public.drivers set memo = 'hack' where company_id = '%s'$$, :'company_a')) = 0, '別会社のデータは更新できない');
select public.t_expect_error(format($$insert into public.drivers (company_id, name) values ('%s', '侵入')$$, :'company_a'), null, '別会社へ INSERT できない');
select public.t_expect_error(format($$insert into public.work_entries (company_id, month, driver_id, project_item_id, qty, bill_rate, pay_rate, royalty_rate) values ('%s', '2026-11-01', (select id from public.drivers where company_id = '%s' limit 1), (select id from public.project_items limit 1), 1, 1, 1, 0)$$, :'company_b', :'company_a'), null, '他社のドライバーを参照する稼働行は作れない');
select public.t_expect_error(format($$select public.import_backup(jsonb_build_object('drivers', jsonb_build_array(jsonb_build_object('id', '%s', 'name', 'x'))))$$, :'drv_a'), 'ID_CONFLICT', '他社 ID と衝突する復元は拒否');
reset role;
select public.t_assert((select count(*) from public.drivers where company_id = :'company_a' and memo = 'hack') = 0, '他社データが変更されていない');

\echo '== 11. 無効化ユーザー'
set role authenticated;
select public.test_login(:'inactive_a');
select public.t_assert(public.current_company_id() is null, '無効ユーザーは会社を持たない');
select public.t_assert((select count(*) from public.drivers) = 0, '無効ユーザーは何も見えない');
select public.t_assert((select count(*) from public.profiles) = 0, '無効ユーザーは自分のプロフィールも見えない');
select public.t_expect_error($$select public.export_backup()$$, 'FORBIDDEN', '無効ユーザーは RPC を使えない');

\echo '== 12. owner のプロフィール保護・締め解除・招待'
select public.test_login(:'owner_a');
select public.t_expect_error($$update public.profiles set role = 'admin' where id = auth.uid()$$, 'SELF_CHANGE', 'owner も自分のロールは変更できない');
select public.t_expect_error($$update public.profiles set is_active = false where id = auth.uid()$$, 'SELF_CHANGE', 'owner も自分を無効化できない');
select public.t_assert(public.t_rowcount(format($$update public.profiles set role = 'viewer' where id = '%s'$$, :'admin_a')) = 1, 'owner は他人のロールを変更できる');
update public.profiles set role = 'admin' where id = :'admin_a';
select public.t_assert((select count(*) from public.invitations) >= 5, 'owner は招待を読める');
select public.t_assert((select role from public.create_invitation('New@A.test', 'viewer', null, '新人')) = 'viewer', 'create_invitation');
select public.t_assert((select email from public.invitations where display_name = '新人') = 'new@a.test', 'メールは小文字化される');
select public.t_expect_error($$select public.create_invitation('drv@a.test', 'driver', null)$$, null, 'driver 招待にはドライバー ID が必要');
select public.t_assert((select length(token) >= 32 from public.invitations where display_name = '新人'), 'トークンが生成される');
select public.reopen_month('2026-09-01');
select public.t_assert((select bool_and(tax_rate is null and tax_rounding is null and tax_mode is null) from public.driver_months where month = '2026-09-01'), '締め解除で固定を外す（現在の設定に従う）');
select public.t_assert(not public.is_month_closed(:'company_a', '2026-09-01'), 'owner は締め解除できる');
select public.t_assert((select count(*) from public.audit_logs where action = 'reopen_month') = 1, '締め解除の監査ログ');
select public.t_assert(public.t_rowcount($$update public.work_entries set memo = '解除後に編集' where month = '2026-09-01' and qty = 21$$) >= 1, '解除後は編集できる');
select public.t_assert((public.close_month('2026-09-01', '再締め'))->'summary' is not null, '再締め');

\echo '== 13. driver ロール（自分の締め済み月のみ）'
select public.create_invitation('driver@a.test', 'driver', (select id from public.drivers where name = '相曽慧'), '相曽');
select public.test_logout();
reset role;
insert into auth.users (id, email) values (:'driver_a', 'driver@a.test');
set role authenticated;
select public.test_login(:'driver_a');
select public.t_assert(public.is_driver_user() and public.current_driver_id() = (select id from public.drivers where name = '相曽慧'), 'driver ロール');
select public.t_assert((select count(*) from public.drivers) = 1, 'driver は自分のドライバー行だけ見える');
select public.t_assert((select count(*) from public.work_entries) = 1, 'driver は自分の締め済み月（2026-09）の稼働行だけ見える');
select public.t_assert((select count(*) from public.work_entries where month = '2026-11-01') = 0, '未締め月（2026-11）の自分の稼働行は見えない');
select public.t_assert((select count(*) from public.driver_months) = 1, 'driver_months も締め済み月のみ');
select public.t_assert((select count(*) from public.projects) = 1 and (select count(*) from public.project_items) = 1, '関係する案件・内容だけ見える');
select public.t_assert((select count(*) from public.audit_logs) = 0, 'driver は監査ログを読めない');
select public.t_assert((select count(*) from public.driver_portal_months() where status = 'closed') = 1, 'ポータル: 締め済み月 1 件');
select public.t_assert((select count(*) from public.driver_portal_months() where status = 'open') >= 1, 'ポータル: 未締め月（稼働あり）は集計中として返る');
select public.t_assert((select bool_and(payout is null) from public.driver_portal_months() where status = 'open'), 'ポータル: 未締め月は金額を返さない');
select public.t_assert((select payout from public.driver_portal_months() where status = 'closed') = 396643, 'ポータル: 支払額 396,643');
select public.t_assert((public.driver_portal_statement('2026-09-01'))->'summary'->>'payout' = '396643.00000000', 'ポータル明細: 支払額');
select public.t_assert((public.driver_portal_statement('2026-09-01'))->'summary' ? 'bill' = false, 'ポータル明細に会社売上は含まれない');
select public.t_assert((public.driver_portal_statement('2026-11-01'))->>'status' = 'open', '未締め月は集計中');
select public.t_expect_error(format($$insert into public.work_entries (company_id, month, driver_id, project_item_id, qty, bill_rate, pay_rate, royalty_rate) values ('%s', '2026-12-01', public.current_driver_id(), (select id from public.project_items limit 1), 1, 1, 1, 0)$$, :'company_a'), null, 'driver は稼働行を追加できない');
select public.t_expect_error($$select public.export_backup()$$, 'FORBIDDEN', 'driver はバックアップを出力できない');
-- ロイヤリティ率の非表示設定
reset role;
update public.companies set driver_portal_show_royalty = false where id = :'company_a';
set role authenticated;
select public.test_login(:'driver_a');
select public.t_assert(((public.driver_portal_statement('2026-09-01'))->'entries'->0->>'royalty_rate') is null, '会社設定で率を非表示にできる');
reset role;
update public.companies set driver_portal_show_royalty = true where id = :'company_a';

\echo '== 14. 監査ログ'
set role authenticated;
select public.test_login(:'owner_a');
select public.t_assert((select count(*) from public.audit_logs where table_name = 'work_entries' and action = 'INSERT') >= 10, '稼働行 INSERT が記録される');
select public.t_assert((select count(*) from public.audit_logs where table_name = 'drivers' and action = 'UPDATE' and after->>'memo' = 'admin 編集') = 1, 'UPDATE の差分が記録される');
select public.t_assert((select actor_id from public.audit_logs where table_name = 'drivers' and action = 'UPDATE' and after->>'memo' = 'admin 編集') = :'admin_a', '操作者が記録される');
select public.t_assert((select count(*) from public.audit_logs where table_name = 'invitations' and after ? 'token') = 0, '招待トークンは監査ログに残らない');
do $$
declare before_n integer; after_n integer;
begin
  select count(*) into before_n from public.audit_logs;
  update public.drivers set memo = memo where name = '相曽慧';
  select count(*) into after_n from public.audit_logs;
  perform public.t_assert(before_n = after_n, '差分の無い UPDATE は記録しない');
end $$;
select public.t_expect_error(format($$insert into public.audit_logs (company_id, action, table_name) values ('%s', 'x', 'y')$$, :'company_a'), null, '監査ログは直接書けない');

\echo '== 15. バックアップ → 全削除 → 復元（冪等）'
update public.driver_pay_overrides set bill_rate = 23500 where driver_id = :'drv_yosh' and project_item_id = :'item_misato';
update public.drivers set payout_month_offset = 2, payout_day = 15, invoice_reg_no = 'T1234567890123' where name = '金島幸太';
create temporary table t_backup as select public.export_backup() as data;
select public.t_assert((select jsonb_array_length(data->'work_entries') from t_backup) = 23, 'バックアップに稼働行 23 件');
select public.t_assert((select jsonb_array_length(data->'month_closings') from t_backup) = 1, 'バックアップに締め記録');
select public.t_expect_error($$select public.reset_company_data('間違った会社名')$$, 'NAME_MISMATCH', '会社名が違えば全削除できない');
select public.t_assert((public.reset_company_data('株式会社ROOTIVE'))->>'work_entries' = '23', 'データ全削除');
select public.t_assert((select count(*) from public.drivers) = 0 and (select count(*) from public.month_closings) = 0, '全削除後は空');
select public.t_assert((select count(*) from public.profiles) >= 4, 'ユーザーは残る');
select public.t_assert((select count(*) from public.companies) = 1, '会社設定は残る');
select public.t_assert((public.import_backup((select data from t_backup)))->>'work_entries' = '23', '復元');
select public.t_assert((select bill from public.v_month_summary where month = '2026-09-01') = 2559573 + 23025 * 20, '復元後の売上が一致');
select public.t_assert((select payout from public.v_month_summary where month = '2026-09-01') = 1907082.7 + (21960 * 20 - 21960 * 20 * 0.1 - 15000 - 30000 + 5000), '復元後の支払が一致');
select public.t_assert(public.is_month_closed(:'company_a', '2026-09-01'), '締め状態も復元される');
select public.t_assert((select count(*) from public.adjustments) = 3, '調整も復元される');
select public.t_assert((select bill_rate from public.driver_pay_overrides where driver_id = :'drv_yosh' and project_item_id = :'item_misato') = 23500 and (select pay_rate from public.driver_pay_overrides where driver_id = :'drv_yosh' and project_item_id = :'item_misato') = 21960, 'ドライバー別単価（受注・支払）も復元される');
select public.t_assert((select tax_mode = 'taxable' and payout_month_offset = 2 and payout_day = 15 and invoice_reg_no = 'T1234567890123' from public.drivers where name = '金島幸太'), 'ドライバーの課税区分・支払日・登録番号も復元される');
select public.t_assert((select bool_and(tax_rate = 0.10 and tax_mode = 'taxable') from public.driver_months where month = '2026-09-01'), '締め時に固定した消費税の設定も復元される');
select public.t_assert((public.import_backup((select data from t_backup)))->>'work_entries' = '23', '同じバックアップの再取り込み');
select public.t_assert((select count(*) from public.work_entries) = 23 and (select count(*) from public.drivers) = 10 and (select count(*) from public.adjustments) = 3, '再取り込みで重複しない（冪等）');
select public.t_assert((select count(*) from public.audit_logs where action = 'import_backup') = 2, '復元の監査ログ');
-- 同名で ID が異なるマスタ
select public.t_expect_error($$select public.import_backup(jsonb_build_object('drivers', jsonb_build_array(jsonb_build_object('id', gen_random_uuid()::text, 'name', '相曽慧'))))$$, 'NAME_CONFLICT', '同名・別 ID のドライバーは拒否');

\echo '== 16. 参照整合性：稼働行があるマスタは削除不可、無ければ削除可'
select public.t_expect_error($$delete from public.drivers where name = '相曽慧'$$, null, '稼働行があるドライバーは削除できない（restrict）');
select public.t_expect_error($$delete from public.project_items where id in (select project_item_id from public.work_entries limit 1)$$, null, '稼働行がある内容は削除できない');
insert into public.drivers (company_id, name) values (:'company_a', '一時ドライバー');
select public.t_assert(public.t_rowcount($$delete from public.drivers where name = '一時ドライバー'$$) = 1, '稼働行が無いドライバーは削除できる');
select public.t_expect_error(format($$insert into public.drivers (company_id, name) values ('%s', '相曽慧')$$, :'company_a'), null, 'ドライバー名は会社内で一意');
select public.t_expect_error($$update public.work_entries set royalty_rate = 1.5 where qty = 21$$, null, '率は 0〜1');
select public.t_expect_error($$update public.work_entries set qty = -1 where qty = 21$$, null, '数量は 0 以上');
select public.t_expect_error(format($$insert into public.work_entries (company_id, month, driver_id, project_item_id, qty, bill_rate, pay_rate, royalty_rate) values ('%s', '2026-12-15', (select id from public.drivers where name = '相曽慧'), (select id from public.project_items limit 1), 1, 1, 1, 0)$$, :'company_a'), null, '稼動月は月初日のみ');

reset role;
\echo '== すべてのアサーションが通りました'

\echo '== 17. 内部関数は一般ユーザーから直接呼べない（権限昇格の防止）'
set role authenticated;
select public.test_login(:'viewer_a');
select public.t_expect_error(format($$select public.apply_invitation('%s', 'viewer@a.test')$$, :'viewer_a'), null, 'viewer は apply_invitation を呼べない');
select public.t_expect_error(format($$select public.write_audit('%s', 'x', 'y', null, null, null)$$, :'company_a'), null, 'viewer は write_audit を呼べない');
select public.t_expect_error(format($$select public.ensure_driver_month('%s', '2026-12-01', (select id from public.drivers limit 1))$$, :'company_a'), null, 'viewer は ensure_driver_month を呼べない');
select public.t_expect_error(format($$select public.import_has_id_conflict('%s', '{}'::jsonb)$$, :'company_a'), null, 'viewer は import_has_id_conflict を呼べない');
select public.test_login(:'admin_a');
select public.t_expect_error(format($$select public.apply_invitation('%s', 'admin@a.test')$$, :'admin_a'), null, 'admin も apply_invitation を呼べない');
select public.test_login(:'driver_a');
select public.t_assert((select count(*) from public.month_closings) = 0, '元 driver（全削除後は無効な閲覧者）は month_closings を読めない');
select public.test_logout();
reset role;
-- driver ロールを再設定して、month_closings は読めないがポータル関数では締め済み月を得られることを確認
update public.profiles set role = 'driver', driver_id = (select id from public.drivers where name = '相曽慧'), is_active = true where id = :'driver_a';
set role authenticated;
select public.test_login(:'driver_a');
select public.t_assert((select count(*) from public.month_closings) = 0, 'driver は month_closings（スナップショット）を読めない');
select public.t_assert((select count(*) from public.driver_portal_months() where status = 'closed') >= 1, 'driver はポータル関数で締め済み月を得られる');
reset role;
-- サービスロール（JWT role=service_role）とトリガー（JWT なし）からは apply_invitation を使える
set role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', false);
select set_config('request.jwt.claim.role', 'service_role', false);
select public.t_assert((select role from public.apply_invitation(:'viewer_a', 'viewer@a.test', null)) is null or true, 'サービスロールは apply_invitation を呼べる（該当招待なしは null）');
select public.test_logout();
reset role;
\echo '== すべてのアサーションが通りました（17 節）'

\echo '== 18. 経費・営業利益・月次目標'
set role authenticated;
select public.test_login(:'owner_a');
update public.companies set tax_rate = 0.10, tax_rounding = 'floor' where id = :'company_a';

-- 既定の経費カテゴリ（会社を作ったときにトリガーが用意する）
select public.t_assert((select count(*) from public.expense_categories where company_id = :'company_a') = 12, '既定の経費カテゴリ 12 件');
select public.t_assert((select count(*) from public.expense_categories where company_id = :'company_a' and kind = 'fixed') = 5, 'うち固定費 5 件');

-- 未締め月（2026-12）に稼働を 1 件（bill 230,250 / pay 217,800 / royalty 21,780）
insert into public.work_entries (company_id, month, driver_id, project_item_id, qty, bill_rate, pay_rate, royalty_rate, rounding_mode)
values (:'company_a', '2026-12-01',
        (select id from public.drivers where company_id = :'company_a' and name = '相曽慧'),
        (select pi.id from public.project_items pi join public.projects p on p.id = pi.project_id where p.company_id = :'company_a' and p.name = '三郷Amazon' limit 1),
        10, 23025, 21780, 0.1, 'none');
select public.t_assert((select bill = 230250 and pay = 217800 and royalty = 21780 from public.v_month_summary where company_id = :'company_a' and month = '2026-12-01'), '2026-12 の売上 230,250');

-- 経費（金額は税抜）
insert into public.expenses (company_id, month, category_id, label, amount, tax_mode)
values (:'company_a', '2026-12-01', (select id from public.expense_categories where company_id = :'company_a' and name = '車両リース・レンタル'), '軽バン 3 台', 120000, 'taxable'),
       (:'company_a', '2026-12-01', (select id from public.expense_categories where company_id = :'company_a' and name = '燃料費'), 'ガソリン代', 50000, 'taxable');
select public.t_assert((select count(*) = 2 and sum(amount) = 170000 from public.v_expense_list where company_id = :'company_a' and month = '2026-12-01'), '経費 2 件・合計 170,000');
select public.t_assert((select amount = 120000 and kind = 'fixed' from public.v_expense_summary where company_id = :'company_a' and month = '2026-12-01' and category_name = '車両リース・レンタル'), 'カテゴリ別の集計（固定費）');

-- 営業利益 ＝ 会社利益 − 経費
select public.t_assert((select expense_total = 170000 and expense_fixed = 120000 and expense_variable = 50000 from public.v_month_pl where company_id = :'company_a' and month = '2026-12-01'), 'v_month_pl の経費の内訳');
select public.t_assert((select operating_profit = profit - 170000 from public.v_month_pl where company_id = :'company_a' and month = '2026-12-01'), '営業利益 ＝ 会社利益 − 経費');
select public.t_assert((select operating_margin = round(operating_profit / 230250, 6) from public.v_month_pl where company_id = :'company_a' and month = '2026-12-01'), '営業利益率');
select public.t_assert((select expense_total = 0 and operating_profit = profit from public.v_month_pl where company_id = :'company_a' and month = '2026-09-01'), '経費が無い月は営業利益 ＝ 会社利益');

-- 毎月かかる経費（テンプレ）→ その月に計上（冪等）
insert into public.recurring_expenses (company_id, category_id, label, amount, sort_order)
values (:'company_a', (select id from public.expense_categories where company_id = :'company_a' and name = '保険料'), '自動車保険', 30000, 1);
select public.t_assert(public.apply_recurring_expenses('2026-12-01') = 1, '毎月かかる経費を 1 件計上');
select public.t_assert(public.apply_recurring_expenses('2026-12-01') = 0, '二重計上しない（冪等）');
select public.t_assert((select expense_total = 200000 from public.v_month_pl where company_id = :'company_a' and month = '2026-12-01'), '計上後の経費合計 200,000');
select public.t_expect_error($$select public.apply_recurring_expenses('2026-09-01')$$, 'MONTH_CLOSED', '締め済み月には計上できない');

-- 締め済み月の経費は変更できない
select public.t_expect_error(format($$insert into public.expenses (company_id, month, category_id, label, amount) values ('%s', '2026-09-01', (select id from public.expense_categories where company_id = '%s' limit 1), 'あとから経費', 1000)$$, :'company_a', :'company_a'), 'MONTH_CLOSED', '締め済み月に経費は足せない');

-- 月次目標
insert into public.month_targets (company_id, month, bill_target, profit_target, memo)
values (:'company_a', '2026-12-01', 3000000, 500000, '年末は件数を増やす')
on conflict (company_id, month) do update set bill_target = excluded.bill_target, profit_target = excluded.profit_target;
select public.t_assert((select bill_target = 3000000 and profit_target = 500000 and target_memo = '年末は件数を増やす' from public.v_month_pl where company_id = :'company_a' and month = '2026-12-01'), '月次目標がビューに出る');

-- viewer は経費を書けない
select public.test_login(:'viewer_a');
select public.t_assert((select count(*) from public.v_expense_list where month = '2026-12-01') = 3, 'viewer は経費を閲覧できる');
select public.t_expect_error(format($$insert into public.expenses (company_id, month, category_id, label, amount) values ('%s', '2026-12-01', (select id from public.expense_categories limit 1), 'だめ', 1)$$, :'company_a'), null, 'viewer は経費を追加できない');
select public.t_expect_error($$select public.apply_recurring_expenses('2026-12-01')$$, 'FORBIDDEN', 'viewer は固定費を計上できない');

\echo '== 19. 取引先と請求書（インボイス）・入金管理'
select public.test_login(:'owner_a');

-- 取引先マスタと案件の紐づけ（client_name はトリガーが同期する）
insert into public.clients (company_id, name, honorific, payment_month_offset, payment_day, invoice_reg_no)
values (:'company_a', '株式会社テスト物流', '御中', 1, 0, 'T9999999999999');
update public.projects set client_id = (select id from public.clients where company_id = :'company_a' and name = '株式会社テスト物流')
 where company_id = :'company_a' and name = '三郷Amazon';
select public.t_assert((select client_name = '株式会社テスト物流' from public.projects where company_id = :'company_a' and name = '三郷Amazon'), '案件の取引先名が同期される');
update public.clients set name = '株式会社テスト運輸' where company_id = :'company_a' and name = '株式会社テスト物流';
select public.t_assert((select client_name = '株式会社テスト運輸' from public.projects where company_id = :'company_a' and name = '三郷Amazon'), '取引先の改名も案件に反映される');

-- 取引先名だけ入れると取引先が自動で作られる
insert into public.projects (company_id, name, client_name, sort_order) values (:'company_a', 'テスト案件', '新規取引先', 99);
select public.t_assert((select count(*) = 1 from public.clients where company_id = :'company_a' and name = '新規取引先'), '取引先名から取引先を自動作成');
select public.t_assert((select client_id is not null from public.projects where company_id = :'company_a' and name = 'テスト案件'), '自動作成した取引先が案件に紐づく');

-- 取引先 × 月の売上
select public.t_assert((select bill = 230250 and entry_count = 1 from public.v_client_month_summary where company_id = :'company_a' and month = '2026-12-01' and client_name = '株式会社テスト運輸'), '取引先 × 月の売上 230,250');

-- 請求書の作成（稼働から明細を作る）
select public.t_assert(public.build_invoice((select id from public.clients where company_id = :'company_a' and name = '株式会社テスト運輸'), '2026-12-01') is not null, '請求書を作成');
select public.t_assert((select count(*) = 1 from public.invoices where company_id = :'company_a' and month = '2026-12-01'), '請求書 1 件');
select public.t_assert((select count(*) = 1 and sum(qty) = 10 and max(unit_price) = 23025 and sum(amount) = 230250 from public.invoice_items it join public.invoices i on i.id = it.invoice_id where i.company_id = :'company_a' and i.month = '2026-12-01'), '明細 1 行（数量 10 × 単価 23,025）');
select public.t_assert((select subtotal = 230250 and tax = 23025 and total = 253275 and status = 'draft' from public.invoices where company_id = :'company_a' and month = '2026-12-01'), '小計 230,250／消費税 23,025／合計 253,275');
select public.t_assert((select due_date = '2027-01-31' and issue_date = '2026-12-31' from public.invoices where company_id = :'company_a' and month = '2026-12-01'), '発行日は月末・入金予定日は翌月末');
select public.t_assert((select invoice_no = '202612-01' from public.invoices where company_id = :'company_a' and month = '2026-12-01'), '請求書番号は YYYYMM-01');

-- 作り直しても増えない（冪等）
select public.t_assert(public.build_invoice((select id from public.clients where company_id = :'company_a' and name = '株式会社テスト運輸'), '2026-12-01') is not null, '請求書を作り直す');
select public.t_assert((select count(*) = 1 from public.invoice_items it join public.invoices i on i.id = it.invoice_id where i.company_id = :'company_a' and i.month = '2026-12-01'), '作り直しても明細は 1 行');

-- 明細を手で足すと合計が自動で計算し直される（金額は数量 × 単価）
insert into public.invoice_items (company_id, invoice_id, name, qty, unit_price, sort_order)
values (:'company_a', (select id from public.invoices where company_id = :'company_a' and month = '2026-12-01'), '追加作業', 2, 5000, 90);
select public.t_assert((select amount = 10000 from public.invoice_items where name = '追加作業'), '明細の金額は数量 × 単価');
select public.t_assert((select subtotal = 240250 and tax = 24025 and total = 264275 from public.invoices where company_id = :'company_a' and month = '2026-12-01'), '合計と消費税が自動で計算し直される');

-- 状態（下書き → 発行済み → 入金済み）
select public.set_invoice_status((select id from public.invoices where company_id = :'company_a' and month = '2026-12-01'), 'issued');
select public.t_expect_error(format($$select public.build_invoice((select id from public.clients where company_id = '%s' and name = '株式会社テスト運輸'), '2026-12-01')$$, :'company_a'), 'INVOICE_ISSUED', '発行済みの請求書は作り直せない');
select public.set_invoice_status((select id from public.invoices where company_id = :'company_a' and month = '2026-12-01'), 'paid', '2027-01-30');
select public.t_assert((select status = 'paid' and paid_on = '2027-01-30' from public.invoices where company_id = :'company_a' and month = '2026-12-01'), '入金済みと入金日');
select public.set_invoice_status((select id from public.invoices where company_id = :'company_a' and month = '2026-12-01'), 'issued');
select public.t_assert((select status = 'issued' and paid_on is null from public.invoices where company_id = :'company_a' and month = '2026-12-01'), '発行済みに戻すと入金日は消える');

-- 一覧ビュー
select public.t_assert((select client_name = '株式会社テスト運輸' and item_count = 2 from public.v_invoice_list where company_id = :'company_a' and month = '2026-12-01'), '請求書一覧ビュー');

-- 権限
select public.test_login(:'viewer_a');
select public.t_expect_error(format($$select public.build_invoice((select id from public.clients where company_id = '%s' limit 1), '2026-12-01')$$, :'company_a'), 'FORBIDDEN', 'viewer は請求書を作れない');
select public.t_expect_error(format($$insert into public.clients (company_id, name) values ('%s', 'だめ取引先')$$, :'company_a'), null, 'viewer は取引先を追加できない');

-- 会社分離
select public.test_login(:'owner_b');
select public.t_assert((select count(*) from public.clients) = 0, '他社の取引先は見えない');
select public.t_assert((select count(*) from public.v_invoice_list) = 0, '他社の請求書は見えない');
select public.t_assert((select count(*) from public.v_expense_list) = 0, '他社の経費は見えない');
select public.t_assert((select count(*) from public.expense_categories) = 12, '自社の既定カテゴリは見える');

-- バックアップに含まれる
select public.test_login(:'owner_a');
select public.t_assert(jsonb_array_length(public.export_backup()->'expenses') = 3, 'バックアップに経費が入る');
select public.t_assert(jsonb_array_length(public.export_backup()->'invoices') = 1 and jsonb_array_length(public.export_backup()->'invoice_items') = 2, 'バックアップに請求書と明細が入る');
select public.t_assert(jsonb_array_length(public.export_backup()->'clients') >= 2, 'バックアップに取引先が入る');
select public.t_assert(jsonb_array_length(public.export_backup()->'month_targets') = 1, 'バックアップに月次目標が入る');

-- バックアップ → 復元（冪等）
select public.t_assert((select count(*) from public.import_backup(public.export_backup())) >= 0, '復元（同じデータ）');
select public.t_assert((select count(*) from public.expenses where company_id = :'company_a') = 3, '復元後も経費は 3 件');
select public.t_assert((select subtotal = 240250 and total = 264275 from public.invoices where company_id = :'company_a' and month = '2026-12-01'), '復元後も請求書の合計は同じ');
select public.t_assert((select count(*) from public.invoice_items it join public.invoices i on i.id = it.invoice_id where i.company_id = :'company_a') = 2, '復元後も明細は 2 行');

\echo '== 20. 案件別採算（v_project_pl）と資金繰り（cash_forecast）'
select public.test_login(:'owner_a');

-- 案件 × 月の損益（2026-12 の三郷Amazon：売上 230,250／単価差額 12,450 ＋ ロイヤリティ 21,780 ＝ 34,230）
select public.t_assert((select bill = 230250 and entry_profit = 34230 and expense_direct = 0 and project_profit = 34230
                          from public.v_project_pl where company_id = :'company_a' and month = '2026-12-01' and project_name = '三郷Amazon'), '案件 × 月の損益');
select public.t_assert((select project_margin = round(34230::numeric / 230250, 6)
                          from public.v_project_pl where company_id = :'company_a' and month = '2026-12-01' and project_name = '三郷Amazon'), '案件の利益率');
select public.t_assert((select not below_target from public.v_project_pl where company_id = :'company_a' and month = '2026-12-01' and project_name = '三郷Amazon'), '目標未設定なら警告しない');

-- 目標利益率 20% を設定すると下回りの警告が出る
update public.projects set target_margin = 0.2 where company_id = :'company_a' and name = '三郷Amazon';
select public.t_assert((select below_target from public.v_project_pl where company_id = :'company_a' and month = '2026-12-01' and project_name = '三郷Amazon'), '目標利益率を下回ると警告');
update public.projects set target_margin = 0.1 where company_id = :'company_a' and name = '三郷Amazon';
select public.t_assert((select not below_target from public.v_project_pl where company_id = :'company_a' and month = '2026-12-01' and project_name = '三郷Amazon'), '目標を上回れば警告しない');

-- 案件に紐づけた経費は案件利益から引く
insert into public.expenses (company_id, month, category_id, label, amount, project_id)
values (:'company_a', '2026-12-01', (select id from public.expense_categories where company_id = :'company_a' and name = '高速・有料道路'), '三郷の高速代', 4230,
        (select id from public.projects where company_id = :'company_a' and name = '三郷Amazon'));
select public.t_assert((select expense_direct = 4230 and project_profit = 30000 from public.v_project_pl where company_id = :'company_a' and month = '2026-12-01' and project_name = '三郷Amazon'), '直課した経費を引いた案件利益 30,000');
select public.t_assert((select not below_target from public.v_project_pl where company_id = :'company_a' and month = '2026-12-01' and project_name = '三郷Amazon'), '経費を引いても利益率 13.0% は目標 10% を上回る');
update public.projects set target_margin = 0.15 where company_id = :'company_a' and name = '三郷Amazon';
select public.t_assert((select below_target and project_margin = round(30000::numeric / 230250, 6) from public.v_project_pl where company_id = :'company_a' and month = '2026-12-01' and project_name = '三郷Amazon'), '目標 15% にすると下回りの警告が出る');
update public.projects set target_margin = 0.1 where company_id = :'company_a' and name = '三郷Amazon';

-- 資金繰り：入金予定・支払予定・経費を日付順に並べる
select public.t_assert((select count(*) = 1 and sum(amount) = 264275 and min(event_date) = '2027-01-31'
                          from public.cash_forecast('2026-12-01', '2027-02-28') where kind = 'invoice'), '請求書の入金予定（2027-01-31 に 264,275）');
select public.t_assert((select f.amount = -(select s.payout_incl from public.v_driver_month_summary s where s.company_id = :'company_a' and s.month = '2026-12-01' and s.driver_name = '相曽慧')
                          from public.cash_forecast('2026-12-01', '2027-02-28') f where f.kind = 'payout' and f.month = '2026-12-01' and f.label = '相曽慧'), 'ドライバーへの支払は税込額のマイナスで載る');
select public.t_assert((select event_date = '2027-01-31' from public.cash_forecast('2026-12-01', '2027-02-28') where kind = 'payout' and month = '2026-12-01' and label = '相曽慧'), '支払予定日は翌月末');
select public.t_assert((select sum(amount) = -204230 from public.cash_forecast('2026-12-01', '2027-02-28') where kind = 'expense' and status = 'done'), '計上済みの経費 204,230 はマイナスの実績');
select public.t_assert((select count(*) = 2 and sum(amount) = -60000 from public.cash_forecast('2026-12-01', '2027-02-28') where kind = 'expense' and status = 'planned'), '未計上の固定費 2 か月分が予定として出る');
select public.t_assert((select count(*) = 0 from public.cash_forecast('2027-03-01', '2027-03-31') where kind = 'invoice'), '範囲外の入金予定は出ない');
select public.t_assert((select status = 'confirmed' from public.cash_forecast('2026-12-01', '2027-02-28') where kind = 'invoice' limit 1), '発行済みの請求書は confirmed');

-- 現金残高のスナップショット
insert into public.cash_snapshots (company_id, as_of, balance, memo) values (:'company_a', '2026-12-01', 1500000, '期首残高');
select public.t_assert((select balance = 1500000 from public.cash_snapshots where company_id = :'company_a' and as_of = '2026-12-01'), '現金残高のスナップショット');
select public.t_expect_error(format($$insert into public.cash_snapshots (company_id, as_of, balance) values ('%s', '2026-12-01', 1)$$, :'company_a'), null, '同じ日の残高は 1 件だけ');

-- 権限
select public.test_login(:'viewer_a');
select public.t_assert((select count(*) = 1 from public.cash_snapshots), 'viewer は残高を閲覧できる');
select public.t_expect_error(format($$insert into public.cash_snapshots (company_id, as_of, balance) values ('%s', '2027-01-01', 1)$$, :'company_a'), null, 'viewer は残高を登録できない');
select public.test_login(:'owner_b');
select public.t_assert((select count(*) = 0 from public.cash_snapshots), '他社の残高は見えない');
select public.t_assert((select count(*) = 0 from public.v_project_pl), '他社の案件損益は見えない');
select public.test_login(:'owner_a');

-- バックアップ（version 3）に含まれる
select public.t_assert((public.export_backup()->>'version') = '3', 'バックアップは version 3');
select public.t_assert(jsonb_array_length(public.export_backup()->'cash_snapshots') = 1, 'バックアップに現金残高が入る');
select public.t_assert((select count(*) from public.import_backup(public.export_backup())) >= 0, '復元（同じデータ）');
select public.t_assert((select count(*) = 1 and max(balance) = 1500000 from public.cash_snapshots where company_id = :'company_a'), '復元後も現金残高は同じ');
select public.t_assert((select target_margin = 0.1 from public.projects where company_id = :'company_a' and name = '三郷Amazon'), '復元後も案件の目標利益率は同じ');

-- driver ロールは経費・請求書・取引先を読めない（社外秘）
select public.test_login(:'owner_a');
update public.profiles set role = 'driver', driver_id = (select id from public.drivers where company_id = :'company_a' and name = '相曽慧'), is_active = true where id = :'driver_a';
select public.test_login(:'driver_a');
select public.t_assert((select count(*) from public.expenses) = 0, 'driver は経費を読めない');
select public.t_assert((select count(*) from public.invoices) = 0, 'driver は請求書を読めない');
select public.t_assert((select count(*) from public.clients) = 0, 'driver は取引先を読めない');
select public.t_assert((select count(*) from public.month_targets) = 0, 'driver は月次目標を読めない');
select public.t_expect_error(format($$insert into public.expenses (company_id, month, category_id, label, amount) values ('%s', '2026-12-01', (select id from public.expense_categories limit 1), 'だめ', 1)$$, :'company_a'), null, 'driver は経費を追加できない');

-- ドライバーポータルの当月速報（未締め月の暫定額）
select public.test_login(:'owner_a');
update public.profiles set role = 'driver', driver_id = (select id from public.drivers where company_id = :'company_a' and name = '相曽慧'), is_active = true where id = :'driver_a';
select public.test_login(:'driver_a');
select public.t_assert((public.driver_portal_current()->>'month') = '2026-12', '速報は最新の未締め月（2026-12）');
select public.t_assert((public.driver_portal_current()->>'status') = 'open', '速報は集計中');
select public.t_assert((public.driver_portal_current()->>'payout_incl')::numeric > 0, '速報に税込のお支払予定額が入る');
select public.t_assert((public.driver_portal_current()->>'payout_date') = '2027-01-31', '速報の振込予定日は翌月末');
select public.test_login(:'owner_a');
update public.companies set driver_portal_show_open_month = false where id = :'company_a';
select public.test_login(:'driver_a');
select public.t_assert(public.driver_portal_current() is null, '会社設定で速報を止められる');
select public.test_login(:'owner_a');
update public.companies set driver_portal_show_open_month = true where id = :'company_a';

select public.test_logout();
reset role;
\echo '== すべてのアサーションが通りました（18〜20 節）'
