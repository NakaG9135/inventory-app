-- 従業員名簿（社長専用。ページ権限「従業員名簿」、初期値は全員「見えない」、許可できるのは社長のみ）
-- 閲覧＝見るだけ / 操作・編集＝編集できる
-- 接続ログ（IP・端末）と位置情報ログも記録する

-- ========== ページ権限に「従業員名簿」を追加 ==========
create or replace function public.permission_page_keys()
returns text[]
language sql
immutable
set search_path = public
as $$
  select array[
    'inventory', 'reserves', 'lending', 'sites', 'report', 'report_logs',
    'material_prices', 'logs', 'master', 'vehicles', 'workers', 'settings',
    'permissions', 'operation_logs', 'employees'
  ]::text[];
$$;

create or replace function public.default_page_level(p_role text, p_page text)
returns smallint
language sql
immutable
set search_path = public
as $$
  select case
    when p_page in ('permissions', 'operation_logs', 'employees') then 0
    when p_role = 'admin' then
      case when p_page = 'material_prices' then 1 else 3 end
    else
      case p_page
        when 'inventory' then 2
        when 'reserves' then 2
        when 'lending' then 2
        when 'sites' then 2
        when 'report' then 2
        when 'report_logs' then 1
        else 0
      end
  end::smallint;
$$;

create or replace function public.is_protected_permission_page(p_page text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p_page in ('permissions', 'operation_logs', 'employees');
$$;

create or replace function public.op_page_label(p_key text)
returns text
language sql
immutable
set search_path = public
as $$
  select case p_key
    when 'inventory' then '在庫一覧'
    when 'reserves' then '材料確保'
    when 'lending' then '貸出管理'
    when 'sites' then '現場リスト'
    when 'report' then '日報'
    when 'report_logs' then '日報ログ'
    when 'material_prices' then '材料単価'
    when 'logs' then '入出庫ログ'
    when 'master' then '商品マスタ'
    when 'vehicles' then '車両管理'
    when 'workers' then '作業員名簿'
    when 'settings' then 'システム設定'
    when 'permissions' then '権限管理'
    when 'operation_logs' then '操作ログ'
    when 'employees' then '従業員名簿'
    else coalesce(p_key, '')
  end;
$$;

insert into public.permission_preset_levels (preset_key, page_key, level)
select key, 'employees', 0 from public.permission_presets
on conflict (preset_key, page_key) do nothing;

create or replace function public.emp_can_view()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.page_level('employees') >= 1;
$$;

create or replace function public.emp_can_edit()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.page_level('employees') >= 2;
$$;

-- ========== 従業員 ==========
create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references public.users_profile(id) on delete set null,
  name text not null default '',
  name_kana text not null default '',
  department text not null default '',
  position text not null default '',
  employment_type text not null default '',
  gender text not null default '',
  birth_date date,
  phone text not null default '',
  email text not null default '',
  current_address text not null default '',
  family_address text not null default '',
  marital_status text not null default '',
  spouse_name text not null default '',
  hire_date date,
  leave_date date,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.employee_children (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  name text not null default '',
  birth_date date,
  notes text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.employee_emergency_contacts (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  name text not null default '',
  relationship text not null default '',
  phone text not null default '',
  address text not null default '',
  notes text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.employee_vehicles (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  maker text not null default '',
  model text not null default '',
  plate_number text not null default '',
  color text not null default '',
  inspection_expiry date,
  insurance_expiry date,
  notes text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.employee_qualifications (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  kind text not null default '資格',
  name text not null default '',
  number text not null default '',
  acquired_date date,
  expiry_date date,
  paid_by text not null default '',
  cost numeric,
  notes text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.employee_payments (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  kind text not null default '',
  paid_date date,
  amount numeric,
  notes text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.employee_leaves (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  leave_type text not null default '',
  start_date date,
  end_date date,
  days numeric,
  notes text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists employee_children_emp_idx on public.employee_children (employee_id);
create index if not exists employee_contacts_emp_idx on public.employee_emergency_contacts (employee_id);
create index if not exists employee_vehicles_emp_idx on public.employee_vehicles (employee_id);
create index if not exists employee_quals_emp_idx on public.employee_qualifications (employee_id);
create index if not exists employee_payments_emp_idx on public.employee_payments (employee_id);
create index if not exists employee_leaves_emp_idx on public.employee_leaves (employee_id, start_date);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists employees_touch_updated_at on public.employees;
create trigger employees_touch_updated_at before update on public.employees
  for each row execute function public.touch_updated_at();

-- RLS：閲覧は「従業員名簿」閲覧以上、変更は操作以上
do $$
declare
  t text;
begin
  foreach t in array array[
    'employees', 'employee_children', 'employee_emergency_contacts', 'employee_vehicles',
    'employee_qualifications', 'employee_payments', 'employee_leaves'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "emp_select" on public.%I', t);
    execute format('drop policy if exists "emp_insert" on public.%I', t);
    execute format('drop policy if exists "emp_update" on public.%I', t);
    execute format('drop policy if exists "emp_delete" on public.%I', t);
    execute format('create policy "emp_select" on public.%I for select to authenticated using ((select public.emp_can_view()))', t);
    execute format('create policy "emp_insert" on public.%I for insert to authenticated with check ((select public.emp_can_edit()))', t);
    execute format('create policy "emp_update" on public.%I for update to authenticated using ((select public.emp_can_edit()))', t);
    execute format('create policy "emp_delete" on public.%I for delete to authenticated using ((select public.emp_can_edit()))', t);
  end loop;
end $$;

-- 既存アカウントを名簿に登録（部署・役職はプリセットから）
insert into public.employees (user_id, name, email, department, position)
select
  p.id,
  coalesce(p.name, ''),
  coalesce(u.email::text, p.email, ''),
  case
    when p.is_super_admin then ''
    when ps.department = 'office' then '総務部'
    when ps.department = 'construction' then '工事部'
    else ''
  end,
  case
    when p.is_super_admin then '社長'
    when ps.label is not null then regexp_replace(ps.label, '^(総務部|工事部)', '')
    else ''
  end
from public.users_profile p
left join auth.users u on u.id = p.id
left join public.user_presets up on up.user_id = p.id
left join public.permission_presets ps on ps.key = up.preset_key
on conflict (user_id) do nothing;

-- 新しく登録されたアカウントも名簿に追加
create or replace function public.add_employee_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.employees (user_id, name, email, department, position)
  values (new.id, coalesce(new.name, ''), coalesce(new.email, ''),
          case when new.role = 'admin' then '総務部' else '工事部' end,
          case when new.role = 'admin' then '事務' else '作業員' end)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

revoke execute on function public.add_employee_for_new_user() from public, anon, authenticated;

drop trigger if exists on_users_profile_created_add_employee on public.users_profile;
create trigger on_users_profile_created_add_employee
  after insert on public.users_profile
  for each row execute function public.add_employee_for_new_user();

-- ========== 接続ログ ==========
create table if not exists public.access_logs (
  id bigserial primary key,
  user_id uuid not null references public.users_profile(id) on delete cascade,
  created_at timestamptz not null default now(),
  event text not null default 'open',
  ip text not null default '',
  user_agent text not null default '',
  device_type text not null default '',
  os text not null default '',
  os_version text not null default '',
  browser text not null default '',
  browser_version text not null default '',
  device_model text not null default '',
  is_installed boolean,
  extra jsonb
);
create index if not exists access_logs_user_idx on public.access_logs (user_id, created_at desc);

create table if not exists public.location_logs (
  id bigserial primary key,
  user_id uuid not null references public.users_profile(id) on delete cascade,
  created_at timestamptz not null default now(),
  status text not null,
  latitude double precision,
  longitude double precision,
  accuracy double precision
);
create index if not exists location_logs_user_idx on public.location_logs (user_id, created_at desc);

alter table public.access_logs enable row level security;
alter table public.location_logs enable row level security;
drop policy if exists "emp_select" on public.access_logs;
create policy "emp_select" on public.access_logs for select to authenticated using ((select public.emp_can_view()));
drop policy if exists "emp_select" on public.location_logs;
create policy "emp_select" on public.location_logs for select to authenticated using ((select public.emp_can_view()));

-- 記録は本人だけ（IP と User-Agent は通信のヘッダーから取得。画面から渡された値は使わない）
create or replace function public.log_access(p_event text, p_info jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_headers json := nullif(current_setting('request.headers', true), '')::json;
  v_ip text;
begin
  if auth.uid() is null then
    return;
  end if;
  v_ip := coalesce(
    nullif(v_headers->>'cf-connecting-ip', ''),
    nullif(v_headers->>'x-real-ip', ''),
    nullif(trim(split_part(coalesce(v_headers->>'x-forwarded-for', ''), ',', 1)), ''),
    ''
  );
  insert into public.access_logs (
    user_id, event, ip, user_agent, device_type, os, os_version, browser, browser_version,
    device_model, is_installed, extra
  ) values (
    auth.uid(),
    left(coalesce(nullif(p_event, ''), 'open'), 20),
    v_ip,
    left(coalesce(v_headers->>'user-agent', ''), 500),
    left(coalesce(p_info->>'device_type', ''), 50),
    left(coalesce(p_info->>'os', ''), 50),
    left(coalesce(p_info->>'os_version', ''), 50),
    left(coalesce(p_info->>'browser', ''), 50),
    left(coalesce(p_info->>'browser_version', ''), 50),
    left(coalesce(p_info->>'device_model', ''), 100),
    (p_info->>'is_installed')::boolean,
    p_info->'extra'
  );
end;
$$;

create or replace function public.log_location(p_status text, p_latitude double precision, p_longitude double precision, p_accuracy double precision)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return;
  end if;
  if p_status not in ('ok', 'denied', 'unavailable', 'timeout', 'unsupported') then
    raise exception '不正な状態です';
  end if;
  insert into public.location_logs (user_id, status, latitude, longitude, accuracy)
  values (
    auth.uid(), p_status,
    case when p_status = 'ok' then p_latitude end,
    case when p_status = 'ok' then p_longitude end,
    case when p_status = 'ok' then p_accuracy end
  );
end;
$$;

revoke execute on function public.log_access(text, jsonb) from public, anon;
revoke execute on function public.log_location(text, double precision, double precision, double precision) from public, anon;
grant execute on function public.log_access(text, jsonb) to authenticated;
grant execute on function public.log_location(text, double precision, double precision, double precision) to authenticated;

-- 一覧用：各アカウントの最終接続
create or replace function public.employee_last_access()
returns table (user_id uuid, last_at timestamptz, ip text, device_type text, os text, os_version text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.emp_can_view() then
    raise exception '権限がありません' using errcode = '42501';
  end if;
  return query
  select distinct on (a.user_id) a.user_id, a.created_at, a.ip, a.device_type, a.os, a.os_version
  from public.access_logs a
  order by a.user_id, a.created_at desc;
end;
$$;

revoke execute on function public.employee_last_access() from public, anon;
grant execute on function public.employee_last_access() to authenticated;
revoke execute on function public.emp_can_view() from public, anon;
revoke execute on function public.emp_can_edit() from public, anon;
grant execute on function public.emp_can_view() to authenticated;
grant execute on function public.emp_can_edit() to authenticated;
