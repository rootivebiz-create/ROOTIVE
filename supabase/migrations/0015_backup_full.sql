-- =============================================================================
-- 0015 バックアップと復元を「全テーブル」に広げる
--   0011〜0014 で足したテーブルがバックアップ JSON に入っていなかったため、
--   運行管理・法令対応の記録（点呼・日別の稼働・車両・書類）や採用・契約・借入・税務の期限が
--   バックアップから復元できなかった。export_backup / import_has_id_conflict / import_backup を置き換える。
--   会社の決算月と振込元、ドライバーの振込先口座（0014）も復元されるようにする。
--   ・AI と社内チャット、外部連携の設定・トークン、銀行明細、監査ログ、アラートは含めない
--     （トークンは絶対に書き出さない。アラートは detect_anomalies で作り直せる）
--   ・Storage のファイル（ロゴ・認印・レシート・契約書）は JSON に含まれないためパスのみ復元する
-- =============================================================================

-- ---------- 書き出し（admin 以上） ----------
create or replace function public.export_backup()
returns jsonb language plpgsql security invoker set search_path = public as $$
declare cid uuid := public.current_company_id();
begin
  if not public.is_admin() then
    raise exception '権限がありません' using errcode = 'P0001', hint = 'FORBIDDEN';
  end if;
  return jsonb_build_object(
    'version', 4,
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
    'driver_instructions', (select coalesce(jsonb_agg(to_jsonb(x) order by x.instructed_on), '[]'::jsonb) from public.driver_instructions x where x.company_id = cid),
    'incidents', (select coalesce(jsonb_agg(to_jsonb(x) order by x.occurred_at), '[]'::jsonb) from public.incidents x where x.company_id = cid),
    -- 0013 取り込みと採用・契約
    'import_profiles', (select coalesce(jsonb_agg(to_jsonb(x) order by x.name), '[]'::jsonb) from public.import_profiles x where x.company_id = cid),
    'applicants', (select coalesce(jsonb_agg(to_jsonb(x) order by x.applied_on), '[]'::jsonb) from public.applicants x where x.company_id = cid),
    'applicant_events', (select coalesce(jsonb_agg(to_jsonb(x) order by x.applicant_id, x.happened_on), '[]'::jsonb) from public.applicant_events x where x.company_id = cid),
    'contracts', (select coalesce(jsonb_agg(to_jsonb(x) order by x.start_on), '[]'::jsonb) from public.contracts x where x.company_id = cid),
    -- 0014 法人の経営管理
    'tax_tasks', (select coalesce(jsonb_agg(to_jsonb(x) order by x.due_on), '[]'::jsonb) from public.tax_tasks x where x.company_id = cid),
    'loans', (select coalesce(jsonb_agg(to_jsonb(x) order by x.start_on), '[]'::jsonb) from public.loans x where x.company_id = cid),
    'loan_payments', (select coalesce(jsonb_agg(to_jsonb(x) order by x.loan_id, x.seq), '[]'::jsonb) from public.loan_payments x where x.company_id = cid)
  );
end $$;

-- ---------- ID 衝突チェックに 0012〜0014 のテーブルを追加 ----------
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
    or exists (select 1 from jsonb_array_elements(coalesce(p_data->'loan_payments','[]')) x join public.loan_payments t on t.id = (x->>'id')::uuid where t.company_id <> p_company_id);
$$;

-- ---------- 復元／取り込みを全テーブルに広げる（import_backup を置き換え） ----------
-- 復元／取り込み（owner）。ID 一致は上書き、他社の ID と衝突すれば拒否。締めガード・行単位監査は一時的に回避
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
      fb_account_number = coalesce(c->>'fb_account_number', fb_account_number)
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
                              tax_mode, invoice_reg_no, payout_month_offset, payout_day,
                              bank_code, bank_name, branch_code, branch_name, account_type, account_number, account_holder_kana)
  select (x->>'id')::uuid, cid, x->>'name', coalesce(x->>'kana',''), coalesce((x->>'is_active')::boolean, true),
         (x->>'royalty_rate')::numeric, coalesce((x->>'mgmt_fee')::numeric, 0), (x->>'rounding_mode')::public.rounding_mode,
         coalesce(x->>'phone',''), coalesce(x->>'email',''), coalesce(x->>'bank_info',''), coalesce(x->>'memo',''), coalesce((x->>'sort_order')::integer, 0),
         coalesce((x->>'tax_mode')::public.tax_mode, 'taxable'), coalesce(x->>'invoice_reg_no',''), (x->>'payout_month_offset')::integer, (x->>'payout_day')::integer,
         coalesce(x->>'bank_code',''), coalesce(x->>'bank_name',''), coalesce(x->>'branch_code',''), coalesce(x->>'branch_name',''),
         (x->>'account_type')::public.bank_account_type, coalesce(x->>'account_number',''), coalesce(x->>'account_holder_kana','')
    from jsonb_array_elements(coalesce(p_data->'drivers','[]')) x
  on conflict (id) do update set
    name = excluded.name, kana = excluded.kana, is_active = excluded.is_active, royalty_rate = excluded.royalty_rate,
    mgmt_fee = excluded.mgmt_fee, rounding_mode = excluded.rounding_mode, phone = excluded.phone, email = excluded.email,
    bank_info = excluded.bank_info, memo = excluded.memo, sort_order = excluded.sort_order,
    tax_mode = excluded.tax_mode, invoice_reg_no = excluded.invoice_reg_no, payout_month_offset = excluded.payout_month_offset, payout_day = excluded.payout_day,
    bank_code = excluded.bank_code, bank_name = excluded.bank_name, branch_code = excluded.branch_code, branch_name = excluded.branch_name,
    account_type = excluded.account_type, account_number = excluded.account_number, account_holder_kana = excluded.account_holder_kana;
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

  perform set_config('app.skip_audit', 'off', true);
  perform set_config('app.bypass_closing', 'off', true);
  perform set_config('app.audit_internal', 'on', true);
  perform public.write_audit(cid, 'import_backup', 'company', cid::text, null, counts);
  perform set_config('app.audit_internal', 'off', true);
  return counts;
end $$;

-- =============================================================================
-- 権限（0006 と同じ方針）
-- =============================================================================
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
