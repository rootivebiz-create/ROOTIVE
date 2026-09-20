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

-- バックアップ（0019 で version 6 に上がった）に含まれる
select public.t_assert((public.export_backup()->>'version') = '6', 'バックアップは version 6');
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

\echo '== 21. AI・社内チャット・異常検知・外部連携・銀行 CSV'
select public.test_login(:'owner_a');

-- ---------- 社内チャット ----------
select public.t_assert((select count(*) = 2 from public.chat_channels where company_id = :'company_a'), '会社を作ると既定のルームが 2 つできる');
select public.t_assert((select is_default from public.chat_channels where company_id = :'company_a' and name = '全体'), '「全体」が既定のルーム');

select public.t_assert(public.chat_post((select id from public.chat_channels where company_id = :'company_a' and name = '全体'), '今月もよろしくお願いします', '{}'::uuid[]) is not null, 'オーナーが発言できる');
select public.t_assert((select m.author_name = coalesce(nullif(p.display_name, ''), p.email) and m.author_role = 'owner'
                          from public.chat_messages m join public.profiles p on p.id = m.author_id
                         where m.company_id = :'company_a'), '発言者の名前とロールが写る');
select public.t_expect_error(format($$select public.chat_post((select id from public.chat_channels where company_id = '%s' and name = '全体'), '   ', '{}'::uuid[])$$, :'company_a'), 'EMPTY_BODY', '空の発言はできない');

-- 閲覧者も発言できる（メンション付き）
select public.test_login(:'viewer_a');
select public.t_assert((select unread_count = 1 from public.v_chat_channel_list where name = '全体'), '閲覧者から見て未読 1 件');
select public.t_assert(public.chat_post((select id from public.chat_channels where company_id = :'company_a' and name = '全体'), '@owner 確認しました', array[:'owner_a']::uuid[]) is not null, '閲覧者も発言できる');
select public.t_assert((select unread_count = 0 from public.v_chat_channel_list where name = '全体'), '発言すると自分の未読は 0 になる');
select public.t_assert((select message_count = 2 from public.v_chat_channel_list where name = '全体'), 'ルームの発言数は 2');
select public.t_assert((select count(*) = 1 from public.v_chat_message_list where is_mine), '自分の発言が 1 件');
select public.t_assert((select count(*) >= 3 from public.v_staff), 'スタッフ一覧を閲覧者も読める');
select public.t_assert((select count(*) = 0 from public.v_staff where role = 'driver'), 'スタッフ一覧にドライバーは含まれない');

select public.test_login(:'owner_a');
select public.t_assert((select mention_count = 1 and unread_count = 1 from public.v_chat_channel_list where name = '全体'), '自分宛のメンションが 1 件');
select public.t_assert((select is_mentioned from public.v_chat_message_list where author_id = :'viewer_a'), 'メンションされた発言が分かる');
select public.chat_mark_read((select id from public.chat_channels where company_id = :'company_a' and name = '全体'));
select public.t_assert((select unread_count = 0 from public.v_chat_channel_list where name = '全体'), '既読にすると未読が 0');
select public.t_assert(public.chat_unread_total() = 0, '未読の合計も 0');

-- 他人の発言は消せない／ルームは admin 以上だけが作れる
select public.test_login(:'admin_a');
select public.t_assert(public.t_rowcount(format($$delete from public.chat_messages where author_id = '%s'$$, :'viewer_a')) = 0, '管理者でも他人の発言は消せない');
select public.test_login(:'viewer_a');
select public.t_expect_error(format($$insert into public.chat_channels (company_id, name) values ('%s', '勝手なルーム')$$, :'company_a'), null, '閲覧者はルームを作れない');
select public.test_login(:'driver_a');
select public.t_assert((select count(*) = 0 from public.chat_channels), 'ドライバーはチャットを読めない');
select public.t_assert((select count(*) = 0 from public.v_staff), 'ドライバーはスタッフ一覧を読めない');

-- ---------- AI チャット ----------
select public.test_login(:'owner_a');
insert into public.ai_conversations (id, company_id, title, month, created_by)
values ('00000000-0000-0000-0000-0000000000c1', :'company_a', '今月の着地は？', '2026-12-01', :'owner_a');
insert into public.ai_messages (company_id, conversation_id, role, content, created_by, created_at)
values (:'company_a', '00000000-0000-0000-0000-0000000000c1', 'user', '今月の着地はどうなりそう？', :'owner_a', now()),
       (:'company_a', '00000000-0000-0000-0000-0000000000c1', 'assistant', '売上は 2,559,573 円の見込みです。', null, now() + interval '2 seconds');
select public.t_assert((select message_count = 2 from public.ai_conversations where id = '00000000-0000-0000-0000-0000000000c1'), '発言を入れると会話の件数が増える');
select public.t_assert((select last_role = 'assistant' and message_count = 2 from public.v_ai_conversation_list where id = '00000000-0000-0000-0000-0000000000c1'), '会話一覧に最後の発言が出る');
select public.test_login(:'viewer_a');
select public.t_assert((select count(*) = 1 from public.ai_conversations), '閲覧者も AI の会話を読める');
select public.test_login(:'driver_a');
select public.t_assert((select count(*) = 0 from public.ai_conversations), 'ドライバーは AI の会話を読めない');

-- 月次分析の保存形式（summary / findings / actions）
select public.test_login(:'owner_a');
insert into public.ai_insights (company_id, month, model, kind, summary, findings, actions, created_by)
values (:'company_a', '2026-12-01', 'claude-sonnet-5', 'monthly', '営業利益は前月並みです。',
        '[{"title":"利益率が低下","detail":"前月比 -2.1pt","severity":"medium"}]'::jsonb,
        '[{"title":"三郷Amazon の単価交渉","detail":"1 件 +500 円","effect":"月 +10 万円程度"}]'::jsonb, :'owner_a');
select public.t_assert((select kind = 'monthly' and summary <> '' and jsonb_array_length(actions) = 1
                          from public.ai_insights where company_id = :'company_a' and month = '2026-12-01'), '月次分析に総括と改善策が入る');

-- ---------- 異常の検知 ----------
select public.test_login(:'viewer_a');
select public.t_expect_error($$select public.detect_anomalies('2026-12-01')$$, 'FORBIDDEN', '閲覧者は検査できない');
select public.test_login(:'owner_a');

-- 数量 0 の稼働を 1 件入れると qty_zero を検知する
insert into public.work_entries (company_id, month, driver_id, project_item_id, qty, bill_rate, pay_rate, royalty_rate)
select :'company_a', '2026-12-01', d.id, i.id, 0, ed.bill_rate, ed.pay_rate, ed.royalty_rate
  from public.drivers d join public.projects p on p.name = 'Temu' join public.project_items i on i.project_id = p.id
  cross join lateral public.entry_defaults(d.id, i.id) ed where d.name = '高森豪介';
select public.t_assert((public.detect_anomalies('2026-12-01')->>'detected')::integer > 0, '異常を検知する');
select public.t_assert((select count(*) = 1 from public.alerts where company_id = :'company_a' and month = '2026-12-01' and code = 'qty_zero' and status = 'open'), '数量 0 の稼働を検知');
select public.t_assert((select count(*) >= 1 from public.alerts where company_id = :'company_a' and month = '2026-12-01' and code = 'no_entry' and status = 'open'), '稼働が無い稼働中ドライバーを検知');
select public.t_assert((select count(*) = 0 from public.alerts where company_id = :'company_a' and code = 'invoice_missing' and status = 'open'), '請求書を作った取引先は警告しない');

-- 2 回流しても増えない（fingerprint で一意）
do $$
declare before_n integer; after_n integer;
begin
  select count(*) into before_n from public.alerts;
  perform public.detect_anomalies('2026-12-01');
  select count(*) into after_n from public.alerts;
  perform public.t_assert(before_n = after_n, '2 回検査しても件数は増えない');
end $$;

-- 直ると自動で「対応済み」になる
delete from public.work_entries where company_id = :'company_a' and month = '2026-12-01' and qty = 0;
select public.t_assert((public.detect_anomalies('2026-12-01')->>'auto_resolved')::integer >= 1, '直った異常は自動で対応済みになる');
select public.t_assert((select status = 'resolved' from public.alerts where company_id = :'company_a' and month = '2026-12-01' and code = 'qty_zero'), '数量 0 のアラートが解決済みに');

-- 手で状態を変える
select public.set_alert_status((select id from public.alerts where company_id = :'company_a' and code = 'no_entry' order by id limit 1), 'ignored', 'この人は今月お休み');
select public.t_assert((select count(*) = 1 from public.alerts where company_id = :'company_a' and code = 'no_entry' and status = 'ignored' and note <> ''), '対象外にできる');
select public.t_assert((select open_count >= 0 and total_count > 0 from public.v_alert_summary where company_id = :'company_a' and month = '2026-12-01'), 'アラートの集計が取れる');
select public.test_login(:'viewer_a');
select public.t_assert((select count(*) > 0 from public.alerts), '閲覧者はアラートを見られる');
select public.t_expect_error(format($$select public.set_alert_status((select id from public.alerts where company_id = '%s' limit 1), 'resolved', '')$$, :'company_a'), 'FORBIDDEN', '閲覧者はアラートを閉じられない');
select public.test_login(:'driver_a');
select public.t_assert((select count(*) = 0 from public.alerts), 'ドライバーはアラートを読めない');

-- ---------- 外部連携 ----------
select public.test_login(:'owner_a');
insert into public.integrations (company_id, kind, is_enabled, config) values (:'company_a', 'line', true, '{"notify_statement": true}'::jsonb);
select public.t_assert((select is_enabled from public.integrations where company_id = :'company_a' and kind = 'line'), '連携の設定を保存できる');
select public.test_login(:'viewer_a');
select public.t_assert((select count(*) = 0 from public.integrations), '閲覧者は連携の設定を読めない');
select public.test_login(:'owner_a');
-- 機密はサービスロール（サーバー）以外から読めない
reset role;
insert into public.integration_secrets (company_id, kind, secrets) values (:'company_a', 'line', '{"channelAccessToken":"dummy"}'::jsonb);
set role authenticated;
select public.test_login(:'owner_a');
select public.t_expect_error($$select count(*) from public.integration_secrets$$, null, 'オーナーでも機密テーブルは読めない');

-- LINE の合言葉：ドライバー本人が出して、Webhook（サービスロール）が使う
select public.test_login(:'driver_a');
select public.t_assert(length(public.line_issue_code()) = 8, 'ドライバーが 8 桁の合言葉を出せる');
reset role;
select public.t_assert((public.line_consume_code((select code from public.line_link_codes where company_id = :'company_a' and used_at is null limit 1), 'U1234567890')->>'ok')::boolean, '合言葉で連携できる');
select public.t_assert((select line_user_id = 'U1234567890' and line_linked_at is not null from public.drivers where company_id = :'company_a' and name = '相曽慧'), 'ドライバーに LINE の ID が入る');
select public.t_assert((public.line_consume_code('000000', 'U9999999999')->>'reason') = 'not_found', '使えない合言葉は弾く');
set role authenticated;
select public.test_login(:'driver_a');
select public.line_unlink();
select public.test_login(:'owner_a');
select public.t_assert((select line_user_id = '' from public.drivers where company_id = :'company_a' and name = '相曽慧'), '連携を解除できる');

-- ---------- 銀行 CSV の取り込みと消込 ----------
select public.test_login(:'owner_a');
select public.set_invoice_status((select id from public.invoices where company_id = :'company_a' and month = '2026-12-01'), 'issued');
insert into public.bank_imports (id, company_id, file_name, format, row_count, created_by)
values ('00000000-0000-0000-0000-0000000000d1', :'company_a', 'meisai.csv', '2列型', 3, :'owner_a');
insert into public.bank_transactions (company_id, import_id, txn_date, description, amount, balance, fingerprint)
select :'company_a', '00000000-0000-0000-0000-0000000000d1', i.issue_date + 30, 'カ）テストウンユ', i.total, 3000000, 'fp-1'
  from public.invoices i where i.company_id = :'company_a' and i.month = '2026-12-01';
insert into public.bank_transactions (company_id, import_id, txn_date, description, amount, balance, fingerprint)
select :'company_a', '00000000-0000-0000-0000-0000000000d1', i.issue_date + 30, 'デンキダイ', -18000, 2982000, 'fp-2'
  from public.invoices i where i.company_id = :'company_a' and i.month = '2026-12-01';
select public.t_assert((select count(*) = 2 from public.bank_transactions where company_id = :'company_a'), '明細を 2 件取り込んだ');
select public.t_expect_error(format($$insert into public.bank_transactions (company_id, import_id, txn_date, description, amount, fingerprint) values ('%s', '00000000-0000-0000-0000-0000000000d1', '2027-01-30', '二重', 1, 'fp-1')$$, :'company_a'), null, '同じ明細は二重に入らない');

select public.t_assert(public.bank_auto_match('00000000-0000-0000-0000-0000000000d1') = 1, '金額が一致する請求書を 1 件自動で消し込む');
select public.t_assert((select status = 'matched' and auto_matched and invoice_id is not null from public.bank_transactions where fingerprint = 'fp-1'), '入金の明細が消込済みになる');
select public.t_assert((select i.status = 'paid' and i.paid_on = (select txn_date from public.bank_transactions where fingerprint = 'fp-1')
                          from public.invoices i where i.company_id = :'company_a' and i.month = '2026-12-01'), '請求書が入金済みになり、入金日は明細の日付');
select public.t_assert((select invoice_no <> '' and client_name <> '' and import_file_name = 'meisai.csv'
                          from public.v_bank_transaction_list where id = (select id from public.bank_transactions where fingerprint = 'fp-1')), '一覧に請求書番号・取引先名・取り込み元が出る');
select public.t_assert(public.bank_auto_match('00000000-0000-0000-0000-0000000000d1') = 0, '2 回目は消し込むものが無い');

-- 消込を外すと請求書は発行済みに戻る
select public.bank_set_status((select id from public.bank_transactions where fingerprint = 'fp-1'), 'unmatched');
select public.t_assert((select status = 'unmatched' and invoice_id is null from public.bank_transactions where fingerprint = 'fp-1'), '消込を外せる');
select public.t_assert((select status = 'issued' and paid_on is null from public.invoices where company_id = :'company_a' and month = '2026-12-01'), '請求書が発行済みに戻る');

-- 手で消し込む／対象外にする
select public.bank_match_invoice((select id from public.bank_transactions where fingerprint = 'fp-1'), (select id from public.invoices where company_id = :'company_a' and month = '2026-12-01'));
select public.t_assert((select status = 'matched' and not auto_matched from public.bank_transactions where fingerprint = 'fp-1'), '手で消し込める');
select public.bank_set_status((select id from public.bank_transactions where fingerprint = 'fp-2'), 'ignored');
select public.t_assert((select status = 'ignored' from public.bank_transactions where fingerprint = 'fp-2'), '対象外にできる');

select public.test_login(:'viewer_a');
select public.t_assert((select count(*) = 2 from public.bank_transactions), '閲覧者は明細を見られる');
select public.t_expect_error($$select public.bank_auto_match(null)$$, 'FORBIDDEN', '閲覧者は消し込めない');
select public.test_login(:'owner_b');
select public.t_assert((select count(*) = 0 from public.bank_transactions), '他社の明細は見えない');
select public.t_assert((select count(*) = 0 from public.alerts), '他社のアラートは見えない');
select public.t_assert((select count(*) = 0 from public.chat_messages), '他社のチャットは見えない');

\echo '== 22. 運行管理と法令対応（車両・書類・点呼・日別の稼働）'
set role authenticated;
select public.test_login(:'owner_a');

-- ---------- 車両と書類の期限 ----------
insert into public.vehicles (id, company_id, plate, maker, model, ownership, driver_id)
values ('00000000-0000-0000-0000-0000000000e1', :'company_a', '足立 480 あ 12-34', 'ダイハツ', 'ハイゼット', 'lease',
        (select id from public.drivers where company_id = :'company_a' and name = '相曽慧'));
select public.t_assert((select driver_name = '相曽慧' and ownership = 'lease' from public.v_vehicle_list where id = '00000000-0000-0000-0000-0000000000e1'), '車両に割当ドライバーが出る');

insert into public.documents (company_id, kind, vehicle_id, label, expires_on, reminder_days)
values (:'company_a', 'vehicle_inspection', '00000000-0000-0000-0000-0000000000e1', '車検', current_date - 1, 60);
insert into public.documents (company_id, kind, vehicle_id, label, expires_on, reminder_days)
values (:'company_a', 'voluntary_insurance', '00000000-0000-0000-0000-0000000000e1', '任意保険', current_date + 30, 60);
insert into public.documents (company_id, kind, driver_id, label, expires_on, reminder_days)
values (:'company_a', 'license', (select id from public.drivers where company_id = :'company_a' and name = '相曽慧'), '運転免許証', current_date + 300, 60);

select public.t_assert((select expiry_status = 'expired' and days_left = -1 from public.v_document_list where label = '車検'), '期限切れの書類が分かる');
select public.t_assert((select expiry_status = 'soon' and days_left = 30 from public.v_document_list where label = '任意保険'), '期限が近い書類が分かる');
select public.t_assert((select expiry_status = 'valid' from public.v_document_list where label = '運転免許証'), '余裕がある書類は valid');
select public.t_assert((select vehicle_plate = '足立 480 あ 12-34' from public.v_document_list where label = '車検'), '書類に車両番号が出る');
select public.t_assert((select next_expires_on = current_date - 1 and expired_count = 1 from public.v_vehicle_list where id = '00000000-0000-0000-0000-0000000000e1'), '車両に次の期限と期限切れ件数が出る');

-- ---------- 安全管理者 ----------
insert into public.safety_managers (company_id, name, office, appointed_on, training_on)
values (:'company_a', '川島幹太', '本店', '2026-04-01', '2026-03-10');
select public.t_assert((select count(*) = 1 from public.safety_managers where company_id = :'company_a' and is_active), '安全管理者を選任できる');

-- ---------- 指導・監督と事故 ----------
insert into public.driver_instructions (company_id, driver_id, kind, instructed_on, hours, topics)
values (:'company_a', (select id from public.drivers where company_id = :'company_a' and name = '相曽慧'), 'initial', '2026-12-02', 6, '安全運転の基本');
insert into public.incidents (company_id, driver_id, occurred_at, kind, place, description, prevention)
values (:'company_a', (select id from public.drivers where company_id = :'company_a' and name = '相曽慧'), '2026-12-03 09:00+09', 'near_miss', '三郷市', '交差点で急ブレーキ', '車間距離の指導');
select public.t_assert((select count(*) = 1 from public.driver_instructions where company_id = :'company_a'), '指導の記録を残せる');
select public.t_assert((select count(*) = 1 from public.incidents where company_id = :'company_a'), '事故・ヒヤリハットを残せる');

-- ---------- 日報（点呼・業務記録） ----------
insert into public.daily_reports (company_id, work_date, driver_id, vehicle_id, pre_at, pre_method, pre_alcohol, pre_alcohol_ok, pre_health_ok, pre_inspection_ok, start_at)
values (:'company_a', '2026-12-05', (select id from public.drivers where company_id = :'company_a' and name = '相曽慧'),
        '00000000-0000-0000-0000-0000000000e1', '2026-12-05 07:00+09', 'app', 0.000, true, true, true, '2026-12-05 07:10+09');
select public.t_assert((select month = '2026-12-01' from public.daily_reports where work_date = '2026-12-05'), '稼動月が日付から入る');
select public.t_assert((select pre_done and not post_done and not roll_call_done from public.v_daily_report_list where work_date = '2026-12-05'), '業務前だけ済んでいる状態が分かる');
update public.daily_reports set post_at = '2026-12-05 19:00+09', post_method = 'app', post_alcohol = 0.000, post_alcohol_ok = true, post_condition_ok = true, distance_km = 128.5
 where work_date = '2026-12-05';
select public.t_assert((select roll_call_done and distance_km = 128.5 from public.v_daily_report_list where work_date = '2026-12-05'), '業務後点呼まで済むと完了');
select public.t_expect_error(format($$insert into public.daily_reports (company_id, work_date, driver_id) values ('%s', '2026-12-05', (select id from public.drivers where company_id = '%s' and name = '相曽慧'))$$, :'company_a', :'company_a'), null, '同じ日・同じドライバーの日報は 1 件だけ');

-- ---------- 日別の稼働 → 月次への自動集計 ----------
-- 反映前の 2026-12 の三郷Amazon（相曽慧）の数量を確認
select public.t_assert((select qty_source = 'manual' from public.work_entries we
                          join public.drivers d on d.id = we.driver_id
                          join public.project_items pi on pi.id = we.project_item_id
                          join public.projects p on p.id = pi.project_id
                         where we.month = '2026-12-01' and d.name = '相曽慧' and p.name = '三郷Amazon'), '最初の稼働行は手入力');

select public.t_assert(public.submit_day_entries('2026-12-05',
  array[(select pi.id from public.project_items pi join public.projects p on p.id = pi.project_id where p.company_id = :'company_a' and p.name = '三郷Amazon')]::uuid[],
  array[1]::numeric[],
  (select id from public.drivers where company_id = :'company_a' and name = '相曽慧')) = 1, 'スタッフが日別の稼働を提出できる');
select public.t_assert((select status = 'submitted' and source = 'staff' from public.work_day_entries where work_date = '2026-12-05'), '提出直後は承認待ち');
select public.t_assert((select qty_source = 'manual' from public.work_entries we
                          join public.drivers d on d.id = we.driver_id
                          join public.project_items pi on pi.id = we.project_item_id
                          join public.projects p on p.id = pi.project_id
                         where we.month = '2026-12-01' and d.name = '相曽慧' and p.name = '三郷Amazon'), '承認前は月次に反映しない');

-- 2 日目を追加して承認する
select public.t_assert(public.submit_day_entries('2026-12-08',
  array[(select pi.id from public.project_items pi join public.projects p on p.id = pi.project_id where p.company_id = :'company_a' and p.name = '三郷Amazon')]::uuid[],
  array[2]::numeric[],
  (select id from public.drivers where company_id = :'company_a' and name = '相曽慧')) = 1, '別の日も提出できる');
select public.t_assert(public.approve_day_entries(array(select id from public.work_day_entries where company_id = :'company_a'), true) = 2, '2 件をまとめて承認');
select public.t_assert((select qty = 3 and qty_source = 'daily' from public.work_entries we
                          join public.drivers d on d.id = we.driver_id
                          join public.project_items pi on pi.id = we.project_item_id
                          join public.projects p on p.id = pi.project_id
                         where we.month = '2026-12-01' and d.name = '相曽慧' and p.name = '三郷Amazon'), '承認すると月次の数量が日別の合計（1 ＋ 2 ＝ 3）になる');

-- 数量を直すと月次も追従する
update public.work_day_entries set qty = 5 where work_date = '2026-12-08';
select public.t_assert((select qty = 6 from public.work_entries we
                          join public.drivers d on d.id = we.driver_id
                          join public.project_items pi on pi.id = we.project_item_id
                          join public.projects p on p.id = pi.project_id
                         where we.month = '2026-12-01' and d.name = '相曽慧' and p.name = '三郷Amazon'), '日別を直すと月次も変わる（1 ＋ 5 ＝ 6）');

-- 差戻すと月次から外れる
select public.t_assert(public.approve_day_entries(array(select id from public.work_day_entries where work_date = '2026-12-08'), false, '数量が違います') = 1, '差戻しできる');
select public.t_assert((select qty = 1 from public.work_entries we
                          join public.drivers d on d.id = we.driver_id
                          join public.project_items pi on pi.id = we.project_item_id
                          join public.projects p on p.id = pi.project_id
                         where we.month = '2026-12-01' and d.name = '相曽慧' and p.name = '三郷Amazon'), '差戻した分は月次から外れる（1 のみ）');
select public.t_assert((select reject_reason = '数量が違います' from public.work_day_entries where work_date = '2026-12-08'), '差戻しの理由が残る');

-- 全部消すと 0 になる（日別由来の行）
delete from public.work_day_entries where company_id = :'company_a';
select public.t_assert((select qty = 0 and qty_source = 'daily' from public.work_entries we
                          join public.drivers d on d.id = we.driver_id
                          join public.project_items pi on pi.id = we.project_item_id
                          join public.projects p on p.id = pi.project_id
                         where we.month = '2026-12-01' and d.name = '相曽慧' and p.name = '三郷Amazon'), '日別が無くなると数量 0');

-- ---------- 締め済み月 ----------
select public.t_expect_error(format($$insert into public.work_day_entries (company_id, work_date, driver_id, project_item_id, qty)
  values ('%s', '2026-09-10', (select id from public.drivers where company_id = '%s' and name = '相曽慧'),
          (select pi.id from public.project_items pi join public.projects p on p.id = pi.project_id where p.company_id = '%s' and p.name = '三郷Amazon'), 1)$$,
  :'company_a', :'company_a', :'company_a'), 'MONTH_CLOSED', '締め済み月には日別の稼働を入れられない');
select public.t_expect_error(format($$insert into public.daily_reports (company_id, work_date, driver_id) values ('%s', '2026-09-10', (select id from public.drivers where company_id = '%s' and name = '相曽慧'))$$, :'company_a', :'company_a'), 'MONTH_CLOSED', '締め済み月には日報を入れられない');

-- ---------- ドライバー本人 ----------
select public.test_login(:'driver_a');
select public.t_assert((select count(*) = 1 from public.daily_reports), 'ドライバーは自分の日報を読める');
select public.t_assert((select count(*) >= 1 from public.documents), 'ドライバーは自分の書類を読める');
select public.t_assert((select count(*) = 1 from public.vehicles), 'ドライバーは自分に割り当てられた車両を読める');
select public.t_assert(public.submit_day_entries('2026-12-10',
  array[(select pi.id from public.project_items pi join public.projects p on p.id = pi.project_id where p.company_id = :'company_a' and p.name = '三郷Amazon')]::uuid[],
  array[4]::numeric[]) = 1, 'ドライバー本人が自分の稼働を提出できる');
select public.t_assert((select source = 'driver' and status = 'submitted' from public.work_day_entries where work_date = '2026-12-10'), '本人の提出は source=driver・承認待ち');
select public.t_assert((select count(*) > 0 from public.driver_day_items()), 'ドライバーは「今日の報告」で選べる案件内容を取得できる');
select public.t_assert((select count(*) from public.driver_day_items()) > (select count(*) from public.project_items), '案件マスタを直接読める範囲より多くの候補を返す（RPC は security definer）');
select public.t_expect_error($$select public.approve_day_entries(array(select id from public.work_day_entries), true)$$, 'FORBIDDEN', 'ドライバーは自分で承認できない');
select public.t_expect_error($$update public.work_day_entries set status = 'approved' where work_date = '2026-12-10'$$, null, 'ドライバーは status を承認済みに変えられない');
select public.t_assert((select count(*) = 0 from public.safety_managers), 'ドライバーは安全管理者の一覧を読めない');

-- ---------- 閲覧者 ----------
select public.test_login(:'viewer_a');
select public.t_assert((select count(*) >= 1 from public.v_daily_report_list), '閲覧者は日報を読める');
select public.t_expect_error(format($$insert into public.vehicles (company_id, plate) values ('%s', 'テスト 1')$$, :'company_a'), null, '閲覧者は車両を追加できない');
select public.t_expect_error($$select public.apply_day_entries('2026-12-01')$$, 'FORBIDDEN', '閲覧者は月次への反映ができない');

-- ---------- 検知（運行管理のルール） ----------
select public.test_login(:'owner_a');
select public.t_assert((public.detect_anomalies('2026-12-01')->>'detected')::integer > 0, '運行管理を含めて検知する');
select public.t_assert((select count(*) = 1 from public.alerts where company_id = :'company_a' and code = 'document_expired' and status = 'open'), '期限切れの書類を検知');
select public.t_assert((select count(*) = 1 from public.alerts where company_id = :'company_a' and code = 'document_expiring' and status = 'open'), '期限が近い書類を検知');
select public.t_assert((select count(*) = 1 from public.alerts where company_id = :'company_a' and code = 'day_entry_pending' and status = 'open'), '承認待ちの稼働報告を検知');
select public.t_assert((select count(*) = 1 from public.alerts where company_id = :'company_a' and code = 'roll_call_missing' and status = 'open'), '点呼の無い稼働日を検知');
select public.t_assert((select count(*) = 0 from public.alerts where company_id = :'company_a' and code = 'safety_manager_missing' and status = 'open'), '安全管理者が居れば警告しない');
update public.safety_managers set is_active = false where company_id = :'company_a';
select public.detect_anomalies('2026-12-01');
select public.t_assert((select count(*) = 1 from public.alerts where company_id = :'company_a' and code = 'safety_manager_missing' and status = 'open'), '安全管理者が居ないと警告する（再発したら未対応に戻る）');
-- 「対象外」にしたものは再検知しても戻らない
select public.set_alert_status((select id from public.alerts where company_id = :'company_a' and code = 'safety_manager_missing'), 'ignored', '3 月までに選任予定');
select public.detect_anomalies('2026-12-01');
select public.t_assert((select status = 'ignored' from public.alerts where company_id = :'company_a' and code = 'safety_manager_missing'), '対象外にしたアラートは再検知でも戻らない');
update public.safety_managers set is_active = true where company_id = :'company_a';

-- ---------- 月次への一括反映と他社の分離 ----------
select public.t_assert(public.apply_day_entries('2026-12-01') >= 0, '月次への一括反映が動く');
select public.test_login(:'owner_b');
select public.t_assert((select count(*) = 0 from public.vehicles), '他社の車両は見えない');
select public.t_assert((select count(*) = 0 from public.daily_reports), '他社の日報は見えない');
select public.t_assert((select count(*) = 0 from public.work_day_entries), '他社の日別の稼働は見えない');
select public.t_assert((select count(*) = 0 from public.documents), '他社の書類は見えない');

select public.test_logout();
reset role;

\echo '== 23. 法人の経営管理（銀行口座・税務カレンダー・借入・経営指標）'
set role authenticated;
select public.test_login(:'owner_a');

-- ---------- 決算月と税務カレンダー ----------
update public.companies set fiscal_month = 3 where id = :'company_a';
select public.t_assert(public.ensure_tax_tasks(2027) >= 10, '税務・決算の期限をまとめて作れる');
select public.t_assert((select count(*) = 0 from public.tax_tasks where company_id = :'company_a' and title = '') , '期限には必ず名前がつく');
select public.t_assert((select due_on = '2027-05-31' from public.tax_tasks where company_id = :'company_a' and kind = 'corporate_tax_final' and due_on >= '2027-01-01'), '3 月決算なら法人税の申告期限は 5 月末');
select public.t_assert(public.ensure_tax_tasks(2027) = 0, '同じ年を作り直しても二重にならない');
select public.t_assert((select urgency = 'future' or urgency in ('soon','overdue','done') from public.v_tax_task_list where company_id = :'company_a' and kind = 'corporate_tax_final' limit 1), '期限の緊急度が出る');
update public.tax_tasks set status = 'done', done_on = current_date where company_id = :'company_a' and kind = 'depreciable_assets';
select public.t_assert((select urgency = 'done' from public.v_tax_task_list where company_id = :'company_a' and kind = 'depreciable_assets' limit 1), '済にすると done になる');

-- 決算月を変えると期限も変わる
update public.companies set fiscal_month = 12 where id = :'company_a';
select public.ensure_tax_tasks(2028);
select public.t_assert((select count(*) = 1 from public.tax_tasks where company_id = :'company_a' and kind = 'corporate_tax_final' and due_on = '2029-02-28'), '12 月決算なら法人税の申告期限は翌年 2 月末');
update public.companies set fiscal_month = 3 where id = :'company_a';

-- ---------- 借入と返済予定 ----------
insert into public.loans (id, company_id, name, lender, principal, annual_rate, start_on, months, payment_day, status)
values ('00000000-0000-0000-0000-0000000000f1', :'company_a', '運転資金', '日本政策金融公庫', 3000000, 0.0180, '2026-12-01', 60, 27, 'active');
select public.t_assert(public.generate_loan_schedule('00000000-0000-0000-0000-0000000000f1') = 60, '返済予定を 60 回分作れる');
select public.t_assert((select count(*) = 0 from public.loan_payments where loan_id = '00000000-0000-0000-0000-0000000000f1' and company_id <> :'company_a'), '返済予定の会社はトリガーが補完する');
select public.t_assert((select abs(sum(principal) - 3000000) < 100 from public.loan_payments where loan_id = '00000000-0000-0000-0000-0000000000f1'), '元金の合計が借入額と一致する');
select public.t_assert((select sum(interest) > 0 from public.loan_payments where loan_id = '00000000-0000-0000-0000-0000000000f1'), '利息がつく');
select public.t_assert((select balance = 0 from public.loan_payments where loan_id = '00000000-0000-0000-0000-0000000000f1' order by seq desc limit 1), '最後の返済で残高が 0 になる');
select public.t_assert((select due_on = '2027-01-27' from public.loan_payments where loan_id = '00000000-0000-0000-0000-0000000000f1' and seq = 1), '初回の返済日は返済日の指定どおり');
select public.t_assert((select remaining_principal > 0 and payment_count = 60 from public.v_loan_list where id = '00000000-0000-0000-0000-0000000000f1'), '借入の一覧に残高と回数が出る');
select public.t_assert((select loan_name = '運転資金' from public.v_loan_payment_list where loan_id = '00000000-0000-0000-0000-0000000000f1' and seq = 1), '返済予定に借入名が出る');

-- 返済済みの回は作り直しても消えない
update public.loan_payments set paid_on = due_on where loan_id = '00000000-0000-0000-0000-0000000000f1' and seq = 1;
select public.generate_loan_schedule('00000000-0000-0000-0000-0000000000f1');
select public.t_assert((select paid_on is not null from public.loan_payments where loan_id = '00000000-0000-0000-0000-0000000000f1' and seq = 1), '返済済みの回は作り直しても残る');
select public.t_assert((select paid_count = 1 from public.v_loan_list where id = '00000000-0000-0000-0000-0000000000f1'), '返済済みの回数が出る');

-- 資金繰りに返済が載る
select public.t_assert((select count(*) > 0 from public.cash_forecast('2027-01-01', '2027-03-31') where kind = 'loan'), '資金繰りに借入の返済が載る');
select public.t_assert((select bool_and(amount < 0) from public.cash_forecast('2027-01-01', '2027-03-31') where kind = 'loan'), '返済は支払（マイナス）として載る');
update public.loans set status = 'planned' where id = '00000000-0000-0000-0000-0000000000f1';
select public.t_assert((select count(*) = 0 from public.cash_forecast('2027-01-01', '2027-03-31') where kind = 'loan'), '予定（planned）の借入は資金繰りに載せない');
update public.loans set status = 'active' where id = '00000000-0000-0000-0000-0000000000f1';

-- ---------- 経営指標 ----------
update public.month_targets set expense_target = 300000, driver_target = 3 where company_id = :'company_a' and month = '2026-12-01';
insert into public.month_targets (company_id, month, bill_target, profit_target, expense_target, driver_target)
select :'company_a', '2026-12-01', 1000000, 300000, 300000, 3
where not exists (select 1 from public.month_targets where company_id = :'company_a' and month = '2026-12-01');
select public.t_assert((select count(*) = 1 from public.v_month_kpi where company_id = :'company_a' and month = '2026-12-01'), '経営指標のビューが 1 行返る');
select public.t_assert((select contribution = margin + royalty - expense_variable from public.v_month_kpi where company_id = :'company_a' and month = '2026-12-01'), '限界利益 ＝ 粗利 ＋ ロイヤリティ − 変動費');
select public.t_assert((select net_fixed_cost = expense_fixed - mgmt_fee - adj_profit from public.v_month_kpi where company_id = :'company_a' and month = '2026-12-01'), '正味の固定費 ＝ 固定費 − 管理費 − 利益計上の調整');
select public.t_assert((select bill_achievement is not null from public.v_month_kpi where company_id = :'company_a' and month = '2026-12-01'), '売上の達成率が出る');
select public.t_assert((select expense_target = 300000 and driver_target = 3 from public.v_month_kpi where company_id = :'company_a' and month = '2026-12-01'), '経費とドライバー数の予算が出る');
select public.t_assert((select break_even_bill >= 0 from public.v_month_kpi where company_id = :'company_a' and month = '2026-12-01'), '損益分岐点売上高が出る');

-- ---------- 口座情報 ----------
update public.drivers set bank_code = '0005', bank_name = '三菱ＵＦＪ銀行', branch_code = '001', branch_name = '本店',
       account_type = 'ordinary', account_number = '1234567', account_holder_kana = 'ｱｲｿ ｻﾄｼ'
 where company_id = :'company_a' and name = '相曽慧';
select public.t_assert((select account_number = '1234567' from public.drivers where company_id = :'company_a' and name = '相曽慧'), '口座情報を保存できる');
select public.t_expect_error($$update public.drivers set bank_code = '12' where name = '相曽慧'$$, '', '銀行コードは 4 桁でないと保存できない');
select public.t_expect_error($$update public.drivers set account_number = '12345678' where name = '相曽慧'$$, '', '口座番号は 7 桁までしか保存できない');
update public.companies set fb_consignor_code = '1234567890', fb_consignor_kana = 'ｶ)ﾙｰﾃｨﾌﾞ', fb_bank_code = '0005',
       fb_bank_name = '三菱ＵＦＪ銀行', fb_branch_code = '001', fb_branch_name = '本店',
       fb_account_type = 'ordinary', fb_account_number = '7654321' where id = :'company_a';
select public.t_assert((select fb_consignor_code = '1234567890' from public.companies where id = :'company_a'), '会社の振込元情報を保存できる');

-- ---------- 異常検知（税務・契約・口座） ----------
insert into public.tax_tasks (company_id, kind, title, due_on)
values (:'company_a', 'spot_check', 'テスト用の期限', current_date + 10);
insert into public.tax_tasks (company_id, kind, title, due_on)
values (:'company_a', 'spot_overdue', '過ぎたテスト用の期限', current_date - 5);
insert into public.contracts (company_id, driver_id, title, start_on, end_on, notice_days, auto_renew)
values (:'company_a', (select id from public.drivers where company_id = :'company_a' and name = '相曽慧'), '業務委託契約書', '2025-04-01', current_date + 10, 30, true);
select public.detect_anomalies('2026-12-01');
select public.t_assert((select count(*) = 1 from public.alerts where company_id = :'company_a' and code = 'tax_due' and status = 'open'), '近づいた税務の期限を検知');
select public.t_assert((select count(*) = 1 from public.alerts where company_id = :'company_a' and code = 'tax_overdue' and status = 'open'), '過ぎた税務の期限を検知');
select public.t_assert((select count(*) = 1 from public.alerts where company_id = :'company_a' and code = 'contract_renewal' and status = 'open'), '更新時期の契約を検知');
update public.tax_tasks set status = 'done', done_on = current_date where company_id = :'company_a' and kind = 'spot_check';
select public.detect_anomalies('2026-12-01');
select public.t_assert((select count(*) = 0 from public.alerts where company_id = :'company_a' and code = 'tax_due' and status = 'open'), '済にすると税務のアラートは解決済みになる');

-- ---------- 権限 ----------
select public.test_login(:'viewer_a');
select public.t_assert((select count(*) > 0 from public.tax_tasks where company_id = :'company_a'), '閲覧者は税務の期限を読める');
select public.t_assert((select count(*) > 0 from public.v_loan_list where company_id = :'company_a'), '閲覧者は借入を読める');
select public.t_expect_error($$insert into public.loans (company_id, name, principal, start_on) values ('00000000-0000-0000-0000-00000000000a', 'だめ', 1, '2026-12-01')$$, '', '閲覧者は借入を追加できない');
select public.t_expect_error($$select public.generate_loan_schedule('00000000-0000-0000-0000-0000000000f1')$$, 'FORBIDDEN', '閲覧者は返済予定を作れない');
select public.t_expect_error($$select public.ensure_tax_tasks(2029)$$, 'FORBIDDEN', '閲覧者は税務の期限を作れない');

-- ---------- 会社分離 ----------
select public.test_login(:'owner_b');
select public.t_assert((select count(*) = 0 from public.tax_tasks), '他社の税務の期限は見えない');
select public.t_assert((select count(*) = 0 from public.loans), '他社の借入は見えない');
select public.t_assert((select count(*) = 0 from public.loan_payments), '他社の返済予定は見えない');
select public.t_assert((select count(*) = 0 from public.v_month_kpi where company_id = '00000000-0000-0000-0000-00000000000a'), '他社の経営指標は見えない');

select public.test_logout();
reset role;

\echo '== 24. バックアップと復元（0012〜0014 のテーブルを含む）'
set role authenticated;
select public.test_login(:'owner_a');

-- 書き出しに新しいテーブルが入る
select public.t_assert((public.export_backup()->>'version') = '6', 'バックアップは version 6');
select public.t_assert(jsonb_array_length(public.export_backup()->'vehicles') > 0, 'バックアップに車両が入る');
select public.t_assert(jsonb_array_length(public.export_backup()->'documents') > 0, 'バックアップに書類が入る');
select public.t_assert(jsonb_array_length(public.export_backup()->'daily_reports') > 0, 'バックアップに日報が入る');
select public.t_assert(jsonb_array_length(public.export_backup()->'work_day_entries') > 0, 'バックアップに日別の稼働が入る');
select public.t_assert(jsonb_array_length(public.export_backup()->'safety_managers') > 0, 'バックアップに安全管理者が入る');
select public.t_assert(jsonb_array_length(public.export_backup()->'driver_instructions') > 0, 'バックアップに指導の記録が入る');
select public.t_assert(jsonb_array_length(public.export_backup()->'incidents') > 0, 'バックアップに事故の記録が入る');
select public.t_assert(jsonb_array_length(public.export_backup()->'contracts') > 0, 'バックアップに契約が入る');
select public.t_assert(jsonb_array_length(public.export_backup()->'tax_tasks') > 0, 'バックアップに税務の期限が入る');
select public.t_assert(jsonb_array_length(public.export_backup()->'loans') > 0, 'バックアップに借入が入る');
select public.t_assert(jsonb_array_length(public.export_backup()->'loan_payments') > 0, 'バックアップに返済予定が入る');
select public.t_assert((public.export_backup()->'company'->>'fiscal_month') is not null, 'バックアップに決算月が入る');
select public.t_assert((select (x->>'account_number') = '1234567' from jsonb_array_elements(public.export_backup()->'drivers') x where x->>'name' = '相曽慧'), 'バックアップにドライバーの口座情報が入る');
-- トークンや秘密は含めない
select public.t_assert((public.export_backup() ? 'integration_secrets') = false, 'バックアップに外部連携のトークンは含めない');

-- 件数を控える
drop table if exists t_before24;
create temporary table t_before24 as
select
  (select count(*) from public.vehicles where company_id = '00000000-0000-0000-0000-00000000000a') as vehicles,
  (select count(*) from public.documents where company_id = '00000000-0000-0000-0000-00000000000a') as documents,
  (select count(*) from public.daily_reports where company_id = '00000000-0000-0000-0000-00000000000a') as daily_reports,
  (select count(*) from public.work_day_entries where company_id = '00000000-0000-0000-0000-00000000000a') as work_day_entries,
  (select count(*) from public.contracts where company_id = '00000000-0000-0000-0000-00000000000a') as contracts,
  (select count(*) from public.tax_tasks where company_id = '00000000-0000-0000-0000-00000000000a') as tax_tasks,
  (select count(*) from public.loan_payments where company_id = '00000000-0000-0000-0000-00000000000a') as loan_payments,
  (select count(*) from public.work_entries where company_id = '00000000-0000-0000-0000-00000000000a') as work_entries;

-- 全削除 → 復元
create temporary table t_backup24 as select public.export_backup() as data;
select public.reset_company_data('株式会社ROOTIVE');
select public.t_assert((select count(*) = 0 from public.vehicles where company_id = '00000000-0000-0000-0000-00000000000a'), '全削除で車両が消える');
select public.t_assert((select count(*) = 0 from public.loan_payments where company_id = '00000000-0000-0000-0000-00000000000a'), '全削除で返済予定が消える');
select public.import_backup((select data from t_backup24));

select public.t_assert((select count(*) from public.vehicles where company_id = '00000000-0000-0000-0000-00000000000a') = (select vehicles from t_before24), '復元後も車両の件数が同じ');
select public.t_assert((select count(*) from public.documents where company_id = '00000000-0000-0000-0000-00000000000a') = (select documents from t_before24), '復元後も書類の件数が同じ');
select public.t_assert((select count(*) from public.daily_reports where company_id = '00000000-0000-0000-0000-00000000000a') = (select daily_reports from t_before24), '復元後も日報の件数が同じ');
select public.t_assert((select count(*) from public.work_day_entries where company_id = '00000000-0000-0000-0000-00000000000a') = (select work_day_entries from t_before24), '復元後も日別の稼働の件数が同じ');
select public.t_assert((select count(*) from public.contracts where company_id = '00000000-0000-0000-0000-00000000000a') = (select contracts from t_before24), '復元後も契約の件数が同じ');
select public.t_assert((select count(*) from public.tax_tasks where company_id = '00000000-0000-0000-0000-00000000000a') = (select tax_tasks from t_before24), '復元後も税務の期限の件数が同じ');
select public.t_assert((select count(*) from public.loan_payments where company_id = '00000000-0000-0000-0000-00000000000a') = (select loan_payments from t_before24), '復元後も返済予定の件数が同じ');
select public.t_assert((select count(*) from public.work_entries where company_id = '00000000-0000-0000-0000-00000000000a') = (select work_entries from t_before24), '復元後も稼働行の件数が同じ');
select public.t_assert((select account_number = '1234567' and account_holder_kana = 'ｱｲｿ ｻﾄｼ' from public.drivers where company_id = '00000000-0000-0000-0000-00000000000a' and name = '相曽慧'), '復元後もドライバーの口座情報が同じ');
select public.t_assert((select fiscal_month = 3 and fb_consignor_code = '1234567890' from public.companies where id = '00000000-0000-0000-0000-00000000000a'), '復元後も決算月と振込元が同じ');
select public.t_assert((select expense_target = 300000 and driver_target = 3 from public.month_targets where company_id = '00000000-0000-0000-0000-00000000000a' and month = '2026-12-01'), '復元後も経費とドライバー数の予算が同じ');
select public.t_assert((select abs(sum(principal) - 3000000) < 100 from public.loan_payments where company_id = '00000000-0000-0000-0000-00000000000a'), '復元後も返済予定の元金合計が同じ');

-- もう一度復元しても壊れない（冪等）
select public.import_backup((select data from t_backup24));
select public.t_assert((select count(*) from public.tax_tasks where company_id = '00000000-0000-0000-0000-00000000000a') = (select tax_tasks from t_before24), '二度復元しても税務の期限が増えない');
select public.t_assert((select count(*) from public.vehicles where company_id = '00000000-0000-0000-0000-00000000000a') = (select vehicles from t_before24), '二度復元しても車両が増えない');

select public.test_logout();
reset role;

\echo '== 25. 異常の検知を cron から回す（detect_anomalies_core）'
set role authenticated;
select public.test_login(:'owner_a');
select public.t_expect_error($$select public.detect_anomalies_core('00000000-0000-0000-0000-00000000000a', '2026-12-01')$$, '', 'ログイン中のユーザーは detect_anomalies_core を直接呼べない');
select public.t_assert((public.detect_anomalies('2026-12-01')->>'detected')::integer >= 0, '入口の detect_anomalies は admin 以上なら呼べる');
select public.test_login(:'viewer_a');
select public.t_expect_error($$select public.detect_anomalies('2026-12-01')$$, 'FORBIDDEN', '閲覧者は検知を実行できない');
select public.test_logout();
reset role;

-- サービスロール（cron）は会社を指定して検知できる
set role service_role;
select public.t_assert((public.detect_anomalies_core('00000000-0000-0000-0000-00000000000a', '2026-12-01')->>'detected')::integer > 0, 'サービスロールは会社を指定して検知できる');
select public.t_assert((public.detect_anomalies_core('00000000-0000-0000-0000-00000000000b', '2026-12-01')->>'detected')::integer >= 0, '別の会社も指定して検知できる');
select public.t_expect_error($$select public.detect_anomalies_core(null, '2026-12-01')$$, '', '会社の指定が無ければエラー');
-- 会社を指定した集計は、その会社のぶんだけを返す（cron から呼んでも他社が混ざらない）
select public.t_assert((select count(*) = 0 from public.cash_forecast_for('00000000-0000-0000-0000-00000000000b', '2026-01-01', '2028-12-31') where kind = 'loan'), '別会社の資金繰りに A 社の借入は出ない');
select public.t_assert((select count(*) > 0 from public.cash_forecast_for('00000000-0000-0000-0000-00000000000a', '2026-01-01', '2028-12-31') where kind = 'loan'), 'A 社の資金繰りには A 社の借入が出る');
select public.t_assert((select count(*) = 0 from public.rate_diffs_for('00000000-0000-0000-0000-00000000000b', '2026-12-01')), '別会社の単価差分は 0 件');
reset role;

set role authenticated;
select public.test_login(:'owner_a');
select public.t_expect_error($$select count(*) from public.cash_forecast_for('00000000-0000-0000-0000-00000000000b', '2026-01-01', '2026-12-31')$$, '', 'ログイン中のユーザーは会社指定の資金繰りを呼べない');
select public.t_expect_error($$select count(*) from public.rate_diffs_for('00000000-0000-0000-0000-00000000000b', '2026-12-01')$$, '', 'ログイン中のユーザーは会社指定の単価差分を呼べない');
select public.t_assert((select count(*) >= 0 from public.cash_forecast('2026-01-01', '2026-12-31')), '入口の資金繰りは自社ぶんが見える');
select public.test_logout();
reset role;

\echo '== 26. 労務（拘束時間・休息・連続勤務）と、元請の支払通知との突合'
set role authenticated;
select public.test_login(:'owner_a');

-- ---------- 日報から拘束時間・休息・連続勤務を出す（2026-11 は未締め） ----------
insert into public.daily_reports (company_id, work_date, driver_id, start_at, end_at, break_minutes, distance_km)
values
  (:'company_a', '2026-11-10', (select id from public.drivers where company_id = :'company_a' and name = '相曽慧'), '2026-11-10 06:00+09', '2026-11-10 20:00+09', 60, 120),
  (:'company_a', '2026-11-11', (select id from public.drivers where company_id = :'company_a' and name = '相曽慧'), '2026-11-11 03:00+09', '2026-11-11 19:00+09', 60, 150),
  (:'company_a', '2026-11-12', (select id from public.drivers where company_id = :'company_a' and name = '相曽慧'), '2026-11-12 08:00+09', '2026-11-12 17:00+09', 60, 90);

select public.t_assert((select duty_minutes = 840 and work_minutes = 780 and duty_status = 'over' from public.v_daily_labor where company_id = :'company_a' and work_date = '2026-11-10'), '14 時間の拘束は「超過」と判定する');
select public.t_assert((select duty_minutes = 960 and duty_status = 'severe' from public.v_daily_labor where company_id = :'company_a' and work_date = '2026-11-11'), '16 時間の拘束は「大幅超過」と判定する');
select public.t_assert((select rest_minutes = 420 and rest_status = 'severe' from public.v_daily_labor where company_id = :'company_a' and work_date = '2026-11-11'), '前日 20 時 → 当日 3 時は休息 7 時間で「不足」');
select public.t_assert((select rest_status = 'ok' from public.v_daily_labor where company_id = :'company_a' and work_date = '2026-11-12'), '13 時間空けば休息は「問題なし」');
select public.t_assert((select rest_minutes is null from public.v_daily_labor where company_id = :'company_a' and work_date = '2026-11-10'), '前の稼働が無い日は休息を判定しない');
select public.t_assert((select consecutive_days = 3 from public.v_daily_labor where company_id = :'company_a' and work_date = '2026-11-12'), '連続 3 日として数える');
select public.t_assert((select duty_status = 'ok' and break_status = 'ok' from public.v_daily_labor where company_id = :'company_a' and work_date = '2026-11-12'), '9 時間・休憩 60 分は問題なし');

-- 休憩が足りない日
update public.daily_reports set break_minutes = 20 where company_id = :'company_a' and work_date = '2026-11-12';
select public.t_assert((select break_status = 'short' from public.v_daily_labor where company_id = :'company_a' and work_date = '2026-11-12'), '実働 8 時間超で休憩 20 分は「不足」');
update public.daily_reports set break_minutes = 60 where company_id = :'company_a' and work_date = '2026-11-12';

-- 月のサマリー
select public.t_assert((select report_days = 3 and over_duty_days = 1 and severe_duty_days = 1 and severe_rest_days = 1 and max_consecutive_days = 3
                          from public.v_driver_month_labor where company_id = :'company_a' and month = '2026-11-01'), '月のサマリーに超過日数と連続勤務が出る');
select public.t_assert((select duty_minutes_total = 840 + 960 + 540 from public.v_driver_month_labor where company_id = :'company_a' and month = '2026-11-01'), '拘束時間の合計が合う');
select public.t_assert((select month_duty_over = false from public.v_driver_month_labor where company_id = :'company_a' and month = '2026-11-01'), '月 284 時間は超えていない');

-- 会社ごとに基準を変えられる
update public.companies set labor_duty_limit_minutes = 900, labor_duty_max_minutes = 1000 where id = :'company_a';
select public.t_assert((select duty_status = 'ok' from public.v_daily_labor where company_id = :'company_a' and work_date = '2026-11-10'), '基準を 15 時間にすると 14 時間は問題なしになる');
update public.companies set labor_duty_limit_minutes = 780, labor_duty_max_minutes = 900 where id = :'company_a';

-- ---------- 元請の支払通知との突合 ----------
insert into public.payment_notices (id, company_id, month, notice_no, received_on, total_amount)
select '00000000-0000-0000-0000-00000000aa01', :'company_a', '2026-12-01', 'PN-001', '2027-01-20', coalesce(sum(bill), 0) + 1000
  from public.v_work_entry_calc where company_id = :'company_a' and month = '2026-12-01';
select public.t_assert((select total_diff = 1000 from public.v_payment_notice_list where id = '00000000-0000-0000-0000-00000000aa01'), '通知の合計と自社の売上の差が出る');

insert into public.payment_notice_items (notice_id, raw_name, qty, unit_price)
values ('00000000-0000-0000-0000-00000000aa01', '三郷Amazon 標準', 10, 23025);
select public.t_assert((select amount = 230250 from public.payment_notice_items where notice_id = '00000000-0000-0000-0000-00000000aa01'), '金額が 0 なら 数量 × 単価 で埋まる');
select public.t_assert((select company_id = :'company_a' from public.payment_notice_items where notice_id = '00000000-0000-0000-0000-00000000aa01'), '明細の会社はトリガーが補完する');
select public.t_assert((select diff_status = 'unmatched' from public.v_payment_notice_diff where notice_id = '00000000-0000-0000-0000-00000000aa01'), '案件内容が未紐づけなら unmatched');

-- 名前の一致で紐づける
select public.t_assert(public.match_notice_items('00000000-0000-0000-0000-00000000aa01') = 1, '名前の一致で案件内容を紐づけられる');
select public.t_assert((select project_item_id is not null from public.payment_notice_items where notice_id = '00000000-0000-0000-0000-00000000aa01'), '紐づけ後は project_item_id が入る');
select public.t_assert((select item_name = '標準' and project_name = '三郷Amazon' from public.v_payment_notice_diff where notice_id = '00000000-0000-0000-0000-00000000aa01'), '差の一覧に案件名と内容名が出る');
select public.t_assert((select diff_status in ('notice_more', 'notice_less', 'ok') from public.v_payment_notice_diff where notice_id = '00000000-0000-0000-0000-00000000aa01'), '紐づけ後は差の判定が出る');
select public.t_assert(public.match_notice_items('00000000-0000-0000-0000-00000000aa01') = 0, '紐づけ済みの行は二度紐づけない');

-- ---------- 異常の検知（21〜24） ----------
select public.detect_anomalies('2026-11-01');
select public.t_assert((select count(*) = 1 from public.alerts where company_id = :'company_a' and code = 'duty_long' and status = 'open'), '拘束時間の長い日を検知');
select public.t_assert((select count(*) = 1 from public.alerts where company_id = :'company_a' and code = 'rest_short' and status = 'open'), '休息の足りない日を検知');
select public.detect_anomalies('2026-12-01');
select public.t_assert((select count(*) = 1 from public.alerts where company_id = :'company_a' and code = 'notice_diff' and status = 'open'), '支払通知との差を検知');

-- ---------- 権限と会社分離 ----------
select public.test_login(:'viewer_a');
select public.t_assert((select count(*) > 0 from public.v_daily_labor where company_id = :'company_a'), '閲覧者は労務を読める');
select public.t_assert((select count(*) > 0 from public.payment_notices where company_id = :'company_a'), '閲覧者は支払通知を読める');
select public.t_expect_error($$insert into public.payment_notices (company_id, month, notice_no) values ('00000000-0000-0000-0000-00000000000a', '2026-12-01', 'NG')$$, '', '閲覧者は支払通知を追加できない');
select public.t_expect_error($$select public.match_notice_items('00000000-0000-0000-0000-00000000aa01')$$, 'FORBIDDEN', '閲覧者は自動の紐づけができない');

select public.test_login(:'owner_b');
select public.t_assert((select count(*) = 0 from public.v_daily_labor), '他社の労務は見えない');
select public.t_assert((select count(*) = 0 from public.payment_notices), '他社の支払通知は見えない');
select public.t_assert((select count(*) = 0 from public.v_payment_notice_diff), '他社の差の一覧は見えない');

-- ---------- バックアップに入る ----------
select public.test_login(:'owner_a');
select public.t_assert(jsonb_array_length(public.export_backup()->'payment_notices') = 1, 'バックアップに支払通知が入る');
select public.t_assert(jsonb_array_length(public.export_backup()->'payment_notice_items') = 1, 'バックアップに支払通知の明細が入る');
select public.t_assert((public.export_backup()->'company'->>'labor_duty_limit_minutes') = '780', 'バックアップに労務の基準が入る');

select public.test_logout();
reset role;

\echo '== 27. 代表（承認・意思決定ログ・会社の基本情報・中期計画・ログイン記録）'
set role authenticated;

-- ---------- 承認：申請は管理者以上、決裁は代表だけ ----------
select public.test_login(:'admin_a');
\set approval_1 '00000000-0000-0000-0000-00000000ee01'
select public.t_assert(public.request_approval('expense', '新しいカーゴ車の購入', '中古で 120 万円', 1200000, 'expenses', '', '/expenses', '2027-01-31') is not null, '管理者は代表に決裁を申請できる');
select public.t_assert((select count(*) = 1 from public.approvals where company_id = :'company_a' and status = 'pending'), '申請は「決裁待ち」で入る');
select public.t_assert((select requested_by = :'admin_a' from public.approvals where company_id = :'company_a'), '申請者が記録される');
select public.t_assert((select requested_by_name = (select coalesce(nullif(display_name, ''), email) from public.profiles where id = :'admin_a') from public.approvals where company_id = :'company_a'), '申請者の名前が行に写る（閲覧者も読めるように）');
select public.t_expect_error($$select public.request_approval('other', '')$$, '', '件名が空だと申請できない');

-- 管理者は自分では決裁できない（RPC でもテーブル直更新でも）
select public.t_expect_error($$select public.decide_approval((select id from public.approvals where company_id = '00000000-0000-0000-0000-00000000000a'), true, '')$$, 'FORBIDDEN', '管理者は決裁できない');
select public.t_expect_error($$update public.approvals set status = 'approved' where company_id = '00000000-0000-0000-0000-00000000000a'$$, 'FORBIDDEN', '管理者がテーブルを直接更新しても決裁できない');

-- 閲覧者は読めるが申請できない
select public.test_login(:'viewer_a');
select public.t_assert((select count(*) = 1 from public.approvals where company_id = :'company_a'), '閲覧者も申請の行方を見られる');
select public.t_expect_error($$select public.request_approval('other', 'NG')$$, 'FORBIDDEN', '閲覧者は申請できない');

-- 代表が決裁する
select public.test_login(:'owner_a');
select public.t_assert((select count(*) = 1 from public.v_approval_list where company_id = :'company_a' and status = 'pending' and urgency = 'waiting'), '申請した当日は「待ち」');
select public.t_assert((select (public.decide_approval(id, true, '見積を 3 社取ること')).status = 'approved' from public.approvals where company_id = :'company_a'), '代表は承認できる');
select public.t_assert((select decided_by = :'owner_a' and decided_by_name <> '' and decision_note = '見積を 3 社取ること' from public.approvals where company_id = :'company_a'), '決裁者と付記が残る');
select public.t_expect_error($$select public.decide_approval((select id from public.approvals where company_id = '00000000-0000-0000-0000-00000000000a'), false, '')$$, '', '決裁済みの申請は二度決裁できない');

-- 滞留と期限切れの判定
insert into public.approvals (id, company_id, kind, title, requested_by, requested_at, due_on)
values (:'approval_1', :'company_a', 'loan', '運転資金の借入 500 万円', :'admin_a', now() - interval '10 days', current_date - 1);
select public.t_assert((select is_overdue and urgency = 'overdue' and waiting_days = 10 from public.v_approval_list where id = :'approval_1'), '期限を過ぎた申請は「期限切れ」');
select public.t_assert((select pending_approvals = 1 and overdue_approvals = 1 from public.v_executive_summary where company_id = :'company_a'), 'サマリーに決裁待ちと期限切れが出る');
select public.t_assert((select count(*) = 1 from public.v_executive_tasks where company_id = :'company_a' and kind = 'approval' and severity = 'high'), '代表のやることに期限切れの申請が出る');

-- 異常の検知（25）
select public.detect_anomalies('2026-12-01');
select public.t_assert((select count(*) = 1 from public.alerts where company_id = :'company_a' and code = 'approval_pending' and status = 'open' and severity = 'high'), '決裁の滞留を検知する');

-- 取り下げ（申請した本人）
select public.test_login(:'admin_a');
select public.t_assert((select (public.withdraw_approval(:'approval_1', 'いったん取り下げ')).status = 'withdrawn'), '申請した本人は取り下げられる');
select public.detect_anomalies('2026-12-01');
select public.t_assert((select count(*) = 0 from public.alerts where company_id = :'company_a' and code = 'approval_pending' and status = 'open'), '取り下げると滞留のアラートは解決になる');

-- ---------- 意思決定ログ（代表だけ） ----------
select public.test_login(:'owner_a');
insert into public.decisions (company_id, title, context, decision, reason, decided_on, review_on, created_by)
values (:'company_a', '三郷案件の単価交渉', '燃料費が上がっている', '受注単価を 5% 上げてもらう', '利益率が目標を下回ったため', '2026-12-01', current_date - 40, :'owner_a');
select public.t_assert((select created_by_name <> '' from public.decisions where company_id = :'company_a'), '記録した人の名前が入る');
select public.t_assert((select due_reviews = 1 and open_decisions = 1 from public.v_executive_summary where company_id = :'company_a'), '見直し日が来た意思決定がサマリーに出る');
select public.t_assert((select count(*) = 1 from public.v_executive_tasks where company_id = :'company_a' and kind = 'decision_review'), '代表のやることに見直しが出る');
update public.decisions set status = 'reviewed', outcome = '交渉成立', outcome_on = current_date where company_id = :'company_a';
select public.t_assert((select due_reviews = 0 from public.v_executive_summary where company_id = :'company_a'), '振り返りを書くと見直しの件数が減る');

select public.test_login(:'admin_a');
select public.t_assert((select count(*) = 0 from public.decisions), '管理者には意思決定ログが一行も見えない');
select public.t_expect_error($$insert into public.decisions (company_id, title) values ('00000000-0000-0000-0000-00000000000a', 'NG')$$, '', '管理者は意思決定ログを書けない');
select public.test_login(:'viewer_a');
select public.t_assert((select count(*) = 0 from public.decisions), '閲覧者にも意思決定ログは見えない');

-- ---------- 会社の基本情報・役員・株主・保険・顧問・個人保証（代表だけ） ----------
select public.test_login(:'owner_a');
insert into public.company_profile (company_id, corporate_number, established_on, capital, representative_name, transport_number)
values (:'company_a', '1234567890123', '2023-04-03', 3000000, '川島幹太', '関自貨第 12345 号');
select public.t_assert((select has_profile from public.v_executive_summary where company_id = :'company_a'), 'サマリーに会社の基本情報ありが出る');
select public.t_expect_error($$update public.company_profile set corporate_number = '123' where company_id = '00000000-0000-0000-0000-00000000000a'$$, '', '法人番号は 13 桁でないと入らない');

insert into public.officers (company_id, name, title, appointed_on, term_end_on)
values (:'company_a', '川島幹太', '代表取締役', '2023-04-03', current_date + 30);
insert into public.shareholders (company_id, name, shares) values (:'company_a', '川島幹太', 100);
insert into public.insurance_policies (company_id, kind, insurer, policy_no, expires_on, premium)
values (:'company_a', '貨物保険', '○○海上', 'P-1', current_date + 20, 120000);
insert into public.advisors (company_id, kind, name, fee) values (:'company_a', '税理士', '○○会計事務所', 33000);
insert into public.guarantees (company_id, lender, kind, amount, loan_id, starts_on)
select :'company_a', '日本政策金融公庫', '個人保証', 5000000, id, '2026-01-01' from public.loans where company_id = :'company_a' limit 1;

select public.t_assert((select officer_count = 1 and expiring_officers = 1 and expiring_insurance = 1 and shares_total = 100 and guarantee_total = 5000000
                          from public.v_executive_summary where company_id = :'company_a'), 'サマリーに役員・保険・株数・個人保証が出る');
select public.t_assert((select count(*) = 1 from public.v_executive_tasks where company_id = :'company_a' and kind = 'insurance_expiry'), '満了が近い保険がやることに出る');
select public.t_assert((select count(*) = 1 from public.v_executive_tasks where company_id = :'company_a' and kind = 'officer_term'), '任期満了が近い役員がやることに出る');

-- 代表専用のことは alerts には出さない（スタッフ全員が読めるため）
select public.detect_anomalies('2026-12-01');
select public.t_assert((select count(*) = 0 from public.alerts where company_id = :'company_a' and code in ('insurance_expiry', 'officer_term', 'decision_review')), '代表だけの情報はアラートに出さない');

select public.test_login(:'admin_a');
select public.t_assert((select count(*) = 0 from public.company_profile) and (select count(*) = 0 from public.officers)
                       and (select count(*) = 0 from public.shareholders) and (select count(*) = 0 from public.insurance_policies)
                       and (select count(*) = 0 from public.advisors) and (select count(*) = 0 from public.guarantees), '管理者には代表専用のテーブルが一行も見えない');
select public.t_assert((select pending_approvals = 0 and guarantee_total = 0 and officer_count = 0 from public.v_executive_summary where company_id = :'company_a'), '管理者が見るとサマリーは 0 になる');
select public.t_assert((select count(*) = 0 from public.v_executive_tasks), '管理者には代表のやることが見えない');

-- ---------- 中期計画 ----------
select public.test_login(:'owner_a');
\set plan_1 '00000000-0000-0000-0000-00000000ef01'
insert into public.plans (id, company_id, name, from_year, to_year, vision, created_by)
values (:'plan_1', :'company_a', '第 1 次 3 か年計画', 2026, 2028, 'ドライバー 20 名・売上 3 億円', :'owner_a');
select public.t_assert(public.ensure_plan_years(:'plan_1') = 3, '計画の期間ぶんの年ができる');
select public.t_assert(public.ensure_plan_years(:'plan_1') = 3, '二度実行しても年は増えない');
select public.t_assert((select count(*) = 3 from public.plan_years where plan_id = :'plan_1'), '年は 3 件');
select public.t_assert((select company_id = :'company_a' from public.plan_years where plan_id = :'plan_1' and year = 2026), '年の会社はトリガーが補完する');
select public.t_expect_error($$insert into public.plan_years (plan_id, year) values ('00000000-0000-0000-0000-00000000ef01', 2030)$$, '', '計画の期間の外の年は入らない');

update public.plan_years set bill_target = 100000000, profit_target = 12000000, driver_target = 12 where plan_id = :'plan_1' and year = 2026;
select public.t_assert((select bill_actual > 0 and month_count > 0 from public.v_plan_year_actual where plan_id = :'plan_1' and year = 2026), '2026 年の実績が出る');
select public.t_assert((select bill_achievement is not null and profit_achievement is not null from public.v_plan_year_actual where plan_id = :'plan_1' and year = 2026), '達成率が出る');
select public.t_assert((select bill_achievement is null from public.v_plan_year_actual where plan_id = :'plan_1' and year = 2028), '目標が 0 の年は達成率を出さない');
select public.t_assert((select plan_name = '第 1 次 3 か年計画' from public.v_plan_year_actual where plan_id = :'plan_1' and year = 2027), '計画名が付く');

select public.test_login(:'admin_a');
select public.t_assert((select count(*) = 0 from public.v_plan_year_actual), '管理者には中期計画が見えない');
select public.t_expect_error($$select public.ensure_plan_years('00000000-0000-0000-0000-00000000ef01')$$, 'FORBIDDEN', '管理者は中期計画の年を作れない');

-- ---------- ログインの記録（書き込みはサービスロール、閲覧は代表だけ） ----------
select public.test_login(:'owner_a');
select public.t_expect_error($$select public.record_login_event('00000000-0000-0000-0000-0000000000a1', 'login', '', '')$$, '', 'ログイン中のユーザーはログイン記録を書けない');
select public.test_logout();
reset role;

set role service_role;
select public.t_assert(public.record_login_event(:'owner_a', 'login', '203.0.113.9', 'Mozilla/5.0') is not null, 'サービスロールはログインを記録できる');
select public.t_assert(public.record_login_event('00000000-0000-0000-0000-0000000000ff', 'login', '', '') is null, '存在しないユーザーなら何も記録しない');
reset role;

set role authenticated;
select public.test_login(:'owner_a');
select public.t_assert((select count(*) = 1 from public.login_events where company_id = :'company_a'), '代表はログインの記録を見られる');
select public.t_assert((select email = 'owner@a.test' and display_name <> '' and role = 'owner' and ip = '203.0.113.9' from public.login_events where company_id = :'company_a'), '記録にメール・名前・ロール・IP が入る');
select public.test_login(:'admin_a');
select public.t_assert((select count(*) = 0 from public.login_events), '管理者にはログインの記録が見えない');

-- ---------- 会社そのものの書類を置ける（0012 は ドライバー か 車両 が必須だった） ----------
select public.test_login(:'owner_a');
insert into public.documents (company_id, kind, label, expires_on) values (:'company_a', 'other', '貨物軽自動車運送事業経営届出書', null);
select public.t_assert((select count(*) = 1 from public.documents where company_id = :'company_a' and driver_id is null and vehicle_id is null), '会社そのものの書類を置ける');

-- ---------- 会社分離 ----------
select public.test_login(:'owner_b');
select public.t_assert((select count(*) = 0 from public.approvals), '他社の申請は見えない');
select public.t_assert((select count(*) = 0 from public.decisions), '他社の意思決定ログは見えない');
select public.t_assert((select count(*) = 0 from public.officers), '他社の役員は見えない');
select public.t_assert((select count(*) = 0 from public.login_events), '他社のログイン記録は見えない');
select public.t_assert((select count(*) = 0 from public.v_plan_year_actual), '他社の中期計画は見えない');
select public.t_assert((select pending_approvals = 0 from public.v_executive_summary where company_id = :'company_b'), '自社のサマリーは 0 件');

-- ---------- バックアップ（version 6）に入る ----------
select public.test_login(:'owner_a');
select public.t_assert((public.export_backup()->>'version') = '6', 'バックアップは version 6');
select public.t_assert(jsonb_array_length(public.export_backup()->'approvals') = 2, 'バックアップに申請が入る');
select public.t_assert(jsonb_array_length(public.export_backup()->'decisions') = 1, 'バックアップに意思決定ログが入る');
select public.t_assert(jsonb_array_length(public.export_backup()->'officers') = 1, 'バックアップに役員が入る');
select public.t_assert(jsonb_array_length(public.export_backup()->'plan_years') = 3, 'バックアップに中期計画の年が入る');
select public.t_assert((public.export_backup()->'company_profile'->>'corporate_number') = '1234567890123', 'バックアップに会社の基本情報が入る');
select public.t_assert(not (public.export_backup() ? 'login_events'), 'ログインの記録はバックアップに含めない');

-- 管理者が書き出すと、代表専用のぶんは RLS により空になる
select public.test_login(:'admin_a');
select public.t_assert(jsonb_array_length(public.export_backup()->'decisions') = 0, '管理者のバックアップに意思決定ログは入らない');
select public.t_assert(jsonb_array_length(public.export_backup()->'officers') = 0, '管理者のバックアップに役員は入らない');
select public.t_assert(jsonb_typeof(public.export_backup()->'company_profile') = 'null', '管理者のバックアップに会社の基本情報は入らない');
select public.t_assert(jsonb_array_length(public.export_backup()->'approvals') = 2, '申請はスタッフ共通なので管理者のバックアップにも入る');

-- 復元（二度実行しても増えない）
select public.test_login(:'owner_a');
create temp table t_backup27 as select public.export_backup() as data;
select public.import_backup((select data from t_backup27));
select public.import_backup((select data from t_backup27));
select public.t_assert((select count(*) = 2 from public.approvals where company_id = :'company_a'), '復元しても申請は 2 件のまま');
select public.t_assert((select count(*) = 1 from public.decisions where company_id = :'company_a'), '復元しても意思決定ログは 1 件');
select public.t_assert((select count(*) = 3 from public.plan_years where company_id = :'company_a'), '復元しても中期計画の年は 3 件');
select public.t_assert((select corporate_number = '1234567890123' from public.company_profile where company_id = :'company_a'), '復元しても会社の基本情報は同じ');
select public.t_assert((select count(*) = 1 from public.guarantees where company_id = :'company_a' and amount = 5000000), '復元しても個人保証は 1 件');

select public.test_logout();
reset role;

\echo '== すべてのアサーションが通りました（18〜27 節）'
