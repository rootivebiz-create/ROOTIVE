-- =============================================================================
-- 0006 Storage（backups バケット）と権限の最終調整
-- =============================================================================

-- backups バケット（非公開）
insert into storage.buckets (id, name, public)
values ('backups', 'backups', false)
on conflict (id) do nothing;

-- 会社フォルダ配下のみ、owner/admin が閲覧・作成できる（実際の保存はサーバーのサービスロールで行う）
drop policy if exists backups_select on storage.objects;
create policy backups_select on storage.objects for select to authenticated
  using (bucket_id = 'backups' and public.is_admin() and (storage.foldername(name))[1] = public.current_company_id()::text);
drop policy if exists backups_insert on storage.objects;
create policy backups_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'backups' and public.is_admin() and (storage.foldername(name))[1] = public.current_company_id()::text);

-- anon には一切の権限を与えない
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;
revoke usage on schema public from anon;

-- authenticated / service_role
grant usage on schema public to authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;
grant execute on all functions in schema public to authenticated, service_role;

-- 今後作成されるオブジェクトにも anon 権限を付けない
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on functions from anon;
alter default privileges in schema public revoke all on sequences from anon;

-- 招待トリガー用：auth 管理ロールが関数を実行できること（security definer なのでテーブル権限は不要）
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    grant usage on schema public to supabase_auth_admin;
    grant execute on function public.handle_new_auth_user() to supabase_auth_admin;
    grant execute on function public.apply_invitation(uuid, text) to supabase_auth_admin;
  end if;
end $$;
