-- 材料確保: 現場テーブル
create table if not exists material_reserve_sites (
  id uuid default gen_random_uuid() primary key,
  site_name text not null unique,
  manager_name text not null default '',
  created_at timestamptz default now()
);

-- 材料確保: 確保品テーブル
create table if not exists material_reserve_items (
  id uuid default gen_random_uuid() primary key,
  site_id uuid not null references material_reserve_sites(id) on delete cascade,
  item_id uuid not null references inventory(id) on delete cascade,
  quantity int not null default 0,
  operator_name text not null default '',
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(site_id, item_id)
);

-- RLS
alter table material_reserve_sites enable row level security;
alter table material_reserve_items enable row level security;

-- Sites policies
create policy "auth_select_reserve_sites" on material_reserve_sites for select to authenticated using (true);
create policy "auth_insert_reserve_sites" on material_reserve_sites for insert to authenticated with check (true);
create policy "auth_update_reserve_sites" on material_reserve_sites for update to authenticated using (true);
create policy "auth_delete_reserve_sites" on material_reserve_sites for delete to authenticated using (true);

-- Items policies
create policy "auth_select_reserve_items" on material_reserve_items for select to authenticated using (true);
create policy "auth_insert_reserve_items" on material_reserve_items for insert to authenticated with check (true);
create policy "auth_update_reserve_items" on material_reserve_items for update to authenticated using (true);
create policy "auth_delete_reserve_items" on material_reserve_items for delete to authenticated using (true);
