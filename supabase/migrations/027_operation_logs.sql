-- 操作ログ：だれが・いつ・何を操作したかを各テーブルのトリガーで自動記録する
-- 閲覧は社長のみ（search_operation_logs 経由）

create extension if not exists pg_trgm with schema extensions;

create table if not exists public.operation_logs (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  user_id uuid,
  user_name text not null default '',
  action text not null check (action in ('insert', 'update', 'delete')),
  table_name text not null,
  category text not null,
  summary text not null default '',
  item_name text not null default '',
  site_name text not null default '',
  company_name text not null default '',
  record_id text,
  old_data jsonb,
  new_data jsonb,
  search_text text not null default ''
);

create index if not exists operation_logs_created_at_idx on public.operation_logs (created_at desc);
create index if not exists operation_logs_user_idx on public.operation_logs (user_id, created_at desc);
create index if not exists operation_logs_category_idx on public.operation_logs (category, created_at desc);
create index if not exists operation_logs_search_trgm_idx
  on public.operation_logs using gin (search_text extensions.gin_trgm_ops);

alter table public.operation_logs enable row level security;
-- ポリシーなし＝直接の読み書きは不可。記録はトリガー、閲覧は関数経由のみ。

-- ========== 表示用の名前 ==========
create or replace function public.op_field_label(p_col text)
returns text
language sql
immutable
set search_path = public
as $$
  select case p_col
    when 'quantity' then '数量'
    when 'site_name' then '現場名'
    when 'company_name' then '会社名'
    when 'manager_name' then '担当者'
    when 'registrant_name' then '登録者'
    when 'operator_name' then '操作者'
    when 'name' then '名前'
    when 'type' then '種類'
    when 'maker' then 'メーカー'
    when 'detail' then '詳細'
    when 'unit' then '単位'
    when 'unit_price' then '単価'
    when 'specification' then '規格'
    when 'category' then '区分'
    when 'source_file' then '取込元'
    when 'planned_date' then '予定日'
    when 'status' then '状態'
    when 'returned' then '返却'
    when 'returned_at' then '返却日時'
    when 'return_type' then '返却種別'
    when 'period_start' then '貸出開始'
    when 'period_end' then '貸出終了'
    when 'level' then '権限'
    when 'preset_key' then 'プリセット'
    when 'role' then '部署'
    when 'address' then '住所'
    when 'office_location' then '事務所'
    when 'number' then 'ナンバー'
    when 'vehicle_type' then '車種'
    when 'model' then 'タイプ'
    when 'fuel_type' then '燃料'
    when 'work_date' then '作業日'
    when 'work_time' then '時間'
    when 'work_description' then '作業内容'
    when 'workers' then '作業員'
    when 'vehicles' then '使用車両'
    when 'note' then '備考'
    when 'email' then 'メール'
    when 'locked' then 'ロック'
    else p_col
  end;
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
    else coalesce(p_key, '')
  end;
$$;

create or replace function public.op_level_label(p_level text)
returns text
language sql
immutable
set search_path = public
as $$
  select case p_level
    when '0' then '見えない'
    when '1' then '閲覧'
    when '2' then '操作'
    when '3' then '編集'
    when 'null' then 'プリセット通り'
    else coalesce(p_level, 'プリセット通り')
  end;
$$;

create or replace function public.op_item_name(p_item_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select concat_ws(' ', nullif(type, ''), nullif(maker, ''), nullif(detail, ''))
    from public.inventory where id = p_item_id
  ), '');
$$;

create or replace function public.op_text(p_value jsonb)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when p_value is null or p_value = 'null'::jsonb then '（空）'
    when jsonb_typeof(p_value) = 'string' then
      case when p_value #>> '{}' = '' then '（空）' else left(p_value #>> '{}', 60) end
    when jsonb_typeof(p_value) = 'boolean' then case when p_value::text = 'true' then 'はい' else 'いいえ' end
    when jsonb_typeof(p_value) = 'array' then left((select string_agg(x, '・') from jsonb_array_elements_text(p_value) x), 60)
    else left(p_value::text, 60)
  end;
$$;

-- ========== 記録トリガー ==========
create or replace function public.log_operation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_action text := lower(tg_op);
  v_action_label text := case tg_op when 'INSERT' then '追加' when 'UPDATE' then '変更' else '削除' end;
  v_user uuid := auth.uid();
  v_user_name text := '';
  v_category text := tg_table_name;
  v_desc text := '';
  v_item text := '';
  v_site text := coalesce(v_row->>'site_name', '');
  v_company text := coalesce(v_row->>'company_name', '');
  v_changes text := '';
  v_summary text;
  k text;
begin
  -- 変更内容（更新時のみ）。記録不要な列は除く
  if tg_op = 'UPDATE' then
    select string_agg(
             public.op_field_label(key) || ': ' ||
             case when tg_table_name in ('user_page_permissions', 'permission_preset_levels') and key = 'level'
               then public.op_level_label(v_old->>key) || '→' || public.op_level_label(v_new->>key)
               else public.op_text(v_old->key) || '→' || public.op_text(v_new->key)
             end,
             '、' order by key)
      into v_changes
      from jsonb_object_keys(v_new) as key
     where key not in ('updated_at', 'created_at', 'updated_by', 'failed_attempts', 'last_login_at', 'id')
       and (v_old->key) is distinct from (v_new->key);
    if v_changes is null then
      return null; -- 実質的な変更なし（ログイン回数などのみ）
    end if;
  end if;

  if v_user is not null then
    select coalesce(name, '') into v_user_name from public.users_profile where id = v_user;
  end if;
  if v_user is null then
    v_user_name := 'システム';
  end if;

  case tg_table_name
    when 'inventory' then
      v_category := '在庫';
      v_item := concat_ws(' ', nullif(v_row->>'type', ''), nullif(v_row->>'maker', ''), nullif(v_row->>'detail', ''));
      v_desc := '商品「' || v_item || '」を' || v_action_label;
      if tg_op = 'INSERT' then v_desc := v_desc || '（数量 ' || coalesce(v_row->>'quantity', '0') || '）'; end if;
    when 'inventory_logs' then
      v_category := '入出庫';
      v_item := public.op_item_name((v_row->>'item_id')::uuid);
      v_desc := case v_row->>'change_type' when 'in' then '入庫' when 'out' then '出庫' else coalesce(v_row->>'change_type', '') end
        || '「' || v_item || '」×' || coalesce(v_row->>'quantity', '');
      if tg_op <> 'INSERT' then v_desc := '入出庫記録を' || v_action_label || '：' || v_desc; end if;
    when 'daily_reports' then
      v_category := '日報';
      v_desc := case
        when tg_op = 'INSERT' and v_row->>'status' = 'draft' then '日報を一時保存'
        when tg_op = 'INSERT' then '日報を登録'
        when tg_op = 'UPDATE' and v_old->>'status' = 'draft' and v_new->>'status' = 'confirmed' then '一時保存した日報を登録'
        when tg_op = 'UPDATE' then '日報を変更'
        when tg_op = 'DELETE' and v_row->>'status' = 'draft' then '一時保存した日報を削除'
        else '日報を削除'
      end || '（' || coalesce(v_row->>'work_date', '') || ' ' || v_site || '）';
    when 'daily_report_materials' then
      v_category := '日報';
      v_item := public.op_item_name((v_row->>'item_id')::uuid);
      select coalesce(site_name, '') into v_site from public.daily_reports where id = (v_row->>'report_id')::uuid;
      v_site := coalesce(v_site, '');
      v_desc := '日報の材料を' || v_action_label || '「' || v_item || '」×' || coalesce(v_row->>'quantity', '');
    when 'lending_items' then
      v_category := '貸出';
      v_item := coalesce(v_row->>'name', '');
      v_desc := '貸出品「' || v_item || '」を' || v_action_label;
    when 'lending_records' then
      v_category := '貸出';
      select coalesce(name, '') into v_item from public.lending_items where id = (v_row->>'lending_item_id')::uuid;
      v_item := coalesce(v_item, '');
      v_desc := case
        when tg_op = 'INSERT' then '貸出登録'
        when tg_op = 'UPDATE' and coalesce(v_old->>'returned', 'false') = 'false' and v_new->>'returned' = 'true'
          then '返却' || case when v_new->>'return_type' is not null and v_new->>'return_type' <> '' then '（' || (v_new->>'return_type') || '）' else '' end
        when tg_op = 'UPDATE' then '貸出記録を変更'
        else '貸出記録を削除'
      end || '「' || v_item || '」担当:' || coalesce(v_row->>'manager_name', '');
    when 'material_prices' then
      v_category := '材料単価';
      v_item := concat_ws(' ', nullif(v_row->>'name', ''), nullif(v_row->>'specification', ''));
      v_desc := '材料単価「' || v_item || '」を' || v_action_label || '（¥' || coalesce(v_row->>'unit_price', '') || '）';
    when 'material_reserve_items' then
      v_category := '材料確保';
      v_item := public.op_item_name((v_row->>'item_id')::uuid);
      select coalesce(site_name, ''), coalesce(company_name, '') into v_site, v_company
        from public.material_reserve_sites where id = (v_row->>'site_id')::uuid;
      v_site := coalesce(v_site, ''); v_company := coalesce(v_company, '');
      v_desc := '材料確保を' || v_action_label || '「' || v_item || '」×' || coalesce(v_row->>'quantity', '');
    when 'material_reserve_sites' then
      v_category := '現場';
      v_desc := '現場「' || v_site || '」を' || v_action_label;
    when 'site_details' then
      v_category := '現場';
      v_desc := '現場詳細「' || v_site || '」を' || v_action_label;
    when 'vehicles' then
      v_category := '車両';
      v_desc := '車両「' || coalesce(v_row->>'number', '') || '」を' || v_action_label;
    when 'users_profile' then
      v_category := 'アカウント';
      v_desc := 'アカウント「' || coalesce(v_row->>'name', '') || '」を' || v_action_label;
    when 'user_page_permissions' then
      v_category := '権限';
      select coalesce(name, '') into k from public.users_profile where id = (v_row->>'user_id')::uuid;
      v_desc := coalesce(k, '') || ' の「' || public.op_page_label(v_row->>'page_key') || '」を'
        || public.op_level_label(v_new->>'level') || 'に設定';
      v_changes := '';
    when 'user_presets' then
      v_category := '権限';
      select coalesce(name, '') into k from public.users_profile where id = (v_row->>'user_id')::uuid;
      v_desc := coalesce(k, '') || ' のプリセットを「'
        || coalesce((select label from public.permission_presets where key = v_row->>'preset_key'), v_row->>'preset_key', '') || '」に設定';
      v_changes := '';
    when 'permission_preset_levels' then
      v_category := '権限';
      v_desc := 'プリセット「' || coalesce((select label from public.permission_presets where key = v_row->>'preset_key'), '')
        || '」の「' || public.op_page_label(v_row->>'page_key') || '」を' || public.op_level_label(v_row->>'level') || 'に設定';
      v_changes := '';
    else
      v_desc := tg_table_name || ' を' || v_action_label;
  end case;

  v_summary := v_desc || case when coalesce(v_changes, '') <> '' then '　［' || v_changes || '］' else '' end;

  insert into public.operation_logs (
    user_id, user_name, action, table_name, category, summary,
    item_name, site_name, company_name, record_id, old_data, new_data, search_text
  ) values (
    v_user, coalesce(v_user_name, ''), v_action, tg_table_name, v_category, v_summary,
    coalesce(v_item, ''), coalesce(v_site, ''), coalesce(v_company, ''), v_row->>'id', v_old, v_new,
    -- 区分名（例：入出庫）は含めない。「出庫」で入庫まで引っかかるのを防ぐため。区分は専用の条件で絞る
    lower(concat_ws(' ', v_user_name, v_action_label, v_summary, v_item, v_site, v_company))
  );
  return null;
end;
$$;

revoke execute on function public.log_operation() from public, anon, authenticated;

do $$
declare
  t text;
begin
  foreach t in array array[
    'inventory', 'inventory_logs', 'daily_reports', 'daily_report_materials',
    'lending_items', 'lending_records', 'material_prices',
    'material_reserve_items', 'material_reserve_sites', 'site_details', 'vehicles',
    'users_profile', 'user_page_permissions', 'user_presets', 'permission_preset_levels'
  ] loop
    execute format('drop trigger if exists zz_log_operation on public.%I', t);
    execute format(
      'create trigger zz_log_operation after insert or update or delete on public.%I
         for each row execute function public.log_operation()', t);
  end loop;
end $$;

-- ========== 検索（社長のみ） ==========
-- p_query：スペース区切りの各語がどこか（人・内容・材料・現場・会社）に含まれるものに絞る
-- それ以外の条件は指定したものすべてで絞る
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
  if not public.is_super_admin() then
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

revoke execute on function public.search_operation_logs(text, uuid, text, text, text, text, text, text, timestamptz, timestamptz, int, int) from public, anon;
grant execute on function public.search_operation_logs(text, uuid, text, text, text, text, text, text, timestamptz, timestamptz, int, int) to authenticated;

-- 検索候補（材料名・現場名・会社名）
create or replace function public.operation_log_suggestions()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_super_admin() then
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

revoke execute on function public.operation_log_suggestions() from public, anon;
grant execute on function public.operation_log_suggestions() to authenticated;
