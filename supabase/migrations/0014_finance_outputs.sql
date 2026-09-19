-- =============================================================================
-- 0014 法人の経営管理と出力の土台
--   - 振込データ（全銀）に必要な口座情報：drivers の銀行口座、companies の依頼人情報
--   - 決算月と税務カレンダー（tax_tasks ＋ RPC ensure_tax_tasks）
--   - 借入金と返済予定（loans / loan_payments）→ 資金繰りに反映
--   - 年間予算（month_targets に経費とドライバー数を追加）
--   - 経営指標のビュー（v_month_kpi：限界利益・損益分岐点・1 人当たり）
--   - 契約書の保管（Storage: contracts）
-- =============================================================================

-- ---------- 列挙型 ----------
do $$ begin
  create type public.bank_account_type as enum ('ordinary','checking','savings');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.tax_task_status as enum ('todo','done','skipped');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.loan_status as enum ('active','paid','planned');
exception when duplicate_object then null; end $$;

-- =============================================================================
-- 銀行口座（振込データに使う）
-- =============================================================================
alter table public.drivers add column if not exists bank_code text not null default '';
alter table public.drivers add column if not exists bank_name text not null default '';
alter table public.drivers add column if not exists branch_code text not null default '';
alter table public.drivers add column if not exists branch_name text not null default '';
alter table public.drivers add column if not exists account_type public.bank_account_type;
alter table public.drivers add column if not exists account_number text not null default '';
alter table public.drivers add column if not exists account_holder_kana text not null default '';
alter table public.drivers drop constraint if exists drivers_bank_code_check;
alter table public.drivers add constraint drivers_bank_code_check check (bank_code = '' or bank_code ~ '^[0-9]{4}$');
alter table public.drivers drop constraint if exists drivers_branch_code_check;
alter table public.drivers add constraint drivers_branch_code_check check (branch_code = '' or branch_code ~ '^[0-9]{3}$');
alter table public.drivers drop constraint if exists drivers_account_number_check;
alter table public.drivers add constraint drivers_account_number_check check (account_number = '' or account_number ~ '^[0-9]{1,7}$');
comment on column public.drivers.account_holder_kana is '口座名義（半角カナ）。全銀の振込データに使う';

-- 会社（依頼人）の情報と決算月
alter table public.companies add column if not exists fiscal_month integer not null default 3;
alter table public.companies drop constraint if exists companies_fiscal_month_check;
alter table public.companies add constraint companies_fiscal_month_check check (fiscal_month between 1 and 12);
alter table public.companies add column if not exists fb_consignor_code text not null default '';
alter table public.companies add column if not exists fb_consignor_kana text not null default '';
alter table public.companies add column if not exists fb_bank_code text not null default '';
alter table public.companies add column if not exists fb_bank_name text not null default '';
alter table public.companies add column if not exists fb_branch_code text not null default '';
alter table public.companies add column if not exists fb_branch_name text not null default '';
alter table public.companies add column if not exists fb_account_type public.bank_account_type;
alter table public.companies add column if not exists fb_account_number text not null default '';
comment on column public.companies.fiscal_month is '決算月（1〜12）。税務カレンダーの期限を組み立てる';
comment on column public.companies.fb_consignor_code is '全銀の委託者コード（10 桁。銀行から指定される）';

-- =============================================================================
-- 税務・決算のカレンダー
-- =============================================================================
create table if not exists public.tax_tasks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  kind text not null check (length(kind) between 1 and 40),
  title text not null check (length(title) between 1 and 200),
  detail text not null default '',
  due_on date not null,
  status public.tax_task_status not null default 'todo',
  done_on date,
  amount numeric(14,2),
  memo text not null default '',
  is_generated boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, kind, due_on)
);
create index if not exists tax_tasks_company_idx on public.tax_tasks (company_id, due_on);
comment on table public.tax_tasks is '決算・税務・社会保険の期限（目安）。ensure_tax_tasks が決算月から組み立てる';

-- =============================================================================
-- 借入金と返済予定
-- =============================================================================
create table if not exists public.loans (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null check (length(name) between 1 and 100),
  lender text not null default '',
  principal numeric(14,2) not null default 0 check (principal >= 0),
  annual_rate numeric(6,4) not null default 0 check (annual_rate >= 0 and annual_rate <= 1),
  start_on date not null,
  months integer not null default 60 check (months between 1 and 600),
  payment_day integer not null default 0 check (payment_day between 0 and 31),
  monthly_payment numeric(14,2) not null default 0 check (monthly_payment >= 0),
  status public.loan_status not null default 'active',
  memo text not null default '',
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists loans_company_idx on public.loans (company_id, status, start_on);
comment on table public.loans is '借入金。返済予定（loan_payments）は generate_loan_schedule が作り、資金繰りに載る';

create table if not exists public.loan_payments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  loan_id uuid not null references public.loans(id) on delete cascade,
  seq integer not null check (seq >= 1),
  due_on date not null,
  principal numeric(14,2) not null default 0,
  interest numeric(14,2) not null default 0,
  total numeric(14,2) not null default 0,
  balance numeric(14,2) not null default 0,
  paid_on date,
  memo text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (loan_id, seq)
);
create index if not exists loan_payments_company_idx on public.loan_payments (company_id, due_on);
comment on table public.loan_payments is '返済予定の 1 回分。paid_on が入ると返済済み';

-- =============================================================================
-- 年間予算（月次目標の拡張）
-- =============================================================================
alter table public.month_targets add column if not exists expense_target numeric(14,2) not null default 0;
alter table public.month_targets add column if not exists driver_target integer not null default 0;
comment on column public.month_targets.expense_target is '経費の予算（税抜）';
comment on column public.month_targets.driver_target is '稼働ドライバー数の目標';

-- =============================================================================
-- トリガー
-- =============================================================================
do $$
declare t text;
begin
  foreach t in array array['tax_tasks','loans','loan_payments']
  loop
    execute format('drop trigger if exists t00_set_updated_at on public.%I', t);
    execute format('create trigger t00_set_updated_at before update on public.%I for each row execute function public.set_updated_at()', t);
    execute format('drop trigger if exists t90_audit on public.%I', t);
    execute format('create trigger t90_audit after insert or update or delete on public.%I for each row execute function public.audit_row_change()', t);
  end loop;
end $$;

-- 返済予定の company_id を借入から補完する
create or replace function public.fill_company_id_loan_payment()
returns trigger language plpgsql security definer set search_path = public as $$
declare c uuid;
begin
  select company_id into c from public.loans where id = new.loan_id;
  if c is null then
    raise exception '借入が見つかりません' using errcode = 'foreign_key_violation';
  end if;
  if new.company_id is null then
    new.company_id := c;
  elsif new.company_id <> c then
    raise exception '会社が一致しません' using errcode = 'check_violation';
  end if;
  return new;
end $$;
drop trigger if exists t01_fill_company_id on public.loan_payments;
create trigger t01_fill_company_id before insert or update on public.loan_payments
  for each row execute function public.fill_company_id_loan_payment();

-- =============================================================================
-- RLS
-- =============================================================================
do $$
declare t text;
begin
  foreach t in array array['tax_tasks','loans','loan_payments']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I_select on public.%I', t, t);
    execute format($p$create policy %I_select on public.%I for select to authenticated
      using (company_id = public.current_company_id() and public.is_staff())$p$, t, t);
    execute format('drop policy if exists %I_write on public.%I', t, t);
    execute format($p$create policy %I_write on public.%I for all to authenticated
      using (company_id = public.current_company_id() and public.is_admin())
      with check (company_id = public.current_company_id() and public.is_admin())$p$, t, t);
  end loop;
end $$;

-- =============================================================================
-- 資金繰りに借入の返済を載せる（cash_forecast を置き換える）
-- =============================================================================
create or replace function public.cash_forecast(p_from date, p_to date)
returns table (
  event_date date,
  kind text,
  label text,
  detail text,
  amount numeric,
  ref_id uuid,
  status text,
  month date
)
language sql stable security invoker set search_path = public as $$
  -- 入金予定（未入金の請求書）
  select coalesce(i.due_date, public.month_day_date(i.month, cl.payment_month_offset, cl.payment_day)) as event_date,
         'invoice'::text as kind,
         cl.name as label,
         i.invoice_no as detail,
         i.total as amount,
         i.id as ref_id,
         case when i.status = 'issued' then 'confirmed' else 'planned' end as status,
         i.month
    from public.invoices i
    join public.clients cl on cl.id = i.client_id
   where i.status <> 'paid'
     and coalesce(i.due_date, public.month_day_date(i.month, cl.payment_month_offset, cl.payment_day)) between p_from and p_to
  union all
  -- 入金の実績
  select i.paid_on, 'invoice', cl.name, i.invoice_no || '（入金済み）', i.total, i.id, 'done', i.month
    from public.invoices i
    join public.clients cl on cl.id = i.client_id
   where i.status = 'paid' and i.paid_on is not null and i.paid_on between p_from and p_to
  union all
  -- ドライバーへの支払予定（税込）
  select public.month_day_date(s.month, coalesce(d.payout_month_offset, c.payout_month_offset), coalesce(d.payout_day, c.payout_day)),
         'payout',
         s.driver_name,
         to_char(s.month, 'YYYY年MM月') || 'の支払',
         -s.payout_incl,
         s.driver_id,
         case when s.is_closed then 'confirmed' else 'planned' end,
         s.month
    from public.v_driver_month_summary s
    join public.drivers d on d.id = s.driver_id
    join public.companies c on c.id = s.company_id
   where s.payout_incl <> 0
     and public.month_day_date(s.month, coalesce(d.payout_month_offset, c.payout_month_offset), coalesce(d.payout_day, c.payout_day)) between p_from and p_to
  union all
  -- 登録済みの経費（発生日が無ければ月末）
  select coalesce(e.incurred_on, public.month_day_date(e.month, 0, 0)), 'expense', ec.name, e.label, -e.amount, e.id, 'done', e.month
    from public.expenses e
    join public.expense_categories ec on ec.id = e.category_id
   where coalesce(e.incurred_on, public.month_day_date(e.month, 0, 0)) between p_from and p_to
  union all
  -- これから計上される固定費（まだその月に計上されていないもの）
  select public.month_day_date(m.month, 0, coalesce(r.payment_day, 0)), 'expense', ec.name, r.label || '（予定）', -r.amount, r.id, 'planned', m.month
    from public.recurring_expenses r
    join public.expense_categories ec on ec.id = r.category_id
    cross join lateral (
      select generate_series(date_trunc('month', p_from), date_trunc('month', p_to), interval '1 month')::date as month
    ) m
   where r.is_active
     and (r.start_month is null or r.start_month <= m.month)
     and (r.end_month is null or r.end_month >= m.month)
     and not exists (
       select 1 from public.expenses e
        where e.company_id = r.company_id and e.month = m.month and e.recurring_id = r.id
     )
     and public.month_day_date(m.month, 0, coalesce(r.payment_day, 0)) between p_from and p_to
  union all
  -- 借入の返済予定（0014）。返済済みは実績として出す
  select lp.due_on, 'loan', l.name, l.lender || ' 第 ' || lp.seq || ' 回',
         -lp.total, l.id,
         case when lp.paid_on is not null then 'done' else 'planned' end,
         date_trunc('month', lp.due_on)::date
    from public.loan_payments lp
    join public.loans l on l.id = lp.loan_id
   where l.status <> 'planned' and lp.due_on between p_from and p_to
  order by 1, 2, 3;
$$;

-- =============================================================================
-- ビュー
-- =============================================================================
drop view if exists public.v_month_kpi, public.v_loan_list, public.v_loan_payment_list, public.v_tax_task_list cascade;

-- 会社 × 月の経営指標
--   限界利益 ＝ 会社売上 −（ドライバー支払 − ロイヤリティ）− 変動費
--   損益分岐点売上高 ＝（固定費 − 管理費 − 利益計上の調整）÷ 限界利益率
create view public.v_month_kpi
with (security_invoker = true) as
with base as (
  select
    pl.company_id,
    pl.month,
    pl.status,
    pl.bill,
    pl.pay,
    pl.royalty,
    pl.margin,
    pl.mgmt_fee,
    pl.adj_profit,
    pl.payout,
    pl.payout_incl,
    pl.profit,
    pl.expense_total,
    pl.expense_fixed,
    pl.expense_variable,
    pl.operating_profit,
    pl.operating_margin,
    pl.bill_target,
    pl.profit_target,
    pl.entry_count,
    pl.active_driver_count,
    pl.driver_count,
    coalesce(t.expense_target, 0) as expense_target,
    coalesce(t.driver_target, 0) as driver_target,
    coalesce(ds.work_day_count, 0) as work_day_count,
    (pl.margin + pl.royalty - pl.expense_variable) as contribution,
    (pl.expense_fixed - pl.mgmt_fee - pl.adj_profit) as net_fixed_cost
  from public.v_month_pl pl
  left join public.month_targets t on t.company_id = pl.company_id and t.month = pl.month
  left join public.v_day_status ds on ds.company_id = pl.company_id and ds.month = pl.month
)
select
  b.*,
  case when b.bill <> 0 then round(b.contribution / b.bill, 6) else 0 end as contribution_rate,
  case when b.bill <> 0 then round(b.payout / b.bill, 6) else 0 end as payout_rate,
  case
    when b.bill <> 0 and b.contribution > 0 then round(b.net_fixed_cost / (b.contribution / b.bill), 2)
    else 0
  end as break_even_bill,
  case
    when b.bill <> 0 and b.contribution > 0 and b.net_fixed_cost > 0
      then round(b.bill / nullif(b.net_fixed_cost / (b.contribution / b.bill), 0), 6)
    else null
  end as break_even_ratio,
  case when b.active_driver_count > 0 then round(b.bill / b.active_driver_count, 2) else 0 end as bill_per_driver,
  case when b.active_driver_count > 0 then round(b.profit / b.active_driver_count, 2) else 0 end as profit_per_driver,
  case when b.work_day_count > 0 then round(b.bill / b.work_day_count, 2) else 0 end as bill_per_work_day,
  case when b.expense_target <> 0 then round(b.expense_total / b.expense_target, 6) else null end as expense_achievement,
  case when b.bill_target <> 0 then round(b.bill / b.bill_target, 6) else null end as bill_achievement,
  case when b.profit_target <> 0 then round(b.operating_profit / b.profit_target, 6) else null end as profit_achievement
from base b;

comment on view public.v_month_kpi is '会社 × 月の経営指標（限界利益・損益分岐点・1 人当たり・予算達成率）';

-- 借入の一覧（残高と次回返済）
create view public.v_loan_list
with (security_invoker = true) as
select
  l.*,
  coalesce(p.total_count, 0)::integer as payment_count,
  coalesce(p.paid_count, 0)::integer as paid_count,
  coalesce(p.remaining_principal, 0) as remaining_principal,
  coalesce(p.paid_principal, 0) as paid_principal,
  coalesce(p.total_interest, 0) as total_interest,
  n.due_on as next_due_on,
  n.total as next_total,
  f.due_on as final_due_on
from public.loans l
left join lateral (
  select count(*) as total_count,
         count(*) filter (where paid_on is not null) as paid_count,
         coalesce(sum(principal) filter (where paid_on is null), 0) as remaining_principal,
         coalesce(sum(principal) filter (where paid_on is not null), 0) as paid_principal,
         coalesce(sum(interest), 0) as total_interest
    from public.loan_payments where loan_id = l.id
) p on true
left join lateral (
  select due_on, total from public.loan_payments
   where loan_id = l.id and paid_on is null order by due_on limit 1
) n on true
left join lateral (
  select due_on from public.loan_payments where loan_id = l.id order by due_on desc limit 1
) f on true;

-- 返済予定の一覧（借入名つき）
create view public.v_loan_payment_list
with (security_invoker = true) as
select
  p.*,
  l.name as loan_name,
  l.lender,
  (p.paid_on is not null) as is_paid,
  case when p.paid_on is null and p.due_on < current_date then true else false end as is_overdue
from public.loan_payments p
join public.loans l on l.id = p.loan_id;

-- 税務・決算の期限（残り日数つき）
create view public.v_tax_task_list
with (security_invoker = true) as
select
  t.*,
  (t.due_on - current_date) as days_left,
  case
    when t.status <> 'todo' then 'done'
    when t.due_on < current_date then 'overdue'
    when t.due_on <= current_date + 30 then 'soon'
    else 'future'
  end as urgency
from public.tax_tasks t;

-- =============================================================================
-- RPC：返済予定の生成（元利均等）
-- =============================================================================
create or replace function public.generate_loan_schedule(p_loan_id uuid)
returns integer language plpgsql security invoker set search_path = public as $$
declare
  l record;
  cid uuid := public.current_company_id();
  r numeric;          -- 月利
  pay numeric;        -- 毎月の返済額
  bal numeric;
  i integer;
  due date;
  interest numeric;
  principal numeric;
  n integer := 0;
begin
  if not public.is_admin() then
    raise exception '権限がありません' using errcode = 'P0001', hint = 'FORBIDDEN';
  end if;
  select * into l from public.loans where id = p_loan_id and company_id = cid;
  if l is null then
    raise exception '借入が見つかりません' using errcode = 'P0001';
  end if;

  delete from public.loan_payments where loan_id = p_loan_id and paid_on is null;

  r := l.annual_rate / 12;
  if l.monthly_payment > 0 then
    pay := l.monthly_payment;
  elsif r = 0 then
    pay := round(l.principal / l.months, 0);
  else
    pay := round(l.principal * r / (1 - power(1 + r, -l.months)), 0);
  end if;

  bal := l.principal;
  for i in 1 .. l.months loop
    exit when bal <= 0;
    due := public.month_day_date((date_trunc('month', l.start_on) + (i || ' month')::interval)::date, 0, l.payment_day);
    interest := round(bal * r, 0);
    principal := least(pay - interest, bal);
    if principal <= 0 then
      principal := bal;  -- 利息が返済額を超える場合は残額を一括
    end if;
    if i = l.months then
      principal := bal;  -- 端数は最終回でまとめて返す（残高をきっちり 0 にする）
    end if;
    bal := bal - principal;

    insert into public.loan_payments (company_id, loan_id, seq, due_on, principal, interest, total, balance)
    values (cid, p_loan_id, i, due, principal, interest, principal + interest, bal)
    on conflict (loan_id, seq) do update
      set due_on = excluded.due_on, principal = excluded.principal, interest = excluded.interest,
          total = excluded.total, balance = excluded.balance, updated_at = now()
      where public.loan_payments.paid_on is null;
    n := n + 1;
  end loop;
  return n;
end $$;

-- =============================================================================
-- RPC：決算・税務のカレンダーを組み立てる（決算月から。目安なので画面で直せる）
-- =============================================================================
create or replace function public.ensure_tax_tasks(p_year integer)
returns integer language plpgsql security invoker set search_path = public as $$
declare
  cid uuid := public.current_company_id();
  fm integer;
  fiscal_end date;      -- その年に到来する決算日
  n integer := 0;
  v record;
begin
  if not public.is_admin() then
    raise exception '権限がありません' using errcode = 'P0001', hint = 'FORBIDDEN';
  end if;
  if p_year < 2000 or p_year > 2100 then
    raise exception '年の指定が不正です' using errcode = 'P0001';
  end if;
  select fiscal_month into fm from public.companies where id = cid;
  fm := coalesce(fm, 3);
  -- 決算日 ＝ その年の決算月の末日
  fiscal_end := (make_date(p_year, fm, 1) + interval '1 month - 1 day')::date;

  for v in
    select * from (values
      ('corporate_tax_final',
       '法人税・地方税の確定申告と納付',
       '決算日の翌日から 2 か月以内。延長の特例を受けている場合は 3 か月以内です。',
       (date_trunc('month', fiscal_end + interval '2 month') + interval '1 month - 1 day')::date),
      ('consumption_tax_final',
       '消費税の確定申告と納付',
       '決算日の翌日から 2 か月以内。',
       (date_trunc('month', fiscal_end + interval '2 month') + interval '1 month - 1 day')::date),
      ('corporate_tax_interim',
       '法人税の中間申告・納付（前期の納税額が 20 万円超の場合）',
       '決算日の翌日から 8 か月以内。対象外なら「対象外」にしてください。',
       (date_trunc('month', fiscal_end + interval '8 month') + interval '1 month - 1 day')::date),
      ('withholding_jan',
       '源泉所得税の納付（納期の特例：7〜12 月分）',
       '納期の特例の承認を受けている場合。受けていなければ毎月 10 日です。',
       make_date(p_year, 1, 20)),
      ('withholding_jul',
       '源泉所得税の納付（納期の特例：1〜6 月分）',
       '納期の特例の承認を受けている場合。',
       make_date(p_year, 7, 10)),
      ('depreciable_assets',
       '償却資産申告（市区町村）',
       '1 月 1 日時点の償却資産を申告します。',
       make_date(p_year, 1, 31)),
      ('legal_records',
       '法定調書合計表・給与支払報告書の提出',
       '前年分をまとめて提出します。',
       make_date(p_year, 1, 31)),
      ('labor_insurance',
       '労働保険の年度更新',
       '6 月 1 日から 7 月 10 日まで。',
       make_date(p_year, 7, 10)),
      ('social_insurance',
       '社会保険の算定基礎届',
       '7 月 10 日まで。',
       make_date(p_year, 7, 10)),
      ('year_end_adjustment',
       '年末調整',
       '12 月の給与支払時までに書類を集めます。',
       make_date(p_year, 12, 20))
    ) as t(kind, title, detail, due_on)
  loop
    insert into public.tax_tasks (company_id, kind, title, detail, due_on, is_generated)
    values (cid, v.kind, v.title, v.detail, v.due_on, true)
    on conflict (company_id, kind, due_on) do nothing;
    if found then n := n + 1; end if;
  end loop;
  return n;
end $$;

-- =============================================================================
-- Storage：契約書（非公開。締結済みの業務委託契約書の PDF・画像を保管する）
-- =============================================================================
insert into storage.buckets (id, name, public)
values ('contracts', 'contracts', false)
on conflict (id) do nothing;

drop policy if exists contracts_file_select on storage.objects;
create policy contracts_file_select on storage.objects for select to authenticated
  using (bucket_id = 'contracts' and (storage.foldername(name))[1] = public.current_company_id()::text and public.is_staff());
drop policy if exists contracts_file_insert on storage.objects;
create policy contracts_file_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'contracts' and (storage.foldername(name))[1] = public.current_company_id()::text and public.is_admin());
drop policy if exists contracts_file_delete on storage.objects;
create policy contracts_file_delete on storage.objects for delete to authenticated
  using (bucket_id = 'contracts' and (storage.foldername(name))[1] = public.current_company_id()::text and public.is_admin());

-- =============================================================================
-- 異常の検知に「税務の期限」と「契約の期限」を追加する（17〜19 番。0012 を置き換える）
-- =============================================================================
create or replace function public.detect_anomalies(p_month date)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  cid uuid := public.current_company_id();
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
  if not public.is_admin() then
    raise exception '権限がありません' using errcode = 'P0001', hint = 'FORBIDDEN';
  end if;
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

-- =============================================================================
-- データ全削除に 0014 のテーブルを追加（reset_company_data を置き換える）
-- =============================================================================
create or replace function public.reset_company_data(p_company_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  cid uuid := public.current_company_id();
  actual text;
  counts jsonb := '{}'::jsonb;
  n integer;
begin
  if not public.is_owner() then
    raise exception 'データ全削除はオーナーのみ可能です' using errcode = 'P0001', hint = 'OWNER_ONLY';
  end if;
  select name into actual from public.companies where id = cid;
  if actual is null or actual <> p_company_name then
    raise exception '会社名が一致しません' using errcode = 'P0001', hint = 'NAME_MISMATCH';
  end if;
  perform set_config('app.bypass_closing', 'on', true);
  perform set_config('app.skip_audit', 'on', true);
  delete from public.bank_transactions where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('bank_transactions', n);
  delete from public.bank_imports where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('bank_imports', n);
  delete from public.alerts where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('alerts', n);
  delete from public.invoice_items where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('invoice_items', n);
  delete from public.invoices where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('invoices', n);
  delete from public.expenses where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('expenses', n);
  delete from public.recurring_expenses where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('recurring_expenses', n);
  delete from public.month_targets where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('month_targets', n);
  delete from public.cash_snapshots where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('cash_snapshots', n);
  delete from public.loan_payments where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('loan_payments', n);
  delete from public.loans where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('loans', n);
  delete from public.tax_tasks where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('tax_tasks', n);
  delete from public.import_runs where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('import_runs', n);
  delete from public.import_profiles where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('import_profiles', n);
  delete from public.applicant_events where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('applicant_events', n);
  delete from public.applicants where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('applicants', n);
  delete from public.contracts where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('contracts', n);
  delete from public.work_day_entries where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('work_day_entries', n);
  delete from public.daily_reports where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('daily_reports', n);
  delete from public.incidents where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('incidents', n);
  delete from public.driver_instructions where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('driver_instructions', n);
  delete from public.documents where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('documents', n);
  delete from public.safety_managers where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('safety_managers', n);
  delete from public.adjustments where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('adjustments', n);
  delete from public.work_entries where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('work_entries', n);
  delete from public.driver_months where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('driver_months', n);
  delete from public.month_closings where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('month_closings', n);
  delete from public.ai_messages where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('ai_messages', n);
  delete from public.ai_conversations where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('ai_conversations', n);
  delete from public.ai_insights where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('ai_insights', n);
  delete from public.driver_pay_overrides where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('driver_pay_overrides', n);
  delete from public.driver_recurring_adjustments where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('driver_recurring_adjustments', n);
  delete from public.line_link_codes where company_id = cid;
  -- ドライバー本人のユーザーは、対応ドライバーが消えるため「無効な閲覧者」に変更する（再招待で復帰できる）
  perform set_config('app.bypass_profile_guard', 'on', true);
  update public.profiles set role = 'viewer', driver_id = null, is_active = false where company_id = cid and role = 'driver';
  update public.profiles set driver_id = null where company_id = cid and driver_id is not null;
  perform set_config('app.bypass_profile_guard', 'off', true);
  delete from public.invitations where company_id = cid and role = 'driver';
  update public.invitations set driver_id = null where company_id = cid and driver_id is not null;
  delete from public.project_items where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('project_items', n);
  delete from public.projects where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('projects', n);
  delete from public.vehicles where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('vehicles', n);
  delete from public.drivers where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('drivers', n);
  delete from public.clients where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('clients', n);
  -- 経費カテゴリ・チャットのルーム・外部連携の設定は残す
  perform set_config('app.skip_audit', 'off', true);
  perform set_config('app.bypass_closing', 'off', true);
  perform set_config('app.audit_internal', 'on', true);
  perform public.write_audit(cid, 'reset_company_data', 'company', cid::text, counts, null);
  perform set_config('app.audit_internal', 'off', true);
  return counts;
end $$;

-- =============================================================================
-- 権限（0006 と同じ方針を 0014 で追加したテーブル・ビューにも適用する）
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
