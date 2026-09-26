-- ページごとの権限（アカウント単位）
-- level: 0=見えない / 1=閲覧 / 2=操作 / 3=編集
-- 最上位管理者（is_super_admin）は常に全ページ「編集」で、権限管理画面を使える唯一のアカウント。
-- 行が無いページは role ごとの初期値（これまでの動作と同じ）になる。

-- ========== 最上位管理者 ==========
alter table public.users_profile
  add column if not exists is_super_admin boolean not null default false;

update public.users_profile p
set is_super_admin = true
from auth.users u
where u.id = p.id and lower(u.email) = 'nsasadeny@gmail.com';

-- ========== 権限テーブル ==========
create table if not exists public.user_page_permissions (
  user_id uuid not null references public.users_profile(id) on delete cascade,
  page_key text not null,
  level smallint not null check (level between 0 and 3),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  primary key (user_id, page_key)
);

alter table public.user_page_permissions enable row level security;

-- ========== 権限関数 ==========
create or replace function public.permission_page_keys()
returns text[]
language sql
immutable
as $$
  select array[
    'inventory', 'reserves', 'lending', 'sites', 'report', 'report_logs',
    'material_prices', 'logs', 'master', 'vehicles', 'workers', 'settings'
  ]::text[];
$$;

-- これまでの admin / user の動作に合わせた初期値
create or replace function public.default_page_level(p_role text, p_page text)
returns smallint
language sql
immutable
as $$
  select case
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

create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select is_super_admin from public.users_profile where id = auth.uid()), false);
$$;

-- ログイン中のアカウントのページ権限
create or replace function public.page_level(p_page text)
returns smallint
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select case
      when p.is_super_admin then 3
      else coalesce(up.level, public.default_page_level(p.role, p_page))
    end
    from public.users_profile p
    left join public.user_page_permissions up
      on up.user_id = p.id and up.page_key = p_page
    where p.id = auth.uid()
  ), 0)::smallint;
$$;

-- 画面用：自分の全ページ権限
create or replace function public.get_my_permissions()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'is_super_admin', public.is_super_admin(),
    'levels', coalesce((
      select jsonb_object_agg(k, public.page_level(k))
      from unnest(public.permission_page_keys()) as k
    ), '{}'::jsonb)
  );
$$;

-- 権限管理画面用：全アカウント×全ページ（最上位管理者のみ）
create or replace function public.get_permission_matrix()
returns table (
  user_id uuid,
  name text,
  email text,
  role text,
  is_super_admin boolean,
  page_key text,
  level smallint,
  default_level smallint
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_super_admin() then
    raise exception '権限がありません' using errcode = '42501';
  end if;

  return query
  select
    p.id,
    p.name,
    coalesce(u.email::text, p.email),
    p.role,
    p.is_super_admin,
    k,
    case
      when p.is_super_admin then 3::smallint
      else coalesce(up.level, public.default_page_level(p.role, k))
    end,
    public.default_page_level(p.role, k)
  from public.users_profile p
  left join auth.users u on u.id = p.id
  cross join unnest(public.permission_page_keys()) as k
  left join public.user_page_permissions up
    on up.user_id = p.id and up.page_key = k
  order by p.is_super_admin desc, p.role, p.name, k;
end;
$$;

-- 権限の変更（最上位管理者のみ）。p_level が null なら初期値に戻す。
create or replace function public.set_page_permission(p_user uuid, p_page text, p_level smallint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_target_super boolean;
  v_level smallint;
begin
  if not public.is_super_admin() then
    raise exception '権限がありません' using errcode = '42501';
  end if;
  if not (p_page = any(public.permission_page_keys())) then
    raise exception '不明なページです: %', p_page;
  end if;

  select role, is_super_admin into v_role, v_target_super
  from public.users_profile where id = p_user;
  if not found then
    raise exception 'アカウントが見つかりません';
  end if;
  if v_target_super then
    raise exception '最上位管理者の権限は変更できません';
  end if;

  v_level := coalesce(p_level, public.default_page_level(v_role, p_page));
  if v_level < 0 or v_level > 3 then
    raise exception '権限の値が不正です';
  end if;

  -- 初期値に戻す時も行は残す（リアルタイム通知を UPDATE で届けるため）
  insert into public.user_page_permissions (user_id, page_key, level, updated_at, updated_by)
  values (p_user, p_page, v_level, now(), auth.uid())
  on conflict (user_id, page_key)
  do update set level = excluded.level, updated_at = now(), updated_by = auth.uid();
end;
$$;

revoke all on function public.get_permission_matrix() from public, anon;
revoke all on function public.set_page_permission(uuid, text, smallint) from public, anon;
revoke all on function public.get_my_permissions() from anon;
grant execute on function public.get_permission_matrix() to authenticated;
grant execute on function public.set_page_permission(uuid, text, smallint) to authenticated;
grant execute on function public.get_my_permissions() to authenticated;

-- 権限テーブル：自分の行と、最上位管理者は全行を参照可。書込みは set_page_permission 経由のみ。
drop policy if exists "own or super admin can read permissions" on public.user_page_permissions;
create policy "own or super admin can read permissions" on public.user_page_permissions
  for select to authenticated
  using (user_id = auth.uid() or (select public.is_super_admin()));

-- 権限変更を開いている画面へリアルタイム通知
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'user_page_permissions'
  ) then
    alter publication supabase_realtime add table public.user_page_permissions;
  end if;
end $$;

-- ========== 各テーブルの書込み制限 ==========
-- 参照は複数ページで共有しているため従来どおり（材料単価のみ権限で制限）。
-- 書込みは「そのテーブルを書くページのいずれかで必要な権限があること」を条件にする。
-- ページ内のより細かい制限（自分が担当の現場のみ等）は画面側で行う。

-- inventory
drop policy if exists "全員が在庫を更新可能" on public.inventory;
drop policy if exists "auth_insert_inventory" on public.inventory;
drop policy if exists "管理者が在庫を登録可能" on public.inventory;
drop policy if exists "管理者が在庫を削除可能" on public.inventory;
create policy "perm_insert_inventory" on public.inventory
  for insert to authenticated
  with check ((select public.page_level('report')) >= 2 or (select public.page_level('master')) >= 2);
create policy "perm_update_inventory" on public.inventory
  for update to authenticated
  using (
    (select public.page_level('inventory')) >= 2
    or (select public.page_level('report')) >= 2
    or (select public.page_level('master')) >= 2
  );
create policy "perm_delete_inventory" on public.inventory
  for delete to authenticated
  using ((select public.page_level('master')) >= 3);

-- inventory_logs
drop policy if exists "認証ユーザーがログを挿入可能" on public.inventory_logs;
create policy "perm_insert_inventory_logs" on public.inventory_logs
  for insert to authenticated
  with check (
    auth.uid() = user_id
    and ((select public.page_level('inventory')) >= 2 or (select public.page_level('report')) >= 2)
  );

-- daily_reports
drop policy if exists "insert_daily_reports" on public.daily_reports;
drop policy if exists "update_daily_reports" on public.daily_reports;
create policy "perm_insert_daily_reports" on public.daily_reports
  for insert to authenticated
  with check (user_id = auth.uid() and (select public.page_level('report')) >= 2);
create policy "perm_update_daily_reports" on public.daily_reports
  for update to authenticated
  using (user_id = auth.uid() and (select public.page_level('report')) >= 2)
  with check (user_id = auth.uid());

-- daily_report_materials
drop policy if exists "insert_daily_report_materials" on public.daily_report_materials;
drop policy if exists "delete_daily_report_materials" on public.daily_report_materials;
create policy "perm_insert_daily_report_materials" on public.daily_report_materials
  for insert to authenticated
  with check ((select public.page_level('report')) >= 2);
create policy "perm_delete_daily_report_materials" on public.daily_report_materials
  for delete to authenticated
  using ((select public.page_level('report')) >= 2);

-- lending_items（貸出品マスタ）
drop policy if exists "auth_insert_lending_items" on public.lending_items;
drop policy if exists "auth_update_lending_items" on public.lending_items;
drop policy if exists "auth_delete_lending_items" on public.lending_items;
create policy "perm_insert_lending_items" on public.lending_items
  for insert to authenticated with check ((select public.page_level('lending')) >= 3);
create policy "perm_update_lending_items" on public.lending_items
  for update to authenticated using ((select public.page_level('lending')) >= 3);
create policy "perm_delete_lending_items" on public.lending_items
  for delete to authenticated using ((select public.page_level('lending')) >= 3);

-- lending_records
drop policy if exists "auth_insert_lending_records" on public.lending_records;
drop policy if exists "auth_update_lending_records" on public.lending_records;
drop policy if exists "auth_delete_lending_records" on public.lending_records;
create policy "perm_insert_lending_records" on public.lending_records
  for insert to authenticated with check ((select public.page_level('lending')) >= 2);
create policy "perm_update_lending_records" on public.lending_records
  for update to authenticated
  using ((select public.page_level('lending')) >= 2 or (select public.page_level('sites')) >= 3);
create policy "perm_delete_lending_records" on public.lending_records
  for delete to authenticated using ((select public.page_level('lending')) >= 3);

-- material_prices（材料単価）：参照も権限で制限
drop policy if exists "Authenticated users can manage material_prices" on public.material_prices;
drop policy if exists "Authenticated users can read material_prices" on public.material_prices;
create policy "perm_select_material_prices" on public.material_prices
  for select to authenticated using ((select public.page_level('material_prices')) >= 1);
create policy "perm_insert_material_prices" on public.material_prices
  for insert to authenticated with check ((select public.page_level('material_prices')) >= 2);
create policy "perm_update_material_prices" on public.material_prices
  for update to authenticated using ((select public.page_level('material_prices')) >= 3);
create policy "perm_delete_material_prices" on public.material_prices
  for delete to authenticated using ((select public.page_level('material_prices')) >= 3);

-- material_reserve_items
drop policy if exists "auth_insert_reserve_items" on public.material_reserve_items;
drop policy if exists "auth_update_reserve_items" on public.material_reserve_items;
drop policy if exists "auth_delete_reserve_items" on public.material_reserve_items;
create policy "perm_insert_reserve_items" on public.material_reserve_items
  for insert to authenticated
  with check ((select public.page_level('inventory')) >= 2);
create policy "perm_update_reserve_items" on public.material_reserve_items
  for update to authenticated
  using (
    (select public.page_level('inventory')) >= 2
    or (select public.page_level('reserves')) >= 2
    or (select public.page_level('report')) >= 2
  );
create policy "perm_delete_reserve_items" on public.material_reserve_items
  for delete to authenticated
  using ((select public.page_level('reserves')) >= 2 or (select public.page_level('report')) >= 2);

-- material_reserve_logs
drop policy if exists "auth_insert_reserve_logs" on public.material_reserve_logs;
drop policy if exists "auth_delete_reserve_logs" on public.material_reserve_logs;
create policy "perm_insert_reserve_logs" on public.material_reserve_logs
  for insert to authenticated with check ((select public.page_level('inventory')) >= 2);
create policy "perm_delete_reserve_logs" on public.material_reserve_logs
  for delete to authenticated using ((select public.page_level('reserves')) >= 3);

-- material_reserve_sites（現場）
drop policy if exists "auth_insert_reserve_sites" on public.material_reserve_sites;
drop policy if exists "auth_update_reserve_sites" on public.material_reserve_sites;
drop policy if exists "auth_delete_reserve_sites" on public.material_reserve_sites;
create policy "perm_insert_reserve_sites" on public.material_reserve_sites
  for insert to authenticated
  with check (
    (select public.page_level('inventory')) >= 2
    or (select public.page_level('lending')) >= 2
    or (select public.page_level('report')) >= 2
  );
create policy "perm_update_reserve_sites" on public.material_reserve_sites
  for update to authenticated
  using (
    (select public.page_level('inventory')) >= 2
    or (select public.page_level('lending')) >= 2
    or (select public.page_level('report')) >= 2
    or (select public.page_level('sites')) >= 3
  );
create policy "perm_delete_reserve_sites" on public.material_reserve_sites
  for delete to authenticated using ((select public.page_level('reserves')) >= 2);

-- site_details（現場詳細）
drop policy if exists "auth_insert_site_details" on public.site_details;
drop policy if exists "auth_update_site_details" on public.site_details;
drop policy if exists "auth_delete_site_details" on public.site_details;
create policy "perm_insert_site_details" on public.site_details
  for insert to authenticated with check ((select public.page_level('sites')) >= 2);
create policy "perm_update_site_details" on public.site_details
  for update to authenticated using ((select public.page_level('sites')) >= 2);
create policy "perm_delete_site_details" on public.site_details
  for delete to authenticated using ((select public.page_level('sites')) >= 3);

-- vehicles（車両）
drop policy if exists "authenticated users can insert vehicles" on public.vehicles;
drop policy if exists "authenticated users can update vehicles" on public.vehicles;
drop policy if exists "authenticated users can delete vehicles" on public.vehicles;
create policy "perm_insert_vehicles" on public.vehicles
  for insert to authenticated with check ((select public.page_level('vehicles')) >= 2);
create policy "perm_update_vehicles" on public.vehicles
  for update to authenticated using ((select public.page_level('vehicles')) >= 2);
create policy "perm_delete_vehicles" on public.vehicles
  for delete to authenticated using ((select public.page_level('vehicles')) >= 3);

-- 作業員名簿の最終ログイン：作業員名簿を閲覧できる人のみ
create or replace function public.get_users_last_sign_in()
returns table(user_id uuid, last_sign_in_at timestamptz)
language sql
security definer
set search_path = public
as $$
  select id, last_sign_in_at from auth.users
  where public.page_level('workers') >= 1;
$$;
