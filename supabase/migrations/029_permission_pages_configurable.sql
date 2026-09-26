-- 「権限管理」「操作ログ」もページ権限として設定できるようにする（初期値は全員「見えない」＝社長のみ）
-- 権限管理：閲覧＝見るだけ / 操作＝アカウントのプリセット割当・個別設定 / 編集＝プリセットの中身も変更
-- 操作ログ：閲覧＝見る
-- 安全策（社長以外）：自分自身・社長は変更不可、自分のプリセットの中身は変更不可、
--                     「権限管理」「操作ログ」の権限は社長だけが変更できる

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

create or replace function public.default_page_level(p_role text, p_page text)
returns smallint
language sql
immutable
set search_path = public
as $$
  select case
    when p_page in ('permissions', 'operation_logs') then 0
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

insert into public.permission_preset_levels (preset_key, page_key, level)
select ps.key, k, 0
from public.permission_presets ps
cross join unnest(array['permissions', 'operation_logs']) as k
on conflict (preset_key, page_key) do nothing;

-- 社長だけが変更できるページ
create or replace function public.is_protected_permission_page(p_page text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p_page in ('permissions', 'operation_logs');
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
    else coalesce(p_key, '')
  end;
$$;

-- アカウントの権限を変更してよいか（社長以外は制限付き）
create or replace function public.assert_can_manage_account(p_user uuid, p_page text)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_target_super boolean;
begin
  select is_super_admin into v_target_super from public.users_profile where id = p_user;
  if not found then
    raise exception 'アカウントが見つかりません';
  end if;
  if v_target_super then
    raise exception '社長の権限は変更できません';
  end if;
  if public.is_super_admin() then
    return;
  end if;
  if public.page_level('permissions') < 2 then
    raise exception '権限がありません' using errcode = '42501';
  end if;
  if p_user = auth.uid() then
    raise exception '自分自身の権限は変更できません' using errcode = '42501';
  end if;
  if p_page is not null and public.is_protected_permission_page(p_page) then
    raise exception '「%」の権限は社長だけが変更できます', public.op_page_label(p_page) using errcode = '42501';
  end if;
end;
$$;

create or replace function public.get_permission_matrix()
returns table (
  user_id uuid,
  name text,
  email text,
  role text,
  is_super_admin boolean,
  preset_key text,
  page_key text,
  level smallint,
  override_level smallint,
  preset_level smallint
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if public.page_level('permissions') < 1 then
    raise exception '権限がありません' using errcode = '42501';
  end if;

  return query
  select
    p.id,
    p.name,
    coalesce(u.email::text, p.email),
    p.role,
    p.is_super_admin,
    upr.preset_key,
    k,
    case
      when p.is_super_admin then 3::smallint
      else coalesce(up.level, pl.level, public.default_page_level(p.role, k))
    end,
    up.level,
    coalesce(pl.level, public.default_page_level(p.role, k))
  from public.users_profile p
  left join auth.users u on u.id = p.id
  left join public.user_presets upr on upr.user_id = p.id
  cross join unnest(public.permission_page_keys()) as k
  left join public.user_page_permissions up
    on up.user_id = p.id and up.page_key = k
  left join public.permission_preset_levels pl
    on pl.preset_key = upr.preset_key and pl.page_key = k
  order by p.is_super_admin desc, p.role, p.name, k;
end;
$$;

create or replace function public.set_page_permission(p_user uuid, p_page text, p_level smallint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (p_page = any(public.permission_page_keys())) then
    raise exception '不明なページです: %', p_page;
  end if;
  if p_level is not null and (p_level < 0 or p_level > 3) then
    raise exception '権限の値が不正です';
  end if;
  perform public.assert_can_manage_account(p_user, p_page);

  insert into public.user_page_permissions (user_id, page_key, level, updated_at, updated_by)
  values (p_user, p_page, p_level, now(), auth.uid())
  on conflict (user_id, page_key)
  do update set level = excluded.level, updated_at = now(), updated_by = auth.uid();
end;
$$;

create or replace function public.set_user_preset(p_user uuid, p_preset text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_department text;
begin
  select department into v_department from public.permission_presets where key = p_preset;
  if not found then
    raise exception '不明なプリセットです: %', p_preset;
  end if;
  perform public.assert_can_manage_account(p_user, null);

  insert into public.user_presets (user_id, preset_key, updated_at)
  values (p_user, p_preset, now())
  on conflict (user_id) do update set preset_key = excluded.preset_key, updated_at = now();

  update public.users_profile
  set role = case when v_department = 'office' then 'admin' else 'user' end
  where id = p_user;
end;
$$;

create or replace function public.set_preset_level(p_preset text, p_page text, p_level smallint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.permission_presets where key = p_preset) then
    raise exception '不明なプリセットです: %', p_preset;
  end if;
  if not (p_page = any(public.permission_page_keys())) then
    raise exception '不明なページです: %', p_page;
  end if;
  if p_level is null or p_level < 0 or p_level > 3 then
    raise exception '権限の値が不正です';
  end if;
  if not public.is_super_admin() then
    if public.page_level('permissions') < 3 then
      raise exception '権限がありません' using errcode = '42501';
    end if;
    if public.is_protected_permission_page(p_page) then
      raise exception '「%」の権限は社長だけが変更できます', public.op_page_label(p_page) using errcode = '42501';
    end if;
    if exists (select 1 from public.user_presets where user_id = auth.uid() and preset_key = p_preset) then
      raise exception '自分に割り当てられたプリセットは変更できません' using errcode = '42501';
    end if;
  end if;

  insert into public.permission_preset_levels (preset_key, page_key, level, updated_at)
  values (p_preset, p_page, p_level, now())
  on conflict (preset_key, page_key) do update set level = excluded.level, updated_at = now();
end;
$$;

revoke execute on function public.assert_can_manage_account(uuid, text) from public, anon, authenticated;

-- 操作ログ：「操作ログ」閲覧以上
create or replace function public.search_operation_logs(
  p_query text default null,
  p_user_id uuid default null,
  p_category text default null,
  p_action text default null,
  p_item text default null,
  p_site text default null,
  p_company text default null,
  p_word text default null,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_limit int default 50,
  p_offset int default 0
)
returns table (
  id bigint,
  created_at timestamptz,
  user_id uuid,
  user_name text,
  action text,
  category text,
  summary text,
  item_name text,
  site_name text,
  company_name text,
  old_data jsonb,
  new_data jsonb,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_terms text[];
begin
  if public.page_level('operation_logs') < 1 then
    raise exception '権限がありません' using errcode = '42501';
  end if;

  v_terms := array(
    select lower(t) from regexp_split_to_table(coalesce(trim(p_query), ''), '[\s　]+') t where t <> ''
  );

  return query
  select
    l.id, l.created_at, l.user_id, l.user_name, l.action, l.category, l.summary,
    l.item_name, l.site_name, l.company_name, l.old_data, l.new_data,
    count(*) over ()
  from public.operation_logs l
  where (p_user_id is null or l.user_id = p_user_id)
    and (p_category is null or p_category = '' or l.category = p_category)
    and (p_action is null or p_action = '' or l.action = p_action)
    and (p_item is null or p_item = '' or l.item_name ilike '%' || p_item || '%')
    and (p_site is null or p_site = '' or l.site_name ilike '%' || p_site || '%')
    and (p_company is null or p_company = '' or l.company_name ilike '%' || p_company || '%')
    and (p_word is null or p_word = '' or l.summary ilike '%' || p_word || '%')
    and (p_from is null or l.created_at >= p_from)
    and (p_to is null or l.created_at < p_to)
    and not exists (
      select 1 from unnest(v_terms) term where l.search_text not like '%' || term || '%'
    )
  order by l.created_at desc, l.id desc
  limit greatest(1, least(coalesce(p_limit, 50), 500))
  offset greatest(0, coalesce(p_offset, 0));
end;
$$;

create or replace function public.operation_log_suggestions()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if public.page_level('operation_logs') < 1 then
    raise exception '権限がありません' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'items', coalesce((select jsonb_agg(v order by v) from (select distinct item_name v from public.operation_logs where item_name <> '' limit 1000) x), '[]'::jsonb),
    'sites', coalesce((select jsonb_agg(v order by v) from (select distinct site_name v from public.operation_logs where site_name <> '' limit 1000) x), '[]'::jsonb),
    'companies', coalesce((select jsonb_agg(v order by v) from (select distinct company_name v from public.operation_logs where company_name <> '' limit 1000) x), '[]'::jsonb),
    'users', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name) order by name)
                        from public.users_profile), '[]'::jsonb)
  );
end;
$$;
