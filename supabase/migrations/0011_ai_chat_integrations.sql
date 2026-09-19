-- =============================================================================
-- 0011 AI・社内チャット・異常検知・外部連携
--   - AI チャット（ai_conversations / ai_messages）と AI 月次分析の保存形式の拡張
--   - 社内チャット（chat_channels / chat_messages / chat_reads。閲覧者を含むスタッフ全員）
--   - 異常の検知とアラート（alerts ＋ RPC detect_anomalies）
--   - 外部連携（integrations / integration_secrets / integration_logs）
--       LINE 公式アカウント：drivers.line_user_id・profiles.line_user_id・line_link_codes
--       銀行 CSV 取り込み：bank_imports / bank_transactions ＋ 自動消込
-- =============================================================================

-- ---------- 列挙型 ----------
do $$ begin
  create type public.alert_status as enum ('open','resolved','ignored');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.alert_severity as enum ('high','medium','low');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.integration_kind as enum ('line','google_drive','bank');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.bank_txn_status as enum ('unmatched','matched','ignored');
exception when duplicate_object then null; end $$;

-- =============================================================================
-- AI チャット
-- =============================================================================
create table if not exists public.ai_conversations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  title text not null default '新しい相談' check (length(title) <= 200),
  month date check (month is null or extract(day from month) = 1),
  message_count integer not null default 0,
  last_message_at timestamptz not null default now(),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ai_conversations_company_idx on public.ai_conversations (company_id, last_message_at desc);
comment on table public.ai_conversations is 'AI チャットの会話（スタッフ全員が閲覧できる。会社の数字に関する相談）';

create table if not exists public.ai_messages (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  conversation_id uuid not null references public.ai_conversations(id) on delete cascade,
  role text not null check (role in ('user','assistant')),
  content text not null default '',
  model text not null default '',
  data_months integer not null default 0,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists ai_messages_conversation_idx on public.ai_messages (conversation_id, created_at);
create index if not exists ai_messages_company_idx on public.ai_messages (company_id, created_at desc);
comment on table public.ai_messages is 'AI チャットの発言。role=user は質問、role=assistant は Claude の回答';

-- AI 月次分析：所見に加えて要約・改善策を持てるようにする（findings は jsonb なので形は自由）
alter table public.ai_insights add column if not exists kind text not null default 'monthly';
alter table public.ai_insights add column if not exists summary text not null default '';
alter table public.ai_insights add column if not exists actions jsonb not null default '[]'::jsonb;
comment on column public.ai_insights.kind is '分析の種類（monthly＝月次の分析と改善策）';
comment on column public.ai_insights.summary is 'ひとことの総括';
comment on column public.ai_insights.actions is '改善策の配列 [{title, detail, effect}]';

-- =============================================================================
-- 社内チャット（閲覧者を含むスタッフ全員）
-- =============================================================================
create table if not exists public.chat_channels (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null check (length(name) between 1 and 60),
  description text not null default '',
  is_default boolean not null default false,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, name)
);
create index if not exists chat_channels_company_idx on public.chat_channels (company_id, sort_order, name);
comment on table public.chat_channels is '社内チャットのルーム。会社を作ると「全体」「経営」が入る';

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  channel_id uuid not null references public.chat_channels(id) on delete cascade,
  author_id uuid not null,
  body text not null check (length(body) between 1 and 4000),
  mentions jsonb not null default '[]'::jsonb,
  edited_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists chat_messages_channel_idx on public.chat_messages (channel_id, created_at desc);
create index if not exists chat_messages_company_idx on public.chat_messages (company_id, created_at desc);
comment on table public.chat_messages is '社内チャットの発言。mentions は宛先のユーザー ID（profiles.id）の配列';

create table if not exists public.chat_reads (
  company_id uuid not null references public.companies(id) on delete cascade,
  channel_id uuid not null references public.chat_channels(id) on delete cascade,
  profile_id uuid not null,
  last_read_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (channel_id, profile_id)
);
create index if not exists chat_reads_profile_idx on public.chat_reads (profile_id);
comment on table public.chat_reads is 'どこまで読んだか（未読件数の計算に使う）';

-- =============================================================================
-- 異常の検知とアラート
-- =============================================================================
create table if not exists public.alerts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  month date check (month is null or extract(day from month) = 1),
  code text not null check (length(code) between 1 and 50),
  severity public.alert_severity not null default 'medium',
  title text not null check (length(title) between 1 and 200),
  detail text not null default '',
  amount numeric(14,2),
  ref_table text not null default '',
  ref_id text not null default '',
  href text not null default '',
  status public.alert_status not null default 'open',
  fingerprint text not null,
  detected_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid,
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, fingerprint)
);
create index if not exists alerts_company_status_idx on public.alerts (company_id, status, severity, detected_at desc);
create index if not exists alerts_company_month_idx on public.alerts (company_id, month, status);
comment on table public.alerts is '異常の検知（RPC detect_anomalies が作る）。fingerprint で同じ異常を二重に作らない';

-- =============================================================================
-- 外部連携
-- =============================================================================
create table if not exists public.integrations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  kind public.integration_kind not null,
  is_enabled boolean not null default false,
  config jsonb not null default '{}'::jsonb,
  status text not null default '',
  last_ok_at timestamptz,
  last_error text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, kind)
);
comment on table public.integrations is '外部連携の設定（機密でないもの）。トークンなどは integration_secrets に入れる';

-- 機密（アクセストークン等）。RLS を有効にしてポリシーを作らない＝サービスロールだけが読み書きできる
create table if not exists public.integration_secrets (
  company_id uuid not null references public.companies(id) on delete cascade,
  kind public.integration_kind not null,
  secrets jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (company_id, kind)
);
comment on table public.integration_secrets is 'アクセストークンなどの機密。サービスロール（サーバー）だけが読み書きできる';

create table if not exists public.integration_logs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  kind public.integration_kind not null,
  action text not null default '',
  status text not null default 'ok' check (status in ('ok','error')),
  message text not null default '',
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists integration_logs_company_idx on public.integration_logs (company_id, created_at desc);
comment on table public.integration_logs is '外部連携の実行記録（送信・保存・取り込みの結果）';

-- LINE のユーザー ID（ドライバー・スタッフ）
alter table public.drivers add column if not exists line_user_id text not null default '';
alter table public.drivers add column if not exists line_linked_at timestamptz;
comment on column public.drivers.line_user_id is 'LINE 公式アカウントで連携したユーザー ID（空 = 未連携）';
alter table public.profiles add column if not exists line_user_id text not null default '';
alter table public.profiles add column if not exists line_linked_at timestamptz;
comment on column public.profiles.line_user_id is 'LINE 公式アカウントで連携したユーザー ID（空 = 未連携）';

create table if not exists public.line_link_codes (
  code text primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  driver_id uuid references public.drivers(id) on delete cascade,
  profile_id uuid,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  check (driver_id is not null or profile_id is not null)
);
create index if not exists line_link_codes_company_idx on public.line_link_codes (company_id, expires_at desc);
comment on table public.line_link_codes is 'LINE 連携用の合言葉（6 桁）。LINE で送ってもらうと本人と結びつく';

-- 銀行 CSV の取り込み
create table if not exists public.bank_imports (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  file_name text not null default '',
  format text not null default '',
  row_count integer not null default 0,
  inserted_count integer not null default 0,
  skipped_count integer not null default 0,
  matched_count integer not null default 0,
  period_from date,
  period_to date,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists bank_imports_company_idx on public.bank_imports (company_id, created_at desc);
comment on table public.bank_imports is '銀行 CSV の取り込み 1 回分';

create table if not exists public.bank_transactions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  import_id uuid references public.bank_imports(id) on delete set null,
  txn_date date not null,
  description text not null default '',
  amount numeric(14,2) not null,
  balance numeric(14,2),
  status public.bank_txn_status not null default 'unmatched',
  invoice_id uuid references public.invoices(id) on delete set null,
  expense_id uuid references public.expenses(id) on delete set null,
  matched_at timestamptz,
  matched_by uuid,
  auto_matched boolean not null default false,
  memo text not null default '',
  fingerprint text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, fingerprint)
);
create index if not exists bank_transactions_company_idx on public.bank_transactions (company_id, txn_date desc);
create index if not exists bank_transactions_status_idx on public.bank_transactions (company_id, status, txn_date desc);
comment on table public.bank_transactions is '銀行明細の 1 行（amount は入金 ＋／出金 −）。fingerprint で二重取り込みを防ぐ';

-- =============================================================================
-- トリガー
-- =============================================================================
do $$
declare t text;
begin
  foreach t in array array['ai_conversations','chat_channels','chat_messages','chat_reads','alerts','integrations','bank_transactions']
  loop
    execute format('drop trigger if exists t00_set_updated_at on public.%I', t);
    execute format('create trigger t00_set_updated_at before update on public.%I for each row execute function public.set_updated_at()', t);
  end loop;
end $$;

-- 子テーブルの company_id を親から補完し、親と一致することを確認する（0011 のテーブル）
create or replace function public.fill_company_id_0011()
returns trigger language plpgsql as $$
declare parent_company uuid;
begin
  if tg_table_name = 'ai_messages' then
    select company_id into parent_company from public.ai_conversations where id = new.conversation_id;
  elsif tg_table_name in ('chat_messages', 'chat_reads') then
    select company_id into parent_company from public.chat_channels where id = new.channel_id;
  elsif tg_table_name = 'bank_transactions' then
    if new.import_id is null then
      return new;
    end if;
    select company_id into parent_company from public.bank_imports where id = new.import_id;
  end if;

  if parent_company is null then
    raise exception '親レコードが見つかりません（%）', tg_table_name using errcode = 'foreign_key_violation';
  end if;
  if new.company_id is null then
    new.company_id := parent_company;
  elsif new.company_id <> parent_company then
    raise exception '会社が一致しません（%）', tg_table_name using errcode = 'check_violation';
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['ai_messages','chat_messages','chat_reads','bank_transactions']
  loop
    execute format('drop trigger if exists t01_fill_company_id on public.%I', t);
    execute format('create trigger t01_fill_company_id before insert or update on public.%I for each row execute function public.fill_company_id_0011()', t);
  end loop;
end $$;

-- 監査（チャット・AI の発言は量が多いので対象外。設定と連携の変更だけ残す）
do $$
declare t text;
begin
  foreach t in array array['chat_channels','integrations','bank_imports']
  loop
    execute format('drop trigger if exists t90_audit on public.%I', t);
    execute format('create trigger t90_audit after insert or update or delete on public.%I for each row execute function public.audit_row_change()', t);
  end loop;
end $$;

-- 会話の発言数・最終発言時刻を保つ
create or replace function public.t_ai_message_touch()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.ai_conversations
     set message_count = (select count(*) from public.ai_messages where conversation_id = new.conversation_id),
         last_message_at = greatest(last_message_at, new.created_at),
         updated_at = now()
   where id = new.conversation_id;
  return new;
end $$;
drop trigger if exists t10_touch_conversation on public.ai_messages;
create trigger t10_touch_conversation after insert on public.ai_messages for each row execute function public.t_ai_message_touch();

-- =============================================================================
-- RLS
-- =============================================================================
alter table public.ai_conversations enable row level security;
drop policy if exists ai_conversations_select on public.ai_conversations;
create policy ai_conversations_select on public.ai_conversations for select to authenticated
  using (company_id = public.current_company_id() and public.is_staff());
drop policy if exists ai_conversations_write on public.ai_conversations;
create policy ai_conversations_write on public.ai_conversations for all to authenticated
  using (company_id = public.current_company_id() and public.is_staff())
  with check (company_id = public.current_company_id() and public.is_staff());

alter table public.ai_messages enable row level security;
drop policy if exists ai_messages_select on public.ai_messages;
create policy ai_messages_select on public.ai_messages for select to authenticated
  using (company_id = public.current_company_id() and public.is_staff());
drop policy if exists ai_messages_write on public.ai_messages;
create policy ai_messages_write on public.ai_messages for all to authenticated
  using (company_id = public.current_company_id() and public.is_staff())
  with check (company_id = public.current_company_id() and public.is_staff());

alter table public.chat_channels enable row level security;
drop policy if exists chat_channels_select on public.chat_channels;
create policy chat_channels_select on public.chat_channels for select to authenticated
  using (company_id = public.current_company_id() and public.is_staff());
drop policy if exists chat_channels_write on public.chat_channels;
create policy chat_channels_write on public.chat_channels for all to authenticated
  using (company_id = public.current_company_id() and public.is_admin())
  with check (company_id = public.current_company_id() and public.is_admin());

alter table public.chat_messages enable row level security;
drop policy if exists chat_messages_select on public.chat_messages;
create policy chat_messages_select on public.chat_messages for select to authenticated
  using (company_id = public.current_company_id() and public.is_staff());
-- 発言は本人のものだけ作れる・直せる・消せる（閲覧者も発言できる）
drop policy if exists chat_messages_insert on public.chat_messages;
create policy chat_messages_insert on public.chat_messages for insert to authenticated
  with check (company_id = public.current_company_id() and public.is_staff() and author_id = auth.uid());
drop policy if exists chat_messages_update on public.chat_messages;
create policy chat_messages_update on public.chat_messages for update to authenticated
  using (company_id = public.current_company_id() and public.is_staff() and author_id = auth.uid())
  with check (company_id = public.current_company_id() and author_id = auth.uid());
drop policy if exists chat_messages_delete on public.chat_messages;
create policy chat_messages_delete on public.chat_messages for delete to authenticated
  using (company_id = public.current_company_id() and (author_id = auth.uid() or public.is_owner()));

alter table public.chat_reads enable row level security;
drop policy if exists chat_reads_self on public.chat_reads;
create policy chat_reads_self on public.chat_reads for all to authenticated
  using (company_id = public.current_company_id() and profile_id = auth.uid())
  with check (company_id = public.current_company_id() and profile_id = auth.uid());

alter table public.alerts enable row level security;
drop policy if exists alerts_select on public.alerts;
create policy alerts_select on public.alerts for select to authenticated
  using (company_id = public.current_company_id() and public.is_staff());
drop policy if exists alerts_write on public.alerts;
create policy alerts_write on public.alerts for all to authenticated
  using (company_id = public.current_company_id() and public.is_admin())
  with check (company_id = public.current_company_id() and public.is_admin());

alter table public.integrations enable row level security;
drop policy if exists integrations_select on public.integrations;
create policy integrations_select on public.integrations for select to authenticated
  using (company_id = public.current_company_id() and public.is_admin());
drop policy if exists integrations_write on public.integrations;
create policy integrations_write on public.integrations for all to authenticated
  using (company_id = public.current_company_id() and public.is_owner())
  with check (company_id = public.current_company_id() and public.is_owner());

-- 機密はポリシーを作らない＝サービスロールのみ
alter table public.integration_secrets enable row level security;

alter table public.integration_logs enable row level security;
drop policy if exists integration_logs_select on public.integration_logs;
create policy integration_logs_select on public.integration_logs for select to authenticated
  using (company_id = public.current_company_id() and public.is_admin());

-- 連携コードはサービスロールと本人（ドライバー・スタッフ）が作れる
alter table public.line_link_codes enable row level security;
drop policy if exists line_link_codes_self on public.line_link_codes;
create policy line_link_codes_self on public.line_link_codes for all to authenticated
  using (
    company_id = public.current_company_id()
    and (profile_id = auth.uid() or (driver_id is not null and driver_id = public.current_driver_id()) or public.is_admin())
  )
  with check (
    company_id = public.current_company_id()
    and (profile_id = auth.uid() or (driver_id is not null and driver_id = public.current_driver_id()) or public.is_admin())
  );

alter table public.bank_imports enable row level security;
drop policy if exists bank_imports_select on public.bank_imports;
create policy bank_imports_select on public.bank_imports for select to authenticated
  using (company_id = public.current_company_id() and public.is_staff());
drop policy if exists bank_imports_write on public.bank_imports;
create policy bank_imports_write on public.bank_imports for all to authenticated
  using (company_id = public.current_company_id() and public.is_admin())
  with check (company_id = public.current_company_id() and public.is_admin());

alter table public.bank_transactions enable row level security;
drop policy if exists bank_transactions_select on public.bank_transactions;
create policy bank_transactions_select on public.bank_transactions for select to authenticated
  using (company_id = public.current_company_id() and public.is_staff());
drop policy if exists bank_transactions_write on public.bank_transactions;
create policy bank_transactions_write on public.bank_transactions for all to authenticated
  using (company_id = public.current_company_id() and public.is_admin())
  with check (company_id = public.current_company_id() and public.is_admin());

-- 発言者の名前・ロールを発言に写し取る（閲覧者は他人の profiles を読めないため）
alter table public.chat_messages add column if not exists author_name text not null default '';
alter table public.chat_messages add column if not exists author_role public.user_role;

create or replace function public.t_chat_message_author()
returns trigger language plpgsql security definer set search_path = public as $$
declare p record;
begin
  select display_name, email, role into p from public.profiles where id = new.author_id;
  if p is null then
    raise exception '発言者が見つかりません' using errcode = 'foreign_key_violation';
  end if;
  new.author_name := coalesce(nullif(p.display_name, ''), p.email, '');
  new.author_role := p.role;
  return new;
end $$;
drop trigger if exists t02_chat_author on public.chat_messages;
create trigger t02_chat_author before insert or update of author_id on public.chat_messages
  for each row execute function public.t_chat_message_author();

-- =============================================================================
-- ビュー
-- =============================================================================
drop view if exists public.v_staff, public.v_chat_channel_list, public.v_chat_message_list,
  public.v_ai_conversation_list, public.v_alert_summary, public.v_bank_transaction_list cascade;

-- 社内のスタッフ一覧（チャットの宛先に使う）。閲覧者は profiles を読めないため security_invoker にせず、
-- ビューの中で会社とロールを必ず絞り込む
create view public.v_staff as
select
  p.id,
  p.company_id,
  coalesce(nullif(p.display_name, ''), p.email) as display_name,
  p.email,
  p.role,
  p.is_active,
  (coalesce(p.line_user_id, '') <> '') as line_linked,
  p.created_at
from public.profiles p
where p.company_id = public.current_company_id()
  and public.is_staff()
  and p.role <> 'driver';
comment on view public.v_staff is 'スタッフ一覧（チャットの宛先・管理画面用）。会社と権限はビューの中で絞り込む';

-- 社内チャットのルーム一覧（発言数・最終発言・未読件数）
create view public.v_chat_channel_list
with (security_invoker = true) as
select
  c.id,
  c.company_id,
  c.name,
  c.description,
  c.is_default,
  c.is_active,
  c.sort_order,
  c.created_at,
  coalesce(m.message_count, 0)::integer as message_count,
  m.last_message_at,
  coalesce(m.last_author_name, '') as last_author_name,
  coalesce(m.last_body, '') as last_body,
  coalesce(u.unread_count, 0)::integer as unread_count,
  coalesce(u.mention_count, 0)::integer as mention_count,
  r.last_read_at
from public.chat_channels c
left join lateral (
  select count(*)::integer as message_count,
         max(x.created_at) as last_message_at,
         (array_agg(x.author_name order by x.created_at desc))[1] as last_author_name,
         (array_agg(x.body order by x.created_at desc))[1] as last_body
    from public.chat_messages x
   where x.channel_id = c.id
) m on true
left join public.chat_reads r on r.channel_id = c.id and r.profile_id = auth.uid()
left join lateral (
  select count(*)::integer as unread_count,
         count(*) filter (where x.mentions ? auth.uid()::text)::integer as mention_count
    from public.chat_messages x
   where x.channel_id = c.id
     and x.author_id <> auth.uid()
     and x.created_at > coalesce(r.last_read_at, timestamptz '1970-01-01')
) u on true;

-- 社内チャットの発言一覧（発言者名つき）
create view public.v_chat_message_list
with (security_invoker = true) as
select
  m.id,
  m.company_id,
  m.channel_id,
  m.author_id,
  m.author_name,
  m.author_role,
  m.body,
  m.mentions,
  (m.author_id = auth.uid()) as is_mine,
  (m.mentions ? auth.uid()::text) as is_mentioned,
  m.edited_at,
  m.created_at
from public.chat_messages m;

-- AI チャットの会話一覧
create view public.v_ai_conversation_list
with (security_invoker = true) as
select
  c.id,
  c.company_id,
  c.title,
  c.month,
  c.message_count,
  c.last_message_at,
  c.created_by,
  c.created_at,
  coalesce(l.last_role, '') as last_role,
  coalesce(l.last_content, '') as last_content
from public.ai_conversations c
left join lateral (
  select x.role as last_role, x.content as last_content
    from public.ai_messages x
   where x.conversation_id = c.id
   -- 同じ時刻に入っていても、AI の回答（assistant）を最後の発言とみなす
   order by x.created_at desc, (x.role = 'assistant') desc
   limit 1
) l on true;

-- アラートの件数（会社 × 月）
create view public.v_alert_summary
with (security_invoker = true) as
select
  company_id,
  month,
  count(*) filter (where status = 'open')::integer as open_count,
  count(*) filter (where status = 'open' and severity = 'high')::integer as high_count,
  count(*) filter (where status = 'open' and severity = 'medium')::integer as medium_count,
  count(*) filter (where status = 'open' and severity = 'low')::integer as low_count,
  count(*)::integer as total_count,
  max(detected_at) as last_detected_at
from public.alerts
group by company_id, month;

-- 銀行明細の一覧（消込先の請求書・取引先つき）
create view public.v_bank_transaction_list
with (security_invoker = true) as
select
  t.id,
  t.company_id,
  t.import_id,
  t.txn_date,
  t.description,
  t.amount,
  t.balance,
  t.status,
  t.invoice_id,
  t.expense_id,
  t.auto_matched,
  t.memo,
  t.created_at,
  coalesce(i.invoice_no, '') as invoice_no,
  coalesce(i.total, 0) as invoice_total,
  coalesce(cl.name, '') as client_name,
  coalesce(e.label, '') as expense_label,
  coalesce(b.file_name, '') as import_file_name
from public.bank_transactions t
left join public.invoices i on i.id = t.invoice_id
left join public.clients cl on cl.id = i.client_id
left join public.expenses e on e.id = t.expense_id
left join public.bank_imports b on b.id = t.import_id;

-- =============================================================================
-- RPC：社内チャット
-- =============================================================================
-- 既定のルーム（会社を作ったとき・既存の会社に一度だけ）
create or replace function public.default_chat_channels(p_company_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  insert into public.chat_channels (company_id, name, description, is_default, sort_order)
  select p_company_id, v.name, v.descr, v.is_default, v.sort
    from (values
      ('全体', 'みんなへの連絡はここへ', true, 1),
      ('経営', '数字・方針の相談', false, 2)
    ) as v(name, descr, is_default, sort)
  on conflict (company_id, name) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- 発言する（閲覧者も発言できる）。宛先は profiles.id の配列
create or replace function public.chat_post(p_channel_id uuid, p_body text, p_mentions jsonb default '[]'::jsonb)
returns uuid language plpgsql security invoker set search_path = public as $$
declare
  cid uuid := public.current_company_id();
  mid uuid;
  body text := btrim(coalesce(p_body, ''));
begin
  if not public.is_staff() then
    raise exception 'チャットを使えるのはスタッフだけです' using errcode = 'P0001', hint = 'FORBIDDEN';
  end if;
  if body = '' then
    raise exception 'メッセージを入力してください' using errcode = 'P0001', hint = 'EMPTY_BODY';
  end if;
  if not exists (select 1 from public.chat_channels where id = p_channel_id and company_id = cid and is_active) then
    raise exception 'ルームが見つかりません' using errcode = 'P0001', hint = 'NOT_FOUND';
  end if;

  insert into public.chat_messages (company_id, channel_id, author_id, body, mentions)
  values (cid, p_channel_id, auth.uid(), body, coalesce(p_mentions, '[]'::jsonb))
  returning id into mid;

  insert into public.chat_reads (company_id, channel_id, profile_id, last_read_at)
  values (cid, p_channel_id, auth.uid(), now())
  on conflict (channel_id, profile_id) do update set last_read_at = now(), updated_at = now();

  return mid;
end $$;

-- ここまで読んだ
create or replace function public.chat_mark_read(p_channel_id uuid)
returns void language plpgsql security invoker set search_path = public as $$
declare cid uuid := public.current_company_id();
begin
  if not public.is_staff() then
    raise exception 'チャットを使えるのはスタッフだけです' using errcode = 'P0001', hint = 'FORBIDDEN';
  end if;
  insert into public.chat_reads (company_id, channel_id, profile_id, last_read_at)
  values (cid, p_channel_id, auth.uid(), now())
  on conflict (channel_id, profile_id) do update set last_read_at = now(), updated_at = now();
end $$;

-- 未読の合計（ナビのバッジ用）
create or replace function public.chat_unread_total()
returns integer language sql stable security invoker set search_path = public as $$
  select coalesce(sum(unread_count), 0)::integer from public.v_chat_channel_list where is_active;
$$;

-- =============================================================================
-- RPC：異常の検知
-- =============================================================================
-- アラートを 1 件記録する（同じ fingerprint があれば内容だけ更新し、解決済みは触らない）
create or replace function public.record_alert(
  p_company_id uuid, p_month date, p_code text, p_severity public.alert_severity,
  p_title text, p_detail text, p_amount numeric, p_ref_table text, p_ref_id text, p_href text, p_fingerprint text
-- security invoker：呼び出した人の RLS（admin・自社のみ）がそのまま効く
) returns text language plpgsql security invoker set search_path = public as $$
begin
  insert into public.alerts (company_id, month, code, severity, title, detail, amount, ref_table, ref_id, href, fingerprint)
  values (p_company_id, p_month, p_code, p_severity, p_title, coalesce(p_detail, ''), p_amount,
          coalesce(p_ref_table, ''), coalesce(p_ref_id, ''), coalesce(p_href, ''), p_fingerprint)
  on conflict (company_id, fingerprint) do update
    set severity = excluded.severity,
        title = excluded.title,
        detail = excluded.detail,
        amount = excluded.amount,
        href = excluded.href,
        detected_at = now(),
        updated_at = now();
  return p_fingerprint;
end $$;

-- その月の異常を洗い出す（admin 以上）。検知しなくなった未対応のアラートは自動で解決済みにする
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

  -- 検知しなくなったものは自動で解決済みにする
  update public.alerts
     set status = 'resolved', resolved_at = now(), updated_at = now()
   where company_id = cid and month = p_month and status = 'open' and not (fingerprint = any(fps));
  get diagnostics n = row_count;

  select count(*) into closed_n from public.alerts where company_id = cid and month = p_month and status = 'open';
  return jsonb_build_object('detected', coalesce(array_length(fps, 1), 0), 'open', closed_n, 'auto_resolved', n);
end $$;

-- アラートの状態を変える（admin 以上）
create or replace function public.set_alert_status(p_alert_id uuid, p_status public.alert_status, p_note text default '')
returns void language plpgsql security invoker set search_path = public as $$
declare cid uuid := public.current_company_id();
begin
  if not public.is_admin() then
    raise exception '権限がありません' using errcode = 'P0001', hint = 'FORBIDDEN';
  end if;
  update public.alerts
     set status = p_status,
         note = coalesce(nullif(btrim(p_note), ''), note),
         resolved_at = case when p_status = 'open' then null else now() end,
         resolved_by = case when p_status = 'open' then null else auth.uid() end,
         updated_at = now()
   where id = p_alert_id and company_id = cid;
  if not found then
    raise exception 'アラートが見つかりません' using errcode = 'P0001';
  end if;
end $$;

-- =============================================================================
-- RPC：銀行 CSV の消込
-- =============================================================================
-- 入金明細と未入金の請求書を金額で突き合わせる（金額が一致し、候補が 1 件だけのものを消し込む）
create or replace function public.bank_auto_match(p_import_id uuid default null)
returns integer language plpgsql security invoker set search_path = public as $$
declare
  cid uuid := public.current_company_id();
  t record;
  inv_id uuid;
  cnt integer;
  matched integer := 0;
begin
  if not public.is_admin() then
    raise exception '権限がありません' using errcode = 'P0001', hint = 'FORBIDDEN';
  end if;
  for t in
    select * from public.bank_transactions
     where company_id = cid and status = 'unmatched' and amount > 0
       and (p_import_id is null or import_id = p_import_id)
     order by txn_date
  loop
    select count(*), (array_agg(i.id order by i.issue_date, i.invoice_no))[1] into cnt, inv_id
      from public.invoices i
     where i.company_id = cid and i.status <> 'paid' and i.total = t.amount
       and t.txn_date >= i.issue_date - 7 and t.txn_date <= i.issue_date + 180;
    if cnt = 1 then
      update public.bank_transactions
         set status = 'matched', invoice_id = inv_id, matched_at = now(), matched_by = auth.uid(), auto_matched = true, updated_at = now()
       where id = t.id;
      perform public.set_invoice_status(inv_id, 'paid', t.txn_date);
      matched := matched + 1;
    end if;
  end loop;
  if p_import_id is not null then
    update public.bank_imports set matched_count = matched where id = p_import_id and company_id = cid;
  end if;
  return matched;
end $$;

-- 手で消し込む（請求書に紐づけて入金済みにする）
create or replace function public.bank_match_invoice(p_txn_id uuid, p_invoice_id uuid)
returns void language plpgsql security invoker set search_path = public as $$
declare
  cid uuid := public.current_company_id();
  d date;
begin
  if not public.is_admin() then
    raise exception '権限がありません' using errcode = 'P0001', hint = 'FORBIDDEN';
  end if;
  select txn_date into d from public.bank_transactions where id = p_txn_id and company_id = cid;
  if d is null then
    raise exception '明細が見つかりません' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.invoices where id = p_invoice_id and company_id = cid) then
    raise exception '請求書が見つかりません' using errcode = 'P0001';
  end if;
  update public.bank_transactions
     set status = 'matched', invoice_id = p_invoice_id, expense_id = null,
         matched_at = now(), matched_by = auth.uid(), auto_matched = false, updated_at = now()
   where id = p_txn_id and company_id = cid;
  perform public.set_invoice_status(p_invoice_id, 'paid', d);
end $$;

-- 消込を外す／対象外にする
create or replace function public.bank_set_status(p_txn_id uuid, p_status public.bank_txn_status)
returns void language plpgsql security invoker set search_path = public as $$
declare
  cid uuid := public.current_company_id();
  old_invoice uuid;
begin
  if not public.is_admin() then
    raise exception '権限がありません' using errcode = 'P0001', hint = 'FORBIDDEN';
  end if;
  select invoice_id into old_invoice from public.bank_transactions where id = p_txn_id and company_id = cid;
  if not found then
    raise exception '明細が見つかりません' using errcode = 'P0001';
  end if;
  if p_status = 'matched' then
    raise exception '消込は bank_match_invoice を使ってください' using errcode = 'P0001';
  end if;
  update public.bank_transactions
     set status = p_status, invoice_id = null, expense_id = null,
         matched_at = null, matched_by = null, auto_matched = false, updated_at = now()
   where id = p_txn_id and company_id = cid;
  -- 消込を外したら請求書は「発行済み」に戻す
  if old_invoice is not null then
    perform public.set_invoice_status(old_invoice, 'issued', null);
  end if;
end $$;

-- =============================================================================
-- RPC：LINE 連携の合言葉
-- =============================================================================
-- 合言葉（6 桁）を発行する。ドライバーは自分の分、スタッフは自分の分
create or replace function public.line_issue_code()
returns text language plpgsql security invoker set search_path = public as $$
declare
  cid uuid := public.current_company_id();
  did uuid := public.current_driver_id();
  code text;
begin
  if cid is null then
    raise exception 'ログインが必要です' using errcode = 'P0001';
  end if;
  code := lpad((floor(random() * 1000000))::integer::text, 6, '0');
  if did is not null then
    delete from public.line_link_codes where company_id = cid and driver_id = did and used_at is null;
    insert into public.line_link_codes (code, company_id, driver_id, expires_at)
    values (code, cid, did, now() + interval '30 minutes');
  else
    if not public.is_staff() then
      raise exception '権限がありません' using errcode = 'P0001', hint = 'FORBIDDEN';
    end if;
    delete from public.line_link_codes where company_id = cid and profile_id = auth.uid() and used_at is null;
    insert into public.line_link_codes (code, company_id, profile_id, expires_at)
    values (code, cid, auth.uid(), now() + interval '30 minutes');
  end if;
  return code;
end $$;

-- 合言葉を使って LINE のユーザー ID を結びつける（Webhook から。サービスロール専用）
create or replace function public.line_consume_code(p_code text, p_line_user_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r record;
begin
  select * into r from public.line_link_codes
   where code = btrim(p_code) and used_at is null and expires_at > now()
   limit 1;
  if r is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  update public.line_link_codes set used_at = now() where code = r.code;
  if r.driver_id is not null then
    update public.drivers set line_user_id = p_line_user_id, line_linked_at = now() where id = r.driver_id;
    return jsonb_build_object('ok', true, 'kind', 'driver', 'company_id', r.company_id,
      'name', (select name from public.drivers where id = r.driver_id));
  end if;
  perform set_config('app.bypass_profile_guard', 'on', true);
  update public.profiles set line_user_id = p_line_user_id, line_linked_at = now() where id = r.profile_id;
  perform set_config('app.bypass_profile_guard', 'off', true);
  return jsonb_build_object('ok', true, 'kind', 'staff', 'company_id', r.company_id,
    'name', (select coalesce(nullif(display_name, ''), email) from public.profiles where id = r.profile_id));
end $$;

-- LINE の連携を外す（ドライバー本人は自分の分だけ。admin は会社のドライバーの分も外せる）
create or replace function public.line_unlink(p_driver_id uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  cid uuid := public.current_company_id();
  own uuid := public.current_driver_id();
  did uuid;
begin
  if cid is null then
    raise exception 'ログインが必要です' using errcode = 'P0001';
  end if;
  if own is not null then
    did := own; -- ドライバー本人は自分の分だけ（引数は無視する）
  elsif p_driver_id is not null then
    if not public.is_admin() then
      raise exception '権限がありません' using errcode = 'P0001', hint = 'FORBIDDEN';
    end if;
    did := p_driver_id;
  end if;

  if did is not null then
    update public.drivers set line_user_id = '', line_linked_at = null where id = did and company_id = cid;
  else
    perform set_config('app.bypass_profile_guard', 'on', true);
    update public.profiles set line_user_id = '', line_linked_at = null where id = auth.uid() and company_id = cid;
    perform set_config('app.bypass_profile_guard', 'off', true);
  end if;
end $$;

-- =============================================================================
-- 会社を作ったときの既定データ（経費カテゴリ ＋ チャットのルーム）
-- =============================================================================
create or replace function public.company_seed_defaults()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.default_expense_categories(new.id);
  perform public.default_chat_channels(new.id);
  return new;
end $$;
drop trigger if exists t20_company_seed_defaults on public.companies;
create trigger t20_company_seed_defaults after insert on public.companies
  for each row execute function public.company_seed_defaults();

-- 既存の会社にもルームを用意する
do $$
declare c record;
begin
  for c in select id from public.companies loop
    perform public.default_chat_channels(c.id);
  end loop;
end $$;

-- =============================================================================
-- データ全削除に 0011 のテーブルを追加（reset_company_data を置き換え）
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
-- 権限（0006 と同じ方針を 0011 で追加したテーブル・ビュー・関数にも適用する）
-- =============================================================================
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;
grant execute on all functions in schema public to authenticated, service_role;

-- 機密テーブルはサービスロール専用（authenticated から権限そのものを外す）
revoke all on public.integration_secrets from authenticated, anon, public;
grant all on public.integration_secrets to service_role;

-- 内部用の関数は直接呼べないようにする
revoke execute on function public.apply_invitation(uuid, text, text) from authenticated, anon, public;
revoke execute on function public.write_audit(uuid, text, text, text, jsonb, jsonb) from authenticated, anon, public;
revoke execute on function public.ensure_driver_month(uuid, date, uuid) from authenticated, anon, public;
revoke execute on function public.import_has_id_conflict(uuid, jsonb) from authenticated, anon, public;
revoke execute on function public.handle_new_auth_user() from authenticated, anon, public;
revoke execute on function public.default_expense_categories(uuid) from authenticated, anon, public;
revoke execute on function public.default_chat_channels(uuid) from authenticated, anon, public;
revoke execute on function public.recalc_invoice(uuid) from anon, public;
revoke execute on function public.line_consume_code(text, text) from authenticated, anon, public;
