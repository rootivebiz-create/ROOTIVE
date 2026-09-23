-- =============================================================================
-- 0026 事務（/office）
--
--   事務の仕事は 10 画面以上に散らばっていた（稼働報告の承認は日報・点呼、休み希望は配車、
--   消込は入金、月締めは設定 → 月締め …）。しかも月締めには手順の案内が無く、
--   「締める」ボタンの付いた表しかなかった。1 画面で「今日やること」と「月締めの手順」が
--   分かるようにする。
--
--   1. month_close_checks  月締めの手順のうち、アプリが判定できないもの（支払明細を送った・振込を済ませた など）
--                          のチェック。誰がいつ付けたかを残す。締めた月は変えられない
--   2. report_reminders    「今日の報告がまだ」の催促。1 人 1 日 1 回まで（送りすぎない）
--   3. profiles.start_page 最初に開く画面（ホーム／事務）
--   4. office_desk()       事務の画面が使う行と事実を 1 往復で返す。**判定はアプリの純関数**（lib/office）
--   5. nav_badges()        「事務」のバッジ（承認待ちの稼働報告 ＋ 休み希望）を足す
-- =============================================================================

-- ---------- 3. 最初に開く画面 ----------
alter table public.profiles add column if not exists start_page text not null default 'dashboard';
do $$ begin
  alter table public.profiles add constraint profiles_start_page_check check (start_page in ('dashboard', 'office'));
exception when duplicate_object then null; end $$;
comment on column public.profiles.start_page is '最初に開く画面（dashboard＝ホーム／office＝事務）';

create or replace function public.set_start_page(p_start_page text)
returns text language plpgsql security invoker set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'ログインが必要です' using errcode = 'P0001', hint = 'FORBIDDEN';
  end if;
  if p_start_page not in ('dashboard', 'office') then
    raise exception '最初に開く画面の指定が正しくありません' using errcode = 'P0001', hint = 'INVALID';
  end if;
  -- 事務は登録・編集ができる人のための画面（閲覧者・ドライバーは選べない）
  if p_start_page = 'office' and not public.is_admin() then
    raise exception '事務の画面は管理者以上が使えます' using errcode = 'P0001', hint = 'FORBIDDEN';
  end if;
  update public.profiles set start_page = p_start_page where id = uid;
  return p_start_page;
end $$;

comment on function public.set_start_page(text) is '自分の最初に開く画面を変える（profiles の RLS がそのまま効く）';

-- ---------- 1. 月締めの手順のチェック ----------
create table if not exists public.month_close_checks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  month date not null check (month = date_trunc('month', month)::date),
  key text not null check (key ~ '^[a-z_]{1,40}$'),
  done_at timestamptz not null default now(),
  done_by uuid references public.profiles (id) on delete set null default auth.uid(),
  done_by_name text not null default '',
  unique (company_id, month, key)
);
comment on table public.month_close_checks is '月締めの手順のうち手で確かめるもの（支払明細の送付・振込など）。誰がいつ付けたか';

create index if not exists month_close_checks_company_month_idx on public.month_close_checks (company_id, month);

alter table public.month_close_checks enable row level security;
drop policy if exists month_close_checks_select on public.month_close_checks;
create policy month_close_checks_select on public.month_close_checks for select to authenticated
  using (company_id = public.current_company_id() and public.is_staff());
drop policy if exists month_close_checks_write on public.month_close_checks;
create policy month_close_checks_write on public.month_close_checks for all to authenticated
  using (company_id = public.current_company_id() and public.is_admin())
  with check (company_id = public.current_company_id() and public.is_admin());

-- 締めた月のチェックは変えられない（0002 の共通の番人をそのまま使う）
drop trigger if exists t05_guard_month_closed on public.month_close_checks;
create trigger t05_guard_month_closed before insert or update or delete on public.month_close_checks
  for each row execute function public.guard_month_closed();

-- 付けた人の名前を写す（閲覧者は他人の profiles を読めないため。chat_messages と同じ考え方）
create or replace function public.fill_close_check_name()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.done_by is null then
    new.done_by := auth.uid();
  end if;
  select coalesce(nullif(p.display_name, ''), p.email, '') into new.done_by_name
    from public.profiles p where p.id = new.done_by;
  new.done_by_name := coalesce(new.done_by_name, '');
  return new;
end $$;
drop trigger if exists t10_fill_close_check_name on public.month_close_checks;
create trigger t10_fill_close_check_name before insert on public.month_close_checks
  for each row execute function public.fill_close_check_name();

-- チェックを付ける／外す（admin 以上。締めた月は番人が止める）
create or replace function public.set_close_check(p_month date, p_key text, p_done boolean)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  cid uuid := public.current_company_id();
  m date := date_trunc('month', p_month)::date;
  r public.month_close_checks;
begin
  if cid is null or not public.is_admin() then
    raise exception '権限がありません' using errcode = 'P0001', hint = 'FORBIDDEN';
  end if;
  if p_key is null or p_key !~ '^[a-z_]{1,40}$' then
    raise exception '手順の指定が正しくありません' using errcode = 'P0001', hint = 'INVALID';
  end if;
  if coalesce(p_done, false) then
    insert into public.month_close_checks (company_id, month, key)
    values (cid, m, p_key)
    on conflict (company_id, month, key) do nothing;
    select * into r from public.month_close_checks where company_id = cid and month = m and key = p_key;
    return jsonb_build_object('key', r.key, 'done_at', r.done_at, 'done_by_name', r.done_by_name);
  end if;
  delete from public.month_close_checks where company_id = cid and month = m and key = p_key;
  return null;
end $$;

comment on function public.set_close_check(date, text, boolean) is '月締めの手作業の手順にチェックを付ける／外す（admin 以上・締めた月は不可）';

-- ---------- 2. 今日の報告の催促 ----------
create table if not exists public.report_reminders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  driver_id uuid not null references public.drivers (id) on delete cascade,
  work_date date not null,
  sent_at timestamptz not null default now(),
  sent_by uuid references public.profiles (id) on delete set null default auth.uid(),
  sent_by_name text not null default '',
  unique (company_id, driver_id, work_date)
);
comment on table public.report_reminders is '「今日の報告がまだ」の催促の記録（1 人 1 日 1 回まで）';

create index if not exists report_reminders_company_date_idx on public.report_reminders (company_id, work_date);

alter table public.report_reminders enable row level security;
drop policy if exists report_reminders_select on public.report_reminders;
create policy report_reminders_select on public.report_reminders for select to authenticated
  using (company_id = public.current_company_id() and public.is_staff());
drop policy if exists report_reminders_write on public.report_reminders;
create policy report_reminders_write on public.report_reminders for all to authenticated
  using (company_id = public.current_company_id() and public.is_admin())
  with check (company_id = public.current_company_id() and public.is_admin());

create or replace function public.fill_reminder_name()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.sent_by is null then
    new.sent_by := auth.uid();
  end if;
  select coalesce(nullif(p.display_name, ''), p.email, '') into new.sent_by_name
    from public.profiles p where p.id = new.sent_by;
  new.sent_by_name := coalesce(new.sent_by_name, '');
  return new;
end $$;
drop trigger if exists t10_fill_reminder_name on public.report_reminders;
create trigger t10_fill_reminder_name before insert on public.report_reminders
  for each row execute function public.fill_reminder_name();

-- 催促を記録する。**まだ今日催促していない人だけ**を返す（その人にだけ送る＝同じ日に二度送らない）。
-- 過ぎた日・先の日の催促はしない（「今日の報告」のための機能なので、日本時間の今日と昨日だけ受け付ける）
create or replace function public.record_report_reminders(p_work_date date, p_driver_ids uuid[])
returns uuid[] language plpgsql security invoker set search_path = public as $$
declare
  cid uuid := public.current_company_id();
  today date := (now() at time zone 'Asia/Tokyo')::date;
  ids uuid[];
begin
  if cid is null or not public.is_admin() then
    raise exception '権限がありません' using errcode = 'P0001', hint = 'FORBIDDEN';
  end if;
  if p_work_date is null or p_work_date > today or p_work_date < today - 1 then
    raise exception '催促できるのは今日（と昨日）の報告だけです' using errcode = 'P0001', hint = 'INVALID_DATE';
  end if;
  with ins as (
    insert into public.report_reminders (company_id, driver_id, work_date)
    select cid, d.id, p_work_date
      from public.drivers d
     where d.company_id = cid and d.is_active and d.id = any (coalesce(p_driver_ids, '{}'::uuid[]))
    on conflict (company_id, driver_id, work_date) do nothing
    returning driver_id
  )
  select coalesce(array_agg(driver_id), '{}'::uuid[]) into ids from ins;
  return ids;
end $$;

comment on function public.record_report_reminders(date, uuid[]) is
  '今日の報告の催促を記録し、今日まだ催促していなかった人だけを返す（admin 以上）';

-- ---------- 4. 事務の画面が使う行と事実を 1 往復で ----------
--   返すのは行と数だけ。「何を先にやるか」「どの手順が終わっているか」は lib/office の純関数が決める。
--   security invoker なので RLS はそのまま効く（入口で admin 以上に限る）
--   p_month を省くと「締めていない一番古い過去の月（データがある月）」、無ければ今月を選ぶ
--   （月初に先月を締める、がいちばん多い使い方なので）
create or replace function public.office_desk(p_month date default null, p_today date default null)
returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare
  cid uuid := public.current_company_id();
  today date := coalesce(p_today, (now() at time zone 'Asia/Tokyo')::date);
  this_month date := date_trunc('month', coalesce(p_today, (now() at time zone 'Asia/Tokyo')::date))::date;
  m date;
begin
  if cid is null or not public.is_admin() then
    raise exception '権限がありません' using errcode = 'P0001', hint = 'FORBIDDEN';
  end if;
  m := date_trunc('month', coalesce(
    p_month,
    (select min(l.month) from public.v_month_list l
      where l.company_id = cid and l.status = 'open' and l.month < this_month and coalesce(l.entry_count, 0) > 0),
    this_month
  ))::date;

  return jsonb_build_object(
    'today', today,
    'month', m,

    -- 承認待ちの稼働報告（古い日から。多すぎるときは件数だけ total で返す）
    'pending_entries', (
      select coalesce(jsonb_agg(to_jsonb(x) order by x.work_date, x.driver_sort_order, x.driver_name, x.created_at), '[]'::jsonb)
        from (
          select e.id, e.work_date, e.month, e.driver_id, e.driver_name, e.driver_sort_order,
                 e.project_name, e.item_name, e.unit, e.qty, e.memo, e.source, e.created_at
            from public.v_work_day_entry_list e
           where e.company_id = cid and e.status = 'submitted'
           order by e.work_date, e.driver_sort_order, e.driver_name, e.created_at
           limit 300
        ) x
    ),
    'pending_entries_total', (
      select count(*) from public.work_day_entries where company_id = cid and status = 'submitted'
    ),

    -- 休み希望（決まっていないもの）
    'day_offs', (
      select coalesce(jsonb_agg(to_jsonb(x) order by x.on_date, x.driver_sort_order, x.driver_name), '[]'::jsonb)
        from (
          select o.id, o.on_date, o.reason, o.driver_id, o.driver_name, o.driver_sort_order, o.created_at
            from public.v_day_off_list o
           where o.company_id = cid and o.status = 'requested'
           order by o.on_date
           limit 100
        ) x
    ),

    -- 今日の報告：稼働中のドライバーと、今日の点呼・稼働・配車・休み・催促
    'drivers', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', d.id, 'name', d.name, 'sort_order', d.sort_order,
               'weekly_off', to_jsonb(coalesce(d.weekly_off, '{}'::integer[])),
               'line_linked', coalesce(d.line_user_id, '') <> '',
               'has_login', exists (select 1 from public.profiles p where p.company_id = cid and p.driver_id = d.id and p.is_active)
             ) order by d.sort_order, d.name), '[]'::jsonb)
        from public.drivers d
       where d.company_id = cid and d.is_active
    ),
    'today_reports', (
      select coalesce(jsonb_agg(jsonb_build_object('driver_id', r.driver_id, 'pre_at', r.pre_at, 'post_at', r.post_at)), '[]'::jsonb)
        from public.daily_reports r
       where r.company_id = cid and r.work_date = today
    ),
    'today_entry_drivers', (
      select coalesce(jsonb_agg(distinct w.driver_id), '[]'::jsonb)
        from public.work_day_entries w
       where w.company_id = cid and w.work_date = today
    ),
    'today_dispatch_drivers', (
      select coalesce(jsonb_agg(distinct a.driver_id), '[]'::jsonb)
        from public.dispatch_assignments a
       where a.company_id = cid and a.on_date = today and a.status <> 'cancelled'
    ),
    'today_off_drivers', (
      select coalesce(jsonb_agg(distinct o.driver_id), '[]'::jsonb)
        from public.driver_day_offs o
       where o.company_id = cid and o.on_date = today and o.status = 'approved'
    ),
    'reminders', (
      select coalesce(jsonb_agg(jsonb_build_object('driver_id', r.driver_id, 'sent_at', r.sent_at, 'sent_by_name', r.sent_by_name)), '[]'::jsonb)
        from public.report_reminders r
       where r.company_id = cid and r.work_date = today
    ),

    -- 明日の配車（見通しのビューをそのまま）
    'tomorrow', (
      select to_jsonb(o) from public.v_dispatch_outlook o where o.company_id = cid and o.on_date = today + 1
    ),

    -- 入金待ちの請求書（期日の判定はアプリ）
    'invoices_issued', (
      select coalesce(jsonb_agg(to_jsonb(x) order by x.due_date nulls last, x.client_sort_order), '[]'::jsonb)
        from (
          select i.id, i.client_id, i.client_name, i.client_sort_order, i.month, i.invoice_no, i.due_date, i.total
            from public.v_invoice_list i
           where i.company_id = cid and i.status = 'issued'
        ) x
    ),
    -- 消し込めていない入金（出金は請求書と結びつかないので数えない）
    'bank_unmatched', (
      select count(*) from public.bank_transactions b
       where b.company_id = cid and b.status = 'unmatched' and b.amount > 0
    ),
    -- 重要な「気になること」（未対応。新しい順に 5 件）
    'alerts_high', (
      select coalesce(jsonb_agg(to_jsonb(x) order by x.detected_at desc), '[]'::jsonb)
        from (
          select a.id, a.code, a.title, a.detail, a.href, a.month, a.detected_at
            from public.alerts a
           where a.company_id = cid and a.status = 'open' and a.severity = 'high'
           order by a.detected_at desc
           limit 5
        ) x
    ),
    'alerts_open', (
      select count(*) from public.alerts a where a.company_id = cid and a.status = 'open'
    ),

    -- 締めていない過去の月（データがある月だけ。「先月がまだ」の案内に使う）
    'open_past_months', (
      select coalesce(jsonb_agg(l.month order by l.month), '[]'::jsonb)
        from public.v_month_list l
       where l.company_id = cid and l.status = 'open' and l.month < this_month and coalesce(l.entry_count, 0) > 0
    ),

    -- 月締めの手順に使う事実（その月）
    'closing', jsonb_build_object(
      'status', coalesce((select l.status::text from public.v_month_list l where l.company_id = cid and l.month = m), 'open'),
      'closed_at', (select l.closed_at from public.v_month_list l where l.company_id = cid and l.month = m),
      'entry_count', (select count(*) from public.work_entries w where w.company_id = cid and w.month = m and w.qty > 0),
      'zero_qty', (select count(*) from public.work_entries w where w.company_id = cid and w.month = m and w.qty = 0),
      'pending', (select count(*) from public.work_day_entries w where w.company_id = cid and w.month = m and w.status = 'submitted'),
      'roll_call_missing', coalesce((select s.roll_call_missing_count from public.v_day_status s where s.company_id = cid and s.month = m), 0),
      'no_report', (select count(*) from public.alerts a where a.company_id = cid and a.month = m and a.status = 'open' and a.code = 'dispatch_no_report'),
      'rate_diffs', (select count(*) from public.rate_diffs(m)),
      'recurring_due', (
        select count(*) from public.recurring_expenses r
         where r.company_id = cid and r.is_active
           and (r.start_month is null or r.start_month <= m)
           and (r.end_month is null or r.end_month >= m)
      ),
      'recurring_unapplied', (
        select count(*) from public.recurring_expenses r
         where r.company_id = cid and r.is_active
           and (r.start_month is null or r.start_month <= m)
           and (r.end_month is null or r.end_month >= m)
           and not exists (select 1 from public.expenses e where e.company_id = cid and e.month = m and e.recurring_id = r.id)
      ),
      'notices', (select count(*) from public.payment_notices n where n.company_id = cid and n.month = m),
      'notice_diffs', (
        select count(*) from public.v_payment_notice_diff d
         where d.company_id = cid and d.month = m and d.diff_status <> 'ok'
      ),
      -- 請求先ごとのその月の売上（案件に取引先が付いているもの）と、取引先が付いていない売上
      'clients', (
        select coalesce(jsonb_agg(jsonb_build_object('client_id', x.client_id, 'client_name', x.client_name, 'bill', x.bill)
                                  order by x.client_name), '[]'::jsonb)
          from (
            select p.client_id, max(c.name) as client_name, sum(e.bill) as bill
              from public.v_work_entry_calc e
              join public.projects p on p.id = e.project_id
              join public.clients c on c.id = p.client_id
             where e.company_id = cid and e.month = m and p.client_id is not null
             group by p.client_id
            having sum(e.bill) > 0
          ) x
      ),
      'unassigned_bill', (
        select coalesce(sum(e.bill), 0)
          from public.v_work_entry_calc e
          join public.projects p on p.id = e.project_id
         where e.company_id = cid and e.month = m and p.client_id is null
      ),
      'invoices', (
        select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'client_id', i.client_id, 'status', i.status, 'total', i.total, 'invoice_no', i.invoice_no)
                                  order by i.client_sort_order), '[]'::jsonb)
          from public.v_invoice_list i
         where i.company_id = cid and i.month = m
      ),
      'checks', (
        select coalesce(jsonb_agg(jsonb_build_object('key', k.key, 'done_at', k.done_at, 'done_by_name', k.done_by_name) order by k.done_at), '[]'::jsonb)
          from public.month_close_checks k
         where k.company_id = cid and k.month = m
      )
    )
  );
end $$;

comment on function public.office_desk(date, date) is
  '事務の画面（今日やること・月締めの手順）が使う行と事実を 1 往復で返す（admin 以上。判定はアプリの純関数）';

-- ---------- 5. ナビのバッジに「事務」を足す ----------
create or replace function public.nav_badges()
returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare
  cid uuid := public.current_company_id();
  alerts_n integer := 0;
  chat_n integer := 0;
  approvals_n integer := 0;
  office_n integer := 0;
begin
  if cid is null then
    return jsonb_build_object('alerts', 0, 'chat', 0, 'approvals', 0, 'office', 0);
  end if;
  select count(*) into alerts_n from public.alerts where company_id = cid and status = 'open';
  chat_n := coalesce(public.chat_unread_total(), 0);  -- 0011 の RPC をそのまま使う
  if public.is_owner() then
    select count(*) into approvals_n from public.approvals where company_id = cid and status = 'pending';
  end if;
  -- 0026：事務のバッジ＝その場で決められる承認待ち（稼働報告 ＋ 休み希望）。admin 以上だけ
  if public.is_admin() then
    select (select count(*) from public.work_day_entries where company_id = cid and status = 'submitted')
         + (select count(*) from public.driver_day_offs where company_id = cid and status = 'requested')
      into office_n;
  end if;
  return jsonb_build_object('alerts', alerts_n, 'chat', chat_n, 'approvals', approvals_n, 'office', office_n);
end $$;

comment on function public.nav_badges() is
  'ナビのバッジ（未対応のアラート・未読のチャット・決裁待ち・事務の承認待ち）を 1 往復で返す';

-- ---------- データ全削除にも新しい 2 つを足す（それ以外は 0024 と同じ） ----------
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
  -- 0026：事務（月締めのチェック・催促の記録）
  delete from public.month_close_checks where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('month_close_checks', n);
  delete from public.report_reminders where company_id = cid;
  -- 0020：決裁のルールと委任・持ち出しの記録・ドライバーの振込口座
  delete from public.approval_delegations where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('approval_delegations', n);
  delete from public.export_logs where company_id = cid;
  delete from public.driver_bank_accounts where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('driver_bank_accounts', n);
  -- 0019：代表（中期計画 → 計画の年 の逆順で消す）
  delete from public.plan_years where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('plan_years', n);
  delete from public.plans where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('plans', n);
  delete from public.guarantees where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('guarantees', n);
  delete from public.advisors where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('advisors', n);
  delete from public.insurance_policies where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('insurance_policies', n);
  delete from public.shareholders where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('shareholders', n);
  delete from public.officers where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('officers', n);
  delete from public.company_profile where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('company_profile', n);
  delete from public.decisions where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('decisions', n);
  delete from public.approvals where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('approvals', n);
  delete from public.login_events where company_id = cid;
  delete from public.bank_transactions where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('bank_transactions', n);
  delete from public.bank_imports where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('bank_imports', n);
  delete from public.alerts where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('alerts', n);
  delete from public.invoice_items where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('invoice_items', n);
  delete from public.invoices where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('invoices', n);
  delete from public.expenses where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('expenses', n);
  delete from public.recurring_expenses where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('recurring_expenses', n);
  delete from public.month_targets where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('month_targets', n);
  delete from public.cash_snapshots where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('cash_snapshots', n);
  delete from public.payment_notice_items where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('payment_notice_items', n);
  delete from public.payment_notices where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('payment_notices', n);
  delete from public.loan_payments where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('loan_payments', n);
  delete from public.loans where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('loans', n);
  delete from public.tax_tasks where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('tax_tasks', n);
  delete from public.import_runs where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('import_runs', n);
  delete from public.import_profiles where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('import_profiles', n);
  delete from public.applicant_events where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('applicant_events', n);
  delete from public.applicants where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('applicants', n);
  delete from public.contracts where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('contracts', n);
  delete from public.aptitude_tests where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('aptitude_tests', n);
  delete from public.dispatch_assignments where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('dispatch_assignments', n);
  delete from public.driver_day_offs where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('driver_day_offs', n);
  delete from public.project_demand_days where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('project_demand_days', n);
  delete from public.project_demands where company_id = cid; get diagnostics n = row_count; counts := counts || jsonb_build_object('project_demands', n);
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
-- 権限（テーブルを足したので出し直す。0023 で気づいた落とし穴）
-- =============================================================================
grant execute on function public.set_start_page(text) to authenticated;
grant execute on function public.set_close_check(date, text, boolean) to authenticated;
grant execute on function public.record_report_reminders(date, uuid[]) to authenticated;
grant execute on function public.office_desk(date, date) to authenticated;
grant execute on function public.nav_badges() to authenticated, service_role;
revoke execute on function public.set_start_page(text) from anon, public;
revoke execute on function public.set_close_check(date, text, boolean) from anon, public;
revoke execute on function public.record_report_reminders(date, uuid[]) from anon, public;
revoke execute on function public.office_desk(date, date) from anon, public;

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;
revoke all on public.integration_secrets from authenticated, anon, public;
grant all on public.integration_secrets to service_role;
