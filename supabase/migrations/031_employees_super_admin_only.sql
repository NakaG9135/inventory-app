-- 従業員名簿を権限管理から外し、社長だけが使える隠しページにする

-- ページ権限の一覧から外す
create or replace function public.permission_page_keys()
returns text[]
language sql
immutable
set search_path = public
as $$
  select array[
    'inventory', 'reserves', 'lending', 'sites', 'report', 'report_logs',
    'material_prices', 'logs', 'master', 'vehicles', 'workers', 'settings',
    'permissions', 'operation_logs'
  ]::text[];
$$;

create or replace function public.is_protected_permission_page(p_page text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p_page in ('permissions', 'operation_logs');
$$;

delete from public.permission_preset_levels where page_key = 'employees';
delete from public.user_page_permissions where page_key = 'employees';

-- 名簿・接続ログ・位置情報は社長のみ
create or replace function public.emp_can_view()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_super_admin();
$$;

create or replace function public.emp_can_edit()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_super_admin();
$$;

-- 名簿の存在が分かる操作ログを消す
delete from public.operation_logs
where table_name in ('permission_preset_levels', 'user_page_permissions')
  and coalesce(new_data->>'page_key', old_data->>'page_key') = 'employees';

-- 未ログインの利用者からは名簿のテーブルを一切参照できないようにする
revoke all on public.employees, public.employee_children, public.employee_emergency_contacts,
  public.employee_vehicles, public.employee_qualifications, public.employee_payments,
  public.employee_leaves, public.access_logs, public.location_logs from anon;
