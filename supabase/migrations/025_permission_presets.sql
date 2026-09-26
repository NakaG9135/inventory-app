-- 権限プリセット（事務部 / 工事部作業員・工事部主任・工事部課長・工事部次長・工事部部長）
-- 実際の権限 = 個別設定 > 割り当てたプリセット > role ごとの初期値
-- 社長（is_super_admin）は常に全ページ「編集」

-- ========== プリセット ==========
create table if not exists public.permission_presets (
  key text primary key,
  department text not null check (department in ('office', 'construction')),
  label text not null,
  sort_order int not null default 0
);

insert into public.permission_presets (key, department, label, sort_order) values
  ('office', 'office', '事務部', 10),
  ('construction_worker', 'construction', '工事部作業員', 20),
  ('construction_shunin', 'construction', '工事部主任', 30),
  ('construction_kacho', 'construction', '工事部課長', 40),
  ('construction_jicho', 'construction', '工事部次長', 50),
  ('construction_bucho', 'construction', '工事部部長', 60)
on conflict (key) do nothing;

create table if not exists public.permission_preset_levels (
  preset_key text not null references public.permission_presets(key) on delete cascade,
  page_key text not null,
  level smallint not null check (level between 0 and 3),
  updated_at timestamptz not null default now(),
  primary key (preset_key, page_key)
);

-- 初期値：事務部＝これまでの管理者（材料単価は操作）、工事部の5種＝これまでの一般
insert into public.permission_preset_levels (preset_key, page_key, level)
select ps.key, k,
  case
    when ps.department = 'office' and k = 'material_prices' then 2
    when ps.department = 'office' then public.default_page_level('admin', k)
    else public.default_page_level('user', k)
  end
from public.permission_presets ps
cross join unnest(public.permission_page_keys()) as k
on conflict (preset_key, page_key) do nothing;

-- ========== アカウントへの割り当て ==========
create table if not exists public.user_presets (
  user_id uuid primary key references public.users_profile(id) on delete cascade,
  preset_key text not null references public.permission_presets(key),
  updated_at timestamptz not null default now()
);

insert into public.user_presets (user_id, preset_key)
select id, case when role = 'admin' then 'office' else 'construction_worker' end
from public.users_profile
where not is_super_admin
on conflict (user_id) do nothing;

-- 新規登録されたアカウントは role に応じて自動で割り当て
create or replace function public.assign_default_preset()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not coalesce(new.is_super_admin, false) then
    insert into public.user_presets (user_id, preset_key)
    values (new.id, case when new.role = 'admin' then 'office' else 'construction_worker' end)
    on conflict (user_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists on_users_profile_created_assign_preset on public.users_profile;
create trigger on_users_profile_created_assign_preset
  after insert on public.users_profile
  for each row execute function public.assign_default_preset();

-- ========== 個別設定：level が null ならプリセットに従う ==========
alter table public.user_page_permissions alter column level drop not null;

-- これまでの行のうち、プリセットと同じ値のものは「プリセットに従う」にする
update public.user_page_permissions up
set level = null
from public.user_presets upr
join public.permission_preset_levels pl on pl.preset_key = upr.preset_key
where upr.user_id = up.user_id
  and pl.page_key = up.page_key
  and up.level = pl.level;

-- ========== 権限の計算 ==========
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
      else coalesce(up.level, pl.level, public.default_page_level(p.role, p_page))
    end
    from public.users_profile p
    left join public.user_page_permissions up
      on up.user_id = p.id and up.page_key = p_page
    left join public.user_presets upr on upr.user_id = p.id
    left join public.permission_preset_levels pl
      on pl.preset_key = upr.preset_key and pl.page_key = p_page
    where p.id = auth.uid()
  ), 0)::smallint;
$$;

drop function if exists public.get_permission_matrix();
create function public.get_permission_matrix()
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

-- 個別設定（p_level が null ならプリセットに従う）
create or replace function public.set_page_permission(p_user uuid, p_page text, p_level smallint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target_super boolean;
begin
  if not public.is_super_admin() then
    raise exception '権限がありません' using errcode = '42501';
  end if;
  if not (p_page = any(public.permission_page_keys())) then
    raise exception '不明なページです: %', p_page;
  end if;
  if p_level is not null and (p_level < 0 or p_level > 3) then
    raise exception '権限の値が不正です';
  end if;

  select is_super_admin into v_target_super from public.users_profile where id = p_user;
  if not found then
    raise exception 'アカウントが見つかりません';
  end if;
  if v_target_super then
    raise exception '社長の権限は変更できません';
  end if;

  -- 行は消さずに null にする（リアルタイム通知を UPDATE で届けるため）
  insert into public.user_page_permissions (user_id, page_key, level, updated_at, updated_by)
  values (p_user, p_page, p_level, now(), auth.uid())
  on conflict (user_id, page_key)
  do update set level = excluded.level, updated_at = now(), updated_by = auth.uid();
end;
$$;

-- プリセットの割り当て（部署に合わせて role も変える：作業員一覧は工事部＝user を表示するため）
create or replace function public.set_user_preset(p_user uuid, p_preset text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target_super boolean;
  v_department text;
begin
  if not public.is_super_admin() then
    raise exception '権限がありません' using errcode = '42501';
  end if;
  select department into v_department from public.permission_presets where key = p_preset;
  if not found then
    raise exception '不明なプリセットです: %', p_preset;
  end if;
  select is_super_admin into v_target_super from public.users_profile where id = p_user;
  if not found then
    raise exception 'アカウントが見つかりません';
  end if;
  if v_target_super then
    raise exception '社長の権限は変更できません';
  end if;

  insert into public.user_presets (user_id, preset_key, updated_at)
  values (p_user, p_preset, now())
  on conflict (user_id) do update set preset_key = excluded.preset_key, updated_at = now();

  update public.users_profile
  set role = case when v_department = 'office' then 'admin' else 'user' end
  where id = p_user;
end;
$$;

-- プリセットの中身の変更
create or replace function public.set_preset_level(p_preset text, p_page text, p_level smallint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_super_admin() then
    raise exception '権限がありません' using errcode = '42501';
  end if;
  if not exists (select 1 from public.permission_presets where key = p_preset) then
    raise exception '不明なプリセットです: %', p_preset;
  end if;
  if not (p_page = any(public.permission_page_keys())) then
    raise exception '不明なページです: %', p_page;
  end if;
  if p_level is null or p_level < 0 or p_level > 3 then
    raise exception '権限の値が不正です';
  end if;

  insert into public.permission_preset_levels (preset_key, page_key, level, updated_at)
  values (p_preset, p_page, p_level, now())
  on conflict (preset_key, page_key) do update set level = excluded.level, updated_at = now();
end;
$$;

revoke execute on function public.get_permission_matrix() from public, anon;
revoke execute on function public.set_page_permission(uuid, text, smallint) from public, anon;
revoke execute on function public.set_user_preset(uuid, text) from public, anon;
revoke execute on function public.set_preset_level(text, text, smallint) from public, anon;
revoke execute on function public.assign_default_preset() from public, anon, authenticated;
grant execute on function public.get_permission_matrix() to authenticated;
grant execute on function public.set_page_permission(uuid, text, smallint) to authenticated;
grant execute on function public.set_user_preset(uuid, text) to authenticated;
grant execute on function public.set_preset_level(text, text, smallint) to authenticated;

-- ========== 参照権限（書込みは上の関数経由のみ） ==========
alter table public.permission_presets enable row level security;
alter table public.permission_preset_levels enable row level security;
alter table public.user_presets enable row level security;

drop policy if exists "authenticated can read presets" on public.permission_presets;
create policy "authenticated can read presets" on public.permission_presets
  for select to authenticated using (true);

drop policy if exists "authenticated can read preset levels" on public.permission_preset_levels;
create policy "authenticated can read preset levels" on public.permission_preset_levels
  for select to authenticated using (true);

drop policy if exists "own or super admin can read user presets" on public.user_presets;
create policy "own or super admin can read user presets" on public.user_presets
  for select to authenticated
  using (user_id = auth.uid() or (select public.is_super_admin()));

-- プリセットの変更・割り当ての変更も開いている画面へリアルタイム通知
do $$
begin
  if not exists (select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'permission_preset_levels') then
    alter publication supabase_realtime add table public.permission_preset_levels;
  end if;
  if not exists (select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'user_presets') then
    alter publication supabase_realtime add table public.user_presets;
  end if;
end $$;
