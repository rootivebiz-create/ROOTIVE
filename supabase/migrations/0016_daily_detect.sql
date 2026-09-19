-- =============================================================================
-- 0016 異常の検知を毎日自動で回せるようにする
--   detect_anomalies は「ログイン中の会社」を前提にしていたため、cron（サービスロール）から呼べなかった。
--   会社 ID を引数で受け取る detect_anomalies_core（サービスロール専用）に中身を移し、
--   detect_anomalies は権限を確認して core を呼ぶだけにする。検知のルールは 0014 と同じ 20 種類。
-- =============================================================================

-- ---------- 中身（サービスロール専用。RLS を越えて会社を指定して検知する） ----------
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
  select count(*) into n from public.rate_diffs(p_month);
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
      from public.cash_forecast(current_date, (current_date + 30)::date);
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
      join public.drivers d on d.id = s.driver_id
     where s.company_id = cid and s.month = p_month and s.payout > 0
       and (d.bank_code = '' or d.branch_code = '' or d.account_number = '' or d.account_holder_kana = '')
  loop
    fp := public.record_alert(cid, p_month, 'bank_account_missing', 'low',
      r.driver_name || ' の口座情報が入っていません',
      '振込データ（全銀フォーマット）を作るには、銀行・支店・口座番号・カナ名義が必要です。',
      null, 'drivers', r.driver_id::text, '/settings/drivers/' || r.driver_id,
      'bank_account_missing:' || m || ':' || r.driver_id);
    fps := fps || fp;
  end loop;

  -- 検知しなくなったものは自動で解決済みにする
  update public.alerts
     set status = 'resolved', resolved_at = now(), updated_at = now()
   where company_id = cid and month = p_month and status = 'open' and not (fingerprint = any(fps));
  get diagnostics n = row_count;

  select count(*) into closed_n from public.alerts where company_id = cid and month = p_month and status = 'open';
  return jsonb_build_object('detected', coalesce(array_length(fps, 1), 0), 'open', closed_n, 'auto_resolved', n);
end $$;

-- ---------- 画面から呼ぶ入口（admin 以上・自社のみ） ----------
create or replace function public.detect_anomalies(p_month date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare cid uuid := public.current_company_id();
begin
  if not public.is_admin() then
    raise exception '権限がありません' using errcode = 'P0001', hint = 'FORBIDDEN';
  end if;
  if cid is null then
    raise exception '会社が特定できません' using errcode = 'P0001';
  end if;
  return public.detect_anomalies_core(cid, p_month);
end $$;

-- ---------- 権限 ----------
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;
grant execute on all functions in schema public to authenticated, service_role;

revoke all on public.integration_secrets from authenticated, anon, public;
grant all on public.integration_secrets to service_role;

revoke execute on function public.apply_invitation(uuid, text, text) from authenticated, anon, public;
revoke execute on function public.write_audit(uuid, text, text, text, jsonb, jsonb) from authenticated, anon, public;
revoke execute on function public.ensure_driver_month(uuid, date, uuid) from authenticated, anon, public;
revoke execute on function public.import_has_id_conflict(uuid, jsonb) from authenticated, anon, public;
revoke execute on function public.handle_new_auth_user() from authenticated, anon, public;
revoke execute on function public.default_expense_categories(uuid) from authenticated, anon, public;
revoke execute on function public.default_chat_channels(uuid) from authenticated, anon, public;
revoke execute on function public.recalc_invoice(uuid) from anon, public;
revoke execute on function public.line_consume_code(text, text, uuid) from authenticated, anon, public;
revoke execute on function public.sync_work_entry_from_days(uuid, date, uuid, uuid) from authenticated, anon, public;
-- 会社を指定して検知できるため、ログイン中のユーザーからは呼べないようにする
revoke execute on function public.detect_anomalies_core(uuid, date) from authenticated, anon, public;
