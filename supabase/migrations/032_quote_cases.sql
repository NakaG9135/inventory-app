-- 見積り事例：過去の見積りに現場の条件（工事種類・連棟数・階数・引込容量など）を付けて保存し、
-- 新しい現場の条件に近い見積りを探して、その品目・数量を下書きに使う
-- 権限は「材料単価」：閲覧＝探して使う / 操作＝登録・条件の修正 / 編集＝削除

create table if not exists public.quote_cases (
  id uuid primary key default gen_random_uuid(),
  title text not null default '',            -- 件名
  client text not null default '',           -- 宛先
  quote_date date,                           -- 見積日
  source_file text not null default '',      -- 取込元ファイル名
  work_type text not null default '',        -- 工事種類（ハウス電源配線・引込工事・高圧受電など）
  house_units integer,                       -- 連棟数（シングル＝1）
  floors integer,                            -- 階数（平屋＝1）
  buildings integer,                         -- 棟数
  capacity_kva numeric,                      -- 引込容量（kVA）
  service_kind text not null default ''      -- 引込：light＝電灯 / power＝動力 / both＝両方
    check (service_kind in ('', 'light', 'power', 'both')),
  structure text not null default '',        -- 構造（RC・S・SRC・木造など）
  floor_area numeric,                        -- 延床面積（㎡）
  site_area numeric,                         -- 敷地面積（㎡）
  duration_months numeric,                   -- 工期（月）
  subtotal numeric not null default 0,       -- 税抜小計
  note text not null default '',             -- メモ
  groups jsonb not null default '[]'::jsonb, -- 内訳（工事区分ごとの品目・数量・単価）
  extras jsonb not null default '[]'::jsonb, -- 表紙の追加行（運搬費・北電申請など）
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists quote_cases_work_type_idx on public.quote_cases (work_type);
-- 同じファイルを二重に登録しない
create unique index if not exists quote_cases_source_file_idx
  on public.quote_cases (source_file) where source_file <> '';

alter table public.quote_cases enable row level security;

drop policy if exists "perm_select_quote_cases" on public.quote_cases;
drop policy if exists "perm_insert_quote_cases" on public.quote_cases;
drop policy if exists "perm_update_quote_cases" on public.quote_cases;
drop policy if exists "perm_delete_quote_cases" on public.quote_cases;
create policy "perm_select_quote_cases" on public.quote_cases
  for select to authenticated using ((select public.page_level('material_prices')) >= 1);
create policy "perm_insert_quote_cases" on public.quote_cases
  for insert to authenticated with check ((select public.page_level('material_prices')) >= 2);
create policy "perm_update_quote_cases" on public.quote_cases
  for update to authenticated using ((select public.page_level('material_prices')) >= 2);
create policy "perm_delete_quote_cases" on public.quote_cases
  for delete to authenticated using ((select public.page_level('material_prices')) >= 3);

revoke all on public.quote_cases from anon;
