-- 材料単価テーブル
create table if not exists material_prices (
  id uuid default gen_random_uuid() primary key,
  name text not null,            -- 名称
  specification text not null default '',  -- 規格
  unit text not null default '',           -- 単位
  unit_price numeric not null default 0,   -- 単価（最高値を採用）
  source_file text not null default '',    -- 取込元ファイル名
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 名称+規格でユニーク（重複排除のキー）
create unique index if not exists idx_material_prices_name_spec
  on material_prices (name, specification);

-- 検索用インデックス
create index if not exists idx_material_prices_name on material_prices (name);

-- RLS
alter table material_prices enable row level security;

create policy "Authenticated users can read material_prices"
  on material_prices for select
  to authenticated
  using (true);

create policy "Authenticated users can manage material_prices"
  on material_prices for all
  to authenticated
  using (true)
  with check (true);
