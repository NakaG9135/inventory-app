-- 権限関数はログイン済みユーザーのみ実行可能にする（未ログインでは使わない）
revoke execute on function public.get_my_permissions() from public, anon;
revoke execute on function public.is_super_admin() from public, anon;
revoke execute on function public.page_level(text) from public, anon;
revoke execute on function public.get_users_last_sign_in() from public, anon;
grant execute on function public.get_my_permissions() to authenticated;
grant execute on function public.is_super_admin() to authenticated;
grant execute on function public.page_level(text) to authenticated;
grant execute on function public.get_users_last_sign_in() to authenticated;

alter function public.permission_page_keys() set search_path = public;
alter function public.default_page_level(text, text) set search_path = public;
