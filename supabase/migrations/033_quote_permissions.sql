-- 「見積り作成」「見積り事例」を「材料単価」から分けて、権限管理で別々に設定できるようにする
-- 見積り作成：閲覧＝見積りを作る・Excel出力（単価と見積り事例も読む。操作・編集も同じ）
-- 見積り事例：閲覧＝事例を見る / 操作＝登録・条件の修正 / 編集＝削除
-- 初期値は今の「材料単価」と同じ値をプリセット・個別設定とも写すので、誰の使える範囲も変わらない

create or replace function public.permission_page_keys()
returns text[]
language sql
immutable
set search_path = public
as $$
  select array[
    'inventory', 'reserves', 'lending', 'sites', 'report', 'report_logs',
    'material_prices', 'quotes', 'quote_cases', 'logs', 'master', 'vehicles', 'workers', 'settings',
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
    when p_page in ('permissions', 'operation_logs', 'employees') then 0
    when p_role = 'admin' then
      case when p_page in ('material_prices', 'quotes', 'quote_cases') then 1 else 3 end
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
    when 'quotes' then '見積り作成'
    when 'quote_cases' then '見積り事例'
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

-- 今の「材料単価」の値を写す
insert into public.permission_preset_levels (preset_key, page_key, level, updated_at)
select pl.preset_key, k, pl.level, now()
from public.permission_preset_levels pl
cross join unnest(array['quotes', 'quote_cases']) as k
where pl.page_key = 'material_prices'
on conflict (preset_key, page_key) do nothing;

insert into public.user_page_permissions (user_id, page_key, level, updated_at, updated_by)
select up.user_id, k, up.level, now(), up.updated_by
from public.user_page_permissions up
cross join unnest(array['quotes', 'quote_cases']) as k
where up.page_key = 'material_prices' and up.level is not null
on conflict (user_id, page_key) do nothing;

-- 単価：見積り作成でも単価を当てるために読む
alter policy "perm_select_material_prices" on public.material_prices
  using ((select public.page_level('material_prices')) >= 1 or (select public.page_level('quotes')) >= 1);

-- 見積り事例：見積り作成でも「似た見積りから作る」・宛先の候補・内訳の候補に読む
alter policy "perm_select_quote_cases" on public.quote_cases
  using ((select public.page_level('quote_cases')) >= 1 or (select public.page_level('quotes')) >= 1);
alter policy "perm_insert_quote_cases" on public.quote_cases
  with check ((select public.page_level('quote_cases')) >= 2);
alter policy "perm_update_quote_cases" on public.quote_cases
  using ((select public.page_level('quote_cases')) >= 2);
alter policy "perm_delete_quote_cases" on public.quote_cases
  using ((select public.page_level('quote_cases')) >= 3);
